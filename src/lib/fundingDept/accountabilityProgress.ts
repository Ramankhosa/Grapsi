/**
 * Where one allocation stands, and whether anyone is still working it.
 *
 * The department already records six assignment statuses, an outcome, an
 * internal deadline and a contact log, but no single answer to the question a
 * head actually asks: "what is happening with this, and when did anyone last
 * touch it?" Status alone cannot say it — ACCEPTED tells you the faculty member
 * said yes in March and nothing since.
 *
 * Pure by design: the callers fetch the rows, this decides what they mean, and
 * the unit tests pin the ladder without a database.
 */

import type { FollowUpStage } from './shared'

/** Days of silence on live work before it counts as gone quiet. */
export const SILENT_DAYS = 14
/** Days a relevant call may sit in a school untouched before it is a pendency. */
export const UNTOUCHED_DAYS = 7
/** Days an unanswered request may sit before the faculty member is chased. */
export const UNANSWERED_DAYS = 3

export const PROGRESS_CODES = [
  'AWARDED',
  'REJECTED',
  'SUBMITTED',
  'DECLINED',
  'CANCELLED',
  'OVERDUE',
  'AWAITING_REPLY',
  'DRAFTING',
  'IN_HAND',
] as const
export type ProgressCode = (typeof PROGRESS_CODES)[number]

export const PROGRESS_LABELS: Record<ProgressCode, string> = {
  AWARDED: 'Awarded',
  REJECTED: 'Not funded',
  SUBMITTED: 'Submitted',
  DECLINED: 'Declined',
  CANCELLED: 'Withdrawn by department',
  OVERDUE: 'Past the internal deadline',
  AWAITING_REPLY: 'Awaiting reply',
  DRAFTING: 'Writing the proposal',
  IN_HAND: 'Accepted, in hand',
}

/** Codes where the work is still someone's to do. */
export const LIVE_PROGRESS_CODES: readonly ProgressCode[] = [
  'OVERDUE',
  'AWAITING_REPLY',
  'DRAFTING',
  'IN_HAND',
]

export interface ProgressAssignment {
  status: string
  outcome?: string | null
  deadline_at?: Date | string | null
  responded_at?: Date | string | null
  submitted_at?: Date | string | null
  created_at?: Date | string | null
}

export interface ProgressFollowUp {
  happened_at: Date | string
  stage?: string | null
  kind?: string | null
}

export interface AssignmentProgress {
  code: ProgressCode
  label: string
  isLive: boolean
  /** Latest stage the department recorded, if any. Informational only. */
  stage: FollowUpStage | null
  /** The most recent thing that happened on this allocation, from any source. */
  lastActionAt: Date | null
  /** Whole days since `lastActionAt`. Null when nothing has happened at all. */
  daysSilent: number | null
  /** Live work nobody has touched for SILENT_DAYS. Composes with the code. */
  goneQuiet: boolean
  /** Past its internal deadline and not chased since that date passed. */
  overdueUnchased: boolean
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000)
}

/**
 * Read one allocation.
 *
 * The ladder is ordered by finality: a decision outranks a submission, which
 * outranks anything about the work in progress. Only after every settled state
 * is ruled out do we ask whether it is late, unanswered, or being written —
 * otherwise an awarded project whose internal deadline passed months ago would
 * report as overdue forever.
 *
 * `goneQuiet` and `overdueUnchased` are deliberately separate booleans rather
 * than codes: "accepted and silent for a month" is two facts, and collapsing
 * them loses the one the officer needs to act on.
 */
export function deriveAssignmentProgress(
  assignment: ProgressAssignment,
  lastFollowUp: ProgressFollowUp | null | undefined,
  hasDraftWorkspace: boolean,
  now: Date = new Date()
): AssignmentProgress {
  const status = String(assignment.status || '').toUpperCase()
  const outcome = String(assignment.outcome || 'PENDING').toUpperCase()

  const followUpAt = lastFollowUp ? toDate(lastFollowUp.happened_at) : null
  const respondedAt = toDate(assignment.responded_at)
  const submittedAt = toDate(assignment.submitted_at)
  const createdAt = toDate(assignment.created_at)
  const deadlineAt = toDate(assignment.deadline_at)

  const candidates = [followUpAt, respondedAt, submittedAt, createdAt].filter(
    (value): value is Date => value !== null
  )
  const lastActionAt =
    candidates.length > 0
      ? candidates.reduce((latest, value) => (value > latest ? value : latest))
      : null
  const daysSilent = lastActionAt ? Math.max(0, daysBetween(lastActionAt, now)) : null

  const stage = (lastFollowUp?.stage as FollowUpStage | undefined) ?? null

  let code: ProgressCode
  if (outcome === 'AWARDED') code = 'AWARDED'
  else if (outcome === 'REJECTED') code = 'REJECTED'
  else if (status === 'COMPLETED') code = 'SUBMITTED'
  else if (status === 'DECLINED') code = 'DECLINED'
  else if (status === 'CANCELLED') code = 'CANCELLED'
  else if (deadlineAt && deadlineAt < now) code = 'OVERDUE'
  else if (status === 'ASSIGNED' && !respondedAt) code = 'AWAITING_REPLY'
  else if (hasDraftWorkspace) code = 'DRAFTING'
  else code = 'IN_HAND'

  const isLive = LIVE_PROGRESS_CODES.includes(code)

  return {
    code,
    label: PROGRESS_LABELS[code],
    isLive,
    stage,
    lastActionAt,
    daysSilent,
    goneQuiet: isLive && daysSilent !== null && daysSilent >= SILENT_DAYS,
    // A deadline that passed with no contact since is the sharpest version of
    // "nobody is on this": the department knew the date and let it go by.
    overdueUnchased:
      code === 'OVERDUE' && Boolean(deadlineAt) && (!followUpAt || followUpAt < deadlineAt!),
  }
}

/**
 * Buckets an allocation contributes to, so callers can tally without repeating
 * the ladder. One allocation counts once in exactly one bucket, plus the two
 * orthogonal attention flags.
 */
export interface ProgressBuckets {
  awaitingReply: number
  inHand: number
  drafting: number
  overdue: number
  submitted: number
  awarded: number
  rejected: number
  declined: number
  cancelled: number
  goneQuiet: number
  overdueUnchased: number
}

export function emptyBuckets(): ProgressBuckets {
  return {
    awaitingReply: 0,
    inHand: 0,
    drafting: 0,
    overdue: 0,
    submitted: 0,
    awarded: 0,
    rejected: 0,
    declined: 0,
    cancelled: 0,
    goneQuiet: 0,
    overdueUnchased: 0,
  }
}

const BUCKET_BY_CODE: Record<ProgressCode, keyof ProgressBuckets> = {
  AWAITING_REPLY: 'awaitingReply',
  IN_HAND: 'inHand',
  DRAFTING: 'drafting',
  OVERDUE: 'overdue',
  SUBMITTED: 'submitted',
  AWARDED: 'awarded',
  REJECTED: 'rejected',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
}

export function addToBuckets(buckets: ProgressBuckets, progress: AssignmentProgress): void {
  buckets[BUCKET_BY_CODE[progress.code]] += 1
  if (progress.goneQuiet) buckets.goneQuiet += 1
  if (progress.overdueUnchased) buckets.overdueUnchased += 1
}
