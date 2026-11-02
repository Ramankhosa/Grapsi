/**
 * Keeping the stored match census fresh, without making a report wait for it.
 *
 * The scoring itself lives in `callMatchCensus` and runs per call. This module
 * is the scheduling around it: reports ask for a school, say how fresh its
 * numbers are, and queue the stale work to a single background worker so a
 * coordinator opening a report never pays for a reranker pass.
 *
 * The school-shaped API is deliberate even though the census is call-shaped:
 * every DSR screen is answerable for a school, and `dsr_match_projection_state`
 * is what tells those screens whether the school's figures can be trusted yet.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { refreshCallMatches, staleCallIds, unprofiledInSchools } from './callMatchCensus'

const running = new Map<string, Promise<{ complete: boolean; unprofiled: string[] }>>()
const queued = new Set<string>()
const retryAfter = new Map<string, number>()
const refreshQueue: Array<{ tenantId: string; schoolId: string }> = []
let queueActive = false
const REPORT_FRESH_MS = 5 * 60 * 1000
/** Share the database and the reranker with live traffic on the production VM. */
const BETWEEN_CALLS_MS = 125

/** Report reads never wait for a census. Stale schools are queued instead. */
export async function reportSchoolMatchStates(tenantId: string, schoolIds: string[]) {
  const state = new Map<string, { fresh: boolean; complete: boolean; unprofiled: string[] }>()
  if (!schoolIds.length) return state
  const rows = await prisma.$queryRaw<Array<{ school_id: string; complete: boolean; unprofiled: string[]; refreshed_at: Date }>>(Prisma.sql`
    SELECT school_id, complete, unprofiled, (refreshed_at AT TIME ZONE current_setting('TimeZone')) refreshed_at FROM dsr_match_projection_state
     WHERE tenant_id = ${tenantId} AND school_id IN (${Prisma.join(schoolIds)})`)
  const stored = new Map(rows.map((row) => [row.school_id, row]))
  for (const schoolId of schoolIds) {
    const row = stored.get(schoolId)
    const fresh = Boolean(row && Date.now() - row.refreshed_at.getTime() < REPORT_FRESH_MS)
    state.set(schoolId, { fresh, complete: Boolean(row?.complete), unprofiled: row?.unprofiled || [] })
    if (!fresh) queueSchoolMatchRefresh(tenantId, schoolId)
  }
  return state
}

export function queueSchoolMatchRefresh(tenantId: string, schoolId: string) {
  const key = `${tenantId}:${schoolId}`
  if (queued.has(key) || running.has(key) || (retryAfter.get(key) || 0) > Date.now()) return
  queued.add(key)
  refreshQueue.push({ tenantId, schoolId })
  // Let the requesting report finish before this worker starts expensive scans.
  if (!queueActive) { queueActive = true; setTimeout(() => { void drainRefreshQueue() }, 5000) }
}

async function drainRefreshQueue() {
  while (refreshQueue.length) {
    const item = refreshQueue.shift()!, key = `${item.tenantId}:${item.schoolId}`
    try { await refreshCurrentSchoolMatches(item.tenantId, item.schoolId) }
    catch (error) { retryAfter.set(key, Date.now() + 60_000); console.error('DSR background matching refresh failed', { schoolId: item.schoolId, error }) }
    finally { queued.delete(key) }
  }
  queueActive = false
}

export function refreshCurrentSchoolMatches(tenantId: string, schoolId: string) {
  const key = `${tenantId}:${schoolId}`
  const prior = running.get(key)
  if (prior) return prior
  const task = refresh(tenantId, schoolId).finally(() => running.delete(key))
  running.set(key, task)
  return task
}

/**
 * Census the stale open calls, then record what this school's numbers rest on.
 *
 * The census is tenant-wide per call, so refreshing one school refreshes every
 * school's slice of those calls — which is the point: a call is scored once,
 * and twenty schools read the same scoring.
 */
async function refresh(tenantId: string, schoolId: string) {
  await refreshStaleCallMatches(tenantId)
  const [state] = await writeSchoolProjections(tenantId, [schoolId])
  return state
}

/** One bounded pass over the calls whose census has gone stale. */
export async function refreshStaleCallMatches(tenantId: string, options: { callIds?: string[]; limit?: number } = {}) {
  const callIds = options.callIds ?? (await staleCallIds(tenantId, options.limit))
  const done: string[] = []
  for (const callId of callIds) {
    try {
      await refreshCallMatches(tenantId, callId)
      done.push(callId)
    } catch (error) {
      // One unscoreable call must not stop the pass: the rest of the catalogue
      // still needs its numbers, and this one is retried on the next sweep.
      console.error('DSR call match census failed', { callId, error })
    }
    await new Promise((resolve) => setTimeout(resolve, BETWEEN_CALLS_MS))
  }
  return done
}

/** The projection is now a readiness record; the scoring fingerprint is per call. */
const CENSUS_PROJECTION_MARKER = 'call-people-census-v2'

/**
 * What each school's figures rest on: whether anyone in it is unmatchable.
 *
 * `complete` is a statement about the school's profiles, not about any one
 * call — a report that says "matching incomplete" is telling a head to go and
 * fill in profiles.
 */
export async function writeSchoolProjections(tenantId: string, schoolIds: string[]) {
  const unprofiled = await unprofiledInSchools(tenantId, schoolIds)
  const states: Array<{ complete: boolean; unprofiled: string[] }> = []
  for (const schoolId of schoolIds) {
    const people = unprofiled.get(schoolId) || []
    states.push({ complete: people.length === 0, unprofiled: people })
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO dsr_match_projection_state(tenant_id, school_id, fingerprint, complete, unprofiled)
      VALUES(${tenantId}, ${schoolId}, ${CENSUS_PROJECTION_MARKER}, ${people.length === 0}, ${JSON.stringify(people)}::jsonb)
      ON CONFLICT(tenant_id, school_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint,
        complete = EXCLUDED.complete, unprofiled = EXCLUDED.unprofiled, refreshed_at = now()`)
  }
  return states
}


/** Calls censused per scheduled pass, across all tenants. */
const SWEEP_CALL_BUDGET = 40

/**
 * The scheduled census pass.
 *
 * Without it the census only refreshed when somebody opened a report, so a call
 * nobody looked at — or one whose last attempt failed — could sit unscored
 * until the next page view. Each pass takes the stale and retry-due calls of
 * every tenant with a school structure, splitting the budget so one large
 * tenant cannot starve the rest, then rewrites those tenants' school readiness.
 */
export async function sweepCallMatchCensus(options: { budget?: number; tenantId?: string } = {}) {
  const budget = Math.max(1, Math.min(200, options.budget ?? SWEEP_CALL_BUDGET))
  const tenants = options.tenantId
    ? [options.tenantId]
    : (await prisma.$queryRaw<Array<{ tenant_id: string }>>(Prisma.sql`
        SELECT DISTINCT tenant_id FROM tenant_org_units WHERE is_active AND depth = 0 ORDER BY tenant_id`)).map((row) => row.tenant_id)
  const perTenant = Math.max(5, Math.ceil(budget / Math.max(1, tenants.length)))
  const result = { tenants: 0, attempted: 0, refreshed: 0, failed: 0 }
  let remaining = budget
  for (const tenantId of tenants) {
    if (remaining <= 0) break
    const callIds = await staleCallIds(tenantId, Math.min(perTenant, remaining))
    if (!callIds.length) continue
    result.tenants += 1
    result.attempted += callIds.length
    remaining -= callIds.length
    const done = await refreshStaleCallMatches(tenantId, { callIds })
    result.refreshed += done.length
    result.failed += callIds.length - done.length
    const schools = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM tenant_org_units WHERE tenant_id = ${tenantId} AND is_active AND depth = 0`)
    await writeSchoolProjections(tenantId, schools.map((school) => school.id))
  }
  return result
}
