/**
 * Embeds released imported-catalogue calls in bulk.
 *
 * Builds exactly what a publish would embed (fundingCallEmbeddingInput /
 * fundingCallEmbeddingTarget from fundingCatalogService) and sends 128
 * documents per provider request. A call is (re-)embedded when its vector is
 * missing, its embedding_version is not the current one, or the text it would
 * embed has changed since (embedding_input_hash) — a re-import or enrichment
 * that rewrites the description is picked up without a version bump.
 *
 * Writes only the vector column and a metadata merge, with raw SQL, so
 * updatedAt does not move. Only rows with import_run_id are ever touched.
 * Open calls go first. Resumable: just run it again.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/embed-catalog-calls.ts [--dry-run] [--limit N] [--batch 128]
 */
import prisma from '../src/lib/prisma'
import { embeddingInputHash } from '../src/lib/fundingCatalogImport/embed'
import { EmbeddingService } from '../src/lib/services/embeddingService'
import { fundingCallEmbeddingInput, fundingCallEmbeddingTarget } from '../src/lib/services/fundingCatalogService'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const dryRun = flag('dry-run')
  const limit = arg('limit') ? Number(arg('limit')) : Infinity
  const batchSize = Math.max(1, Math.min(Number(arg('batch') || 128), 128))
  const target = fundingCallEmbeddingTarget()
  const column = target.column
  console.log(`Provider ${target.provider} · model ${target.modelName} · ${target.outputDimensionality} dims → ${column} · version ${target.version}`)

  // Candidates: released imported calls (in the catalogue, or promoted to
  // the funding department), open ones first.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; has_vector: boolean; version: string | null; input_hash: string | null }>>(`
    SELECT id, (${column} IS NOT NULL) AS has_vector,
           metadata->>'embedding_version' AS version, metadata->>'embedding_input_hash' AS input_hash
    FROM funding_calls
    WHERE import_run_id IS NOT NULL AND visibility::text IN ('GLOBAL_CATALOG', 'GLOBAL_PUBLISHED')
      AND catalog_status::text = 'PUBLISHED' AND COALESCE(is_active, true) = true
    ORDER BY CASE WHEN source_closed_at IS NULL AND (COALESCE(is_rolling, false)
               OR COALESCE(entry_closes_at, close_date::date) >= CURRENT_DATE) THEN 0 ELSE 1 END, id`)
  console.log(`${rows.length} released catalogue calls.`)

  const embedder = new EmbeddingService()
  let examined = 0
  let embedded = 0
  let skipped = 0
  let chars = 0
  const pending: Array<{ id: string; text: string; title: string; hash: string }> = []

  const flush = async () => {
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    chars += batch.reduce((n, item) => n + item.text.length, 0)
    if (dryRun) {
      embedded += batch.length
      return
    }
    const result = await embedder.generateDocumentEmbeddingsBatch(batch.map((item) => ({ text: item.text, title: item.title })))
    if (result.error) throw new Error(`Provider error after ${embedded} calls: ${result.error}. Re-run to resume.`)
    const now = new Date().toISOString()
    for (let i = 0; i < batch.length; i++) {
      const vector = `[${result.embeddings[i].join(',')}]`
      await prisma.$executeRawUnsafe(
        `UPDATE funding_calls
            SET ${column} = $1::vector,
                metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                  'embedding_status', 'generated', 'embedding_version', $2::text, 'embedding_model', $3::text,
                  'embedding_dimensions', $4::int, 'embedding_task_type', 'RETRIEVAL_DOCUMENT',
                  'embedding_updated_at', $5::text, 'embedding_error', NULL, 'embedding_input_hash', $6::text)
          WHERE id = $7 AND import_run_id IS NOT NULL`,
        vector,
        target.version,
        result.modelName || target.modelName,
        result.outputDimensionality || target.outputDimensionality,
        now,
        batch[i].hash,
        batch[i].id
      )
    }
    embedded += batch.length
    console.log(`  embedded ${embedded}`)
  }

  for (let i = 0; i < rows.length && embedded + pending.length < limit; i += 500) {
    const slice = rows.slice(i, i + 500)
    const calls = await prisma.fundingCall.findMany({ where: { id: { in: slice.map((r) => r.id) } } })
    const byId = new Map(calls.map((call) => [call.id, call]))
    for (const row of slice) {
      if (embedded + pending.length >= limit) break
      const call = byId.get(row.id)
      if (!call) continue
      examined++
      const input = fundingCallEmbeddingInput(call)
      const hash = embeddingInputHash(input)
      if (row.has_vector && row.version === target.version && row.input_hash === hash) {
        skipped++
        continue
      }
      pending.push({ id: row.id, ...input, hash })
      if (pending.length >= batchSize) await flush()
    }
  }
  await flush()
  const tokens = Math.round(chars / 4)
  console.log(`${dryRun ? 'Would embed' : 'Embedded'} ${embedded} · up to date ${skipped} · examined ${examined} · ~${tokens.toLocaleString()} tokens`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
