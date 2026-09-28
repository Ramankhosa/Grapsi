/**
 * Incoming Calls: every call that concerns the coordinator's schools, one row
 * per call with a chip per school, and the coordinator's own "action completed"
 * mark.
 *
 * A call reaches a school two ways, and both count here:
 *   - a stored call-to-school mapping (discipline classification, origin, head,
 *     reconstructed work, manual allocation), and
 *   - a current strong or moderate automatic faculty match in the school.
 * The second closes the gap where a school's own researchers match a call the
 * taxonomy never mapped to it. Unlike the routing rule for coordinator queues,
 * there is no five-minute freshness gate on matches here, so the list does not
 * flicker; stale schools are queued for a background refresh instead.
 *
 * SQL-first and paged, like the Call Register: never through
 * `getManagementReport`, which computes the whole department in memory.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { openCallSql, textArray, visibleCallSql } from './callSql'
import { MAPPING_SOURCE_LABELS, type MappingSource } from './callSchoolMapping'
import { queueSchoolMatchRefresh } from './currentMatches'
import { coordinatorSql } from './hubScope'
import { NOT_TAKEN_UP_STATUSES } from '@/lib/assignments/shared'
import {
  ACTION_STATUSES, PENDENCY_MATCH_TIERS, actionStatusSql, indiaDaysToDeadlineSql, rollupActionStatus,
  type ActionStatus,
} from './reportDefinitions'

export const INCOMING_ACTION_FILTERS = ['NOT_STARTED', 'IN_PROGRESS', 'NOT_COMPLETED', 'COMPLETED'] as const
export const INCOMING_SOURCES = ['MAPPED', 'MATCHED_FACULTY', 'ORIGIN'] as const
export const MATCHED_FACULTY_SOURCE = 'MATCHED_FACULTY'

export type IncomingFilters = {
  schoolIds: string[]
  includeExpired?: boolean
  action?: string | null
  closingWithin?: number | null
  source?: string | null
  search?: string | null
  callId?: string | null
  asOf: Date
  page: number
  pageSize: number
  all?: boolean
}

export type IncomingSchool = {
  schoolId: string; schoolName: string; sources: string[]; sourceLabels: string[]
  coordinator: { id: string; name: string } | null
  matchedFaculty: number; shortlisted: number; allocations: number; liveAllocations: number; submitted: number; followUps: number
  triageStatus: string | null; actionStatus: ActionStatus
  completed: { at: Date; by: string | null; note: string | null } | null
}
export type IncomingRow = {
  callId: string; title: string; agency: string | null; deadline: Date | null; daysToDeadline: number | null; enteredAt: Date
  actionStatus: ActionStatus; matchedFaculty: number; shortlisted: number; allocations: number; liveAllocations: number; submitted: number
  schools: IncomingSchool[]
}

export class IncomingError extends Error { constructor(message: string, public status = 400) { super(message) } }

const TIERS = PENDENCY_MATCH_TIERS.map(t => `'${t}'`).join(',')
const NOT_TAKEN_UP = NOT_TAKEN_UP_STATUSES.map(s => `'${s}'`).join(',')
/** A current automatic strong/moderate match. */
const currentDirectMatch = (a: string) => Prisma.raw(`(${a}.is_current AND ${a}.inferred = false AND COALESCE(${a}.source_version,'') <> 'manual-allocation-v1' AND ${a}.match_tier IN (${TIERS}))`)

function validate(f: IncomingFilters) {
  if (f.action && !INCOMING_ACTION_FILTERS.includes(f.action as never)) throw new IncomingError('Unknown action filter.')
  if (f.source && !INCOMING_SOURCES.includes(f.source as never)) throw new IncomingError('Unknown source filter.')
  if (f.closingWithin != null && !(f.closingWithin > 0 && f.closingWithin <= 365)) throw new IncomingError('Closing window must be between 1 and 365 days.')
}

/** One row per (call, school) in scope with every fact the report shows or filters on. */
function pairsSql(tenantId: string, f: IncomingFilters): Prisma.Sql {
  const scope = textArray(f.schoolIds)
  const days = indiaDaysToDeadlineSql('COALESCE(fc.close_date, fc."deadlineAt")', f.asOf)
  const action = actionStatusSql({ actionCompletedAt: 'r.action_completed_at', triageDecidedAt: 'r.triage_decided_at', shortlisted: 'r.shortlisted',
    allocations: 'r.allocations', followUps: 'r.follow_ups', namedActions: 'r.named_actions' })
  const sourceFilter = f.source === 'ORIGIN' ? Prisma.sql`AND 'ORIGIN' = ANY(p.sources)`
    : f.source === 'MATCHED_FACULTY' ? Prisma.sql`AND ${MATCHED_FACULTY_SOURCE} = ANY(p.sources)`
    : f.source === 'MAPPED' ? Prisma.sql`AND EXISTS (SELECT 1 FROM unnest(p.sources) s WHERE s NOT IN ('ORIGIN', ${MATCHED_FACULTY_SOURCE}))` : Prisma.empty
  return Prisma.sql`
    WITH raw_pairs AS (
      SELECT m.call_id, m.school_id, m.source FROM dsr_call_school_mappings m
       WHERE m.tenant_id=${tenantId} AND m.is_active AND m.school_id = ANY(${scope}) ${f.callId ? Prisma.sql`AND m.call_id = ${f.callId}` : Prisma.empty}
      UNION ALL
      SELECT fom.funding_call_id, fom.school_id, ${MATCHED_FACULTY_SOURCE}::text FROM funding_opportunity_matches fom
       WHERE fom.tenant_id=${tenantId} AND fom.school_id = ANY(${scope}) AND ${currentDirectMatch('fom')} ${f.callId ? Prisma.sql`AND fom.funding_call_id = ${f.callId}` : Prisma.empty}
    ), p AS (
      SELECT call_id, school_id, array_agg(DISTINCT source ORDER BY source) sources FROM raw_pairs GROUP BY call_id, school_id
    ), facts AS (
      SELECT p.call_id, p.school_id, s.name school_name, p.sources,
        COALESCE(fc.scheme_title, fc.title) title, COALESCE(fc.agency_name, fc."agencyName") agency,
        COALESCE(fc.close_date, fc."deadlineAt") deadline, ${days} days_to_deadline, COALESCE(fc."publishedAt", fc."createdAt") entered_at,
        tri.status triage_status, tri.decided_at triage_decided_at, tri.action_completed_at, tri.action_completed_note,
        COALESCE(cu.name, cu.email) completed_by,
        (SELECT count(*)::int FROM funding_opportunity_matches fm WHERE fm.tenant_id=${tenantId} AND fm.funding_call_id=p.call_id AND fm.school_id=p.school_id AND ${currentDirectMatch('fm')}) matched_faculty,
        (SELECT count(*)::int FROM call_candidates cc JOIN researcher_profiles rp ON rp.user_id=cc.user_id JOIN tenant_org_units cu2 ON cu2.id=rp.org_unit_id
          WHERE cc.tenant_id=${tenantId} AND cc.funding_call_id=p.call_id AND cu2.path[1]=p.school_id AND cc.status IN ('SHORTLISTED','APPROACHED')) shortlisted,
        (SELECT count(*)::int FROM call_assignments ca JOIN tenant_org_units au ON au.id=ca.assignee_org_unit_id
          WHERE ca.tenant_id=${tenantId} AND ca.funding_call_id=p.call_id AND au.path[1]=p.school_id) allocations,
        (SELECT count(*)::int FROM call_assignments ca JOIN tenant_org_units au ON au.id=ca.assignee_org_unit_id
          WHERE ca.tenant_id=${tenantId} AND ca.funding_call_id=p.call_id AND au.path[1]=p.school_id AND ca.status::text NOT IN (${Prisma.raw(NOT_TAKEN_UP)})) live_allocations,
        (SELECT count(*)::int FROM call_assignments ca JOIN tenant_org_units au ON au.id=ca.assignee_org_unit_id
          WHERE ca.tenant_id=${tenantId} AND ca.funding_call_id=p.call_id AND au.path[1]=p.school_id AND (ca.status='COMPLETED' OR ca.submitted_at IS NOT NULL)) submitted,
        (SELECT count(*)::int FROM assignment_follow_ups fu JOIN tenant_org_units fuu ON fuu.id=fu.org_unit_id
          WHERE fu.tenant_id=${tenantId} AND fu.funding_call_id=p.call_id AND fuu.path[1]=p.school_id AND fu.kind <> 'TRIAGE') follow_ups,
        (SELECT count(*)::int FROM dsr_actions x WHERE x.tenant_id=${tenantId} AND x.call_id=p.call_id AND x.school_id=p.school_id) named_actions,
        ${coordinatorSql(tenantId, 'p.school_id', 'p.call_id')} coordinator_id
      FROM p
      JOIN funding_calls fc ON fc.id = p.call_id
      JOIN tenant_org_units s ON s.id = p.school_id
      LEFT JOIN call_school_triage tri ON tri.funding_call_id = p.call_id AND tri.org_unit_id = p.school_id
      LEFT JOIN users cu ON cu.id = tri.action_completed_by_user_id
      WHERE ${visibleCallSql(tenantId, 'fc')}
        ${f.includeExpired ? Prisma.empty : Prisma.sql`AND ${openCallSql('fc')}`}
        ${f.callId ? Prisma.sql`AND p.call_id = ${f.callId}` : Prisma.empty}
        ${f.search ? Prisma.sql`AND (COALESCE(fc.scheme_title, fc.title) ILIKE ${`%${f.search}%`} OR COALESCE(fc.agency_name, fc."agencyName") ILIKE ${`%${f.search}%`} OR fc.id = ${f.search})` : Prisma.empty}
        ${sourceFilter}
    ), resp AS (
      SELECT r.*, ${action} action_status FROM facts r
    )`
}

/** Call-level action filter over the least-advanced school (see rollupActionStatus). */
function actionHaving(action: string | null | undefined): Prisma.Sql {
  switch (action) {
    case 'NOT_STARTED': return Prisma.sql`bool_or(action_status='NOT_STARTED')`
    case 'IN_PROGRESS': return Prisma.sql`NOT bool_or(action_status='NOT_STARTED') AND bool_or(action_status='IN_PROGRESS')`
    case 'NOT_COMPLETED': return Prisma.sql`bool_or(action_status<>'COMPLETED')`
    case 'COMPLETED': return Prisma.sql`bool_and(action_status='COMPLETED')`
    default: return Prisma.sql`TRUE`
  }
}

export async function getIncomingCalls(tenantId: string, f: IncomingFilters) {
  validate(f)
  const empty = { rows: [] as IncomingRow[], total: 0, page: f.page, pageSize: f.pageSize,
    summary: { openCalls: 0, notStarted: 0, closingSoonNotCompleted: 0, completed: 0 }, matchesRefreshedAt: null as Date | null }
  if (!f.schoolIds.length) return empty
  const base = pairsSql(tenantId, f)
  const closing = f.closingWithin ? Prisma.sql`AND min(days_to_deadline) BETWEEN 0 AND ${f.closingWithin}` : Prisma.empty
  const having = Prisma.sql`HAVING ${actionHaving(f.action)} ${closing}`

  const [summary] = await prisma.$queryRaw<Array<{ open_calls: number; not_started: number; closing_soon_not_completed: number; completed: number }>>(Prisma.sql`
    ${base}, calls AS (
      SELECT call_id, min(days_to_deadline) days, bool_or(action_status='NOT_STARTED') any_not_started, bool_and(action_status='COMPLETED') all_completed
        FROM resp GROUP BY call_id)
    SELECT count(*) FILTER (WHERE days IS NULL OR days >= 0)::int open_calls,
      count(*) FILTER (WHERE any_not_started)::int not_started,
      count(*) FILTER (WHERE days BETWEEN 0 AND 7 AND NOT all_completed)::int closing_soon_not_completed,
      count(*) FILTER (WHERE all_completed)::int completed
    FROM calls`)
  const [count] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`${base}
    SELECT count(*)::int n FROM (SELECT call_id FROM resp GROUP BY call_id ${having}) c`)
  const page = await prisma.$queryRaw<Array<{ call_id: string }>>(Prisma.sql`${base}
    SELECT call_id FROM resp GROUP BY call_id ${having}
     ORDER BY (min(days_to_deadline) < 0) ASC, min(days_to_deadline) ASC NULLS LAST, min(entered_at) DESC, call_id
     ${f.all ? Prisma.empty : Prisma.sql`LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`}`)
  const ids = page.map(r => r.call_id)
  const detail = ids.length ? await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`${base}
    SELECT r.*, COALESCE(u.name, u.email) coordinator_name FROM resp r LEFT JOIN users u ON u.id = r.coordinator_id
     WHERE r.call_id = ANY(${textArray(ids)}) ORDER BY r.school_name`) : []

  const rows: IncomingRow[] = ids.map(callId => {
    const mine = detail.filter(d => d.call_id === callId)
    const schools: IncomingSchool[] = mine.map(d => ({
      schoolId: d.school_id, schoolName: d.school_name, sources: d.sources,
      sourceLabels: (d.sources as string[]).map(s => s === MATCHED_FACULTY_SOURCE ? 'Matched faculty' : MAPPING_SOURCE_LABELS[s as MappingSource] || s),
      coordinator: d.coordinator_id ? { id: d.coordinator_id, name: d.coordinator_name } : null,
      matchedFaculty: d.matched_faculty, shortlisted: d.shortlisted, allocations: d.allocations, liveAllocations: d.live_allocations,
      submitted: d.submitted, followUps: d.follow_ups, triageStatus: d.triage_status, actionStatus: d.action_status,
      completed: d.action_completed_at ? { at: d.action_completed_at, by: d.completed_by, note: d.action_completed_note } : null,
    }))
    const first = mine[0]
    const sum = (k: keyof IncomingSchool) => schools.reduce((n, s) => n + (s[k] as number), 0)
    return {
      callId, title: first.title, agency: first.agency, deadline: first.deadline, daysToDeadline: first.days_to_deadline, enteredAt: first.entered_at,
      actionStatus: rollupActionStatus(schools.map(s => s.actionStatus)),
      matchedFaculty: sum('matchedFaculty'), shortlisted: sum('shortlisted'), allocations: sum('allocations'), liveAllocations: sum('liveAllocations'),
      submitted: sum('submitted'), schools,
    }
  })

  // Matches are a background projection; name how fresh they are and queue the stale schools.
  // refreshed_at is written by raw now(), i.e. session-local wall time, so read it back in that zone.
  const states = await prisma.$queryRaw<Array<{ school_id: string; refreshed_at: Date }>>(Prisma.sql`
    SELECT school_id, (refreshed_at AT TIME ZONE current_setting('TimeZone')) refreshed_at FROM dsr_match_projection_state WHERE tenant_id=${tenantId} AND school_id = ANY(${textArray(f.schoolIds)})`)
  const refreshed = new Map(states.map(s => [s.school_id, s.refreshed_at]))
  for (const id of f.schoolIds) {
    const at = refreshed.get(id)
    if (!at || Date.now() - at.getTime() > 6 * 3600 * 1000) queueSchoolMatchRefresh(tenantId, id)
  }
  const oldest = f.schoolIds.map(id => refreshed.get(id)).reduce<Date | null>((min, at) => !at ? min : !min || at < min ? at : min, null)

  return {
    rows, total: count?.n ?? 0, page: f.page, pageSize: f.pageSize,
    summary: { openCalls: summary?.open_calls ?? 0, notStarted: summary?.not_started ?? 0, closingSoonNotCompleted: summary?.closing_soon_not_completed ?? 0, completed: summary?.completed ?? 0 },
    matchesRefreshedAt: oldest,
  }
}

export function incomingExportTables(rows: IncomingRow[]) {
  const calls: unknown[][] = [['Call ID', 'Call', 'Agency', 'Deadline', 'Days left', 'Schools', 'Matched faculty', 'Shortlisted', 'Allocations (live)', 'Allocations closed', 'Submitted', 'Action status']]
  const schools: unknown[][] = [['Call ID', 'Call', 'School', 'How it reached the school', 'Coordinator', 'Matched faculty', 'Shortlisted', 'Allocations (live)', 'Allocations closed', 'Submitted', 'Follow-ups', 'Action status', 'Completed on', 'Completed by', 'Completion note']]
  for (const r of rows) {
    calls.push([r.callId, r.title, r.agency, r.deadline?.toISOString().slice(0, 10), r.daysToDeadline, r.schools.map(s => s.schoolName).join(' | '),
      r.matchedFaculty, r.shortlisted, r.liveAllocations, r.allocations - r.liveAllocations, r.submitted, r.actionStatus])
    for (const s of r.schools) schools.push([r.callId, r.title, s.schoolName, s.sourceLabels.join(' | '), s.coordinator?.name || 'Unassigned', s.matchedFaculty, s.shortlisted,
      s.liveAllocations, s.allocations - s.liveAllocations, s.submitted, s.followUps, s.actionStatus, s.completed?.at.toISOString().slice(0, 10), s.completed?.by, s.completed?.note])
  }
  return [{ name: 'Incoming calls', rows: calls }, { name: 'By school', rows: schools }]
}

export { ACTION_STATUSES }
