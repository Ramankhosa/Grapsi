/**
 * What every DSR report counts, defined once.
 *
 * Before this module the department overview (`getDepartmentTotals`), the
 * management totals (`summarize` in managementService) and the intake ledger
 * (`getIncomingReport`) each counted "calls" and "submissions" their own way:
 * one counted an ad-hoc proposal as a call, one counted an assignment as
 * submitted only when its own status said COMPLETED while another also read the
 * linked proposal, and one counted every arrival as a call. A head reading two
 * screens could not tell which number was right.
 *
 * Six units and three state sets. Every definition that a report filters or
 * counts on in SQL is shipped twice — a TypeScript predicate and a SQL fragment
 * — and scripts/verify-dsr-reporting.ts evaluates both against the same rows in
 * a disposable database to prove they agree. The queue ladder and the
 * untouched rule already followed that discipline in `queueState.ts`; they are
 * re-exported here so there is one import for "what does this report count".
 */
import { Prisma } from '@/lib/prisma-generated'

import { applicationState, deadlineAttention, type ApplicationRow } from './managementRules'
import { closesOpportunity } from './responsibility'

export { QUEUE_STATES, isCallUntouched, queueStateFor, queueStateSql, untouchedSql } from './queueState'
export * from './reportGlossary'
import {
  ACTION_STATUSES, CLOSING_SOON_DAYS, FACULTY_CONTACT_KINDS, MISSED_DEADLINE_STATES, PENDENCY_AT_RISK_DAYS, PENDENCY_MATCH_TIERS,
  type ActionStatus, type DeadlineState, type PendencyState, type ReviewState, type SubmissionState,
} from './reportGlossary'
export type { QueueState } from './queueState'

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

/** Ids the management report invents for applications that have no call. */
export const isAdHocCallId = (id: string | null | undefined) => Boolean(id && id.startsWith('adhoc:'))

export type IntakeEventLike = { id: string; callId: string | null; duplicate?: boolean | null; enteredAt?: Date | string | null }

/**
 * Intake events, unique calls and duplicates as three separate figures.
 *
 * An arrival is a duplicate when it was flagged as one at intake, or when an
 * earlier arrival already brought the same call. Arrivals still waiting for
 * extraction have no call yet and count as events only.
 */
export function countIntakeEvents(rows: IntakeEventLike[]) {
  const ordered = [...rows].sort((a, b) =>
    (a.enteredAt ? new Date(a.enteredAt).getTime() : 0) - (b.enteredAt ? new Date(b.enteredAt).getTime() : 0) || a.id.localeCompare(b.id))
  const seen = new Set<string>()
  let duplicates = 0
  const duplicateIds = new Set<string>()
  for (const row of ordered) {
    const repeat = Boolean(row.callId && seen.has(row.callId))
    if (row.duplicate || repeat) { duplicates++; duplicateIds.add(row.id) }
    if (row.callId) seen.add(row.callId)
  }
  return { events: rows.length, uniqueCalls: seen.size, duplicates, awaitingExtraction: rows.filter(r => !r.callId).length, duplicateIds }
}

export function countUniqueCalls(rows: Array<{ id?: string; callId?: string | null }>) {
  return new Set(rows.map(r => r.callId ?? r.id).filter((id): id is string => Boolean(id) && !isAdHocCallId(id))).size
}

export function countSchoolResponsibilities(rows: Array<{ id?: string; callId?: string | null; schoolId: string | null }>) {
  return new Set(rows.filter(r => r.schoolId && (r.callId ?? r.id) && !isAdHocCallId(r.callId ?? r.id))
    .map(r => `${r.schoolId}:${r.callId ?? r.id}`)).size
}

type ApplicationFacts = Pick<ApplicationRow, 'assignment_id' | 'assignment_status' | 'proposal_status' | 'outcome' | 'submitted_at'>
export const isAllocation = (app: Pick<ApplicationRow, 'assignment_id'>) => Boolean(app.assignment_id)
export const isIndependentApplication = (app: Pick<ApplicationRow, 'assignment_id'>) => !app.assignment_id
export const isSubmission = (app: ApplicationFacts) => applicationState(app).submitted
export const countAllocations = (apps: ApplicationFacts[]) => apps.filter(isAllocation).length
export const countIndependentApplications = (apps: ApplicationFacts[]) => apps.filter(isIndependentApplication).length
export const countSubmissions = (apps: ApplicationFacts[]) => apps.filter(isSubmission).length

/** Proposal statuses at or beyond agency submission (see applicationState). */
export const SUBMITTED_PROPOSAL_STATUSES = ['SUBMITTED', 'UNDER_AGENCY_REVIEW', 'REVISION_REQUESTED', 'SANCTIONED'] as const

/**
 * `isSubmission` in SQL, over whatever columns hold the four facts. Callers pass
 * expressions, so the same rule works on the `dsr_applications` view and on a
 * raw call_assignments ⟕ grant_proposals join.
 */
export function applicationSubmittedSql(cols: { submittedAt: string; assignmentStatus: string; proposalStatus: string; outcome: string }): Prisma.Sql {
  const statuses = SUBMITTED_PROPOSAL_STATUSES.map(s => `'${s}'`).join(',')
  return Prisma.raw(`(${cols.submittedAt} IS NOT NULL OR COALESCE(${cols.assignmentStatus},'')='COMPLETED'
    OR COALESCE(${cols.proposalStatus},'') IN (${statuses}) OR COALESCE(${cols.outcome},'')='AWARDED')`)
}

/** The same rule on a `dsr_applications` alias. */
export const dsrApplicationSubmittedSql = (alias = 'a') => applicationSubmittedSql({
  submittedAt: `${alias}.submitted_at`, assignmentStatus: `${alias}.assignment_status`,
  proposalStatus: `${alias}.proposal_status`, outcome: `${alias}.outcome`,
})

/* -------------------------------------------------------------------------- */
/* Review state — per school responsibility                                   */
/* -------------------------------------------------------------------------- */

/** Triage outcomes that are a recorded judgement, not a look. */
export const REVIEW_DECISION_TRIAGE = ['RELEVANT', 'SHORTLISTED'] as const

export type ReviewFacts = {
  /** call_school_triage.status, or null when the school never triaged. */
  triageStatus: string | null | undefined
  /** When a person recorded that triage status. A stamp without a decision is not a review. */
  triageDecidedAt: Date | string | null | undefined
  /** dsr_opportunity_dispositions.reason for this school and call. */
  dispositionReason: string | null | undefined
  /** Formal allocations (assignments) for this call in this school. */
  formalAllocations: number
  /** Named call-level actions recorded for this school and call, in any status. */
  namedActions: number
}

/**
 * The four review states, as a ladder: allocation outranks everything, then a
 * recorded closure, then any recorded review decision. Opening a report or a
 * faculty match writes nothing, so it can never move a responsibility out of
 * NOT_REVIEWED. An allocation made after a "not relevant" decision still counts
 * as allocated — the work is real whatever the earlier judgement said.
 */
export function reviewState(facts: ReviewFacts): ReviewState {
  if (facts.formalAllocations > 0) return 'ALLOCATED'
  const decided = Boolean(facts.triageDecidedAt)
  if ((decided && facts.triageStatus === 'NOT_RELEVANT') || closesOpportunity(facts.dispositionReason)) return 'CLOSED_NO_ALLOCATION'
  if ((decided && REVIEW_DECISION_TRIAGE.includes(facts.triageStatus as never)) ||
    facts.dispositionReason === 'AWAITING_ACTION' || facts.namedActions > 0) return 'REVIEWED_ALLOCATION_PENDING'
  return 'NOT_REVIEWED'
}

/** `reviewState` in SQL. Each argument is an SQL expression yielding that fact. */
export function reviewStateSql(cols: { triageStatus: string; triageDecidedAt: string; dispositionReason: string; formalAllocations: string; namedActions: string }): Prisma.Sql {
  const closing = ['NO_SUITABLE_FACULTY', 'DECLINED', 'CAPACITY', 'OTHER'].map(s => `'${s}'`).join(',')
  return Prisma.raw(`(CASE
    WHEN ${cols.formalAllocations} > 0 THEN 'ALLOCATED'
    WHEN (${cols.triageDecidedAt} IS NOT NULL AND ${cols.triageStatus} = 'NOT_RELEVANT') OR COALESCE(${cols.dispositionReason},'') IN (${closing}) THEN 'CLOSED_NO_ALLOCATION'
    WHEN (${cols.triageDecidedAt} IS NOT NULL AND ${cols.triageStatus} IN ('RELEVANT','SHORTLISTED'))
      OR COALESCE(${cols.dispositionReason},'') = 'AWAITING_ACTION' OR ${cols.namedActions} > 0 THEN 'REVIEWED_ALLOCATION_PENDING'
    ELSE 'NOT_REVIEWED' END)`)
}

/* -------------------------------------------------------------------------- */
/* Submission state — per allocation (and per independent application)       */
/* -------------------------------------------------------------------------- */

/**
 * Verification is a separate fact: a reviewer checked evidence whose
 * fingerprint still matches (dsr_submission_verifications). Callers pass the
 * already-matched boolean because the fingerprint needs the document list.
 */
export function submissionState(app: ApplicationFacts, verified: boolean) {
  const state = applicationState(app)
  const value: SubmissionState = state.submitted ? (verified ? 'SUBMITTED_VERIFIED' : 'SUBMITTED_UNVERIFIED')
    : state.closed ? 'CLOSED_NO_SUBMISSION' : 'NOT_SUBMITTED'
  return { state: value, workingStage: state.submitted || state.closed ? null : state.stage }
}

/** "1 of 3 submitted": formal allocations only; independent work is reported beside it. */
export function submissionSummary(apps: Array<ApplicationFacts & { verified?: boolean }>) {
  const allocations = apps.filter(isAllocation)
  const independent = apps.filter(isIndependentApplication)
  const submitted = allocations.filter(isSubmission).length
  const independentSubmitted = independent.filter(isSubmission).length
  return {
    allocations: allocations.length, submitted, verified: allocations.filter(a => isSubmission(a) && a.verified).length,
    independent: independent.length, independentSubmitted,
    label: allocations.length ? `${submitted} of ${allocations.length} submitted` : independent.length ? `${independentSubmitted} of ${independent.length} independent submitted` : 'No applications',
  }
}

/* -------------------------------------------------------------------------- */
/* Deadline state — per school responsibility, India calendar day             */
/* -------------------------------------------------------------------------- */

export type DeadlineFacts = {
  deadline: Date | string | null | undefined
  formalAllocations: number
  /** Submissions of any kind (allocated or independent) for this call in this school. */
  submissions: number
  /** The responsibility was closed with a recorded reason (review state CLOSED_NO_ALLOCATION). */
  closedWithReason: boolean
}

/**
 * A deadline is live for the whole India calendar day it falls on. After it:
 * submitted work, or a recorded closure, is handled; otherwise the call was
 * missed — and whether anybody was ever allocated decides which kind of miss.
 */
export function deadlineState(facts: DeadlineFacts, asOf: Date): DeadlineState {
  const attention = deadlineAttention(facts.deadline, asOf)
  if (attention.daysToDeadline === null) return 'NO_DEADLINE'
  if (attention.daysToDeadline >= 0) return attention.daysToDeadline <= CLOSING_SOON_DAYS ? 'CLOSING_SOON' : 'OPEN'
  if (facts.submissions > 0 || (facts.closedWithReason && facts.formalAllocations === 0)) return 'PASSED_HANDLED'
  return facts.formalAllocations > 0 ? 'MISSED_ALLOCATED_NOT_SUBMITTED' : 'MISSED_NEVER_ALLOCATED'
}

/**
 * Whole India calendar days from `asOf` to the deadline expression, negative
 * once it has passed. Deadlines are stored as UTC timestamps without zone.
 */
export function indiaDaysToDeadlineSql(deadline: string, asOf: Date): Prisma.Sql {
  // asOf is bound as an ISO string: a bound Date arrives zone-less and would be
  // read in the session time zone, which is not UTC on every server.
  return Prisma.sql`((${Prisma.raw(deadline)} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
    - (${asOf.toISOString()}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date)`
}

/** `deadlineState` in SQL. */
export function deadlineStateSql(cols: { deadline: string; formalAllocations: string; submissions: string; closedWithReason: string }, asOf: Date): Prisma.Sql {
  const days = indiaDaysToDeadlineSql(cols.deadline, asOf)
  return Prisma.sql`(CASE
    WHEN ${Prisma.raw(cols.deadline)} IS NULL THEN 'NO_DEADLINE'
    WHEN ${days} > ${CLOSING_SOON_DAYS} THEN 'OPEN'
    WHEN ${days} >= 0 THEN 'CLOSING_SOON'
    WHEN ${Prisma.raw(cols.submissions)} > 0 OR (${Prisma.raw(cols.closedWithReason)} AND ${Prisma.raw(cols.formalAllocations)} = 0) THEN 'PASSED_HANDLED'
    WHEN ${Prisma.raw(cols.formalAllocations)} > 0 THEN 'MISSED_ALLOCATED_NOT_SUBMITTED'
    ELSE 'MISSED_NEVER_ALLOCATED' END)`
}

/* -------------------------------------------------------------------------- */
/* Action status — per school responsibility (Incoming Calls)                 */
/* -------------------------------------------------------------------------- */

export type ActionFacts = {
  /** call_school_triage.action_completed_at: the coordinator's manual mark. */
  actionCompletedAt: Date | string | null | undefined
  /** call_school_triage.decided_at: a person recorded a review decision. */
  triageDecidedAt: Date | string | null | undefined
  /** Shortlisted or approached candidates from this school. */
  shortlisted: number
  /** Assignments to faculty of this school, in any status. */
  allocations: number
  /** Human follow-ups (not TRIAGE history rows) on this call in this school. */
  followUps: number
  /** Named call-level actions for this school and call, in any status. */
  namedActions: number
}

/**
 * Only the manual mark completes a call. Anything a person recorded makes it
 * "in progress"; an automatic match or a sweep stamp is not a record, which is
 * why the test is `decided_at`, never whether a triage row exists.
 */
export function actionStatus(f: ActionFacts): ActionStatus {
  if (f.actionCompletedAt) return 'COMPLETED'
  if (f.triageDecidedAt || f.shortlisted > 0 || f.allocations > 0 || f.followUps > 0 || f.namedActions > 0) return 'IN_PROGRESS'
  return 'NOT_STARTED'
}

/** `actionStatus` in SQL. Each argument is an SQL expression yielding that fact. */
export function actionStatusSql(cols: { actionCompletedAt: string; triageDecidedAt: string; shortlisted: string; allocations: string; followUps: string; namedActions: string }): Prisma.Sql {
  return Prisma.raw(`(CASE
    WHEN ${cols.actionCompletedAt} IS NOT NULL THEN 'COMPLETED'
    WHEN ${cols.triageDecidedAt} IS NOT NULL OR ${cols.shortlisted} > 0 OR ${cols.allocations} > 0 OR ${cols.followUps} > 0 OR ${cols.namedActions} > 0 THEN 'IN_PROGRESS'
    ELSE 'NOT_STARTED' END)`)
}

/** A call row shows its least-advanced school: one school not started means the call is not started. */
export function rollupActionStatus(states: ActionStatus[]): ActionStatus {
  if (!states.length) return 'NOT_STARTED'
  return ACTION_STATUSES.find(state => states.includes(state)) || 'NOT_STARTED'
}

/* -------------------------------------------------------------------------- */
/* Pendency — directly matched, never allocated                               */
/* -------------------------------------------------------------------------- */

export type PendencyFacts = {
  /** India calendar days to the deadline; null when none is recorded. */
  daysToDeadline: number | null
  /** Strong/moderate automatic matches in the school first seen by the deadline day. */
  qualifyingMatches: number
  /** Assignments in the school that were taken up (not CANCELLED/DECLINED/LAPSED). */
  takenUpAllocations: number
  /** Applications from the school made without an allocation. */
  independentApplications: number
  /** The school recorded "not relevant". */
  dismissed: boolean
  /** The coordinator marked the action completed. */
  actionCompleted: boolean
}

/** Null when the (call, school) pair is not pendency at all. */
export function pendencyState(f: PendencyFacts): PendencyState | null {
  if (f.qualifyingMatches === 0 || f.takenUpAllocations > 0 || f.independentApplications > 0 || f.dismissed) return null
  if (f.actionCompleted) return 'COMPLETED_NO_ALLOCATION'
  if (f.daysToDeadline === null) return 'PENDING'
  if (f.daysToDeadline < 0) return 'MISSED'
  return f.daysToDeadline <= PENDENCY_AT_RISK_DAYS ? 'AT_RISK' : 'PENDING'
}

/** `pendencyState` in SQL; yields NULL when the pair is not pendency. `daysToDeadline` may be NULL. */
export function pendencyStateSql(cols: { daysToDeadline: string; qualifyingMatches: string; takenUpAllocations: string; independentApplications: string; dismissed: string; actionCompleted: string }): Prisma.Sql {
  return Prisma.raw(`(CASE
    WHEN ${cols.qualifyingMatches} = 0 OR ${cols.takenUpAllocations} > 0 OR ${cols.independentApplications} > 0 OR ${cols.dismissed} THEN NULL
    WHEN ${cols.actionCompleted} THEN 'COMPLETED_NO_ALLOCATION'
    WHEN ${cols.daysToDeadline} IS NULL THEN 'PENDING'
    WHEN ${cols.daysToDeadline} < 0 THEN 'MISSED'
    WHEN ${cols.daysToDeadline} <= ${PENDENCY_AT_RISK_DAYS} THEN 'AT_RISK'
    ELSE 'PENDING' END)`)
}

/**
 * Match rows that count as "direct" for pendency: automatic (not reconstructed
 * from past work, not a manual-allocation snapshot), strong or moderate, and
 * first seen no later than the deadline's India day. `is_current` is not
 * required, so a call missed months ago still shows the match it had then.
 */
export function qualifyingMatchSql(matchAlias: string, deadlineExpr: string): Prisma.Sql {
  const tiers = PENDENCY_MATCH_TIERS.map(t => `'${t}'`).join(',')
  return Prisma.raw(`(${matchAlias}.inferred = false AND COALESCE(${matchAlias}.source_version,'') <> 'manual-allocation-v1'
    AND ${matchAlias}.match_tier IN (${tiers})
    AND (${deadlineExpr} IS NULL OR (${matchAlias}.first_seen_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date <= (${deadlineExpr} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date))`)
}
export const isQualifyingMatch = (m: { inferred: boolean; source_version: string | null; match_tier: string | null; first_seen_at: Date | string }, deadline: Date | string | null) =>
  !m.inferred && m.source_version !== 'manual-allocation-v1' && PENDENCY_MATCH_TIERS.includes(m.match_tier as never)
  && (!deadline || indiaDate(m.first_seen_at) <= indiaDate(deadline))

/* -------------------------------------------------------------------------- */
/* Follow-up effort — India weeks                                             */
/* -------------------------------------------------------------------------- */

const IST_OFFSET_MS = 330 * 60000
/** YYYY-MM-DD of the India calendar day a UTC instant falls on. */
export function indiaDate(at: Date | string): string {
  return new Date(new Date(at).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}
/** Monday (YYYY-MM-DD) of the India week containing this instant. */
export function indiaWeekStart(at: Date | string): string {
  const day = new Date(`${indiaDate(at)}T00:00:00Z`)
  const offset = (day.getUTCDay() + 6) % 7
  return new Date(day.getTime() - offset * 86400000).toISOString().slice(0, 10)
}
/** `indiaWeekStart` in SQL over a UTC timestamp column; yields a date. */
export const indiaWeekStartSql = (column: string) => Prisma.raw(`date_trunc('week', (${column} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::date`)

/** A follow-up the effort report counts: anything a person logged, not review history. */
export const countableFollowUpSql = (alias = 'f') => Prisma.raw(`(${alias}.kind <> 'TRIAGE')`)
export const isCountableFollowUp = (f: { kind: string }) => f.kind !== 'TRIAGE'
export const facultyContactSql = (alias = 'f') =>
  Prisma.raw(`(${alias}.kind IN (${FACULTY_CONTACT_KINDS.map(k => `'${k}'`).join(',')}) AND ${alias}.contact_target = 'FACULTY')`)
export const isFacultyContact = (f: { kind: string; contact_target: string }) =>
  FACULTY_CONTACT_KINDS.includes(f.kind as never) && f.contact_target === 'FACULTY'

/* -------------------------------------------------------------------------- */
/* Period rule                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Period totals cover responsibilities that ENTERED in the selected period,
 * with their progress as of today. "Needs attention now" ignores the period,
 * so old backlog and missed calls can never be filtered out of view.
 */
export const NEEDS_ATTENTION_DEADLINE_STATES: DeadlineState[] = ['CLOSING_SOON', ...MISSED_DEADLINE_STATES]

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Under one filter set, the headline figure, the drill-down rows and the
 * export rows must be the same number. Returns the mismatch, or null.
 */
export function reconcile(label: string, counts: { headline: number; drillDown: number; exported?: number }) {
  const values = [counts.headline, counts.drillDown, ...(counts.exported === undefined ? [] : [counts.exported])]
  return values.every(value => value === values[0]) ? null
    : `${label}: headline ${counts.headline}, drill-down ${counts.drillDown}${counts.exported === undefined ? '' : `, export ${counts.exported}`}`
}
