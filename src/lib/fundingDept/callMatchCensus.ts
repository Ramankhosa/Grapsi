/**
 * The stored call-to-people match census.
 *
 * Every DSR report that says "matched faculty" counts rows in
 * `funding_opportunity_matches`, and the call window lists the people it found.
 * Until this module they were produced by two different algorithms running in
 * opposite directions:
 *
 *   count  for each researcher, "which calls suit me?", tiered against that
 *          researcher's OWN best call — so everyone's top call was `strong`
 *          however poor the fit, and a broad call collected a hundred of them
 *   list   for each call, "who suits this call?", reranked and tiered on
 *          absolute thresholds
 *
 * A pair could therefore be `strong` in the count and `weak` in the list, which
 * is exactly what a coordinator saw: "5 matched faculty" above two weak people.
 *
 * So the census now runs in the same direction as the list, through the same
 * `researcherSearchService` pipeline, and the call window reads these rows back
 * instead of searching again. One scoring, written once, read by both.
 *
 * Cost is bounded by the score cache: only a changed call or a changed profile
 * is re-scored, so a steady-state refresh makes no reranker calls at all.
 */
import { randomUUID } from 'node:crypto'

import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { researcherSearchService, type RerankScoreCache } from '@/lib/services/researcherSearchService'

import { openCallSql, textArray, utcTimestamp, visibleCallSql } from './callSql'
import { getTenantTimeZone } from '@/lib/tenant/locale'
import {
  DEFAULT_MATCH_WIDTH, MATCH_WIDTHS, MATCH_WIDTH_COPY, MATCH_WIDTH_CUTOFFS, bandForScore, type MatchWidth,
} from './matchBands'
import { UNCOUNTED_MATCH_VERSIONS } from './reportDefinitions'

/**
 * Written to `source_version`. Reports count only this version, so switching it
 * retires the previous census rather than mixing two scorings in one number.
 */
export const CALL_MATCH_CENSUS_VERSION = 'call-people-census-v2'
/** Versions whose scoring has been retired; never counted, kept for history. */
export const SUPERSEDED_CENSUS_VERSIONS = ['person-call-census-v1'] as const

const CENSUS_FRESH_MS = 6 * 60 * 60 * 1000
/** Calls refreshed in one background pass, so a sweep cannot run unbounded. */
const CENSUS_CALLS_PER_PASS = 25

export type CallMatchState = {
  fresh: boolean
  refreshedAt: Date | null
  basis: string | null
  matched: number
  candidates: number
}

/**
 * Everything the scoring depends on, as one hash: the call's own text and the
 * tenant's people. A changed profile re-censuses the calls, a changed call
 * re-censuses that call, and nothing else moves.
 */
async function callFingerprint(tenantId: string, callId: string) {
  const rows = await prisma.$queryRaw<Array<{ fingerprint: string }>>(Prisma.sql`
    SELECT md5(concat_ws('|', ${CALL_MATCH_CENSUS_VERSION},
      (SELECT concat_ws(':', id, "updatedAt", xmin::text) FROM funding_calls WHERE id = ${callId}),
      (SELECT string_agg(concat_ws(':', u.id, u."updatedAt", p.updated_at, p.org_unit_id, u.status, u.xmin::text, p.xmin::text)::text, ',' ORDER BY u.id)
         FROM users u LEFT JOIN researcher_profiles p ON p.user_id = u.id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', a.id, a.updated_at, a.xmin::text)::text, ',' ORDER BY a.id)
         FROM researcher_saved_research_areas a JOIN users u ON u.id = a.user_id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', r.id, r."updatedAt", r.xmin::text)::text, ',' ORDER BY r.id)
         FROM reference_library r JOIN users u ON u.id = r.user_id WHERE u."tenantId" = ${tenantId}),
      (SELECT string_agg(concat_ws(':', id, updated_at, xmin::text)::text, ',' ORDER BY id) FROM tenant_org_units WHERE tenant_id = ${tenantId}),
      ${process.env.RESEARCHER_MATCH_MIN_SIMILARITY || ''}, ${process.env.RESEARCHER_MATCH_RERANK_GATE || ''},
      ${process.env.RESEARCHER_MATCH_RERANK_STRONG || ''}, ${process.env.RESEARCHER_MATCH_RERANK_MODERATE || ''},
      ${process.env.RESEARCHER_MATCH_VECTOR_GAP || ''},
      ${process.env.EMBEDDING_PROVIDER || 'gemini'}, ${process.env.VOYAGE_OUTPUT_DIMENSIONS || '1024'},
      ${process.env.GOOGLE_EMBEDDINGS_DIMENSIONS || '768'}
    )) fingerprint`)
  return rows[0].fingerprint
}

/** Reranker scores already held for this call, keyed by what was scored. */
function scoreCache(tenantId: string, callId: string): RerankScoreCache {
  return {
    async lookup(entries) {
      if (entries.length === 0) return new Map()
      const rows = await prisma.$queryRaw<Array<{ user_id: string; score: number }>>(Prisma.sql`
        SELECT user_id, score FROM dsr_match_score_cache
         WHERE tenant_id = ${tenantId} AND call_id = ${callId}
           AND (user_id, input_hash) IN (${Prisma.join(
             entries.map((entry) => Prisma.sql`(${entry.userId}, ${entry.inputHash})`)
           )})`)
      return new Map(rows.map((row) => [row.user_id, row.score]))
    },
    async store(entries) {
      if (entries.length === 0) return
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO dsr_match_score_cache (tenant_id, call_id, user_id, input_hash, score, scored_at)
        VALUES ${Prisma.join(
          entries.map(
            (entry) =>
              Prisma.sql`(${tenantId}, ${callId}, ${entry.userId}, ${entry.inputHash}, ${entry.score}, (now() AT TIME ZONE 'UTC'))`
          )
        )}
        ON CONFLICT (tenant_id, call_id, user_id)
        DO UPDATE SET input_hash = EXCLUDED.input_hash, score = EXCLUDED.score, scored_at = EXCLUDED.scored_at`)
    },
  }
}

const running = new Map<string, Promise<{ matched: number; candidates: number; basis: string }>>()

/**
 * Score this call against the tenant's people and store the result.
 *
 * Deliberately tenant-wide rather than per school: one reranker pass answers
 * every school at once, and a call that reaches twenty schools is scored once
 * rather than twenty times.
 */
export function refreshCallMatches(tenantId: string, callId: string) {
  const key = `${tenantId}:${callId}`
  const prior = running.get(key)
  if (prior) return prior
  const task = census(tenantId, callId).finally(() => running.delete(key))
  running.set(key, task)
  return task
}

async function census(tenantId: string, callId: string) {
  const fingerprint = await callFingerprint(tenantId, callId)
  const cached = await prisma.$queryRaw<Array<{ matched: number; candidates: number; basis: string }>>(Prisma.sql`
    SELECT matched, candidates, basis FROM dsr_call_match_state
     WHERE tenant_id = ${tenantId} AND call_id = ${callId} AND fingerprint = ${fingerprint} AND version = ${CALL_MATCH_CENSUS_VERSION}`)
  if (cached[0]) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE dsr_call_match_state SET refreshed_at = (now() AT TIME ZONE 'UTC')
       WHERE tenant_id = ${tenantId} AND call_id = ${callId} AND fingerprint = ${fingerprint}`)
    return cached[0]
  }

  const search = await researcherSearchService.search({
    fundingCallId: callId,
    filters: { tenantOnly: true, includeSelf: true },
    requesterTenantId: tenantId,
    census: true,
    scoreCache: scoreCache(tenantId, callId),
  })

  // Where each matched person sits, so every school reads its own slice.
  const placements = search.results.length
    ? await prisma.$queryRaw<Array<{ user_id: string; org_unit_id: string | null; school_id: string | null }>>(Prisma.sql`
        SELECT p.user_id, p.org_unit_id, u.path[1] school_id
          FROM researcher_profiles p LEFT JOIN tenant_org_units u ON u.id = p.org_unit_id
         WHERE p.user_id = ANY(${textArray(search.results.map((result) => result.userId))})`)
    : []
  const placement = new Map(placements.map((row) => [row.user_id, row]))

  const at = new Date()
  const stamp = utcTimestamp(at)
  const runId = randomUUID()
  const rows = search.results.flatMap((result) => {
    const where = placement.get(result.userId)
    // Somebody with no unit belongs to no school's numbers. The dossier already
    // surfaces them separately as a data gap; inventing a school here would put
    // them in one school's count and nobody else's.
    if (!where?.school_id) return []
    return [{
      id: `fom_${randomUUID()}`,
      userId: result.userId,
      unitId: where.org_unit_id,
      schoolId: where.school_id,
      score: result.score,
      tier: result.matchTier,
      reason: result.matchReason,
    }]
  })

  if (await callFingerprint(tenantId, callId) !== fingerprint) {
    throw new Error('Matching inputs changed during the census. Refresh the report to read the updated scores.')
  }

  await prisma.$transaction(async (tx) => {
    if (rows.length) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO funding_opportunity_matches(id, tenant_id, funding_call_id, user_id, org_unit_id, school_id,
          match_score, match_tier, match_reason, source, source_version, inferred, is_current, match_run_id,
          refreshed_at, first_seen_at, last_seen_at, created_at, updated_at)
        SELECT r.id, ${tenantId}, ${callId}, r."userId", r."unitId", r."schoolId", r.score, r.tier, r.reason,
               'matching', ${CALL_MATCH_CENSUS_VERSION}, false, true, ${runId}, ${stamp}, ${stamp}, ${stamp}, ${stamp}, ${stamp}
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS r(id text, "userId" text, "unitId" text, "schoolId" text, score double precision, tier text, reason text)
        ON CONFLICT(tenant_id, funding_call_id, user_id, school_id) DO UPDATE SET
          org_unit_id = EXCLUDED.org_unit_id, match_score = EXCLUDED.match_score, match_tier = EXCLUDED.match_tier,
          match_reason = EXCLUDED.match_reason, source = EXCLUDED.source, source_version = EXCLUDED.source_version,
          inferred = false, is_current = true, match_run_id = EXCLUDED.match_run_id,
          refreshed_at = EXCLUDED.refreshed_at, last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at`)
    }
    // Whoever this pass did not find is no longer a current match. Their row
    // stays as history — pendency reads matches a call had when it closed.
    await tx.$executeRaw(Prisma.sql`
      UPDATE funding_opportunity_matches SET is_current = false, updated_at = (now() AT TIME ZONE 'UTC')
       WHERE tenant_id = ${tenantId} AND funding_call_id = ${callId} AND is_current AND source = 'matching'
         AND match_run_id IS DISTINCT FROM ${runId}`)
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO dsr_call_match_state(tenant_id, call_id, version, fingerprint, basis, candidates, matched, refreshed_at)
      VALUES(${tenantId}, ${callId}, ${CALL_MATCH_CENSUS_VERSION}, ${fingerprint}, ${search.scoreBasis},
             ${search.totalCandidates}, ${rows.length}, (now() AT TIME ZONE 'UTC'))
      ON CONFLICT(tenant_id, call_id) DO UPDATE SET version = EXCLUDED.version, fingerprint = EXCLUDED.fingerprint,
        basis = EXCLUDED.basis, candidates = EXCLUDED.candidates, matched = EXCLUDED.matched, refreshed_at = EXCLUDED.refreshed_at`)
  }, { timeout: 60000 })

  return { matched: rows.length, candidates: search.totalCandidates, basis: search.scoreBasis }
}

export async function callMatchStates(tenantId: string, callIds: string[]) {
  const state = new Map<string, CallMatchState>()
  if (!callIds.length) return state
  const rows = await prisma.$queryRaw<Array<{ call_id: string; refreshed_at: Date; basis: string; matched: number; candidates: number }>>(Prisma.sql`
    SELECT call_id, refreshed_at, basis, matched, candidates FROM dsr_call_match_state
     WHERE tenant_id = ${tenantId} AND version = ${CALL_MATCH_CENSUS_VERSION} AND call_id = ANY(${textArray(callIds)})`)
  const stored = new Map(rows.map((row) => [row.call_id, row]))
  for (const callId of callIds) {
    const row = stored.get(callId)
    state.set(callId, {
      fresh: Boolean(row && Date.now() - row.refreshed_at.getTime() < CENSUS_FRESH_MS),
      refreshedAt: row?.refreshed_at ?? null,
      basis: row?.basis ?? null,
      matched: row?.matched ?? 0,
      candidates: row?.candidates ?? 0,
    })
  }
  return state
}

export type StoredMatch = {
  userId: string
  name: string
  email: string
  department: string | null
  orgUnitId: string | null
  schoolId: string
  score: number | null
  matchTier: string | null
  matchReason: string | null
  researchAreas: string[]
}

/**
 * The stored matches for one call, in one or more schools.
 *
 * This is the list the call window shows, and the rows every report counts, so
 * the two cannot disagree. Ordered the way they were scored.
 */
export async function storedCallMatches(
  tenantId: string,
  callId: string,
  schoolIds: string[],
  limit = 50,
  width: MatchWidth = DEFAULT_MATCH_WIDTH
): Promise<StoredMatch[]> {
  if (!schoolIds.length) return []
  const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`
    SELECT m.user_id, COALESCE(u.name, u.email) name, u.email, p.department, m.org_unit_id, m.school_id,
           m.match_score, m.match_tier, m.match_reason, COALESCE(p.research_areas, ARRAY[]::text[]) research_areas
      FROM funding_opportunity_matches m
      JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
      LEFT JOIN researcher_profiles p ON p.user_id = m.user_id
     WHERE m.tenant_id = ${tenantId} AND m.funding_call_id = ${callId}
       AND m.school_id = ANY(${textArray(schoolIds)})
       AND m.is_current AND m.source_version = ${CALL_MATCH_CENSUS_VERSION}
     ORDER BY m.match_score DESC NULLS LAST, name
     LIMIT ${limit}`)
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    department: row.department,
    orgUnitId: row.org_unit_id,
    schoolId: row.school_id,
    score: row.match_score,
    // The band is derived here, not read back, so the office's narrow/wide
    // setting re-labels the list without anything being re-scored.
    matchTier: bandForScore(row.match_score, width, row.match_tier),
    matchReason: row.match_reason,
    researchAreas: row.research_areas ?? [],
  }))
}

/**
 * Calls whose census is missing or stale, soonest deadline first.
 *
 * Only open calls: a closed call's matches are history, and pendency reads them
 * as they stood. This is what bounds the work to the live catalogue.
 */
export async function staleCallIds(tenantId: string, limit = CENSUS_CALLS_PER_PASS) {
  const timeZone = await getTenantTimeZone(tenantId)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT fc.id FROM funding_calls fc
     LEFT JOIN dsr_call_match_state s ON s.tenant_id = ${tenantId} AND s.call_id = fc.id AND s.version = ${CALL_MATCH_CENSUS_VERSION}
     WHERE ${visibleCallSql(tenantId, 'fc')} AND ${openCallSql('fc', timeZone)}
       AND (s.refreshed_at IS NULL OR s.refreshed_at < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${CENSUS_FRESH_MS / 1000}))
     ORDER BY COALESCE(fc.close_date, fc."deadlineAt") ASC NULLS LAST, fc.id
     LIMIT ${limit}`)
  return rows.map((row) => row.id)
}

export type MatchWidthPreview = {
  width: MatchWidth
  label: string
  help: string
  cutoffs: { strong: number; moderate: number }
  /** (call, person) pairs that would count as matched faculty at this width. */
  matchedPairs: number
  /** Distinct people who would be matched to at least one call. */
  matchedPeople: number
  /** Open calls that would have at least one matched person. */
  callsWithMatch: number
  /** Of those pairs, the ones that would read "Strong match". */
  strongPairs: number
}

/**
 * What each width would actually give this institution.
 *
 * The whole reason width is a setting is that no cutoff is right everywhere, so
 * the admin has to be able to see the consequence before choosing rather than
 * after. Read straight from the stored scores — no scoring is repeated, so this
 * is cheap enough to render on the settings screen and in a live control.
 *
 * Deliberately restricted to open calls and current rows: an office is choosing
 * how to run the work in front of them, not how to re-describe last year.
 */
export async function previewMatchWidths(tenantId: string, schoolIds?: string[]): Promise<MatchWidthPreview[]> {
  const timeZone = await getTenantTimeZone(tenantId)
  const scope = schoolIds?.length
    ? Prisma.sql`AND m.school_id = ANY(${textArray(schoolIds)})`
    : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{ moderate: number; pairs: number; people: number; calls: number; strong_pairs: number }>>(Prisma.sql`
    WITH scored AS (
      SELECT m.match_score score, m.user_id, m.funding_call_id
        FROM funding_opportunity_matches m
        JOIN funding_calls fc ON fc.id = m.funding_call_id
       WHERE m.tenant_id = ${tenantId} AND m.is_current AND m.inferred = false
         AND COALESCE(m.source_version,'') NOT IN (${Prisma.join(UNCOUNTED_MATCH_VERSIONS.map((v) => Prisma.sql`${v}`))})
         AND m.match_score IS NOT NULL
         AND ${visibleCallSql(tenantId, 'fc')} AND ${openCallSql('fc', timeZone)} ${scope}
    ), widths(moderate, strong) AS (VALUES ${Prisma.join(
      MATCH_WIDTHS.map((width) => {
        const cutoffs = MATCH_WIDTH_CUTOFFS[width]
        return Prisma.sql`(${cutoffs.moderate}::float8, ${cutoffs.strong}::float8)`
      })
    )})
    SELECT w.moderate,
           count(*) FILTER (WHERE s.score >= w.moderate)::int pairs,
           count(DISTINCT s.user_id) FILTER (WHERE s.score >= w.moderate)::int people,
           count(DISTINCT s.funding_call_id) FILTER (WHERE s.score >= w.moderate)::int calls,
           count(*) FILTER (WHERE s.score >= w.strong)::int strong_pairs
      FROM widths w LEFT JOIN scored s ON TRUE
     GROUP BY w.moderate`)
  const byModerate = new Map(rows.map((row) => [Number(row.moderate).toFixed(4), row]))
  return MATCH_WIDTHS.map((width) => {
    const cutoffs = MATCH_WIDTH_CUTOFFS[width]
    const row = byModerate.get(cutoffs.moderate.toFixed(4))
    return {
      width,
      label: MATCH_WIDTH_COPY[width].label,
      help: MATCH_WIDTH_COPY[width].help,
      cutoffs,
      matchedPairs: row?.pairs ?? 0,
      matchedPeople: row?.people ?? 0,
      callsWithMatch: row?.calls ?? 0,
      strongPairs: row?.strong_pairs ?? 0,
    }
  })
}

/**
 * People in a school with nothing to match on.
 *
 * Reports say "matching incomplete" when a school holds profiles the matcher
 * cannot read, and that claim has to be about the profiles themselves — not
 * about whether a particular call found them.
 */
export async function unprofiledInSchools(tenantId: string, schoolIds: string[]) {
  const unprofiled = new Map<string, string[]>()
  for (const schoolId of schoolIds) unprofiled.set(schoolId, [])
  if (!schoolIds.length) return unprofiled
  const rows = await prisma.$queryRaw<Array<{ school_id: string; user_id: string }>>(Prisma.sql`
    SELECT unit.path[1] school_id, u.id user_id
      FROM users u
      JOIN researcher_profiles p ON p.user_id = u.id
      JOIN tenant_org_units unit ON unit.id = p.org_unit_id AND unit.is_active
     WHERE u."tenantId" = ${tenantId} AND u.status = 'ACTIVE' AND unit.path[1] = ANY(${textArray(schoolIds)})
       AND p.embedding IS NULL AND p.embedding_voyage_1024 IS NULL
       AND COALESCE(array_length(p.research_areas, 1), 0) = 0
       AND COALESCE(array_length(p.keywords, 1), 0) = 0
       AND NOT EXISTS (SELECT 1 FROM researcher_saved_research_areas a WHERE a.user_id = u.id AND a.use_for_alerts)
       AND NOT EXISTS (SELECT 1 FROM reference_library r WHERE r.user_id = u.id AND r."isActive" AND 'my-publication' = ANY(r.tags))`)
  for (const row of rows) unprofiled.get(row.school_id)?.push(row.user_id)
  return unprofiled
}
