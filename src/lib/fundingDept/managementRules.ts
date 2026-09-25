/** Pure reporting rules shared by the reports and their tests. */
import { createHash } from 'node:crypto'

export type ReportMode = 'pending' | 'cohort' | 'activity' | 'portfolio'
export type AttentionFilter = 'upcoming-21' | 'missed-unallocated-no-submission' | 'missed-never-allocated' | 'missed-allocated-not-submitted'
export type WaitingWith = 'FACULTY' | 'DSR' | 'REVIEWER' | 'APPROVER' | 'AGENCY'
export type OpportunityActionInput = {
  applications: number
  candidatesReviewed: number
  externalContacts: number
  recordedActions: number
  dispositionRecorded: boolean
}
export type ApplicationRow = {
  id: string; tenant_id: string; school_id: string | null; call_id: string | null
  assignment_id: string | null; proposal_id: string | null; faculty_id: string
  allocated_by: string; created_at: Date; assignment_status: string | null; outcome: string | null
  proposal_status: string | null; submitted_at: Date | null; submission_reference: string | null
  submission_url: string | null; submission_notes: string | null; submission_recorder: string | null
  internal_deadline: Date | null; review_deadline: Date | null; agency_deadline: Date | null
  title: string; agency: string | null; requested_amount: number | null; sanctioned_amount: number | null
  currency: string; version_no: number; updated_at: Date
}
export function applicationState(row: Pick<ApplicationRow, 'assignment_status' | 'proposal_status' | 'outcome' | 'submitted_at'>) {
  const p = row.proposal_status
  // Rejected can be an internal review decision; require actual submission evidence.
  const submitted = Boolean(row.submitted_at) || row.assignment_status === 'COMPLETED' ||
    ['SUBMITTED','UNDER_AGENCY_REVIEW','REVISION_REQUESTED','SANCTIONED'].includes(p || '') || row.outcome === 'AWARDED'
  const closed = ['DECLINED','CANCELLED','LAPSED'].includes(row.assignment_status || '') ||
    ['WITHDRAWN','CLOSED','REJECTED','SANCTIONED'].includes(p || '') || ['AWARDED','REJECTED','WITHDRAWN'].includes(row.outcome || '')
  const stage = p === 'SANCTIONED' || row.outcome === 'AWARDED' ? 'SANCTIONED'
    : p === 'REJECTED' || row.outcome === 'REJECTED' ? 'REJECTED'
    : p === 'WITHDRAWN' || row.outcome === 'WITHDRAWN' ? 'CANCELLED'
    : p === 'CLOSED' ? 'CLOSED'
    : ['UNDER_AGENCY_REVIEW','REVISION_REQUESTED'].includes(p || '') ? p!
    : submitted ? 'SUBMITTED'
    : row.assignment_status === 'DECLINED' ? 'DECLINED'
    : row.assignment_status === 'CANCELLED' ? 'CANCELLED'
    : row.assignment_status === 'LAPSED' ? 'LAPSED_NOT_APPLIED'
    : p === 'CLEARED' ? 'CLEARED_AND_READY'
    : p === 'IN_REVIEW' ? 'INTERNAL_REVIEW'
    : p === 'DRAFT' || row.assignment_status === 'IN_PROGRESS' ? 'PROPOSAL_DRAFTING'
    : row.assignment_status === 'ASSIGNED' ? 'AWAITING_FACULTY_RESPONSE' : 'ACCEPTED_IN_HAND'
  return { submitted, closed, stage, workState: submitted ? 'SUBMITTED' : closed ? 'CLOSED_WITHOUT_SUBMISSION' : 'PENDING',
    outstanding: !closed }
}
export function inPeriod(value: Date | string | null | undefined, start: Date, end: Date) {
  if (!value) return false
  const time = new Date(value).getTime()
  return time >= start.getTime() && time < end.getTime()
}
export function overdueAt(value: Date | string | null | undefined, at: Date) {
  return Boolean(value && new Date(value).getTime() < at.getTime())
}
/** Calendar-day deadline classification in the department's reporting timezone.
 * Funding-call dates are date-like values, so a call due today must not become
 * "missed" halfway through the day just because its stored timestamp is 00:00. */
export function indiaCalendarDay(value: Date | string) {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  const shifted = new Date(parsed.getTime() + 330 * 60_000)
  return Math.floor(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) / day)
}
export function deadlineAttention(value: Date | string | null | undefined, at: Date) {
  if (!value) return { daysToDeadline: null, status: 'UNKNOWN' as const, upcoming21: false, missed: false }
  const deadlineDay = indiaCalendarDay(value)
  const reportDay = indiaCalendarDay(at)
  if (deadlineDay === null || reportDay === null) return { daysToDeadline: null, status: 'UNKNOWN' as const, upcoming21: false, missed: false }
  const daysToDeadline = deadlineDay - reportDay
  return {
    daysToDeadline,
    status: daysToDeadline < 0 ? 'MISSED' as const : daysToDeadline <= 21 ? 'UPCOMING_21' as const : 'FUTURE' as const,
    upcoming21: daysToDeadline >= 0 && daysToDeadline <= 21,
    missed: daysToDeadline < 0,
  }
}
export function opportunityDeadlineAttention(input:{deadline:Date|string|null|undefined;asOf:Date;quality:string;formalAllocations:number;submissions:number;outstandingApplications:number}) {
  const deadline=deadlineAttention(input.deadline,input.asOf)
  const confirmed=input.quality==='confirmed'
  return {...deadline,
    upcoming21:confirmed && deadline.upcoming21 && (input.formalAllocations===0 || input.outstandingApplications>0),
    missedUnallocatedNoSubmission:confirmed && deadline.missed && input.formalAllocations===0 && input.submissions===0,
  }
}
export function evidenceFingerprint(row: ApplicationRow, documents: string[]) {
  return createHash('sha256').update(JSON.stringify([
    row.submitted_at, row.submission_reference?.trim() || null, row.submission_url?.trim() || null,
    [...documents].sort(),
  ])).digest('hex')
}
export function hasSubmissionEvidence(row: ApplicationRow, documents: string[]) {
  return Boolean(row.submission_reference?.trim() || row.submission_url?.trim() || documents.length)
}
export function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, percent: denominator ? Math.round(numerator / denominator * 1000) / 10 : null }
}
export function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b)
  return sorted.length ? Math.round((sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)]) / 2 * 10) / 10 : null
}
/** Matching is automated evidence, not human action. A call becomes "acted on"
 * only when a person records engagement, an application/allocation, a named
 * action, or a considered no-uptake decision. */
export function opportunityActionState(input: OpportunityActionInput) {
  const signals = [
    input.applications > 0 ? 'APPLICATION_OR_ALLOCATION' : null,
    input.candidatesReviewed > 0 ? 'FACULTY_REVIEWED' : null,
    input.externalContacts > 0 ? 'EXTERNAL_FACULTY_CONTACT' : null,
    input.recordedActions > 0 ? 'NAMED_ACTION' : null,
    input.dispositionRecorded ? 'NO_UPTAKE_DECISION' : null,
  ].filter(Boolean) as string[]
  return { touched: signals.length > 0, signals }
}
export const day = 86400000
export function csvCell(value: unknown) {
  let text = String(value ?? '')
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
