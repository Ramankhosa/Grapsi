/**
 * Recomputes ts_document for imported calls after
 * 20261016110000_funding_call_search_text widened what the trigger indexes.
 *
 * Touches imported rows only (import_run_id IS NOT NULL): the UPDATE assigns
 * NULL and the BEFORE UPDATE trigger rebuilds the document from the row. Raw
 * SQL, so updatedAt does not move. Legacy calls are recomputed in the Phase E
 * window, not here. Idempotent; dry run by default.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/refresh-catalog-search-text.ts [--apply]
 */
import prisma from '../src/lib/prisma'

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM funding_calls WHERE import_run_id IS NOT NULL ORDER BY id`
  console.log(`${rows.length} imported calls.`)
  if (!apply) {
    console.log('Dry run: re-run with --apply to recompute their search text.')
    return
  }
  let done = 0
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((row) => row.id)
    done += Number(
      await prisma.$executeRaw`UPDATE funding_calls SET ts_document = NULL WHERE id = ANY(${ids}::text[]) AND import_run_id IS NOT NULL`
    )
  }
  const empty = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM funding_calls WHERE import_run_id IS NOT NULL AND ts_document IS NULL`
  console.log(`Recomputed ${done} · still empty ${empty[0].n}`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
