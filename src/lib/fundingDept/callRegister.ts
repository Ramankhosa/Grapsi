/**
 * The Call Register: one row per unique call, each expandable into its school
 * responsibilities (reportDefinitions: uniqueCall, schoolResponsibility).
 *
 * Built directly on dsr_call_school_mappings with SQL filtering, counting and
 * paging. Deliberately not another view inside `getManagementReport`, which
 * computes every school's whole portfolio in memory before slicing a page —
 * the reason those reports time out. Every state here comes from the shared
 * SQL definitions, so a Register figure and the same figure anywhere else are
 * the same number by construction.
 */
import prisma from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

import { textArray, visibleCallSql } from './callSql'
import type { ApplicationRow } from './managementRules'
import { MAPPING_SOURCE_LABELS, type MappingSource } from './callSchoolMapping'
import {
  DEADLINE_STATES, REVIEW_STATES, deadlineStateSql, dsrApplicationSubmittedSql, reviewStateSql, submissionState,
  type DeadlineState, type ReviewState,
} from './reportDefinitions'

export const REGISTER_SUBMISSION_FILTERS = ['NO_ALLOCATION', 'NONE_SUBMITTED', 'PARTLY_SUBMITTED', 'ALL_SUBMITTED'] as const
export type RegisterSubmissionFilter = (typeof REGISTER_SUBMISSION_FILTERS)[number]

export type RegisterFilters = {
  /** Schools the viewer may see; undefined for department-wide access. */
  scopeSchoolIds?: string[]
  schoolId?: string | null
  coordinatorUserId?: string | null
  reviewState?: string | null
  deadlineState?: string | null
  submission?: string | null
  source?: string | null
  callSearch?: string | null
  callId?: string | null
  /** Only responsibilities with an open named action past its due date. */
  overdueActions?: boolean
  /** Period rule: calls that entered in [start, end). Omit both for all time. */
  start?: Date | null
  end?: Date | null
  asOf: Date
  page?: number
  pageSize?: number
  /** Export: every matching row, no paging. */
  all?: boolean
}

export class RegisterError extends Error { constructor(message: string, public status = 400) { super(message) } }

/** Responsibilities with their facts and shared states, filtered. One CTE for rows, totals and export. */
function responsibilitiesSql(tenantId: string, f: RegisterFilters): Prisma.Sql {
  const submitted = dsrApplicationSubmittedSql('a')
  const review = reviewStateSql({ triageStatus: 'r.triage_status', triageDecidedAt: 'r.triage_decided_at', dispositionReason: 'r.disposition_reason',
    formalAllocations: 'r.formal_allocations', namedActions: 'r.named_actions' })
  const deadline = deadlineStateSql({ deadline: 'r.deadline', formalAllocations: 'r.formal_allocations', submissions: 'r.submissions',
    closedWithReason: `(${review.sql} = 'CLOSED_NO_ALLOCATION')` }, f.asOf)
  return Prisma.sql`
    WITH facts AS (
      SELECT m.call_id, m.school_id, s.name school_name, m.source, m.tier, m.reason mapping_reason, m.is_origin, m.mapped_at, m.backfilled,
        COALESCE(fc.scheme_title, fc.title) title, COALESCE(fc.agency_name, fc."agencyName") agency,
        COALESCE(fc.close_date, fc."deadlineAt") deadline, COALESCE(fc."publishedAt", fc."createdAt") entered_at,
        tri.status triage_status, tri.decided_at triage_decided_at, disp.reason disposition_reason, disp.explanation disposition_explanation,
        (SELECT count(*)::int FROM dsr_applications a WHERE a.tenant_id=${tenantId} AND a.call_id=m.call_id AND a.school_id=m.school_id AND a.assignment_id IS NOT NULL) formal_allocations,
        (SELECT count(*)::int FROM dsr_applications a WHERE a.tenant_id=${tenantId} AND a.call_id=m.call_id AND a.school_id=m.school_id AND a.assignment_id IS NOT NULL AND ${submitted}) allocated_submissions,
        (SELECT count(*)::int FROM dsr_applications a WHERE a.tenant_id=${tenantId} AND a.call_id=m.call_id AND a.school_id=m.school_id AND ${submitted}) submissions,
        (SELECT count(*)::int FROM dsr_applications a WHERE a.tenant_id=${tenantId} AND a.call_id=m.call_id AND a.school_id=m.school_id AND a.assignment_id IS NULL) independent_applications,
        (SELECT count(*)::int FROM dsr_actions x WHERE x.tenant_id=${tenantId} AND x.call_id=m.call_id AND x.school_id=m.school_id AND x.application_id IS NULL) named_actions,
        (SELECT count(*)::int FROM dsr_actions x LEFT JOIN dsr_applications a ON a.id=x.application_id AND a.tenant_id=x.tenant_id
          WHERE x.tenant_id=${tenantId} AND x.school_id=m.school_id AND COALESCE(x.call_id, a.call_id)=m.call_id
            AND x.status IN ('OPEN','ACKNOWLEDGED') AND x.due_at < ${f.asOf}) overdue_actions,
        COALESCE(tr.owner_user_id, (SELECT dm.user_id FROM funding_dept_school_assignments sa JOIN funding_dept_members dm ON dm.id=sa.member_id AND dm.is_active
          WHERE sa.tenant_id=${tenantId} AND sa.org_unit_id=m.school_id AND NOT sa.is_deputy ORDER BY sa.id LIMIT 1)) coordinator_id,
        tr.owner_user_id IS NOT NULL transferred
      FROM dsr_call_school_mappings m
      JOIN funding_calls fc ON fc.id = m.call_id
      JOIN tenant_org_units s ON s.id = m.school_id
      LEFT JOIN call_school_triage tri ON tri.funding_call_id = m.call_id AND tri.org_unit_id = m.school_id
      LEFT JOIN dsr_opportunity_dispositions disp ON disp.tenant_id=${tenantId} AND disp.school_id=m.school_id AND disp.call_id=m.call_id
      LEFT JOIN dsr_responsibility_transfers tr ON tr.tenant_id=${tenantId} AND tr.school_id=m.school_id AND tr.call_id=m.call_id
      WHERE m.tenant_id=${tenantId} AND m.is_active AND ${visibleCallSql(tenantId, 'fc')}
        ${f.scopeSchoolIds ? Prisma.sql`AND m.school_id = ANY(${textArray(f.scopeSchoolIds)})` : Prisma.empty}
        ${f.schoolId ? Prisma.sql`AND m.school_id = ${f.schoolId}` : Prisma.empty}
        ${f.source ? Prisma.sql`AND m.source = ${f.source}` : Prisma.empty}
        ${f.callId ? Prisma.sql`AND m.call_id = ${f.callId}` : Prisma.empty}
        ${f.callSearch ? Prisma.sql`AND (COALESCE(fc.scheme_title, fc.title) ILIKE ${`%${f.callSearch}%`} OR fc.id = ${f.callSearch})` : Prisma.empty}
        ${f.start ? Prisma.sql`AND COALESCE(fc."publishedAt", fc."createdAt") >= ${f.start}` : Prisma.empty}
        ${f.end ? Prisma.sql`AND COALESCE(fc."publishedAt", fc."createdAt") < ${f.end}` : Prisma.empty}
    ), resp AS (
      SELECT r.*, ${review} review_state, ${deadline} deadline_state FROM facts r
    ), filtered AS (
      SELECT * FROM resp WHERE TRUE
        ${f.coordinatorUserId ? Prisma.sql`AND coordinator_id = ${f.coordinatorUserId}` : Prisma.empty}
        ${f.reviewState ? Prisma.sql`AND review_state = ${f.reviewState}` : Prisma.empty}
        ${f.deadlineState ? Prisma.sql`AND deadline_state = ${f.deadlineState}` : Prisma.empty}
        ${f.overdueActions ? Prisma.sql`AND overdue_actions > 0` : Prisma.empty}
    )`
}

/** Call-level submission rollup, filterable ("1 of 3 submitted"). */
const CALL_SUBMISSION_SQL = Prisma.sql`CASE
  WHEN sum(formal_allocations)=0 THEN 'NO_ALLOCATION'
  WHEN sum(allocated_submissions)=0 THEN 'NONE_SUBMITTED'
  WHEN sum(allocated_submissions)<sum(formal_allocations) THEN 'PARTLY_SUBMITTED'
  ELSE 'ALL_SUBMITTED' END`

export type RegisterResponsibility = {
  callId: string; schoolId: string; schoolName: string; source: MappingSource; sourceLabel: string; tier: string | null; mappingReason: string | null
  isOrigin: boolean; mappedAt: Date; backfilled: boolean; coordinator: { id: string; name: string } | null; transferred: boolean
  reviewState: ReviewState; deadlineState: DeadlineState; formalAllocations: number; allocatedSubmissions: number; submissions: number
  independentApplications: number; disposition: { reason: string; explanation: string | null } | null
  allocations: Array<{ applicationId: string; faculty: string | null; allocatedBy: string | null; allocatedAt: Date; submissionState: string; workingStage: string | null }>
  independent: Array<{ applicationId: string; faculty: string | null; submissionState: string }>
  nextAction: { title: string; owner: string | null; dueAt: Date | null } | null
}
export type RegisterRow = {
  callId: string; title: string; agency: string | null; enteredAt: Date; deadline: Date | null
  schools: number; schoolNames: string[]; formalAllocations: number; allocatedSubmissions: number; submissionLabel: string; submission: RegisterSubmissionFilter
  deadlineState: DeadlineState; nextAction: string; responsibilities: RegisterResponsibility[]
}

function validate(f: RegisterFilters) {
  if (f.reviewState && !REVIEW_STATES.includes(f.reviewState as ReviewState)) throw new RegisterError('Unknown review state.')
  if (f.deadlineState && !DEADLINE_STATES.includes(f.deadlineState as DeadlineState)) throw new RegisterError('Unknown deadline state.')
  if (f.submission && !REGISTER_SUBMISSION_FILTERS.includes(f.submission as RegisterSubmissionFilter)) throw new RegisterError('Unknown submission filter.')
  if (f.source && !(f.source in MAPPING_SOURCE_LABELS)) throw new RegisterError('Unknown mapping source.')
}

/** The most urgent deadline state among a call's schools, for the collapsed row. */
const DEADLINE_URGENCY: DeadlineState[] = ['MISSED_NEVER_ALLOCATED', 'MISSED_ALLOCATED_NOT_SUBMITTED', 'CLOSING_SOON', 'OPEN', 'PASSED_HANDLED', 'NO_DEADLINE']

export async function getCallRegister(tenantId: string, f: RegisterFilters) {
  validate(f)
  const page = Math.max(1, f.page || 1), pageSize = Math.min(100, Math.max(1, f.pageSize || 20))
  const base = responsibilitiesSql(tenantId, f)
  const having = f.submission ? Prisma.sql`HAVING ${CALL_SUBMISSION_SQL} = ${f.submission}` : Prisma.empty
  const [totals] = await prisma.$queryRaw<Array<{ calls: number; responsibilities: number; allocations: number; allocated_submissions: number; schools: number }>>(Prisma.sql`
    ${base}, calls AS (SELECT call_id, count(*)::int n, sum(formal_allocations)::int alloc, sum(allocated_submissions)::int subs FROM filtered GROUP BY call_id ${having})
    SELECT count(*)::int calls, COALESCE(sum(n),0)::int responsibilities, COALESCE(sum(alloc),0)::int allocations, COALESCE(sum(subs),0)::int allocated_submissions,
      (SELECT count(DISTINCT school_id)::int FROM filtered WHERE call_id IN (SELECT call_id FROM calls)) schools FROM calls`)
  const callPage = await prisma.$queryRaw<Array<{ call_id: string; title: string; agency: string | null; entered_at: Date; deadline: Date | null; submission: RegisterSubmissionFilter }>>(Prisma.sql`
    ${base}
    SELECT call_id, min(title) title, min(agency) agency, min(entered_at) entered_at, min(deadline) deadline, ${CALL_SUBMISSION_SQL} submission
      FROM filtered GROUP BY call_id ${having}
     ORDER BY min(deadline) ASC NULLS LAST, min(entered_at) DESC, call_id
     ${f.all ? Prisma.empty : Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`}`)
  const callIds = callPage.map(c => c.call_id)
  const rows = callIds.length ? await detail(tenantId, f, base, callIds) : []
  return { rows, total: totals?.calls ?? 0, page, pageSize,
    totals: { calls: totals?.calls ?? 0, responsibilities: totals?.responsibilities ?? 0, schools: totals?.schools ?? 0,
      allocations: totals?.allocations ?? 0, allocatedSubmissions: totals?.allocated_submissions ?? 0 },
    ordered: callPage }
}

async function detail(tenantId: string, f: RegisterFilters, base: Prisma.Sql, callIds: string[]): Promise<RegisterRow[]> {
  const ids = textArray(callIds)
  const [resp, apps, verifications, actions] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`${base} SELECT f.*, COALESCE(u.name, u.email) coordinator_name FROM filtered f LEFT JOIN users u ON u.id = f.coordinator_id WHERE f.call_id = ANY(${ids}) ORDER BY f.school_name`),
    prisma.$queryRaw<Array<ApplicationRow & { faculty_name: string | null; allocator_name: string | null }>>(Prisma.sql`
      SELECT a.*, COALESCE(fu.name, fu.email) faculty_name, COALESCE(au.name, au.email) allocator_name FROM dsr_applications a
        LEFT JOIN users fu ON fu.id = a.faculty_id LEFT JOIN users au ON au.id = a.allocated_by
       WHERE a.tenant_id=${tenantId} AND a.call_id = ANY(${ids}) ORDER BY a.created_at, a.id`),
    prisma.$queryRaw<Array<{ application_id: string }>>(Prisma.sql`SELECT application_id FROM dsr_submission_verifications WHERE tenant_id=${tenantId}`),
    prisma.$queryRaw<Array<{ school_id: string; call_id: string; title: string; due_at: Date | null; owner: string | null }>>(Prisma.sql`
      SELECT x.school_id, x.call_id, x.title, x.due_at, COALESCE(u.name, u.email) owner FROM dsr_actions x LEFT JOIN users u ON u.id = x.owner_user_id
       WHERE x.tenant_id=${tenantId} AND x.call_id = ANY(${ids}) AND x.application_id IS NULL AND x.status IN ('OPEN','ACKNOWLEDGED')
       ORDER BY x.is_next DESC, x.due_at NULLS LAST`),
  ])
  // Verification is only as good as the evidence it checked; the Register shows
  // it as recorded. The management report re-checks the evidence fingerprint.
  const verified = new Set(verifications.map(v => v.application_id))
  return callIds.map(callId => {
    const mine = resp.filter(r => r.call_id === callId)
    const responsibilities: RegisterResponsibility[] = mine.map(r => {
      const schoolApps = apps.filter(a => a.call_id === callId && a.school_id === r.school_id)
      const action = actions.find(x => x.call_id === callId && x.school_id === r.school_id)
      return {
        callId, schoolId: r.school_id, schoolName: r.school_name, source: r.source, sourceLabel: MAPPING_SOURCE_LABELS[r.source as MappingSource] || r.source,
        tier: r.tier, mappingReason: r.mapping_reason, isOrigin: r.is_origin, mappedAt: r.mapped_at, backfilled: r.backfilled,
        coordinator: r.coordinator_id ? { id: r.coordinator_id, name: r.coordinator_name } : null, transferred: r.transferred,
        reviewState: r.review_state, deadlineState: r.deadline_state, formalAllocations: r.formal_allocations, allocatedSubmissions: r.allocated_submissions,
        submissions: r.submissions, independentApplications: r.independent_applications,
        disposition: r.disposition_reason ? { reason: r.disposition_reason, explanation: r.disposition_explanation } : null,
        allocations: schoolApps.filter(a => a.assignment_id).map(a => ({ applicationId: a.id, faculty: a.faculty_name, allocatedBy: a.allocator_name, allocatedAt: a.created_at,
          ...submissionState(a, verified.has(a.id)), submissionState: submissionState(a, verified.has(a.id)).state })),
        independent: schoolApps.filter(a => !a.assignment_id).map(a => ({ applicationId: a.id, faculty: a.faculty_name, submissionState: submissionState(a, verified.has(a.id)).state })),
        nextAction: action ? { title: action.title, owner: action.owner, dueAt: action.due_at }
          : r.coordinator_id ? null : { title: 'Assign school coverage', owner: 'DSR head', dueAt: null },
      }
    })
    const first = mine[0]
    const formalAllocations = responsibilities.reduce((n, r) => n + r.formalAllocations, 0)
    const allocatedSubmissions = responsibilities.reduce((n, r) => n + r.allocatedSubmissions, 0)
    const deadlineState = DEADLINE_URGENCY.find(state => responsibilities.some(r => r.deadlineState === state)) || 'NO_DEADLINE'
    const pendingReview = responsibilities.filter(r => r.reviewState === 'NOT_REVIEWED').length
    const owed = responsibilities.filter(r => r.reviewState === 'REVIEWED_ALLOCATION_PENDING').length
    return {
      callId, title: first.title, agency: first.agency, enteredAt: first.entered_at, deadline: first.deadline,
      schools: responsibilities.length, schoolNames: responsibilities.map(r => r.schoolName), formalAllocations, allocatedSubmissions,
      submission: formalAllocations === 0 ? 'NO_ALLOCATION' : allocatedSubmissions === 0 ? 'NONE_SUBMITTED' : allocatedSubmissions < formalAllocations ? 'PARTLY_SUBMITTED' : 'ALL_SUBMITTED',
      submissionLabel: formalAllocations ? `${allocatedSubmissions} of ${formalAllocations} submitted` : 'No allocation',
      deadlineState,
      nextAction: responsibilities.find(r => r.nextAction)?.nextAction?.title
        || (pendingReview ? `${pendingReview} school review${pendingReview === 1 ? '' : 's'} pending` : owed ? `Allocate faculty in ${owed} school${owed === 1 ? '' : 's'}` : 'No open action'),
      responsibilities,
    }
  })
}

/** Flat export rows: one per call, then one per school responsibility. */
export function registerExportTables(rows: RegisterRow[]) {
  const calls: unknown[][] = [['Call ID', 'Call', 'Agency', 'Entered', 'Deadline', 'Relevant schools', 'Allocations', 'Submission', 'Deadline state', 'Next action']]
  const schools: unknown[][] = [['Call ID', 'Call', 'School', 'Mapping source', 'Mapping reason', 'Mapped at', 'Reconstructed or backfilled', 'Responsible coordinator',
    'Review state', 'Allocations (faculty · allocated by · date · submission)', 'Independent applications', 'Deadline state', 'Next action', 'Closure reason']]
  for (const row of rows) {
    calls.push([row.callId, row.title, row.agency, row.enteredAt?.toISOString(), row.deadline?.toISOString(), row.schoolNames.join(' | '),
      row.formalAllocations, row.submissionLabel, row.deadlineState, row.nextAction])
    for (const r of row.responsibilities) schools.push([row.callId, row.title, r.schoolName, r.sourceLabel, r.mappingReason, r.mappedAt?.toISOString(), r.backfilled ? 'Yes' : 'No',
      r.coordinator?.name || 'Unassigned', r.reviewState, r.allocations.map(a => `${a.faculty} · ${a.allocatedBy} · ${a.allocatedAt.toISOString().slice(0, 10)} · ${a.submissionState}`).join(' | '),
      r.independent.map(a => `${a.faculty} · ${a.submissionState}`).join(' | '), r.deadlineState, r.nextAction?.title, r.disposition ? `${r.disposition.reason}${r.disposition.explanation ? `: ${r.disposition.explanation}` : ''}` : ''])
  }
  return [{ name: 'Call register', rows: calls }, { name: 'School responsibilities', rows: schools }]
}

/**
 * The head's Overview. Six period totals (calls that entered in the period,
 * with their progress as of today), a "needs attention now" strip that ignores
 * the period, and one row per school. Every figure is a count over the same
 * responsibility SQL the Register lists, so each one opens exactly the rows it
 * counts via the Register filter named beside it.
 */
export async function getOverview(tenantId: string, f: { scopeSchoolIds?: string[]; start: Date; end: Date; asOf: Date; untouchedDays: number }) {
  const periodBase = responsibilitiesSql(tenantId, { scopeSchoolIds: f.scopeSchoolIds, start: f.start, end: f.end, asOf: f.asOf })
  const allBase = responsibilitiesSql(tenantId, { scopeSchoolIds: f.scopeSchoolIds, asOf: f.asOf })
  const [period] = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`${periodBase}
    SELECT count(DISTINCT call_id)::int calls_mapped, count(*)::int responsibilities,
      count(*) FILTER (WHERE review_state='NOT_REVIEWED')::int reviews_pending,
      count(*) FILTER (WHERE review_state='REVIEWED_ALLOCATION_PENDING')::int reviewed_unallocated,
      COALESCE(sum(formal_allocations),0)::int allocations, COALESCE(sum(submissions),0)::int submissions
    FROM filtered`)
  const [entered] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int n FROM funding_calls fc
    WHERE ${visibleCallSql(tenantId, 'fc')} AND COALESCE(fc."publishedAt", fc."createdAt") >= ${f.start} AND COALESCE(fc."publishedAt", fc."createdAt") < ${f.end}
      ${f.scopeSchoolIds ? Prisma.sql`AND EXISTS (SELECT 1 FROM dsr_call_school_mappings m WHERE m.tenant_id=${tenantId} AND m.call_id=fc.id AND m.school_id = ANY(${textArray(f.scopeSchoolIds)}))` : Prisma.empty}`)
  const [attention] = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`${allBase}
    SELECT count(*) FILTER (WHERE deadline_state='CLOSING_SOON' AND review_state IN ('NOT_REVIEWED','REVIEWED_ALLOCATION_PENDING'))::int closing_soon_unallocated,
      count(*) FILTER (WHERE deadline_state='MISSED_NEVER_ALLOCATED')::int missed_never_allocated,
      count(*) FILTER (WHERE deadline_state='MISSED_ALLOCATED_NOT_SUBMITTED')::int missed_allocated_not_submitted,
      count(*) FILTER (WHERE review_state='NOT_REVIEWED' AND mapped_at < ${new Date(f.asOf.getTime() - f.untouchedDays * 86400000)})::int reviews_overdue,
      count(*) FILTER (WHERE coordinator_id IS NULL)::int without_coordinator,
      count(*) FILTER (WHERE overdue_actions > 0)::int overdue_actions
    FROM filtered`)
  const schools = await prisma.$queryRaw<Array<Record<string, any>>>(Prisma.sql`${periodBase}
    SELECT f.school_id, min(f.school_name) school_name, min(f.coordinator_id) coordinator_id, min(COALESCE(u.name, u.email)) coordinator_name,
      count(*)::int responsibilities, count(*) FILTER (WHERE review_state='NOT_REVIEWED')::int reviews_pending,
      count(*) FILTER (WHERE review_state='REVIEWED_ALLOCATION_PENDING')::int reviewed_unallocated,
      count(*) FILTER (WHERE review_state='ALLOCATED')::int allocated, count(*) FILTER (WHERE review_state='CLOSED_NO_ALLOCATION')::int closed,
      COALESCE(sum(submissions),0)::int submissions,
      count(*) FILTER (WHERE deadline_state IN ('MISSED_NEVER_ALLOCATED','MISSED_ALLOCATED_NOT_SUBMITTED'))::int missed
    FROM filtered f LEFT JOIN users u ON u.id = f.coordinator_id GROUP BY f.school_id ORDER BY min(f.school_name)`)
  return {
    totals: { callsEntered: entered?.n ?? 0, callsMapped: period?.calls_mapped ?? 0, reviewsPending: period?.reviews_pending ?? 0,
      reviewedUnallocated: period?.reviewed_unallocated ?? 0, allocations: period?.allocations ?? 0, submissions: period?.submissions ?? 0,
      responsibilities: period?.responsibilities ?? 0 },
    needsAttention: { overdueActions: attention?.overdue_actions ?? 0, reviewsOverdue: attention?.reviews_overdue ?? 0, closingSoonUnallocated: attention?.closing_soon_unallocated ?? 0,
      missedNeverAllocated: attention?.missed_never_allocated ?? 0, missedAllocatedNotSubmitted: attention?.missed_allocated_not_submitted ?? 0,
      withoutCoordinator: attention?.without_coordinator ?? 0 },
    schools,
  }
}
