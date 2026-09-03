/**
 * Shared shapes for the Funding Department routes.
 *
 * These live outside the route files because Next.js App Router only permits
 * HTTP handlers and a fixed set of config exports from a `route.ts`.
 */
import type { TenantContext } from '@/lib/auth/tenantAccess'
import type { ManagedScope } from '@/lib/orgUnits/scope'

export const FOLLOW_UP_KINDS = ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'REMINDER'] as const
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number]

export const memberInclude = {
  user: { select: { id: true, name: true, email: true } },
  school_assignments: {
    select: {
      id: true,
      org_unit_id: true,
      created_at: true,
      is_deputy: true,
      org_unit: { select: { id: true, name: true, code: true, is_active: true } },
    },
    orderBy: { created_at: 'asc' as const },
  },
} as const

export function serializeMember(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.user?.name || null,
    email: row.user?.email || null,
    isHead: row.is_head,
    title: row.title,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastDigestSentAt: row.last_digest_sent_at ?? null,
    awayFrom: row.away_from ?? null,
    awayUntil: row.away_until ?? null,
    isAway: isMemberAway(row),
    // `schools` stays the primary rota, so every existing caller keeps its
    // meaning; deputy cover is a separate list rather than a flag mixed in.
    schools: (row.school_assignments || [])
      .filter((s: any) => !s.is_deputy)
      .map((s: any) => ({
        id: s.org_unit?.id ?? s.org_unit_id,
        name: s.org_unit?.name ?? null,
        code: s.org_unit?.code ?? null,
        coverageId: s.id,
      })),
    deputySchools: (row.school_assignments || [])
      .filter((s: any) => s.is_deputy)
      .map((s: any) => ({
        id: s.org_unit?.id ?? s.org_unit_id,
        name: s.org_unit?.name ?? null,
        code: s.org_unit?.code ?? null,
        coverageId: s.id,
      })),
  }
}

/**
 * Whether a member is on leave right now.
 *
 * An open-ended window (a start with no end) counts as away — someone who set
 * "from Monday" and forgot the end date is still away, and treating that as
 * present is the failure this whole feature exists to prevent.
 */
export function isMemberAway(row: { away_from?: Date | null; away_until?: Date | null }, at = new Date()) {
  const from = row.away_from ? new Date(row.away_from) : null
  const until = row.away_until ? new Date(row.away_until) : null
  if (!from && !until) return false
  if (from && at < from) return false
  if (until && at > until) return false
  return true
}

export function serializeFollowUp(row: any) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    // Null on an assignment-level row written before call-level follow-ups
    // existed; stamped on everything since, so the dossier can group by call.
    fundingCallId: row.funding_call_id ?? null,
    orgUnitId: row.org_unit_id ?? null,
    kind: row.kind,
    note: row.note,
    happenedAt: row.happened_at,
    remindAt: row.remind_at,
    remindFaculty: row.remind_faculty,
    reminderSentAt: row.reminder_sent_at,
    createdAt: row.created_at,
    author: row.created_by
      ? { id: row.created_by.id, name: row.created_by.name, email: row.created_by.email }
      : null,
  }
}

/**
 * Who may change the department's shape: add or remove members, promote the
 * head. Kept to full tenant admins for the same reason headship grants are —
 * a department that can recruit itself is not a delegated permission.
 */
export function canAdministerDept(context: TenantContext): boolean {
  return context.isAdmin
}

/**
 * Who may review the department and move schools between members: tenant
 * admins and the head. The head runs the rota; that is the job.
 */
export function canReviewDept(context: TenantContext, scope: ManagedScope): boolean {
  return context.isAdmin || scope.fundingDept.isHead
}

/**
 * Who may open one school's work: its queue, a call's dossier in it, its
 * call-level follow-ups, the school page.
 *
 * Three surfaces had grown three different answers — the overview used
 * `canReviewDept`, the school page required the unit in `managedUnitIds`, the
 * shortlist accepted anyone who could assign. The visible casualty was a
 * department head with no coverage rows of their own, who could open the
 * whole-department funnel and was then 403'd from every individual school. One
 * rule, written once:
 *
 *   tenant-wide admin            -> every school
 *   the department head          -> every school (they answer for the department)
 *   anyone else                  -> the schools inside their reach
 *
 * `scope.fundingDept.isHead` is the department head. Do not confuse it with
 * `scope.isHead`, which is true for anyone holding a manager grant or covering
 * a school.
 */
export function canOpenSchoolWork(scope: ManagedScope, orgUnitId: string): boolean {
  if (scope.isTenantWide) return true
  if (scope.fundingDept.isHead) return true
  return scope.managedUnitIds.includes(orgUnitId)
}

/**
 * Where a shortlisted person stands for a call. A string union rather than a
 * Postgres enum, like FOLLOW_UP_KINDS, so a new state needs no migration.
 */
export const CANDIDATE_STATUSES = [
  'SHORTLISTED',
  'APPROACHED',
  'ASSIGNED',
  'DECLINED',
  'PASSED_OVER',
] as const

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]
