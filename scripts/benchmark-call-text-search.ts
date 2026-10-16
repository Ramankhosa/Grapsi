/**
 * Coverage diff + timing for the finder's text-match condition: the UNION
 * form (buildFundingCallTextSearchCondition) against the OR-EXISTS form it
 * replaced (legacyFundingCallTextSearchCondition). Both must return exactly
 * the same calls for every query; exits 1 if any query differs.
 *
 * Runs each query with the finder's base filters (published, active, visible
 * to a tenant user, open) and once without the open-call filter. Read-only.
 *
 *   node ./node_modules/tsx/dist/cli.cjs scripts/benchmark-call-text-search.ts
 */
import { Prisma } from '@prisma/client'

import prisma from '../src/lib/prisma'
import { buildFundingCallTextSearchCondition, legacyFundingCallTextSearchCondition } from '../src/lib/services/recommendationSearchService'

const QUERIES = [
  'cancer immunotherapy', 'climate adaptation', 'machine learning', 'quantum computing', 'cystic fibrosis',
  'malaria vaccine', 'renewable energy storage', 'ocean biodiversity', 'early career fellowship', 'postdoctoral fellowship',
  'mental health adolescents', 'antimicrobial resistance', 'water sanitation', 'neuroscience', 'agriculture food security',
  'social sciences humanities', 'artificial intelligence ethics', 'materials science', 'travel grant conference', 'women in science',
  'rare diseases', 'public health india', 'battery', 'semiconductor', 'epidemiology', 'innovation startup',
  'digital health', 'biodiversity conservation', 'education research', 'physics',
]

const access = Prisma.sql`(visibility = 'GLOBAL_PUBLISHED' OR visibility = 'GLOBAL_CATALOG' OR (visibility = 'TENANT_PRIVATE' AND "tenantId" = 'benchmark-tenant'))`
const published = Prisma.sql`(status = 'PUBLISHED' OR catalog_status = 'PUBLISHED') AND COALESCE(is_active, true) = true AND ${access}`
const open = Prisma.sql`(COALESCE(is_rolling, false) = true OR COALESCE(close_date, expiration_date) IS NULL OR COALESCE(close_date, expiration_date) >= CURRENT_DATE)
  AND (import_run_id IS NULL OR (source_closed_at IS NULL AND (entry_closes_at IS NULL OR entry_closes_at >= CURRENT_DATE)))`

async function timed(condition: Prisma.Sql, base: Prisma.Sql) {
  const sql = Prisma.sql`SELECT id FROM funding_calls WHERE ${condition} AND ${base}`
  const plan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': Array<{ 'Execution Time': number }> }>>(
    Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`
  )
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(sql)
  return { ms: plan[0]['QUERY PLAN'][0]['Execution Time'], ids: new Set(rows.map((row) => row.id)) }
}

const pct = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((p / 100) * values.length))]

async function main() {
  const oldTimes: number[] = []
  const newTimes: number[] = []
  let differing = 0
  let matched = 0
  for (const query of QUERIES) {
    for (const [label, base] of [['open', Prisma.sql`${published} AND ${open}`], ['all', published]] as const) {
      const before = await timed(legacyFundingCallTextSearchCondition(query), base)
      const after = await timed(buildFundingCallTextSearchCondition(query), base)
      oldTimes.push(before.ms)
      newTimes.push(after.ms)
      matched += after.ids.size
      const missing = [...before.ids].filter((id) => !after.ids.has(id))
      const extra = [...after.ids].filter((id) => !before.ids.has(id))
      if (missing.length || extra.length) {
        differing++
        console.log(`DIFF "${query}" (${label}): ${missing.length} missing, ${extra.length} extra`)
      }
    }
  }
  console.log(`${QUERIES.length * 2} query runs · ${matched.toLocaleString('en-US')} matches · ${differing} differing`)
  console.log(`OR-EXISTS  p50 ${pct(oldTimes, 50).toFixed(1)} ms · p95 ${pct(oldTimes, 95).toFixed(1)} ms`)
  console.log(`UNION      p50 ${pct(newTimes, 50).toFixed(1)} ms · p95 ${pct(newTimes, 95).toFixed(1)} ms`)
  if (differing > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
