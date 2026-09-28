/**
 * Assigned Calls: every allocation to faculty in the viewer's schools, with the
 * faculty member's response, both deadlines, the last follow-up and the
 * submission — the working list a coordinator chases from.
 *
 * Scoped by the assignee's school at assignment time (`assignee_org_unit_id`),
 * the same snapshot every other DSR count uses, so moving a person next term
 * does not move last term's work. "Assigned by me" narrows it to the old
 * "Calls I assigned" view.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { textArray, utcTimestamp } from './callSql'
import { indiaDaysToDeadlineSql } from './reportDefinitions'

export const ASSIGNED_STATUS_GROUPS: Record<string, string[] | null> = {
  active: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'],
  awaiting: ['ASSIGNED'],
  submitted: ['COMPLETED'],
  closed: ['CANCELLED', 'DECLINED', 'LAPSED'],
  all: null,
}
export const SILENT_DAYS = 7

export type AssignedFilters = {
  schoolIds: string[]
  status?: string | null
  due?: string | null
  silent?: boolean
  awaitingReply?: boolean
  /** 'month': submitted since the 1st of this month, India time — what the headline tile counts. */
  submittedIn?: string | null
  assignedByUserId?: string | null
  search?: string | null
  callId?: string | null
  assignmentId?: string | null
  asOf: Date
  page: number
  pageSize: number
  all?: boolean
}

export class AssignedError extends Error { constructor(message: string, public status = 400) { super(message) } }

export type AssignedRow = {
  id: string; status: string; outcome: string; createdAt: Date; respondedAt: Date | null; declinedReason: string | null
  call: { id: string; title: string; agency: string | null; deadline: Date | null; daysToDeadline: number | null }
  internalDeadline: Date | null; daysToDue: number | null; overdue: boolean
  faculty: { id: string; name: string; email: string | null }; school: { id: string; name: string }
  assignedBy: { id: string; name: string } | null
  allocationMethod: string | null; allocationReason: string | null; allocationNote: string | null
  followUps: number; facultyContacts: number; lastFollowUp: { at: Date; kind: string; by: string | null; note: string } | null; daysSinceFollowUp: number | null
  nextReminderAt: Date | null
  submittedAt: Date | null; completedAt: Date | null; submissionReference: string | null; submissionUrl: string | null; evidence: string | null; lapsedAt: Date | null
  passedOnTo: { id: string; name: string; status: string } | null; passedOnFrom: { id: string; name: string } | null
}

const ACTIVE = `('ASSIGNED','ACCEPTED','IN_PROGRESS')`

function baseSql(tenantId: string, f: AssignedFilters): Prisma.Sql {
  const due = 'COALESCE(ca.deadline_at, COALESCE(fc.close_date, fc."deadlineAt"))'
  return Prisma.sql`
    WITH base AS (
      SELECT ca.id, ca.status::text status, ca.outcome::text outcome, ca.created_at, ca.responded_at, ca.declined_reason, ca.deadline_at, ca.submitted_at, ca.completed_at,
        ca.submission_reference, ca.submission_url, ca.submission_evidence_status, ca.lapsed_at, ca.allocation_method, ca.allocation_reason, ca.allocation_note,
        ca.assignee_user_id, ca.assigned_by_user_id, ca.previous_assignment_id, ca.funding_call_id,
        COALESCE(fc.scheme_title, fc.title) call_title, COALESCE(fc.agency_name, fc."agencyName") agency, COALESCE(fc.close_date, fc."deadlineAt") call_deadline,
        ${indiaDaysToDeadlineSql('COALESCE(fc.close_date, fc."deadlineAt")', f.asOf)} call_days,
        ${indiaDaysToDeadlineSql(due, f.asOf)} due_days,
        su.id school_id, su.name school_name,
        COALESCE(fu.name, fu.email) faculty_name, fu.email faculty_email, COALESCE(bu.name, bu.email) assigned_by_name,
        lf.happened_at last_at, lf.kind last_kind, lf.note last_note, COALESCE(lu.name, lu.email) last_by,
        (SELECT count(*)::int FROM assignment_follow_ups x WHERE x.assignment_id=ca.id AND x.kind <> 'TRIAGE') follow_ups,
        (SELECT count(*)::int FROM assignment_follow_ups x WHERE x.assignment_id=ca.id AND x.kind IN ('CALL','EMAIL','MEETING') AND x.contact_target='FACULTY') faculty_contacts,
        (SELECT min(x.remind_at) FROM assignment_follow_ups x WHERE x.assignment_id=ca.id AND x.remind_at IS NOT NULL AND x.reminder_sent_at IS NULL) next_reminder_at
      FROM call_assignments ca
      JOIN tenant_org_units au ON au.id = ca.assignee_org_unit_id
      JOIN tenant_org_units su ON su.id = au.path[1]
      JOIN funding_calls fc ON fc.id = ca.funding_call_id
      JOIN users fu ON fu.id = ca.assignee_user_id
      LEFT JOIN users bu ON bu.id = ca.assigned_by_user_id
      LEFT JOIN LATERAL (SELECT x.happened_at, x.kind, x.note, x.created_by_user_id FROM assignment_follow_ups x
        WHERE x.assignment_id=ca.id AND x.kind <> 'TRIAGE' ORDER BY x.happened_at DESC, x.id DESC LIMIT 1) lf ON TRUE
      LEFT JOIN users lu ON lu.id = lf.created_by_user_id
      WHERE ca.tenant_id=${tenantId} AND au.path[1] = ANY(${textArray(f.schoolIds)})
        ${f.assignedByUserId ? Prisma.sql`AND ca.assigned_by_user_id = ${f.assignedByUserId}` : Prisma.empty}
        ${f.callId ? Prisma.sql`AND ca.funding_call_id = ${f.callId}` : Prisma.empty}
        ${f.assignmentId ? Prisma.sql`AND ca.id = ${f.assignmentId}` : Prisma.empty}
        ${f.search ? Prisma.sql`AND (COALESCE(fc.scheme_title, fc.title) ILIKE ${`%${f.search}%`} OR COALESCE(fc.agency_name, fc."agencyName") ILIKE ${`%${f.search}%`}
          OR COALESCE(fu.name,'') ILIKE ${`%${f.search}%`} OR fu.email ILIKE ${`%${f.search}%`} OR fc.id = ${f.search})` : Prisma.empty}
    ), flagged AS (
      SELECT b.*,
        (b.status IN ${Prisma.raw(ACTIVE)} AND b.due_days < 0) overdue,
        (b.status IN ${Prisma.raw(ACTIVE)} AND COALESCE(b.last_at, b.created_at) < ${utcTimestamp(new Date(f.asOf.getTime() - SILENT_DAYS * 86400000))}) silent,
        (b.status = 'ASSIGNED' AND b.created_at < ${utcTimestamp(new Date(f.asOf.getTime() - SILENT_DAYS * 86400000))}) awaiting_long,
        (b.status = 'COMPLETED' AND (COALESCE(b.submitted_at, b.completed_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
          >= date_trunc('month', (${f.asOf.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kolkata'))) submitted_this_month
      FROM base b
    )`
}

function where(f: AssignedFilters): Prisma.Sql {
  const group = ASSIGNED_STATUS_GROUPS[f.status || 'active']
  const parts: Prisma.Sql[] = []
  if (group) parts.push(Prisma.sql`status IN (${Prisma.join(group)})`)
  // Deadlines only bind live allocations: a submitted or closed one is never
  // "overdue", which is also how the Overdue tile counts.
  if (f.due === 'overdue') parts.push(Prisma.sql`overdue`)
  else if (f.due) parts.push(Prisma.sql`status IN ${Prisma.raw(ACTIVE)} AND due_days BETWEEN 0 AND ${Number(f.due)}`)
  if (f.submittedIn === 'month') parts.push(Prisma.sql`submitted_this_month`)
  if (f.silent) parts.push(Prisma.sql`silent`)
  if (f.awaitingReply) parts.push(Prisma.sql`awaiting_long`)
  return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty
}

export async function getAssignedCalls(tenantId: string, f: AssignedFilters) {
  if (f.status && !(f.status in ASSIGNED_STATUS_GROUPS)) throw new AssignedError('Unknown status filter.')
  if (f.due && !['overdue', '7', '14', '30'].includes(f.due)) throw new AssignedError('Unknown deadline filter.')
  if (f.submittedIn && f.submittedIn !== 'month') throw new AssignedError('Unknown submission filter.')
  const summaryEmpty = { active: 0, awaitingReply: 0, overdue: 0, silent: 0, submittedThisMonth: 0 }
  if (!f.schoolIds.length) return { rows: [] as AssignedRow[], total: 0, page: f.page, pageSize: f.pageSize, summary: summaryEmpty }
  const base = baseSql(tenantId, f)
  const [summary] = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`${base}
    SELECT count(*) FILTER (WHERE status IN ${Prisma.raw(ACTIVE)})::int active,
      count(*) FILTER (WHERE awaiting_long)::int awaiting_reply,
      count(*) FILTER (WHERE overdue)::int overdue,
      count(*) FILTER (WHERE silent)::int silent,
      count(*) FILTER (WHERE submitted_this_month)::int submitted_this_month
    FROM flagged`)
  const filter = where(f)
  const [count] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`${base} SELECT count(*)::int n FROM flagged ${filter}`)
  const rows = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`${base}
    SELECT fl.*, nxt.id next_id, COALESCE(nu.name, nu.email) next_name, nxt.status::text next_status, COALESCE(pu.name, pu.email) prev_name
      FROM (SELECT * FROM flagged ${filter}) fl
      LEFT JOIN LATERAL (SELECT n.id, n.assignee_user_id, n.status FROM call_assignments n WHERE n.previous_assignment_id = fl.id ORDER BY n.created_at DESC LIMIT 1) nxt ON TRUE
      LEFT JOIN users nu ON nu.id = nxt.assignee_user_id
      LEFT JOIN call_assignments prev ON prev.id = fl.previous_assignment_id
      LEFT JOIN users pu ON pu.id = prev.assignee_user_id
     ORDER BY (fl.status IN ${Prisma.raw(ACTIVE)}) DESC, fl.due_days ASC NULLS LAST, fl.created_at DESC, fl.id
     ${f.all ? Prisma.empty : Prisma.sql`LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`}`)
  return {
    rows: rows.map((r): AssignedRow => ({
      id: r.id, status: r.status, outcome: r.outcome, createdAt: r.created_at, respondedAt: r.responded_at, declinedReason: r.declined_reason,
      call: { id: r.funding_call_id, title: r.call_title, agency: r.agency, deadline: r.call_deadline, daysToDeadline: r.call_days },
      internalDeadline: r.deadline_at, daysToDue: r.due_days, overdue: r.overdue,
      faculty: { id: r.assignee_user_id, name: r.faculty_name, email: r.faculty_email }, school: { id: r.school_id, name: r.school_name },
      assignedBy: r.assigned_by_user_id ? { id: r.assigned_by_user_id, name: r.assigned_by_name } : null,
      allocationMethod: r.allocation_method, allocationReason: r.allocation_reason, allocationNote: r.allocation_note,
      followUps: r.follow_ups, facultyContacts: r.faculty_contacts,
      lastFollowUp: r.last_at ? { at: r.last_at, kind: r.last_kind, by: r.last_by, note: r.last_note } : null,
      daysSinceFollowUp: r.last_at ? Math.floor((f.asOf.getTime() - new Date(r.last_at).getTime()) / 86400000) : null,
      nextReminderAt: r.next_reminder_at,
      submittedAt: r.submitted_at, completedAt: r.completed_at, submissionReference: r.submission_reference, submissionUrl: r.submission_url,
      evidence: r.submission_evidence_status, lapsedAt: r.lapsed_at,
      passedOnTo: r.next_id ? { id: r.next_id, name: r.next_name, status: r.next_status } : null,
      passedOnFrom: r.previous_assignment_id ? { id: r.previous_assignment_id, name: r.prev_name } : null,
    })),
    total: count?.n ?? 0, page: f.page, pageSize: f.pageSize,
    summary: { active: summary?.active ?? 0, awaitingReply: summary?.awaiting_reply ?? 0, overdue: summary?.overdue ?? 0, silent: summary?.silent ?? 0,
      submittedThisMonth: summary?.submitted_this_month ?? 0 },
  }
}

export function assignedExportTables(rows: AssignedRow[]) {
  return [{ name: 'Assigned calls', rows: [
    ['Assignment ID', 'Call ID', 'Call', 'Agency', 'Agency deadline', 'Internal deadline', 'Faculty', 'Faculty email', 'School', 'Assigned by', 'Assigned on', 'Status',
      'Responded', 'Declined reason', 'Follow-ups', 'Faculty contacts', 'Last follow-up', 'Last follow-up by', 'Next reminder', 'Submitted on', 'Submission reference', 'Evidence', 'Outcome', 'Manual allocation reason'],
    ...rows.map(r => [r.id, r.call.id, r.call.title, r.call.agency, r.call.deadline?.toISOString().slice(0, 10), r.internalDeadline?.toISOString().slice(0, 10), r.faculty.name, r.faculty.email,
      r.school.name, r.assignedBy?.name, r.createdAt.toISOString().slice(0, 10), r.status, r.respondedAt?.toISOString().slice(0, 10), r.declinedReason, r.followUps, r.facultyContacts,
      r.lastFollowUp ? `${r.lastFollowUp.at.toISOString().slice(0, 10)} ${r.lastFollowUp.kind}` : '', r.lastFollowUp?.by, r.nextReminderAt?.toISOString().slice(0, 10),
      r.submittedAt?.toISOString().slice(0, 10), r.submissionReference, r.evidence, r.outcome, r.allocationReason]),
  ] }]
}
