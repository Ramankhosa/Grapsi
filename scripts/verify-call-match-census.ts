/**
 * Proves the fix for the figure that disagreed with its own list.
 *
 * For each sampled call it runs the census, then checks the three things that
 * were broken:
 *   1. the count a report shows and the list the call window shows are the
 *      same rows,
 *   2. nobody is tiered above the people ranked ahead of them,
 *   3. the retired per-researcher scoring is counted nowhere.
 *
 * Read-only apart from the census it is testing. Run against dev.
 */
import 'dotenv/config'

import prisma from '../src/lib/prisma'
import { Prisma } from '../src/lib/prisma-generated'
import { CALL_MATCH_CENSUS_VERSION, refreshCallMatches, storedCallMatches } from '../src/lib/fundingDept/callMatchCensus'
import { textArray } from '../src/lib/fundingDept/callSql'
import { getIncomingCalls } from '../src/lib/fundingDept/incomingCalls'
import { currentQualifyingMatchSql } from '../src/lib/fundingDept/reportDefinitions'

const SAMPLE = Number(process.env.SAMPLE_CALLS || 3)

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/**
 * What the reranker actually scores on this installation.
 *
 * The tier thresholds decide what every report counts, and a cross-encoder's
 * absolute scale is domain-specific: an institution whose calls and profiles
 * are both broadly worded sits lower on it. Set
 * RESEARCHER_MATCH_RERANK_MODERATE / _STRONG from these numbers rather than
 * from the shipped defaults, then re-run.
 */
async function printCalibration(tenantId: string) {
  const rows = await prisma.$queryRaw<Array<{ score: number }>>(Prisma.sql`
    SELECT score FROM dsr_match_score_cache WHERE tenant_id = ${tenantId} ORDER BY score DESC`)
  const scores = rows.map((row) => Number(row.score))
  if (!scores.length) return
  const at = (p: number) => scores[Math.min(scores.length - 1, Math.floor(scores.length * p))]
  console.log(`\nReranker calibration — ${scores.length} scored (call, person) pairs`)
  console.log(`  max ${at(0).toFixed(3)} · p10 ${at(0.1).toFixed(3)} · median ${at(0.5).toFixed(3)} · min ${scores[scores.length - 1].toFixed(3)}`)
  console.log('  pairs that would count as matched faculty, by moderate threshold:')
  for (const threshold of [0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35]) {
    const n = scores.filter((score) => score >= threshold).length
    console.log(`    >= ${threshold.toFixed(2)}  ${String(n).padStart(5)}  (${((100 * n) / scores.length).toFixed(0)}%)`)
  }
  const strong = Number(process.env.RESEARCHER_MATCH_RERANK_STRONG || 0.65)
  const moderate = Number(process.env.RESEARCHER_MATCH_RERANK_MODERATE || 0.5)
  console.log(`  in force: moderate ${moderate}, strong ${strong}`)
  if (at(0) < moderate) {
    console.log('  WARNING: no pair reaches the moderate threshold, so every "matched faculty" figure will read 0.')
  }
}

/**
 * The invariant has to be proved where it can actually fail.
 *
 * On a corpus whose reranker scores all land below the moderate threshold,
 * "count equals the qualifying people in the list" holds trivially at 0 = 0.
 * So lower the threshold until real matches qualify and check it again — this
 * is the case that used to break, where a figure sat above a list of weak
 * people.
 */
async function proveAtLoweredThreshold(tenantId: string, callIds: string[], schoolIds: string[]) {
  const previous = process.env.RESEARCHER_MATCH_RERANK_MODERATE
  process.env.RESEARCHER_MATCH_RERANK_MODERATE = '0.40'
  console.log('\nWith the moderate threshold lowered to 0.40 (scores are reused, no new API calls):')
  try {
    let counted = 0
    for (const callId of callIds) {
      await refreshCallMatches(tenantId, callId)
      const rows = await storedCallMatches(tenantId, callId, schoolIds, 500)
      const qualifying = rows.filter((row) => row.matchTier === 'strong' || row.matchTier === 'moderate')
      counted += qualifying.length
      if (!qualifying.length) continue
      const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT count(*)::int n FROM funding_opportunity_matches m
         WHERE m.tenant_id = ${tenantId} AND m.funding_call_id = ${callId}
           AND m.school_id = ANY(${textArray(schoolIds)}) AND ${currentQualifyingMatchSql('m')}`)
      check(`${callId}: ${qualifying.length} qualifying, and the report counts the same`, n === qualifying.length, `report ${n}`)
      check(
        `${callId}: every counted person outranks every weak one`,
        rows.slice(0, qualifying.length).every((row) => row.matchTier !== 'weak'),
        rows.slice(0, 4).map((r) => `${r.name}=${r.matchTier}`).join(', ')
      )
    }
    check('lowering the threshold produced qualifying matches to test against', counted > 0, `${counted} qualifying`)
  } finally {
    if (previous === undefined) delete process.env.RESEARCHER_MATCH_RERANK_MODERATE
    else process.env.RESEARCHER_MATCH_RERANK_MODERATE = previous
    // Leave the stored census as the real thresholds would have it.
    for (const callId of callIds) await refreshCallMatches(tenantId, callId)
  }
}

async function main() {
  // The tenant has to have people placed in schools, or there is nothing for a
  // school-shaped report to count.
  const [tenant] = await prisma.$queryRaw<Array<{ tenant_id: string; n: number }>>(Prisma.sql`
    SELECT u."tenantId" tenant_id, count(*)::int n
      FROM users u
      JOIN researcher_profiles p ON p.user_id = u.id
      JOIN tenant_org_units unit ON unit.id = p.org_unit_id AND unit.is_active
     WHERE u."tenantId" IS NOT NULL AND unit.path[1] IS NOT NULL
     GROUP BY 1 ORDER BY n DESC LIMIT 1`)
  if (!tenant) throw new Error('No tenant with placed researcher profiles on this database.')
  console.log(`Tenant ${tenant.tenant_id} · ${tenant.n} profiles\n`)

  const schools = await prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
    SELECT id, name FROM tenant_org_units WHERE tenant_id = ${tenant.tenant_id} AND depth = 0 AND is_active ORDER BY name`)
  const schoolIds = schools.map((s) => s.id)

  const calls = await prisma.$queryRaw<Array<{ id: string; title: string }>>(Prisma.sql`
    SELECT fc.id, COALESCE(fc.scheme_title, fc.title) title FROM funding_calls fc
     WHERE ((fc."tenantId" = ${tenant.tenant_id} AND (fc.status='PUBLISHED' OR fc.catalog_status='PUBLISHED'))
            OR (fc."tenantId" IS NULL AND fc.visibility='GLOBAL_PUBLISHED' AND fc.status='PUBLISHED'))
     ORDER BY COALESCE(fc.close_date, fc."deadlineAt") DESC NULLS LAST LIMIT ${SAMPLE}`)

  // How badly the retired scoring inflated the same calls, for the record.
  const [before] = await prisma.$queryRaw<Array<{ pairs: number; counted: number }>>(Prisma.sql`
    SELECT count(*)::int pairs, count(*) FILTER (WHERE match_tier IN ('strong','moderate'))::int counted
      FROM funding_opportunity_matches
     WHERE tenant_id = ${tenant.tenant_id} AND source_version = 'person-call-census-v1'`)
  console.log(`Retired v1 rows: ${before.pairs} pairs, ${before.counted} of them counted as strong/moderate\n`)

  for (const call of calls) {
    console.log(`Call ${call.id} — ${call.title}`)
    const result = await refreshCallMatches(tenant.tenant_id, call.id)
    console.log(`  censused: ${result.matched} matched of ${result.candidates} candidates (basis: ${result.basis})`)

    // What a report counts, straight from the shared SQL definition.
    const counts = await prisma.$queryRaw<Array<{ school_id: string; n: number }>>(Prisma.sql`
      SELECT school_id, count(*)::int n FROM funding_opportunity_matches m
       WHERE m.tenant_id = ${tenant.tenant_id} AND m.funding_call_id = ${call.id}
         AND m.school_id = ANY(${textArray(schoolIds)})
         AND ${currentQualifyingMatchSql('m')}
       GROUP BY school_id`)
    const countBySchool = new Map(counts.map((row) => [row.school_id, row.n]))

    for (const school of schools) {
      const listed = await storedCallMatches(tenant.tenant_id, call.id, [school.id], 500)
      const counted = countBySchool.get(school.id) || 0
      const qualifying = listed.filter((row) => row.matchTier === 'strong' || row.matchTier === 'moderate')
      if (counted === 0 && listed.length === 0) continue

      check(
        `${school.name}: the count equals the qualifying people in the list`,
        counted === qualifying.length,
        `report counts ${counted}, list holds ${qualifying.length} of ${listed.length} ranked`
      )
      // The symptom the coordinator reported: a count above a list whose best
      // person is weak. Impossible once both come from one scoring.
      check(
        `${school.name}: a counted match is never ranked below a weak one`,
        qualifying.length === 0 || listed.slice(0, qualifying.length).every((row) => row.matchTier !== 'weak'),
        `top of list: ${listed.slice(0, 3).map((r) => `${r.name}=${r.matchTier}`).join(', ')}`
      )
    }

    // The screen a coordinator actually opens.
    const incoming = await getIncomingCalls(tenant.tenant_id, {
      schoolIds, includeExpired: true, callId: call.id, asOf: new Date(), page: 1, pageSize: 1,
    })
    const row = incoming.rows[0]
    if (row) {
      const total = row.schools.reduce((sum, s) => sum + s.matchedFaculty, 0)
      check(
        'Incoming calls agrees with the stored census',
        total === Array.from(countBySchool.values()).reduce((sum, n) => sum + n, 0),
        `incoming ${total}`
      )
      console.log(`  incoming: ${row.matchedFaculty} matched faculty across ${row.schools.length} school(s)`)
    }
    console.log('')
  }

  await printCalibration(tenant.tenant_id)
  await proveAtLoweredThreshold(tenant.tenant_id, calls.map((call) => call.id), schoolIds)

  const [stale] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int n FROM funding_opportunity_matches
     WHERE source_version = 'person-call-census-v1' AND is_current`)
  check('no retired v1 row is still current', stale.n === 0, `${stale.n} still current`)

  const [versions] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int n FROM funding_opportunity_matches
     WHERE is_current AND source = 'matching' AND source_version <> ${CALL_MATCH_CENSUS_VERSION}`)
  check('every current automatic match comes from the new scoring', versions.n === 0, `${versions.n} rows`)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
