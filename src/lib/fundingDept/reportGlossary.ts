/**
 * The words every DSR report uses, and what they mean. Pure data with no
 * server imports, so the UI tooltips, the export Definitions sheet and the
 * counting rules in reportDefinitions.ts all read the same text.
 */

export const REPORT_UNITS = {
  intakeEvent: {
    label: 'Intake events',
    counts: 'One arrival: an import job, an intake job, or a call created directly.',
    source: 'funding_import_jobs, funding_intake_jobs, funding_calls',
    duplicates: 'Counted, and flagged as duplicates when the call had already arrived.',
  },
  uniqueCall: {
    label: 'Unique calls',
    counts: 'One funding call, however many times it arrived and however many schools it concerns.',
    source: 'funding_calls',
    duplicates: 'Never counted twice. An application with no funding call is not a call.',
  },
  schoolResponsibility: {
    label: 'School responsibilities',
    counts: 'One call mapped to one school.',
    source: 'dsr_call_school_mappings (routing evidence until mapped)',
    duplicates: 'One per call and school pair.',
  },
  allocation: {
    label: 'Allocations',
    counts: 'One formal faculty assignment made by the department.',
    source: 'dsr_applications with an assignment',
    duplicates: 'One per assignment.',
  },
  independentApplication: {
    label: 'Independent applications',
    counts: 'A faculty application made without a department allocation.',
    source: 'dsr_applications without an assignment',
    duplicates: 'One per proposal.',
  },
  submission: {
    label: 'Submissions',
    counts: 'An allocation or independent application recorded as submitted to the agency.',
    source: 'dsr_applications: a submission date, a completed assignment, or a proposal at or past agency submission',
    duplicates: 'A draft or an uploaded document alone does not count.',
  },
} as const
export type ReportUnit = keyof typeof REPORT_UNITS

/**
 * Report "quality" values that mean the call is this school's business: a
 * matched researcher or the school's own RELEVANT decision ('confirmed'), or a
 * stored call-to-school mapping ('mapped').
 */
export const isRelevantQuality = (quality: string | null | undefined) => quality === 'confirmed' || quality === 'mapped'

export const REVIEW_STATES = ['NOT_REVIEWED', 'REVIEWED_ALLOCATION_PENDING', 'ALLOCATED', 'CLOSED_NO_ALLOCATION'] as const
export type ReviewState = (typeof REVIEW_STATES)[number]
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  NOT_REVIEWED: 'Not reviewed',
  REVIEWED_ALLOCATION_PENDING: 'Reviewed, allocation pending',
  ALLOCATED: 'Allocated',
  CLOSED_NO_ALLOCATION: 'Closed without allocation',
}

export const SUBMISSION_STATES = ['NOT_SUBMITTED', 'SUBMITTED_UNVERIFIED', 'SUBMITTED_VERIFIED', 'CLOSED_NO_SUBMISSION'] as const
export type SubmissionState = (typeof SUBMISSION_STATES)[number]
export const SUBMISSION_STATE_LABELS: Record<SubmissionState, string> = {
  NOT_SUBMITTED: 'Not submitted',
  SUBMITTED_UNVERIFIED: 'Submitted, unverified',
  SUBMITTED_VERIFIED: 'Submitted, verified',
  CLOSED_NO_SUBMISSION: 'Closed without submission',
}

export const CLOSING_SOON_DAYS = 7
export const DEADLINE_STATES = ['NO_DEADLINE', 'OPEN', 'CLOSING_SOON', 'PASSED_HANDLED', 'MISSED_NEVER_ALLOCATED', 'MISSED_ALLOCATED_NOT_SUBMITTED'] as const
export type DeadlineState = (typeof DEADLINE_STATES)[number]
export const DEADLINE_STATE_LABELS: Record<DeadlineState, string> = {
  NO_DEADLINE: 'No deadline recorded',
  OPEN: 'Open',
  CLOSING_SOON: `Closing soon (${CLOSING_SOON_DAYS} days or less)`,
  PASSED_HANDLED: 'Deadline passed, handled',
  MISSED_NEVER_ALLOCATED: 'Missed, never allocated',
  MISSED_ALLOCATED_NOT_SUBMITTED: 'Missed, allocated but not submitted',
}
export const MISSED_DEADLINE_STATES: DeadlineState[] = ['MISSED_NEVER_ALLOCATED', 'MISSED_ALLOCATED_NOT_SUBMITTED']

/* Action status — the coordinator's own mark, per school and call (DSR Reports hub) */

export const ACTION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Action completed',
}

/* Pendency — a school's directly matched call that nobody was allocated to */

export const PENDENCY_AT_RISK_DAYS = 14
export const PENDENCY_MATCH_TIERS = ['strong', 'moderate'] as const
export const PENDENCY_STATES = ['MISSED', 'AT_RISK', 'PENDING', 'COMPLETED_NO_ALLOCATION'] as const
export type PendencyState = (typeof PENDENCY_STATES)[number]
export const PENDENCY_STATE_LABELS: Record<PendencyState, string> = {
  MISSED: 'Missed',
  AT_RISK: `At risk (${PENDENCY_AT_RISK_DAYS} days or less)`,
  PENDING: 'Pending',
  COMPLETED_NO_ALLOCATION: 'Marked completed, no allocation',
}
/** The three states that count as pendency; a coordinator-closed call is shown, not counted. */
export const COUNTED_PENDENCY_STATES: PendencyState[] = ['MISSED', 'AT_RISK', 'PENDING']

/* Follow-up effort — weekly, India time */

export const FACULTY_CONTACT_KINDS = ['CALL', 'EMAIL', 'MEETING'] as const
export const FOLLOW_UP_STAGE_ORDER = ['CONTACTED', 'PREPARING', 'APPROVALS', 'SUBMITTED'] as const

/* Glossary — read by UI tooltips and every export's Definitions sheet */

export const REPORT_DEFINITIONS: Array<{ term: string; definition: string }> = [
  ...Object.values(REPORT_UNITS).map(unit => ({ term: unit.label, definition: `${unit.counts} ${unit.duplicates}` })),
  { term: 'Review', definition: 'A recorded decision for one school on one call: relevant, shortlisted, not relevant with a reason, a closure reason, or a named next action. Opening a report or a faculty match is not a review.' },
  ...REVIEW_STATES.map(state => ({ term: `Review: ${REVIEW_STATE_LABELS[state]}`, definition: {
    NOT_REVIEWED: 'No recorded decision yet.',
    REVIEWED_ALLOCATION_PENDING: 'Judged relevant (or given a next action) but nobody formally allocated yet.',
    ALLOCATED: 'At least one faculty member formally allocated.',
    CLOSED_NO_ALLOCATION: 'Closed with a recorded reason and no allocation.',
  }[state] })),
  ...SUBMISSION_STATES.map(state => ({ term: `Submission: ${SUBMISSION_STATE_LABELS[state]}`, definition: {
    NOT_SUBMITTED: 'Still being worked; the working stage is shown beside it.',
    SUBMITTED_UNVERIFIED: 'Recorded as submitted; no reviewer has checked current evidence.',
    SUBMITTED_VERIFIED: 'Recorded as submitted and a reviewer checked the current evidence.',
    CLOSED_NO_SUBMISSION: 'Declined, cancelled, lapsed or withdrawn before submission.',
  }[state] })),
  ...DEADLINE_STATES.map(state => ({ term: `Deadline: ${DEADLINE_STATE_LABELS[state]}`, definition: {
    NO_DEADLINE: 'The call has no deadline on record.',
    OPEN: `More than ${CLOSING_SOON_DAYS} India calendar days remain.`,
    CLOSING_SOON: `${CLOSING_SOON_DAYS} or fewer India calendar days remain, including the deadline day itself.`,
    PASSED_HANDLED: 'The deadline passed after a submission, or after the school closed the call with a reason.',
    MISSED_NEVER_ALLOCATED: 'The deadline passed with no allocation, no submission and no recorded closure.',
    MISSED_ALLOCATED_NOT_SUBMITTED: 'The deadline passed with an allocation but no submission.',
  }[state] })),
  ...ACTION_STATUSES.map(state => ({ term: `Action: ${ACTION_STATUS_LABELS[state]}`, definition: {
    NOT_STARTED: 'Nobody has recorded anything on this call for this school: no review decision, shortlist, allocation, follow-up or named action.',
    IN_PROGRESS: 'Something has been recorded (a review, shortlist, allocation, follow-up or action), but the coordinator has not marked the work completed.',
    COMPLETED: 'The coordinator marked this school’s action on the call as completed. Only a person sets this; allocating or shortlisting does not.',
  }[state] })),
  { term: 'Directly matched call', definition: `A call with at least one ${PENDENCY_MATCH_TIERS.join(' or ')} automatic faculty match in the school, first seen before the call's deadline. Weak, reconstructed and manual-allocation matches do not count.` },
  ...PENDENCY_STATES.map(state => ({ term: `Pendency: ${PENDENCY_STATE_LABELS[state]}`, definition: {
    MISSED: 'A directly matched call whose deadline passed with nobody from the school allocated, no independent application, and no "not relevant" decision.',
    AT_RISK: `A directly matched call, still open, closing within ${PENDENCY_AT_RISK_DAYS} India calendar days, with nobody allocated.`,
    PENDING: `A directly matched call, still open with more than ${PENDENCY_AT_RISK_DAYS} days left, with nobody allocated.`,
    COMPLETED_NO_ALLOCATION: 'The coordinator marked the action completed without allocating anyone. Shown with their note for the head to judge; not counted as pendency.',
  }[state] })),
  { term: 'Pendency vs. escalation ladder', definition: 'The escalation reminders use a different rule: any relevant call nobody has reviewed or contacted about. This report only counts calls with a direct faculty match that nobody was allocated to.' },
  { term: 'Follow-up', definition: 'An entry in the DSR contact log (call, email, meeting, note or scheduled reminder). Automatic review-history entries are not counted.' },
  { term: 'Faculty contact', definition: 'A follow-up logged as a call, email or meeting with the faculty member.' },
  { term: 'Follow-up week', definition: 'Monday to Sunday, India (Asia/Kolkata) time.' },
  { term: 'Silent assignment', definition: 'An allocation still open (assigned, accepted or in progress) at the end of the week with no follow-up logged that week.' },
  { term: 'Reporting period', definition: 'Period totals cover calls that entered in the selected period, with their progress as of the report date. "Needs attention now" ignores the period.' },
  { term: 'Deadline day', definition: 'A deadline stays open until the end of its India (Asia/Kolkata) calendar day.' },
]

