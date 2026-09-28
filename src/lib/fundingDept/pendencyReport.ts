/**
 * Pendency: calls that directly matched faculty in a school, where nobody from
 * that school was ever allocated — the DSR action that did not happen.
 *
 * "Directly matched" is a strong or moderate automatic faculty match first seen
 * by the deadline day (`qualifyingMatchSql`). Weak, reconstructed and manual
 * matches never count, so every row is one a head can put to a coordinator
 * without argument. A coordinator who closed the call with the manual
 * "action completed" mark but allocated nobody is listed separately, with their
 * note, and is not counted.
 *
 * This is deliberately not `getUnallocatedBacklog`: that list drives the
 * escalation reminders and counts any relevant call nobody has *looked at*. This
 * one counts matched calls nobody was *allocated to*, whether or not somebody
 * looked. The glossary says so wherever the two could be read side by side.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { NOT_TAKEN_UP_STATUSES } from '@/lib/assignments/shared'
import { textArray, utcTimestamp, visibleCallSql } from './callSql'
import { coordinatorSql } from './hubScope'
import { COUNTED_PENDENCY_STATES, PENDENCY_STATES, indiaDaysToDeadlineSql, pendencyStateSql, qualifyingMatchSql, type PendencyState } from './reportDefinitions'

export type PendencyFilters = {
  schoolIds: string[]
  /**
   * Only rows this user is the responsible coordinator for (the head's Member
   * filter). The by-member table groups by responsible coordinator, so its
   * numbers only open the same rows when the drill-down filters the same way —
   * narrowing to the member's primary schools missed calls transferred to them
   * and kept calls transferred away.
   */
  coordinatorUserId?: string | null
  state?: string | null
  deadlineFrom?: Date | null
  deadlineTo?: Date | null
  minMatches?: number | null
  search?: string | null
  asOf: Date
  page: number
  pageSize: number
  all?: boolean
}
export class PendencyError extends Error { constructor(message: string, public status = 400) { super(message) } }

export type PendencyRow = {
  callId: string; title: string; agency: string | null; deadline: Date | null; daysToDeadline: number | null
  school: { id: string; name: string }; coordinator: { id: string; name: string } | null
  state: PendencyState; matchedFaculty: number; firstMatchedAt: Date; daysUnallocated: number
  releasedAllocations: number; escalated: string[]; lastActivityAt: Date | null
  completed: { at: Date; by: string | null; note: string | null } | null
}
export type PendencyMember = {
  coordinatorId: string | null; name: string; missed: number; atRisk: number; pending: number; completedNoAllocation: number; oldestDays: number
  schools: Array<{ id: string; name: string; missed: number; atRisk: number; pending: number; completedNoAllocation: number }>
}

const NOT_TAKEN_UP = NOT_TAKEN_UP_STATUSES.map(s => `'${s}'`).join(',')

function pendencySql(tenantId: string, f: PendencyFilters): Prisma.Sql {
  const deadline = 'COALESCE(fc.close_date, fc."deadlineAt")'
  const state = pendencyStateSql({ daysToDeadline: 'r.days_to_deadline', qualifyingMatches: 'r.matched_faculty', takenUpAllocations: 'r.taken_up',
    independentApplications: 'r.independent', dismissed: `(r.triage_status = 'NOT_RELEVANT' AND r.triage_decided_at IS NOT NULL)`, actionCompleted: '(r.action_completed_at IS NOT NULL)' })
  return Prisma.sql`
    WITH pairs AS (
      SELECT DISTINCT fom.funding_call_id call_id, fom.school_id FROM funding_opportunity_matches fom
       WHERE fom.tenant_id=${tenantId} AND fom.school_id = ANY(${textArray(f.schoolIds)}) AND fom.inferred = false
    ), facts AS (
      SELECT p.call_id, p.school_id, s.name school_name,
        COALESCE(fc.scheme_title, fc.title) title, COALESCE(fc.agency_name, fc."agencyName") agency, ${Prisma.raw(deadline)} deadline,
        ${indiaDaysToDeadlineSql(deadline, f.asOf)} days_to_deadline,
        q.n matched_faculty, q.first_seen first_matched_at,
        (SELECT count(*)::int FROM call_assignments ca JOIN tenant_org_units au ON au.id=ca.assignee_org_unit_id
          WHERE ca.tenant_id=${tenantId} AND ca.funding_call_id=p.call_id AND au.path[1]=p.school_id AND ca.status::text NOT IN (${Prisma.raw(NOT_TAKEN_UP)})) taken_up,
        (SELECT count(*)::int FROM call_assignments ca JOIN tenant_org_units au ON au.id=ca.assignee_org_unit_id
          WHERE ca.tenant_id=${tenantId} AND ca.funding_call_id=p.call_id AND au.path[1]=p.school_id AND ca.status::text IN (${Prisma.raw(NOT_TAKEN_UP)})) released,
        (SELECT count(*)::int FROM dsr_applications a WHERE a.tenant_id=${tenantId} AND a.call_id=p.call_id AND a.school_id=p.school_id AND a.assignment_id IS NULL) independent,
        tri.status triage_status, tri.decided_at triage_decided_at, tri.escalation_stages, tri.action_completed_at, tri.action_completed_note, COALESCE(cu.name, cu.email) completed_by,
        GREATEST(tri.decided_at,
          (SELECT max(fu.happened_at) FROM assignment_follow_ups fu JOIN tenant_org_units fuu ON fuu.id=fu.org_unit_id
            WHERE fu.tenant_id=${tenantId} AND fu.funding_call_id=p.call_id AND fuu.path[1]=p.school_id),
          (SELECT max(x.created_at) FROM dsr_actions x WHERE x.tenant_id=${tenantId} AND x.call_id=p.call_id AND x.school_id=p.school_id)) last_activity_at,
        ${coordinatorSql(tenantId, 'p.school_id', 'p.call_id')} coordinator_id
      FROM pairs p
      JOIN funding_calls fc ON fc.id = p.call_id
      JOIN tenant_org_units s ON s.id = p.school_id
      CROSS JOIN LATERAL (SELECT count(*)::int n, min(m.first_seen_at) first_seen FROM funding_opportunity_matches m
        WHERE m.tenant_id=${tenantId} AND m.funding_call_id=p.call_id AND m.school_id=p.school_id AND ${qualifyingMatchSql('m', deadline)}) q
      LEFT JOIN call_school_triage tri ON tri.funding_call_id = p.call_id AND tri.org_unit_id = p.school_id
      LEFT JOIN users cu ON cu.id = tri.action_completed_by_user_id
      WHERE ${visibleCallSql(tenantId, 'fc')}
        ${f.search ? Prisma.sql`AND (COALESCE(fc.scheme_title, fc.title) ILIKE ${`%${f.search}%`} OR COALESCE(fc.agency_name, fc."agencyName") ILIKE ${`%${f.search}%`} OR fc.id = ${f.search})` : Prisma.empty}
        ${f.deadlineFrom ? Prisma.sql`AND ${Prisma.raw(deadline)} >= ${utcTimestamp(f.deadlineFrom)}` : Prisma.empty}
        ${f.deadlineTo ? Prisma.sql`AND ${Prisma.raw(deadline)} < ${utcTimestamp(f.deadlineTo)}` : Prisma.empty}
    ), resp AS (
      SELECT r.*, ${state} state FROM facts r
    ), pend AS (
      SELECT * FROM resp WHERE state IS NOT NULL ${f.minMatches ? Prisma.sql`AND matched_faculty >= ${f.minMatches}` : Prisma.empty}
        ${f.coordinatorUserId ? Prisma.sql`AND coordinator_id = ${f.coordinatorUserId}` : Prisma.empty}
    )`
}

function stateWhere(state: string | null | undefined): Prisma.Sql {
  if (state === 'all') return Prisma.sql`TRUE`
  if (state) return Prisma.sql`state = ${state}`
  return Prisma.sql`state IN (${Prisma.join(COUNTED_PENDENCY_STATES)})`
}

export async function getPendency(tenantId: string, f: PendencyFilters) {
  if (f.state && f.state !== 'all' && !PENDENCY_STATES.includes(f.state as PendencyState)) throw new PendencyError('Unknown pendency state.')
  const empty = { rows: [] as PendencyRow[], total: 0, page: f.page, pageSize: f.pageSize, members: [] as PendencyMember[],
    summary: { missed: 0, atRisk: 0, pending: 0, completedNoAllocation: 0 } }
  if (!f.schoolIds.length) return empty
  const base = pendencySql(tenantId, f)
  const byMember = await prisma.$queryRaw<Array<{ coordinator_id: string | null; coordinator_name: string | null; school_id: string; school_name: string
    missed: number; at_risk: number; pending: number; completed: number; oldest: number | null }>>(Prisma.sql`${base}
    SELECT p.coordinator_id, COALESCE(u.name, u.email) coordinator_name, p.school_id, min(p.school_name) school_name,
      count(*) FILTER (WHERE state='MISSED')::int missed, count(*) FILTER (WHERE state='AT_RISK')::int at_risk,
      count(*) FILTER (WHERE state='PENDING')::int pending, count(*) FILTER (WHERE state='COMPLETED_NO_ALLOCATION')::int completed,
      max(CASE WHEN state IN ('AT_RISK','PENDING') THEN floor(EXTRACT(EPOCH FROM (${utcTimestamp(f.asOf)} - first_matched_at)) / 86400) END)::int oldest
    FROM pend p LEFT JOIN users u ON u.id = p.coordinator_id GROUP BY p.coordinator_id, u.name, u.email, p.school_id ORDER BY 2 NULLS LAST, 4`)
  const members = new Map<string, PendencyMember>()
  for (const r of byMember) {
    const key = r.coordinator_id || 'none'
    const m = members.get(key) || { coordinatorId: r.coordinator_id, name: r.coordinator_name || 'No coordinator', missed: 0, atRisk: 0, pending: 0, completedNoAllocation: 0, oldestDays: 0, schools: [] }
    m.missed += r.missed; m.atRisk += r.at_risk; m.pending += r.pending; m.completedNoAllocation += r.completed; m.oldestDays = Math.max(m.oldestDays, r.oldest || 0)
    m.schools.push({ id: r.school_id, name: r.school_name, missed: r.missed, atRisk: r.at_risk, pending: r.pending, completedNoAllocation: r.completed })
    members.set(key, m)
  }
  const summary = [...members.values()].reduce((s, m) => ({ missed: s.missed + m.missed, atRisk: s.atRisk + m.atRisk, pending: s.pending + m.pending,
    completedNoAllocation: s.completedNoAllocation + m.completedNoAllocation }), { missed: 0, atRisk: 0, pending: 0, completedNoAllocation: 0 })

  const filter = stateWhere(f.state)
  const [count] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`${base} SELECT count(*)::int n FROM pend WHERE ${filter}`)
  const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`${base}
    SELECT p.*, COALESCE(u.name, u.email) coordinator_name FROM pend p LEFT JOIN users u ON u.id = p.coordinator_id WHERE ${filter}
     ORDER BY CASE state WHEN 'AT_RISK' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'MISSED' THEN 2 ELSE 3 END,
       CASE WHEN state = 'MISSED' THEN -days_to_deadline ELSE days_to_deadline END ASC NULLS LAST, p.call_id, p.school_id
     ${f.all ? Prisma.empty : Prisma.sql`LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`}`)
  return {
    rows: rows.map((r): PendencyRow => {
      // Missed calls stopped accruing at the deadline; open ones are still accruing.
      const end = r.state === 'MISSED' && r.deadline ? new Date(r.deadline) : f.asOf
      return {
        callId: r.call_id, title: r.title, agency: r.agency, deadline: r.deadline, daysToDeadline: r.days_to_deadline,
        school: { id: r.school_id, name: r.school_name }, coordinator: r.coordinator_id ? { id: r.coordinator_id, name: r.coordinator_name } : null,
        state: r.state, matchedFaculty: r.matched_faculty, firstMatchedAt: r.first_matched_at,
        daysUnallocated: Math.max(0, Math.floor((end.getTime() - new Date(r.first_matched_at).getTime()) / 86400000)),
        releasedAllocations: r.released, escalated: r.escalation_stages || [], lastActivityAt: r.last_activity_at,
        completed: r.action_completed_at ? { at: r.action_completed_at, by: r.completed_by, note: r.action_completed_note } : null,
      }
    }),
    total: count?.n ?? 0, page: f.page, pageSize: f.pageSize, members: [...members.values()], summary,
  }
}

export function pendencyExportTables(rows: PendencyRow[], members: PendencyMember[]) {
  return [
    { name: 'By member', rows: [['DSR member', 'School', 'Missed', 'At risk', 'Pending', 'Completed without allocation'],
      ...members.flatMap(m => m.schools.map(s => [m.name, s.name, s.missed, s.atRisk, s.pending, s.completedNoAllocation]))] },
    { name: 'Calls', rows: [['Call ID', 'Call', 'Agency', 'School', 'Coordinator', 'State', 'Deadline', 'Days to deadline', 'Matched faculty', 'First matched', 'Days unallocated',
      'Allocations that fell through', 'Escalated to', 'Last DSR activity', 'Completion note'],
      ...rows.map(r => [r.callId, r.title, r.agency, r.school.name, r.coordinator?.name || 'No coordinator', r.state, r.deadline?.toISOString().slice(0, 10), r.daysToDeadline,
        r.matchedFaculty, r.firstMatchedAt.toISOString().slice(0, 10), r.daysUnallocated, r.releasedAllocations, r.escalated.join(' → '),
        r.lastActivityAt?.toISOString().slice(0, 10), r.completed?.note])] },
  ]
}
