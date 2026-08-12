/**
 * Backfill: register a FundingCallDocument for every funding call that has
 * none, so section-routed extraction and document RAG cover the whole catalog.
 *
 *   - PDF intake source on disk  -> registered directly (parsed by pdfjs)
 *   - stored raw/normalized text -> persisted as a .txt-backed call_document
 *
 * Resumable: checksum dedupe makes re-runs no-ops. Processing (parse ->
 * sectionize -> chunk) is awaited per call so LLM section classification is
 * serialized; chunk embeddings run in the background behind the stored
 * embedding-jobs gate (use the admin embeddings backfill for stragglers).
 *
 * Run:
 *   node scripts/run-local-command.js node ./node_modules/tsx/dist/cli.cjs scripts/backfill-funding-call-documents.ts -- --limit 25
 *   ... --dry-run   lists candidates without writing anything
 */
import prisma from '@/lib/prisma';
import { fundingDocumentService } from '@/lib/fundingDocuments/service';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 ? Math.max(1, Number(args[limitIndex + 1]) || 25) : 25;

const OPERATOR = {
  userId: 'system-backfill',
  email: 'backfill@system.local',
  tenantId: null as string | null,
};

async function findCandidates() {
  return prisma.fundingCall.findMany({
    where: {
      documents: { none: {} },
      OR: [
        { raw_text: { not: null } },
        { normalized_text: { not: null } },
        { intake_job_id: { not: null } },
      ],
    },
    select: {
      id: true,
      scheme_title: true,
      title: true,
      source_url: true,
      raw_text: true,
      normalized_text: true,
      intake_job_id: true,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

async function backfillCall(call: Awaited<ReturnType<typeof findCandidates>>[number]) {
  // Prefer the original intake file so pages/sections carry real page numbers.
  if (call.intake_job_id) {
    const intakeJob = await prisma.fundingIntakeJob.findUnique({
      where: { id: call.intake_job_id },
      select: { input_type: true, source_file_path: true },
    });
    if (intakeJob?.input_type === 'pdf' && intakeJob.source_file_path) {
      try {
        const result = await fundingDocumentService.syncFromIntake(call.id, OPERATOR as any);
        return { mode: 'intake_file', documentId: result.document.id, duplicate: result.duplicate };
      } catch (error) {
        console.warn(`  intake file registration failed, falling back to stored text: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  const text = call.normalized_text || call.raw_text || '';
  if (!text.trim()) {
    return { mode: 'skipped_no_text' as const };
  }

  const result = await fundingDocumentService.createDocumentFromText({
    fundingCallId: call.id,
    text,
    fileNameHint: (call.scheme_title || call.title || 'funding-call').slice(0, 80),
    sourceUrl: call.source_url || null,
    documentKind: 'call_document',
    deferProcessing: true,
    operator: OPERATOR,
  });

  if (!result.duplicate) {
    await fundingDocumentService.processDocument(result.document.id, OPERATOR as any);
  }

  return { mode: 'stored_text', documentId: result.document.id, duplicate: result.duplicate };
}

async function run() {
  const candidates = await findCandidates();
  console.log(`Found ${candidates.length} funding call(s) without documents (limit ${limit})${dryRun ? ' [dry run]' : ''}`);

  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const call of candidates) {
    const label = call.scheme_title || call.title || call.id;
    if (dryRun) {
      console.log(`DRY   ${call.id}  ${label}`);
      continue;
    }
    try {
      const outcome = await backfillCall(call);
      if (outcome.mode === 'skipped_no_text') {
        skipped += 1;
        console.log(`SKIP  ${call.id}  ${label} (no stored text or file)`);
      } else {
        done += 1;
        console.log(`OK    ${call.id}  ${label} (${outcome.mode}${outcome.duplicate ? ', already registered' : ''})`);
      }
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${call.id}  ${label}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`\nBackfill finished: ${done} registered, ${skipped} skipped, ${failed} failed.`);
  if (candidates.length === limit) {
    console.log('More candidates may remain — run again to continue.');
  }
}

run()
  .catch((error) => {
    console.error('Backfill crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
