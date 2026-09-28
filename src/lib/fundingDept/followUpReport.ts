/**
 * Follow-ups: the week-by-week record of what the DSR did to get allocated
 * calls submitted.
 *
 * Two sides of the same weeks:
 *   - effort, by author: follow-ups and faculty contacts each member logged;
 *   - coverage, by owner: of the allocations a member is responsible for (the
 *     school's coordinator, or the call's transfer owner), how many were
 *     followed up that week and how many went silent.
 * Plus one row per allocation, showing the contact trail that led — or did
 * not lead — to a submission.
 *
 * Weeks are Monday to Sunday, India time (`indiaWeekStart`). Review-history
 * rows (kind TRIAGE) are system bookkeeping, not effort, and are never counted.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { textArray, utcTimestamp } from './callSql'
import { coordinatorSql } from './hubScope'
import { FOLLOW_UP_STAGE_ORDER, countableFollowUpSql, facultyContactSql, indiaWeekStart, indiaWeekStartSql } from './reportDefinitions'

export type FollowUpFilters = {
  schoolIds: string[]
  /** Only effort by / allocations owned by this user (the head's Member filter). */
  memberUserId?: string | null
  weeks: number
  facultyOnly?: boolean
  silentOnly?: boolean
  logWeek?: string | null
  logAuthorId?: string | null
  assignmentId?: string | null
  callId?: string | null
  asOf: Date
  page: number
  pageSize: number
  all?: boolean
}
export class FollowUpReportError extends Error { constructor(message: string, public status = 400) { super(message) } }

export type WeekCell = { followUps: number; facultyContacts: number; reminders: number; active: number; touched: number; silent: number }
export type MemberWeeks = { userId: string; name: string; weeks: Record<string, WeekCell>; total: WeekCell }
export type EffortRow = {
  assignmentId: string; callId: string; callTitle: string; faculty: string; school: string; owner: string | null; status: string
  allocatedAt: Date; perWeek: Record<string, number>; followUps: number; facultyContacts: number
  daysToFirstContact: number | null; lastFollowUpAt: Date | null; highestStage: string | null; result: 'SUBMITTED' | 'IN_PROGRESS' | 'CLOSED'
  silentThisWeek: boolean
}
export type LogEntry = { id: string; at: Date; week: string; kind: string; target: string; stage: string | null; note: string; author: string | null; authorId: string
  callId: string | null; callTitle: string | null; faculty: string | null; assignmentId: string | null; school: string | null }

const ACTIVE = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS']
/** Row key for allocations in a school nobody covers. */
export const NO_OWNER = 'no-coordinator'
const empty = (): WeekCell => ({ followUps: 0, facultyContacts: 0, reminders: 0, active: 0, touched: 0, silent: 0 })

/** The Mondays of the last `n` India weeks, oldest first, ending with the current week. */
export function weekStarts(asOf: Date, n: number): string[] {
  const current = new Date(`${indiaWeekStart(asOf)}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) => new Date(current.getTime() - (n - 1 - i) * 7 * 86400000).toISOString().slice(0, 10))
}
/** UTC instant at which an India-date week starts. */
const weekInstant = (monday: string) => new Date(new Date(`${monday}T00:00:00Z`).getTime() - 330 * 60000)

export async function getFollowUpReport(tenantId: string, f: FollowUpFilters) {
  if (![4, 8, 12, 26].includes(f.weeks)) throw new FollowUpReportError('Weeks must be 4, 8, 12 or 26.')
  const weeks = weekStarts(f.asOf, f.weeks)
  const empty_ = { weeks, members: [] as MemberWeeks[], effort: [] as EffortRow[], effortTotal: 0, log: [] as LogEntry[], logTotal: 0, page: f.page, pageSize: f.pageSize,
    totals: { followUps: 0, facultyContacts: 0, activeAssignments: 0, silentThisWeek: 0 }, total: 0 }
  if (!f.schoolIds.length) return empty_
  const start = weekInstant(weeks[0])
  const end = new Date(weekInstant(weeks[weeks.length - 1]).getTime() + 7 * 86400000)
  const scope = textArray(f.schoolIds)
  const faculty = facultyContactSql('f')

  // Every follow-up in range whose school is in scope: via its assignment's school, else its own (call-level) school.
  const entries = await prisma.$queryRaw<Array<{ id: string; assignment_id: string | null; funding_call_id: string | null; kind: string; contact_target: string; stage: string | null
    note: string; happened_at: Date; created_by_user_id: string; author: string | null; week: Date; school_name: string | null; call_title: string | null; faculty_name: string | null; is_faculty: boolean }>>(Prisma.sql`
    SELECT f.id, f.assignment_id, COALESCE(f.funding_call_id, ca.funding_call_id) funding_call_id, f.kind, f.contact_target, f.stage, f.note, f.happened_at, f.created_by_user_id,
      COALESCE(au.name, au.email) author, ${indiaWeekStartSql('f.happened_at')} week, s.name school_name, COALESCE(fc.scheme_title, fc.title) call_title,
      COALESCE(fu.name, fu.email) faculty_name, ${faculty} is_faculty
    FROM assignment_follow_ups f
    LEFT JOIN call_assignments ca ON ca.id = f.assignment_id
    LEFT JOIN tenant_org_units unit ON unit.id = COALESCE(ca.assignee_org_unit_id, f.org_unit_id)
    LEFT JOIN tenant_org_units s ON s.id = unit.path[1]
    LEFT JOIN funding_calls fc ON fc.id = COALESCE(f.funding_call_id, ca.funding_call_id)
    LEFT JOIN users au ON au.id = f.created_by_user_id
    LEFT JOIN users fu ON fu.id = ca.assignee_user_id
    WHERE f.tenant_id=${tenantId} AND ${countableFollowUpSql('f')} AND f.happened_at >= ${utcTimestamp(start)} AND f.happened_at < ${utcTimestamp(end)}
      AND unit.path[1] = ANY(${scope})
      ${f.callId ? Prisma.sql`AND COALESCE(f.funding_call_id, ca.funding_call_id) = ${f.callId}` : Prisma.empty}
      ${f.assignmentId ? Prisma.sql`AND f.assignment_id = ${f.assignmentId}` : Prisma.empty}
    ORDER BY f.happened_at DESC, f.id DESC`)

  // When a closed allocation stopped being owed follow-up. A decline closes at the
  // reply and a lapse when it lapsed; updated_at moves on every later edit, which
  // kept declined allocations "silent" for weeks after the faculty member said no.
  const closedAt = Prisma.raw(`COALESCE(CASE ca.status::text WHEN 'DECLINED' THEN ca.responded_at WHEN 'LAPSED' THEN ca.lapsed_at
    WHEN 'COMPLETED' THEN COALESCE(ca.completed_at, ca.submitted_at) END, ca.updated_at)`)

  // Allocations alive at any point in the range, with their whole-life contact facts.
  const assignments = await prisma.$queryRaw<Array<{ id: string; funding_call_id: string; call_title: string; faculty_name: string; school_name: string; status: string
    created_at: Date; closed_at: Date | null; owner_id: string | null; owner_name: string | null; first_contact: Date | null; last_follow_up: Date | null; stages: string[] | null
    submitted: boolean }>>(Prisma.sql`
    SELECT ca.id, ca.funding_call_id, COALESCE(fc.scheme_title, fc.title) call_title, COALESCE(fu.name, fu.email) faculty_name, s.name school_name, ca.status::text status, ca.created_at,
      CASE WHEN ca.status::text IN ('ASSIGNED','ACCEPTED','IN_PROGRESS') THEN NULL ELSE ${closedAt} END closed_at,
      o.owner_id, COALESCE(ou.name, ou.email) owner_name,
      (SELECT min(x.happened_at) FROM assignment_follow_ups x WHERE x.assignment_id=ca.id AND ${facultyContactSql('x')}) first_contact,
      (SELECT max(x.happened_at) FROM assignment_follow_ups x WHERE x.assignment_id=ca.id AND ${countableFollowUpSql('x')}) last_follow_up,
      (SELECT array_agg(DISTINCT x.stage) FROM assignment_follow_ups x WHERE x.assignment_id=ca.id AND x.stage IS NOT NULL) stages,
      (ca.status='COMPLETED' OR ca.submitted_at IS NOT NULL) submitted
    FROM call_assignments ca
    JOIN tenant_org_units au ON au.id = ca.assignee_org_unit_id
    JOIN tenant_org_units s ON s.id = au.path[1]
    JOIN funding_calls fc ON fc.id = ca.funding_call_id
    JOIN users fu ON fu.id = ca.assignee_user_id
    CROSS JOIN LATERAL (SELECT ${coordinatorSql(tenantId, 'au.path[1]', 'ca.funding_call_id')} owner_id) o
    LEFT JOIN users ou ON ou.id = o.owner_id
    WHERE ca.tenant_id=${tenantId} AND au.path[1] = ANY(${scope}) AND ca.created_at < ${utcTimestamp(end)}
      AND (ca.status::text IN ('ASSIGNED','ACCEPTED','IN_PROGRESS') OR ${closedAt} >= ${utcTimestamp(start)})
      ${f.callId ? Prisma.sql`AND ca.funding_call_id = ${f.callId}` : Prisma.empty}
      ${f.assignmentId ? Prisma.sql`AND ca.id = ${f.assignmentId}` : Prisma.empty}
    ORDER BY ca.created_at DESC, ca.id`)

  const counted = entries.filter(e => !f.facultyOnly || e.is_faculty)
  const weekOf = (d: Date) => d.toISOString().slice(0, 10)
  const touchedIn = new Map<string, Set<string>>() // week -> assignment ids followed up
  const perAssignmentWeek = new Map<string, Record<string, number>>()
  for (const e of counted) {
    if (!e.assignment_id) continue
    const w = weekOf(e.week)
    if (!touchedIn.has(w)) touchedIn.set(w, new Set())
    touchedIn.get(w)!.add(e.assignment_id)
    const pw = perAssignmentWeek.get(e.assignment_id) || {}
    pw[w] = (pw[w] || 0) + 1
    perAssignmentWeek.set(e.assignment_id, pw)
  }

  // Effort by author, coverage by owner, merged per person.
  const members = new Map<string, MemberWeeks>()
  const person = (id: string, name: string | null) => {
    if (!members.has(id)) members.set(id, { userId: id, name: name || 'Unknown', weeks: Object.fromEntries(weeks.map(w => [w, empty()])), total: empty() })
    return members.get(id)!
  }
  for (const e of entries) {
    if (f.memberUserId && e.created_by_user_id !== f.memberUserId) continue
    const w = weekOf(e.week); const m = person(e.created_by_user_id, e.author); const cell = m.weeks[w]
    if (!cell) continue
    // A logged reminder is a follow-up (see the glossary) and is also broken out on
    // its own. Leaving it out of the follow-up count made this grid disagree with
    // the per-allocation totals and the log below, which both include it.
    if (e.kind === 'REMINDER') { cell.reminders++; m.total.reminders++ }
    if (!f.facultyOnly || e.is_faculty) { cell.followUps++; m.total.followUps++ }
    if (e.is_faculty) { cell.facultyContacts++; m.total.facultyContacts++ }
  }
  // An allocation counts in a week when it was still open at the week's end (or
  // now, for the current week): one declined or submitted mid-week is not owed
  // a follow-up that week, and must not show as silent.
  const aliveIn = (a: { created_at: Date; closed_at: Date | null }, monday: string) => {
    const we = new Date(weekInstant(monday).getTime() + 7 * 86400000)
    const close = we > f.asOf ? f.asOf : we
    return a.created_at < close && (!a.closed_at || a.closed_at >= close)
  }
  // A school with no coordinator still has allocations that can go silent; they
  // are counted under "No coordinator" so these totals match the list below.
  for (const a of assignments) {
    if (f.memberUserId && a.owner_id !== f.memberUserId) continue
    const m = a.owner_id ? person(a.owner_id, a.owner_name) : person(NO_OWNER, 'No coordinator')
    for (const w of weeks) {
      if (!aliveIn(a, w)) continue
      const cell = m.weeks[w]; cell.active++
      if (touchedIn.get(w)?.has(a.id)) cell.touched++; else cell.silent++
    }
  }
  const current = weeks[weeks.length - 1]
  for (const m of members.values()) { const c = m.weeks[current]; m.total.active = c.active; m.total.touched = c.touched; m.total.silent = c.silent }

  // One row per allocation.
  const stageRank = (stages: string[] | null) => (stages || []).reduce<string | null>((best, s) =>
    FOLLOW_UP_STAGE_ORDER.indexOf(s as never) > FOLLOW_UP_STAGE_ORDER.indexOf((best || '') as never) ? s : best, null)
  let effort: EffortRow[] = assignments.filter(a => !f.memberUserId || a.owner_id === f.memberUserId).map(a => ({
    assignmentId: a.id, callId: a.funding_call_id, callTitle: a.call_title, faculty: a.faculty_name, school: a.school_name, owner: a.owner_name, status: a.status,
    allocatedAt: a.created_at, perWeek: perAssignmentWeek.get(a.id) || {},
    followUps: Object.values(perAssignmentWeek.get(a.id) || {}).reduce((n, v) => n + v, 0),
    facultyContacts: entries.filter(e => e.assignment_id === a.id && e.is_faculty).length,
    daysToFirstContact: a.first_contact ? Math.max(0, Math.floor((a.first_contact.getTime() - a.created_at.getTime()) / 86400000)) : null,
    lastFollowUpAt: a.last_follow_up, highestStage: a.submitted ? 'SUBMITTED' : stageRank(a.stages),
    result: a.submitted ? 'SUBMITTED' : ACTIVE.includes(a.status) ? 'IN_PROGRESS' : 'CLOSED',
    silentThisWeek: ACTIVE.includes(a.status) && aliveIn(a, current) && !touchedIn.get(current)?.has(a.id),
  }))
  if (f.silentOnly) effort = effort.filter(e => e.silentThisWeek)
  const effortTotal = effort.length
  const pageRows = f.all ? effort : effort.slice((f.page - 1) * f.pageSize, f.page * f.pageSize)

  // The log behind a cell: one week, one author, or everything in range.
  const logFiltered = entries.filter(e => (!f.logWeek || weekOf(e.week) === f.logWeek) && (!f.logAuthorId || e.created_by_user_id === f.logAuthorId)
    && (!f.memberUserId || e.created_by_user_id === f.memberUserId) && (!f.facultyOnly || e.is_faculty))
  const log: LogEntry[] = logFiltered.slice(0, f.all ? undefined : 50).map(e => ({ id: e.id, at: e.happened_at, week: weekOf(e.week), kind: e.kind, target: e.contact_target,
    stage: e.stage, note: e.note, author: e.author, authorId: e.created_by_user_id, callId: e.funding_call_id, callTitle: e.call_title, faculty: e.faculty_name,
    assignmentId: e.assignment_id, school: e.school_name }))

  const memberList = [...members.values()].sort((a, b) => Number(a.userId === NO_OWNER) - Number(b.userId === NO_OWNER) || a.name.localeCompare(b.name))
  return {
    weeks, members: memberList, effort: pageRows, effortTotal, log, logTotal: logFiltered.length, page: f.page, pageSize: f.pageSize, total: effortTotal,
    totals: { followUps: memberList.reduce((n, m) => n + m.total.followUps, 0), facultyContacts: memberList.reduce((n, m) => n + m.total.facultyContacts, 0),
      activeAssignments: memberList.reduce((n, m) => n + m.total.active, 0), silentThisWeek: memberList.reduce((n, m) => n + m.total.silent, 0) },
  }
}

export function followUpExportTables(r: Awaited<ReturnType<typeof getFollowUpReport>>) {
  return [
    { name: 'By member and week', rows: [['DSR member', 'Week starting (Mon, IST)', 'Follow-ups', 'Faculty contacts', 'Reminders', 'Active allocations owned', 'Followed up', 'Silent'],
      ...r.members.flatMap(m => r.weeks.map(w => { const c = m.weeks[w]; return [m.name, w, c.followUps, c.facultyContacts, c.reminders, c.active, c.touched, c.silent] }))] },
    { name: 'By allocation', rows: [['Assignment ID', 'Call ID', 'Call', 'Faculty', 'School', 'Owner', 'Allocated on', ...r.weeks.map(w => `Week ${w}`), 'Follow-ups', 'Faculty contacts',
      'Days to first contact', 'Last follow-up', 'Highest stage', 'Result'],
      ...r.effort.map(e => [e.assignmentId, e.callId, e.callTitle, e.faculty, e.school, e.owner, e.allocatedAt.toISOString().slice(0, 10), ...r.weeks.map(w => e.perWeek[w] || 0),
        e.followUps, e.facultyContacts, e.daysToFirstContact, e.lastFollowUpAt?.toISOString().slice(0, 10), e.highestStage, e.result])] },
    { name: 'Follow-up log', rows: [['When (UTC)', 'Week', 'Author', 'Kind', 'With', 'Stage', 'Call', 'Faculty', 'School', 'Note'],
      ...r.log.map(e => [e.at.toISOString(), e.week, e.author, e.kind, e.target, e.stage, e.callTitle, e.faculty, e.school, e.note])] },
  ]
}
