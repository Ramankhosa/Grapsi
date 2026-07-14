/**
 * Manual verification harness for the researcher-matching relevance gate +
 * evidence changes. Backfills embeddings for the demo researchers, then runs
 * searches through researcherSearchService and prints compact summaries.
 *
 * Usage: node ./node_modules/tsx/dist/cli.cjs scripts/verify-researcher-matching.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function readEnvFile(envPath: string) {
  const buffer = fs.readFileSync(envPath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }
  return buffer.toString('utf8');
}

for (const filename of ['.env', '.env.local']) {
  const envPath = path.join(process.cwd(), filename);
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(readEnvFile(envPath));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = value;
    }
  }
}

function summarize(label: string, response: any) {
  console.log(`\n=== ${label} ===`);
  console.log(`candidates=${response.totalCandidates} results=${response.totalResults} basis=${response.scoreBasis} degraded=${response.degradedMode}`);
  for (const r of response.results) {
    console.log(`  [${r.matchTier}] ${r.displayName} — score=${r.score} sem=${r.semanticSimilarity} rerank=${r.rerankScore}`);
    for (const ev of r.evidence) {
      const bits = [ev.title, ev.snippet ? `"${ev.snippet.slice(0, 90)}"` : null].filter(Boolean).join(' — ');
      console.log(`      · ${ev.source} (${ev.similarity}): ${bits || '(profile similarity)'}`);
    }
    if (r.sharedTerms.length) {
      console.log(`      · shared terms: ${r.sharedTerms.join(', ')}`);
    }
  }
}

async function main() {
  const [{ researcherProfileService }, { fundingPublicationService }, { researcherSearchService }, { default: prisma }] =
    await Promise.all([
      import('../src/lib/services/researcherProfileService'),
      import('../src/lib/researcherProfile/funding-publications'),
      import('../src/lib/services/researcherSearchService'),
      import('../src/lib/prisma'),
    ]);

  console.log('Backfilling embeddings (profiles, research areas, publications)...');
  for (let pass = 1; pass <= 20; pass++) {
    const [profiles, areas, pubs] = [
      await researcherProfileService.backfillResearcherProfileEmbeddings(100),
      await researcherProfileService.backfillResearchAreaEmbeddings(100),
      await fundingPublicationService.backfillEmbeddings(100),
    ];
    const processed = (profiles?.processed || 0) + (areas?.processed || 0) + (pubs?.processed || 0);
    const succeeded = (profiles?.succeeded || 0) + (areas?.succeeded || 0) + (pubs?.succeeded || 0);
    console.log(`  pass ${pass}: processed=${processed} succeeded=${succeeded}`);
    if (processed === 0) break;
    if (succeeded === 0) {
      console.log('  no progress — stopping backfill (check API keys/logs)');
      break;
    }
  }

  const coverage = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       (SELECT COUNT(*) FROM researcher_profiles) AS profiles,
       (SELECT COUNT(*) FROM researcher_profiles WHERE embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL) AS profiles_embedded,
       (SELECT COUNT(*) FROM researcher_saved_research_areas WHERE embedding IS NOT NULL OR embedding_voyage_1024 IS NOT NULL) AS areas_embedded,
       (SELECT COUNT(*) FROM reference_library WHERE 'my-publication' = ANY(tags) AND (funding_embedding IS NOT NULL OR funding_embedding_voyage_1024 IS NOT NULL)) AS pubs_embedded`
  );
  console.log('Coverage:', JSON.stringify(coverage[0], (_, v) => (typeof v === 'bigint' ? Number(v) : v)));

  summarize(
    'Text mode: drone/satellite crop ML (should match precision-agriculture researchers, NOT all 50)',
    await researcherSearchService.search({
      query: 'machine learning for crop yield prediction using satellite imagery and drone data in Indian agriculture',
      limit: 20,
    })
  );

  summarize(
    'Text mode: unrelated topic (should return few or zero results)',
    await researcherSearchService.search({
      query: 'medieval European manuscript preservation and paleography archives',
      limit: 20,
    })
  );

  const call = await prisma.fundingCall.findFirst({
    where: { status: 'PUBLISHED' },
    select: { id: true, scheme_title: true, title: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (call) {
    summarize(
      `Funding-call mode: "${call.scheme_title || call.title}"`,
      await researcherSearchService.search({ fundingCallId: call.id, limit: 20 })
    );
  } else {
    console.log('\n(no published funding call in local DB — skipped funding-call mode)');
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
