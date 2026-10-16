/**
 * Vector search benchmark for funding calls: exact scan vs the deployed index
 * (HNSW since 20261016100000) vs IVFFlat alternatives.
 *
 * Uses 50 stored call vectors as queries (no provider calls), with the
 * finder's typical filters (visible, published, active, open; half of the
 * queries also a country restriction). Measures p50/p95 latency and
 * recall@20 against the exact answer. Candidate indexes are built INSIDE a
 * transaction that is rolled back, so nothing is left in the database.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/benchmark-call-vector-search.ts [--queries 50] [--out docs/vector-index-benchmark.md]
 */
import fs from 'node:fs'

import prisma from '../src/lib/prisma'
import { fundingCallEmbeddingTarget } from '../src/lib/services/fundingCatalogService'
import { vectorSearchSettingsFor } from '../src/lib/vectorSearch'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function main() {
  const queriesWanted = Number(arg('queries') || 50)
  const out = arg('out')
  const { column } = fundingCallEmbeddingTarget()
  const total = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM funding_calls WHERE ${column} IS NOT NULL`))[0].n
  const version = (await prisma.$queryRawUnsafe<Array<{ v: string }>>(`SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'`))[0]?.v
  const queries = await prisma.$queryRawUnsafe<Array<{ id: string; vec: string }>>(
    `SELECT id, ${column}::text AS vec FROM funding_calls WHERE ${column} IS NOT NULL ORDER BY md5(id) LIMIT $1`,
    queriesWanted
  )
  // Mirrors recommendationSearchService.buildBaseConditions for a tenant user
  // (enum comparisons, not ::text casts, so the planner sees real estimates).
  const access = `(visibility = 'GLOBAL_PUBLISHED' OR visibility = 'GLOBAL_CATALOG' OR (visibility = 'TENANT_PRIVATE' AND "tenantId" = 'benchmark-tenant'))`
  const published = `(status = 'PUBLISHED' OR catalog_status = 'PUBLISHED') AND COALESCE(is_active, true) = true AND ${access}`
  const filters = `${published}
    AND (COALESCE(is_rolling, false) = true OR COALESCE(close_date, expiration_date) IS NULL OR COALESCE(close_date, expiration_date) >= CURRENT_DATE)
    AND (import_run_id IS NULL OR (source_closed_at IS NULL AND (entry_closes_at IS NULL OR entry_closes_at >= CURRENT_DATE)))`
  const broadFilters = published
  const countryFilter = `AND (import_run_id IS NULL OR residence_scope IS NULL OR residence_scope IN ('ANY','UNSPECIFIED') OR residence_country_codes && ARRAY['IN']::text[])`

  const appSettings = vectorSearchSettingsFor(version)
  const deployedIndexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'funding_calls' AND indexdef LIKE $1`,
    `%(${column} vector_cosine_ops)%`
  )

  let workload: 'finder' | 'broad' = 'finder'
  const run = async (tx: Tx, label: string, setup: string[]) => {
    for (const statement of setup) await tx.$executeRawUnsafe(statement)
    const times: number[] = []
    const results: string[][] = []
    let usedIndex = false
    let scan = ''
    for (let i = 0; i < queries.length; i++) {
      // Two workloads: the finder (open calls, half with a country filter) and
      // a broad one (every published call, open or closed) like "My areas" with
      // status=all, which is where an index can actually win the plan.
      const where = workload === 'finder' ? `${filters} ${i % 2 === 0 ? countryFilter : ''}` : broadFilters
      const sql = `SELECT id FROM funding_calls WHERE ${column} IS NOT NULL AND ${where}
                   ORDER BY ${column} <=> $1::vector LIMIT 20`
      if (i === 0) {
        const plan = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(`EXPLAIN ${sql}`, queries[i].vec)
        usedIndex = plan.some((row) => /Index Scan using .*(embedding|bench)/i.test(row['QUERY PLAN']))
        scan = (plan.map((row) => row['QUERY PLAN']).find((line) => /Scan/.test(line)) || '').replace(/\s*\(cost.*$/, '').replace(/^[\s>-]+/, '').slice(0, 80)
      }
      // Latency is the server's own execution time (EXPLAIN ANALYZE): Prisma's
      // interactive transaction adds a large, variable client overhead that
      // has nothing to do with the plan.
      const analyzed = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ 'Execution Time': number }> }>>(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, queries[i].vec)
      times.push(analyzed[0]['QUERY PLAN'][0]['Execution Time'])
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(sql, queries[i].vec)
      results.push(rows.map((r) => r.id))
    }
    return { label, times, results, usedIndex, scan }
  }

  const reports: Array<{ workload: string; label: string; p50: number; p95: number; recall: number; usedIndex: boolean; scan: string }> = []
  for (const current of ['finder', 'broad'] as const) {
    workload = current
    let exact: string[][] = []
    await prisma.$transaction(
      async (tx) => {
        const e = await run(tx, 'exact scan', ['SET LOCAL enable_indexscan = off', 'SET LOCAL enable_bitmapscan = off'])
        exact = e.results
        reports.push({ workload, label: e.label, p50: pct(e.times, 50), p95: pct(e.times, 95), recall: 1, usedIndex: e.usedIndex, scan: e.scan })
      },
      { timeout: 600_000 }
    )
    const recallOf = (results: string[][]) =>
      results.reduce((sum, ids, i) => sum + (exact[i].length === 0 ? 1 : ids.filter((id) => exact[i].includes(id)).length / exact[i].length), 0) / results.length

    const lists = Math.max(10, Math.round(Math.sqrt(total)))
    const variants: Array<{ label: string; build?: string; setup: string[] }> = [
      { label: 'deployed index, default settings', setup: [] },
      { label: `deployed index + app settings (${appSettings.map((x) => x.replace('SET LOCAL ', '')).join(', ') || 'none'})`, setup: appSettings },
      {
        label: `IVFFlat trained on the data (lists=${lists}), probes=10 + iterative`,
        build: `CREATE INDEX bench_ivf ON funding_calls USING ivfflat (${column} vector_cosine_ops) WITH (lists = ${lists})`,
        setup: ['SET LOCAL ivfflat.probes = 10', "SET LOCAL ivfflat.iterative_scan = 'relaxed_order'"],
      },
    ]
    for (const variant of variants) {
      try {
        await prisma.$transaction(
          async (tx) => {
            if (variant.build) {
              // Drop the deployed index(es) ONLY inside this rolled-back
              // transaction so the planner has to choose the candidate.
              for (const { name } of deployedIndexes) await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "${name}"`)
              const started = Date.now()
              await tx.$executeRawUnsafe(variant.build)
              console.log(`  built ${variant.label.split(' ')[0]} in ${Date.now() - started} ms`)
            }
            const r = await run(tx, variant.label, variant.setup)
            reports.push({ workload, label: r.label, p50: pct(r.times, 50), p95: pct(r.times, 95), recall: recallOf(r.results), usedIndex: r.usedIndex, scan: r.scan })
            throw new Error('ROLLBACK_BENCHMARK')
          },
          { timeout: 900_000 }
        )
      } catch (error) {
        if (!String(error).includes('ROLLBACK_BENCHMARK')) {
          console.log(`  ${variant.label}: ${String(error).slice(0, 200)}`)
        }
      }
    }

  }

  const lines = [
    `# Funding-call vector search benchmark`,
    '',
    `${new Date().toISOString().slice(0, 10)} · ${total.toLocaleString('en-US')} vectors in \`${column}\` · pgvector ${version} · ${queries.length} queries, top 20. Workloads: **finder** (open, published, visible; half with a residence-country filter) and **broad** (every published, visible call, open or closed). Latency is server execution time from EXPLAIN ANALYZE.`,
    '',
    '| Workload | Method | Plan | p50 ms | p95 ms | Recall@20 |',
    '|---|---|---|---|---|---|',
    ...reports.map((r) => `| ${r.workload} | ${r.label} | ${r.scan} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${(r.recall * 100).toFixed(1)}% |`),
  ]
  console.log(lines.join('\n'))
  if (out) fs.writeFileSync(out, lines.join('\n') + '\n')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
