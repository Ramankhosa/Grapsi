/**
 * The one place an assignment becomes "submitted".
 *
 * Two surfaces record a submission: the assignee (or a manager) closing the
 * record out on `/assignments`, and a department officer logging a follow-up
 * with stage SUBMITTED after the faculty member told them over the phone. Both
 * must land the same row — same proof rule, same timestamps — or the hierarchy
 * ends up with two different definitions of a submitted application and the
 * counts stop agreeing.
 *
 * Pure on purpose: it takes the current record and the proposed proof and
 * returns the update, so it is unit-testable and both callers can validate
 * before opening a transaction.
 */

export interface SubmissionProofInput {
  /** The assignment as it stands, for the "already has proof" fallback. */
  record: {
    submission_reference?: string | null
    submission_url?: string | null
    submission_notes?: string | null
    submitted_at?: Date | string | null
  }
  reference?: string | null
  url?: string | null
  notes?: string | null
  submittedAt?: Date | null
  /** Injectable for tests. */
  now?: Date
}

export interface SubmissionUpdate {
  status: 'COMPLETED'
  completed_at: Date
  submitted_at: Date
  submission_reference?: string | null
  submission_url?: string | null
  submission_notes?: string | null
}

export type SubmissionResult =
  | { ok: true; data: SubmissionUpdate }
  | { ok: false; error: string }

export const SUBMISSION_PROOF_REQUIRED =
  'Add submission info (reference number, link or notes) before marking this complete.'

function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = (value || '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Build the update that marks an assignment submitted, or explain why it
 * cannot be. Proof is required — a completion with nothing attached is a claim,
 * not a record, and the department has to be able to answer "submitted where,
 * under what number" a year later.
 */
export function buildSubmissionUpdate(input: SubmissionProofInput): SubmissionResult {
  const now = input.now ?? new Date()

  const reference = clean(input.reference)
  const url = clean(input.url)
  const notes = clean(input.notes)

  // Values already on the record count as proof: re-completing a re-opened
  // assignment must not force the officer to retype the reference number.
  const effectiveReference = reference !== undefined ? reference : input.record.submission_reference
  const effectiveUrl = url !== undefined ? url : input.record.submission_url
  const effectiveNotes = notes !== undefined ? notes : input.record.submission_notes

  if (!effectiveReference && !effectiveUrl && !effectiveNotes) {
    return { ok: false, error: SUBMISSION_PROOF_REQUIRED }
  }

  const data: SubmissionUpdate = {
    status: 'COMPLETED',
    completed_at: now,
    // The date the application actually went in, which is not necessarily
    // today: an officer logging a call on Friday about a Tuesday submission
    // must be able to date it Tuesday.
    submitted_at:
      input.submittedAt ??
      (input.record.submitted_at ? new Date(input.record.submitted_at) : now),
  }
  if (reference !== undefined) data.submission_reference = reference
  if (url !== undefined) data.submission_url = url
  if (notes !== undefined) data.submission_notes = notes

  return { ok: true, data }
}
