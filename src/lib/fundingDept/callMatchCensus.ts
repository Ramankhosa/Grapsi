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
import {
  getProfileEmbeddingColumn, getPublicationEmbeddingColumn, researcherSearchService, type RerankScoreCache,
} from '@/lib/services/researcherSearchService'
import { canonicalAreasEnabled } from '@/lib/researchAreas/core'

import { openCallSql, textArray, utcTimestamp, visibleCallSql } from './callSql'
import { getTenantTimeZone } from '@/lib/tenant/locale'
import {
  DEFAULT_MATCH_WIDTH, MATCH_WIDTHS, MATCH_WIDTH_COPY, MATCH_WIDTH_CUTOFFS, bandForScore, type MatchWidth,
} from './matchBands'
import { currentAutomaticMatchSql, currentQualifyingMatchSql } from './reportDefinitions'

/**
 * Written to `source_version`. Reports count only this version, so switching it
 * retires the previous census rather than mixing two scorings in one number.
 */
export { CALL_MATCH_CENSUS_VERSION } from '@/lib/researcherMatching/config'
/** Versions whose scoring has been retired; never counted, kept for history. */
export const SUPERSEDED_CENSUS_VERSIONS = ['person-call-census-v1'] as const

import { CALL_MATCH_CENSUS_VERSION, CENSUS_FRESH_MS } from '@/lib/researcherMatching/config'
import { callFingerprint } from './callMatchFingerprint'
export { callFingerprint } from './callMatchFingerprint'
/** Calls refreshed in one background pass, so a sweep cannot run unbounded. */
const CENSUS_CALLS_PER_PASS = 25

export type CallMatchState = {
  fresh: boolean
  /** The last SUCCESSFUL census; null when none has ever succeeded. */
  refreshedAt: Date | null
  basis: string | null
  matched: number
  candidates: number
  /** missing: never attempted. failed: the latest attempt failed; the last good rows still stand. */
  status: 'ok' | 'failed' | 'missing'
  truncated: boolean
  lastAttemptAt: Date | null
  lastError: string | null
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
  // Only a successful census is reusable. The reranker's identity is part of
  // the fingerprint, so restoring or changing the model re-scores.
  const cached = await prisma.$queryRaw<Array<{ matched: number; candidates: number; basis: string }>>(Prisma.sql`
    SELECT matched, candidates, basis FROM dsr_call_match_state
     WHERE tenant_id = ${tenantId} AND call_id = ${callId} AND fingerprint = ${fingerprint}
       AND version = ${CALL_MATCH_CENSUS_VERSION} AND status = 'ok'`)
  if (cached[0]) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE dsr_call_match_state SET refreshed_at = (now() AT TIME ZONE 'UTC'), last_attempt_at = (now() AT TIME ZONE 'UTC')
       WHERE tenant_id = ${tenantId} AND call_id = ${callId} AND fingerprint = ${fingerprint}`)
    return cached[0]
  }

  try {
    return await scoreAndStore(tenantId, callId, fingerprint)
  } catch (error) {
    await recordCensusFailure(tenantId, callId, error).catch((stateError) => {
      console.error('Could not record the census failure', { callId, stateError })
    })
    throw error
  }
}

/** Minutes until a failed census is retried: 1, 2, 4 … 60, then daily after eight failures. */
export const CENSUS_RETRY_LIMIT = 8

/**
 * A failed census touches only its failure fields. The stored matches, the
 * fingerprint they were scored from and `refreshed_at` (the last success) all
 * stay, so every report keeps reading the last good numbers.
 */
async function recordCensusFailure(tenantId: string, callId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO dsr_call_match_state(tenant_id, call_id, version, fingerprint, basis, candidates, matched, refreshed_at,
      status, last_attempt_at, last_error, failure_count, retry_at)
    VALUES(${tenantId}, ${callId}, ${CALL_MATCH_CENSUS_VERSION}, '', 'none', 0, 0, NULL,
      'failed', (now() AT TIME ZONE 'UTC'), ${message}, 1, (now() AT TIME ZONE 'UTC') + interval '1 minute')
    ON CONFLICT(tenant_id, call_id) DO UPDATE SET status = 'failed', last_attempt_at = EXCLUDED.last_attempt_at,
      last_error = EXCLUDED.last_error, failure_count = dsr_call_match_state.failure_count + 1,
      retry_at = (now() AT TIME ZONE 'UTC') + make_interval(mins => CASE
        WHEN dsr_call_match_state.failure_count + 1 >= ${CENSUS_RETRY_LIMIT} THEN 1440
        ELSE LEAST(60, power(2, dsr_call_match_state.failure_count)::int) END)`)
}

async function scoreAndStore(tenantId: string, callId: string, fingerprint: string) {
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

  await prisma.$transaction(async (tx) => {
    // Checked inside the write, so a worker scored from older inputs can never
    // overwrite a census that a newer profile or call edit has already moved on.
    if (await callFingerprint(tenantId, callId, tx) !== fingerprint) {
      throw new Error('Matching inputs changed during the census. Refresh the report to read the updated scores.')
    }
    if (rows.length) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO funding_opportunity_matches(id, tenant_id, funding_call_id, user_id, org_unit_id, school_id,
          match_score, match_tier, match_reason, score_basis, source, source_version, inferred, is_current, match_run_id,
          refreshed_at, first_seen_at, last_seen_at, created_at, updated_at)
        SELECT r.id, ${tenantId}, ${callId}, r."userId", r."unitId", r."schoolId", r.score, r.tier, r.reason, ${search.scoreBasis},
               'matching', ${CALL_MATCH_CENSUS_VERSION}, false, true, ${runId}, ${stamp}, ${stamp}, ${stamp}, ${stamp}, ${stamp}
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS r(id text, "userId" text, "unitId" text, "schoolId" text, score double precision, tier text, reason text)
        ON CONFLICT(tenant_id, funding_call_id, user_id, school_id) DO UPDATE SET
          org_unit_id = EXCLUDED.org_unit_id, match_score = EXCLUDED.match_score, match_tier = EXCLUDED.match_tier,
          match_reason = EXCLUDED.match_reason, score_basis = EXCLUDED.score_basis, source = EXCLUDED.source,
          source_version = EXCLUDED.source_version, inferred = false, is_current = true, match_run_id = EXCLUDED.match_run_id,
          refreshed_at = EXCLUDED.refreshed_at, last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.updated_at`)
    }
    // Whoever this pass did not find is no longer a current match. Their row
    // stays as history — pendency reads matches a call had when it closed.
    await tx.$executeRaw(Prisma.sql`
      UPDATE funding_opportunity_matches SET is_current = false, updated_at = (now() AT TIME ZONE 'UTC')
       WHERE tenant_id = ${tenantId} AND funding_call_id = ${callId} AND is_current AND source = 'matching'
         AND match_run_id IS DISTINCT FROM ${runId}`)
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO dsr_call_match_state(tenant_id, call_id, version, fingerprint, basis, candidates, matched, refreshed_at,
        status, last_attempt_at, last_error, failure_count, retry_at, truncated)
      VALUES(${tenantId}, ${callId}, ${CALL_MATCH_CENSUS_VERSION}, ${fingerprint}, ${search.scoreBasis},
             ${search.totalCandidates}, ${rows.length}, (now() AT TIME ZONE 'UTC'),
             'ok', (now() AT TIME ZONE 'UTC'), NULL, 0, NULL, ${search.truncated})
      ON CONFLICT(tenant_id, call_id) DO UPDATE SET version = EXCLUDED.version, fingerprint = EXCLUDED.fingerprint,
        basis = EXCLUDED.basis, candidates = EXCLUDED.candidates, matched = EXCLUDED.matched, refreshed_at = EXCLUDED.refreshed_at,
        status = 'ok', last_attempt_at = EXCLUDED.last_attempt_at, last_error = NULL, failure_count = 0, retry_at = NULL,
        truncated = EXCLUDED.truncated`)
  }, { timeout: 60000 })

  return { matched: rows.length, candidates: search.totalCandidates, basis: search.scoreBasis }
}

export async function callMatchStates(tenantId: string, callIds: string[]) {
  const state = new Map<string, CallMatchState>()
  if (!callIds.length) return state
  const rows = await prisma.$queryRaw<Array<{ call_id: string; refreshed_at: Date | null; basis: string; matched: number; candidates: number;
    area_changed: boolean; status: string; truncated: boolean; last_attempt_at: Date | null; last_error: string | null }>>(Prisma.sql`
    SELECT call_id, refreshed_at, basis, matched, candidates, status, truncated, last_attempt_at, last_error,
           ${areaRevisionChangedSql(Prisma.sql`s.call_id`,Prisma.sql`s.refreshed_at`)} area_changed FROM dsr_call_match_state s
     WHERE tenant_id = ${tenantId} AND version = ${CALL_MATCH_CENSUS_VERSION} AND call_id = ANY(${textArray(callIds)})`)
  const stored = new Map(rows.map((row) => [row.call_id, row]))
  for (const callId of callIds) {
    const row = stored.get(callId)
    const succeeded = Boolean(row?.refreshed_at && row.basis !== 'none')
    state.set(callId, {
      fresh: Boolean(row?.refreshed_at && row.status === 'ok' && !row.area_changed && Date.now() - row.refreshed_at.getTime() < CENSUS_FRESH_MS),
      refreshedAt: row?.refreshed_at ?? null,
      basis: succeeded ? row!.basis : null,
      matched: row?.matched ?? 0,
      candidates: row?.candidates ?? 0,
      status: !row ? 'missing' : row.status === 'failed' ? 'failed' : 'ok',
      truncated: row?.truncated ?? false,
      lastAttemptAt: row?.last_attempt_at ?? null,
      lastError: row?.last_error ?? null,
    })
  }
  return state
}

/**
 * Whether a call's stored census can support a conclusion. A report may say
 * "no matching researcher" only for a call whose census ran, succeeded on the
 * current inputs, read everybody, and was scored by the reranker.
 */
export function censusSupportsConclusion(state: CallMatchState | undefined) {
  return Boolean(state && state.status === 'ok' && state.refreshedAt && !state.truncated && state.basis === 'rerank')
}

/** The census state for these calls, for readers that only need to know whether to trust a zero. */
export async function callCensusHealth(tenantId: string, callIds: string[]) {
  return callMatchStates(tenantId, Array.from(new Set(callIds)))
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
  limit: number | null = 50,
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
       AND ${currentQualifyingMatchSql('m', width)}
     ORDER BY m.match_score DESC NULLS LAST, name
     ${limit === null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}`)
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
function areaRevisionChangedSql(callId: Prisma.Sql, refreshedAt: Prisma.Sql) {
  return canonicalAreasEnabled() ? Prisma.sql`EXISTS(SELECT 1 FROM research_area_classifications d
    WHERE d.entity_kind='CALL' AND d.entity_id=${callId} AND d.status='ACCEPTED' AND d.revoked_at IS NULL
      AND d.accepted_at > (${refreshedAt} AT TIME ZONE 'UTC'))` : Prisma.sql`FALSE`
}

export async function staleCallIds(tenantId: string, limit = CENSUS_CALLS_PER_PASS) {
  const timeZone = await getTenantTimeZone(tenantId)
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT fc.id FROM funding_calls fc
     LEFT JOIN dsr_call_match_state s ON s.tenant_id = ${tenantId} AND s.call_id = fc.id AND s.version = ${CALL_MATCH_CENSUS_VERSION}
     WHERE ${visibleCallSql(tenantId, 'fc')} AND ${openCallSql('fc', timeZone)}
       -- A failed census waits out its backoff; everything else refreshes when stale.
       AND (CASE WHEN s.status = 'failed' THEN s.retry_at IS NULL OR s.retry_at <= (now() AT TIME ZONE 'UTC')
         ELSE s.refreshed_at IS NULL OR s.refreshed_at < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${CENSUS_FRESH_MS / 1000})
           OR ${areaRevisionChangedSql(Prisma.sql`fc.id`,Prisma.sql`s.refreshed_at`)} END)
     ORDER BY (s.status = 'failed') DESC NULLS LAST, COALESCE(fc.close_date, fc."deadlineAt") ASC NULLS LAST, fc.id
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
       WHERE m.tenant_id = ${tenantId} AND ${currentAutomaticMatchSql('m')}
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
  const profileColumn = Prisma.raw(getProfileEmbeddingColumn())
  const publicationColumn = Prisma.raw(getPublicationEmbeddingColumn())
  const rows = await prisma.$queryRaw<Array<{ school_id: string; user_id: string }>>(Prisma.sql`
    SELECT unit.path[1] school_id, u.id user_id
      FROM users u
      JOIN researcher_profiles p ON p.user_id = u.id
      JOIN tenant_org_units unit ON unit.id = p.org_unit_id AND unit.is_active
     WHERE u."tenantId" = ${tenantId} AND u.status = 'ACTIVE' AND unit.path[1] = ANY(${textArray(schoolIds)})
       -- Exactly what the retrieval branches read: an embedded profile, an
       -- embedded saved interest or tagged publication, or profile text the
       -- keyword branch searches. An unembedded interest is invisible to search.
       AND p.${profileColumn} IS NULL
       AND nullif(btrim(p.research_summary), '') IS NULL
       AND nullif(btrim(p.normalized_text), '') IS NULL
       AND COALESCE(array_length(p.research_areas, 1), 0) = 0
       AND COALESCE(array_length(p.keywords, 1), 0) = 0
       AND NOT EXISTS (SELECT 1 FROM researcher_saved_research_areas a
         WHERE a.user_id = u.id AND a.use_for_alerts AND a.${profileColumn} IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM reference_library r
         WHERE r.user_id = u.id AND r."isActive" AND 'my-publication' = ANY(r.tags) AND r.${publicationColumn} IS NOT NULL)`)
  for (const row of rows) unprofiled.get(row.school_id)?.push(row.user_id)
  return unprofiled
}
