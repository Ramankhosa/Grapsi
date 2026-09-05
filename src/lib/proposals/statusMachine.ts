/**
 * The proposal lifecycle, as a table rather than as scattered `if`s.
 *
 * Pure on purpose: the transition rules are the part most likely to be argued
 * about and revised, and they are the part that is cheapest to get right if a
 * test can state them plainly.
 *
 * The shape of the process this encodes:
 *
 *   DRAFT ── first version uploaded ──▸ IN_REVIEW ◂──┐
 *                                          │         │ another draft
 *                              officer clears        │
 *                                          ▾         │
 *                                      CLEARED ──────┘ (reopened)
 *                                          │
 *                                    submitted
 *                                          ▾
 *                                   SUBMITTED ──▸ UNDER_AGENCY_REVIEW
 *                                          │              │
 *                                          │      REVISION_REQUESTED ──┐
 *                                          ▾              ▾            │
 *                              SANCTIONED / REJECTED ◂─────────────────┘
 *                                          ▾
 *                                       CLOSED
 *
 * WITHDRAWN is reachable from anything still open, because an applicant may
 * always pull out.
 */
import type { ProposalLens, ProposalStatus } from './shared'

/** What each status may become. */
export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['IN_REVIEW', 'CLEARED', 'WITHDRAWN'],
  // CLEARED can fall back to IN_REVIEW when a fresh draft arrives after
  // clearance; SUBMITTED direct from IN_REVIEW covers the office that clears
  // and submits in one action.
  IN_REVIEW: ['CLEARED', 'SUBMITTED', 'DRAFT', 'WITHDRAWN'],
  CLEARED: ['SUBMITTED', 'IN_REVIEW', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_AGENCY_REVIEW', 'REVISION_REQUESTED', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'],
  UNDER_AGENCY_REVIEW: ['REVISION_REQUESTED', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'],
  // A revision the agency asked for goes back through the department, which is
  // the whole point of having a desk.
  REVISION_REQUESTED: ['IN_REVIEW', 'SUBMITTED', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'],
  SANCTIONED: ['CLOSED'],
  REJECTED: ['CLOSED', 'IN_REVIEW'],
  WITHDRAWN: ['CLOSED', 'DRAFT'],
  CLOSED: [],
}

/**
 * Statuses a faculty member may set themselves. Everything else is the
 * department's call — clearing your own proposal for submission would make the
 * check meaningless.
 */
const FACULTY_SETTABLE: ProposalStatus[] = ['WITHDRAWN', 'SUBMITTED']

/**
 * The parts of the tenant's configuration these rules care about. Passed in
 * rather than read here, so the rules stay pure and a test can state a policy
 * in one line.
 */
export interface TransitionPolicy {
  /** May a researcher record their own agency submission? */
  facultyMayRecordSubmission?: boolean
  /** Must a review have been shared before a proposal can be cleared? */
  requireReviewBeforeClearing?: boolean
  /** Does this office follow the agency's decision after submission? */
  agencyTrackingEnabled?: boolean
}

export interface TransitionInput extends TransitionPolicy {
  from: ProposalStatus
  to: ProposalStatus
  lens: ProposalLens
  /** Whether any version's review has actually been sent to the applicant. */
  hasSharedReview?: boolean
  /** An officer's written reason, which unlocks the two guarded moves. */
  overrideReason?: string | null
}

export type TransitionResult = { ok: true } | { ok: false; error: string }

export const CLEAR_WITHOUT_REVIEW =
  'This proposal has had no review shared with the applicant. Add a reason to clear it anyway.'

/**
 * May this transition happen, and by this person?
 */
export function validateProposalTransition(input: TransitionInput): TransitionResult {
  const { from, to, lens } = input

  if (from === to) {
    return { ok: false, error: `This proposal is already ${from.toLowerCase().replace(/_/g, ' ')}.` }
  }

  const allowed = PROPOSAL_TRANSITIONS[from]
  if (!allowed) return { ok: false, error: `Unknown status ${from}.` }
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `A proposal cannot go from ${from.toLowerCase().replace(/_/g, ' ')} to ${to
        .toLowerCase()
        .replace(/_/g, ' ')}.`,
    }
  }

  if (lens === 'head') {
    return { ok: false, error: 'This view is read-only.' }
  }

  if (lens === 'faculty') {
    if (!FACULTY_SETTABLE.includes(to)) {
      return { ok: false, error: 'Only the funding department can move the proposal to that stage.' }
    }
    if (to === 'SUBMITTED' && input.facultyMayRecordSubmission === false) {
      return {
        ok: false,
        error: 'Your institution records agency submissions through the funding department.',
      }
    }
  }

  // An office that does not follow agency outcomes has no use for those states,
  // and offering them would invite a record nobody maintains.
  if (
    input.agencyTrackingEnabled === false &&
    ['UNDER_AGENCY_REVIEW', 'REVISION_REQUESTED', 'SANCTIONED', 'REJECTED'].includes(to)
  ) {
    return {
      ok: false,
      error: 'This institution does not track agency outcomes on the proposal desk.',
    }
  }

  // Clearing a proposal nobody reviewed is exactly the thing the desk exists to
  // prevent, so it is possible but never silent — unless the tenant has said
  // they do not run the review step at all.
  if (to === 'CLEARED' && !input.hasSharedReview && input.requireReviewBeforeClearing !== false) {
    const reason = (input.overrideReason || '').trim()
    if (reason.length < 5) {
      return { ok: false, error: CLEAR_WITHOUT_REVIEW }
    }
  }

  return { ok: true }
}

/**
 * Whether a new draft may still be uploaded.
 *
 * The cut-off is the department's, not the agency's: after it the office needs
 * its remaining days to read and clear what it already has. An officer can
 * accept a late draft, but owes a reason, which is recorded against the version.
 */
export interface UploadGateInput {
  status: ProposalStatus
  lens: ProposalLens
  reviewCutoffAt?: Date | string | null
  overrideReason?: string | null
  /**
   * Whether this office operates a cut-off at all. When false the date may
   * still be displayed as guidance, but it never refuses an upload — an
   * institution that does not work that way should not be stopped by it.
   */
  cutoffEnabled?: boolean
  now?: Date
}

export const CUTOFF_PASSED =
  'The department’s cut-off for new drafts has passed. Contact your funding officer.'
export const CLOSED_TO_UPLOADS = 'This proposal is closed to new drafts.'
export const OVERRIDE_REASON_REQUIRED =
  'This is past the cut-off. Give a short reason to accept it anyway.'

export function validateVersionUpload(input: UploadGateInput): TransitionResult {
  const now = input.now ?? new Date()
  const managing = input.lens === 'admin' || input.lens === 'officer'

  if (input.lens === 'head') {
    return { ok: false, error: 'This view is read-only.' }
  }

  // Nothing more to review once it has gone to the agency or been closed out.
  if (['SUBMITTED', 'UNDER_AGENCY_REVIEW', 'SANCTIONED', 'REJECTED', 'WITHDRAWN', 'CLOSED'].includes(input.status)) {
    return { ok: false, error: CLOSED_TO_UPLOADS }
  }

  if (input.status === 'CLEARED' && !managing) {
    return {
      ok: false,
      error: 'This proposal has been cleared for submission. Ask your officer to reopen it first.',
    }
  }

  const cutoff =
    input.cutoffEnabled === false || !input.reviewCutoffAt ? null : new Date(input.reviewCutoffAt)
  const pastCutoff = Boolean(cutoff && Number.isFinite(cutoff.getTime()) && cutoff.getTime() < now.getTime())

  if (pastCutoff) {
    if (!managing) return { ok: false, error: CUTOFF_PASSED }
    if ((input.overrideReason || '').trim().length < 5) {
      return { ok: false, error: OVERRIDE_REASON_REQUIRED }
    }
  }

  return { ok: true }
}

/**
 * What the applicant should do next, in one sentence. Used on both the faculty
 * list and the officer's register, so the two never disagree about whose move
 * it is.
 */
export function nextActionFor(input: {
  status: ProposalStatus
  currentVersionNo: number
  latestVersionReviewStatus?: string | null
  reviewCutoffAt?: Date | string | null
  /** False when this office does not run the AI review at all. */
  aiReviewEnabled?: boolean
  now?: Date
}): { actor: 'faculty' | 'officer' | 'agency' | 'none'; text: string } {
  const now = input.now ?? new Date()
  const reviews = input.aiReviewEnabled !== false

  switch (input.status) {
    case 'DRAFT':
      return input.currentVersionNo === 0
        ? { actor: 'faculty', text: 'Upload your draft for review.' }
        : { actor: 'officer', text: 'Waiting for the department to start the review.' }
    case 'IN_REVIEW': {
      // With no review step, the office is simply reading the draft; saying
      // "waiting for the review" would name a stage that never happens.
      if (!reviews) {
        return { actor: 'officer', text: 'With the department for checking.' }
      }
      const state = input.latestVersionReviewStatus || 'NONE'
      if (state === 'SHARED') {
        const cutoff = input.reviewCutoffAt ? new Date(input.reviewCutoffAt) : null
        if (cutoff && Number.isFinite(cutoff.getTime())) {
          const days = Math.ceil((cutoff.getTime() - now.getTime()) / 86_400_000)
          if (days >= 0) {
            return {
              actor: 'faculty',
              text: `Revise and upload again${days === 0 ? ' today' : ` within ${days} day${days === 1 ? '' : 's'}`}.`,
            }
          }
        }
        return { actor: 'faculty', text: 'Revise and upload the next version.' }
      }
      if (state === 'QUEUED' || state === 'RUNNING') {
        return { actor: 'officer', text: 'The review is running.' }
      }
      if (state === 'REVIEWED') {
        return { actor: 'officer', text: 'Review finished — waiting to be shared.' }
      }
      if (state === 'FAILED') {
        return { actor: 'officer', text: 'The review failed and needs another run.' }
      }
      return { actor: 'officer', text: 'Waiting for the department to review this draft.' }
    }
    case 'CLEARED':
      return { actor: 'faculty', text: 'Cleared — submit to the agency and record the date.' }
    case 'SUBMITTED':
    case 'UNDER_AGENCY_REVIEW':
      return { actor: 'agency', text: 'With the funding agency.' }
    case 'REVISION_REQUESTED':
      return { actor: 'faculty', text: 'The agency asked for changes.' }
    case 'SANCTIONED':
      // Nothing further is owed on the proposal itself. Post-award instalments
      // and utilisation certificates are tracked on the assignment, and
      // reporting them here would put every funded grant in the desk's backlog.
      return { actor: 'none', text: '' }
    case 'REJECTED':
    case 'WITHDRAWN':
    case 'CLOSED':
    default:
      return { actor: 'none', text: '' }
  }
}
