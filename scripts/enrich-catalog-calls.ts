/**
 * Batch enrichment of imported catalogue calls (src/lib/fundingCatalogImport/enrich.ts).
 *
 *   # who would be enriched (writes nothing)
 *   node ./node_modules/tsx/dist/cli.cjs scripts/enrich-catalog-calls.ts --dry-run [--limit 20]
 *   # enrich: --sample takes a spread of eligible calls (for the cost report);
 *   # otherwise calls with two weeks or more left first, soonest first
 *   node ./node_modules/tsx/dist/cli.cjs scripts/enrich-catalog-calls.ts --apply --confirm-target <db> --operator-email <super admin> [--limit 20] [--concurrency 2]
 *   # reverse a run
 *   node ./node_modules/tsx/dist/cli.cjs scripts/enrich-catalog-calls.ts --rollback <runId> --confirm-target <db>
 *
 * Resumable: enriched calls, calls waiting in review and robots-disallowed
 * pages are skipped; a failed call is retried after 2^attempts days. Each
 * apply ends with a cost report (LLM calls, tokens, cost from usage_logs for
 * the operator's PLATFORM tenant during the run) and a projection for every
 * eligible call, written to storage/enrichment-reports/.
 */
import fs from 'node:fs'
import path from 'node:path'

import { Prisma } from '@prisma/client'

import prisma from '../src/lib/prisma'
import { ENRICH_SOURCE_KEY, ENRICH_VERSION, enrichImportedCall, rollbackEnrichmentRun, type EnrichmentOutcome } from '../src/lib/fundingCatalogImport/enrich'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

/** Released, LITE, open or rolling, with an official URL, and not parked. */
const ELIGIBLE = Prisma.sql`
  fc.import_run_id IS NOT NULL AND fc.visibility::text = 'GLOBAL_CATALOG' AND fc.catalog_status::text = 'PUBLISHED'
  AND COALESCE(fc.is_active, true) AND COALESCE(fc.enrichment_level, 'LITE') = 'LITE'
  AND COALESCE(cardinality(fc.official_urls), 0) + (CASE WHEN fc.source_url IS NULL THEN 0 ELSE 1 END) > 0
  AND fc.source_closed_at IS NULL
  AND (COALESCE(fc.is_rolling, false) OR COALESCE(fc.entry_closes_at, fc.final_deadline_at) IS NULL OR COALESCE(fc.entry_closes_at, fc.final_deadline_at) >= CURRENT_DATE)
  AND COALESCE(fc.metadata->'enrichment'->>'status', '') NOT IN ('enriched', 'needs_review', 'robots_disallowed')
  -- COALESCE: for a call never attempted every test below is NULL, and
  -- NOT (NULL) would silently drop it.
  AND NOT COALESCE(
    fc.metadata->'enrichment'->>'status' = 'failed'
    AND (fc.metadata->'enrichment'->>'at')::timestamptz > now() - make_interval(days => power(2, COALESCE((fc.metadata->'enrichment'->>'attempts')::int, 1))::int),
    false
  )`

async function main() {
  const confirmTarget = arg('confirm-target')
  const database = (await prisma.$queryRawUnsafe<Array<{ name: string }>>('SELECT current_database() AS name'))[0].name

  const rollback = arg('rollback')
  if (rollback) {
    if (confirmTarget !== database) throw new Error(`--confirm-target must equal the target database name (${database}).`)
    console.log(JSON.stringify(await rollbackEnrichmentRun(prisma, rollback)))
    return
  }

  const limit = Math.max(1, Number(arg('limit') || 20))
  const concurrency = Math.max(1, Math.min(Number(arg('concurrency') || 2), 4))
  const [{ eligible }] = await prisma.$queryRaw<Array<{ eligible: number }>>(Prisma.sql`SELECT count(*)::int AS eligible FROM funding_calls fc WHERE ${ELIGIBLE}`)
  const candidates = await prisma.$queryRaw<Array<{ id: string; title: string; closes: string | null }>>(Prisma.sql`
    SELECT fc.id, COALESCE(fc.scheme_title, fc.title) AS title, COALESCE(fc.entry_closes_at, fc.final_deadline_at)::text AS closes
    FROM funding_calls fc WHERE ${ELIGIBLE}
    ORDER BY ${flag('sample')
      // A spread of the eligible set, so the cost and pass rate generalise.
      ? Prisma.sql`md5(fc.id)`
      // Calls with time left to apply first: enriching one that closes today helps nobody.
      : Prisma.sql`(COALESCE(fc.entry_closes_at, fc.final_deadline_at) >= CURRENT_DATE + 14) DESC NULLS LAST,
                   COALESCE(fc.entry_closes_at, fc.final_deadline_at) ASC NULLS LAST, fc.id`}
    LIMIT ${limit}`)
  console.log(`${eligible} eligible open/rolling LITE calls; taking ${candidates.length}.`)
  if (!flag('apply')) {
    candidates.forEach((c) => console.log(`  ${c.closes || 'rolling'}  ${c.title.slice(0, 90)}`))
    console.log('Dry run: nothing fetched or written.')
    return
  }
  if (confirmTarget !== database) throw new Error(`--confirm-target must equal the target database name (${database}).`)

  const platform = await prisma.tenant.findFirst({ where: { atiId: 'PLATFORM' }, select: { id: true } })
  const operatorUser = await prisma.user.findFirst({ where: { email: arg('operator-email') || '' }, select: { id: true, email: true } })
  if (!platform || !operatorUser) throw new Error('Needs the PLATFORM tenant and --operator-email of an existing super admin.')
  const operator = { userId: operatorUser.id, email: operatorUser.email, role: 'ADMIN' as const, tenantId: platform.id }

  const run = await prisma.fundingImportRun.create({
    data: { source_key: ENRICH_SOURCE_KEY, mode: 'ENRICH', status: 'RUNNING', importer_version: ENRICH_VERSION, operator_email: operator.email, target_database: database },
  })
  const startedAt = new Date()
  console.log(`Enrich run ${run.id} (concurrency ${concurrency}).`)

  const outcomes: EnrichmentOutcome[] = []
  const queue = [...candidates]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const t = Date.now()
        const outcome = await enrichImportedCall({ db: prisma, callId: next.id, operator, runId: run.id, log: console.log })
        outcomes.push(outcome)
        console.log(`  ${outcome.status.padEnd(12)} ${Math.round((Date.now() - t) / 1000)}s  page ${outcome.pageChars}ch · docs ${outcome.documents} · rules ${outcome.guidelineItems}  ${outcome.title.slice(0, 60)}${outcome.reasons.length ? `  [${outcome.reasons.join('; ')}]` : ''}`)
      }
    })
  )

  const usage = await prisma.$queryRaw<Array<{ calls: number; input: number; output: number; cost: number }>>(Prisma.sql`
    SELECT count(*)::int AS calls, COALESCE(sum("inputTokens"), 0)::int AS input, COALESCE(sum("outputTokens"), 0)::int AS output,
           COALESCE(sum((meta->'cost'->>'actualCost')::float), 0)::float AS cost
    FROM usage_logs WHERE "tenantId" = ${platform.id} AND "userId" = ${operator.userId} AND "startedAt" >= (${startedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')`)
  const byModel = await prisma.$queryRaw<Array<{ model: string; calls: number; cost: number }>>(Prisma.sql`
    SELECT COALESCE("modelClass", '?') AS model, count(*)::int AS calls, COALESCE(sum((meta->'cost'->>'actualCost')::float), 0)::float AS cost
    FROM usage_logs WHERE "tenantId" = ${platform.id} AND "userId" = ${operator.userId} AND "startedAt" >= (${startedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    GROUP BY 1 ORDER BY 3 DESC`)
  const tally = (status: string) => outcomes.filter((o) => o.status === status).length
  const attempted = outcomes.filter((o) => o.status !== 'SKIPPED').length
  const u = usage[0]
  const perCall = attempted > 0 ? u.cost / attempted : 0
  const report = {
    runId: run.id,
    database,
    at: startedAt.toISOString(),
    minutes: Math.round((Date.now() - startedAt.getTime()) / 6000) / 10,
    outcomes: { enriched: tally('ENRICHED'), needsReview: tally('NEEDS_REVIEW'), skipped: tally('SKIPPED'), failed: tally('FAILED') },
    gatePassRate: attempted > 0 ? Math.round((tally('ENRICHED') / attempted) * 1000) / 10 : null,
    llm: { calls: u.calls, inputTokens: u.input, outputTokens: u.output, costUsd: Math.round(u.cost * 10000) / 10000, byModel },
    perCallUsd: Math.round(perCall * 10000) / 10000,
    projection: { eligibleCalls: eligible, estimatedUsd: Math.round(perCall * eligible * 100) / 100, estimatedHoursAtConcurrency: Math.round(((Date.now() - startedAt.getTime()) / Math.max(attempted, 1)) * eligible / concurrency / 36e5 * 10) / 10 },
    calls: outcomes,
  }
  await prisma.fundingImportRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', finished_at: new Date(), counts: report.outcomes as never, report: { llm: report.llm, projection: report.projection } as never } })
  const dir = path.resolve('storage/enrichment-reports')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `enrich-${run.id}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\n${JSON.stringify({ outcomes: report.outcomes, gatePassRate: report.gatePassRate, llm: { calls: u.calls, inputTokens: u.input, outputTokens: u.output, costUsd: report.llm.costUsd }, perCallUsd: report.perCallUsd, projection: report.projection }, null, 2)}`)
  console.log(`Report: ${file}`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
