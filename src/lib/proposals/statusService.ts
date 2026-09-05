/**
 * Moving a proposal through its lifecycle.
 *
 * Two rules hold this together:
 *
 *  1. A submission recorded here goes through `buildSubmissionUpdate`, the same
 *     pure function the assignment routes use. There is exactly one definition
 *     of "submitted" in the system, so the ledger, the member x school matrix
 *     and the Dean's page cannot end up disagreeing with the proposal desk.
 *  2. The agency's answer writes back to `CallAssignment.outcome`. The existing
 *     success-rate reporting reads that column and knew nothing about proposals;
 *     without the write-back a sanctioned grant would show as still pending on
 *     every dashboard built before this module existed.
 */
import { buildSubmissionUpdate } from '@/lib/assignments/submission'
import { submissionWatchers } from '@/lib/fundingDept/shared'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'

import { outstandingRequiredItems } from './checklistService'
import { recordProposalEvent } from './events'
import { ProposalError } from './proposalService'
import { getProposalSettings } from './settings'
import { proposalTeamUserIds } from './teamService'
import { proposalInclude, type ProposalLens, type ProposalStatus } from './shared'
import { validateProposalTransition } from './statusMachine'

export interface TransitionProposalInput {
  tenantId: string
  proposalId: string
  actorUserId: string
  lens: ProposalLens
  to: ProposalStatus
  /** Submission proof; also accepted when clearing straight to SUBMITTED. */
  submissionReference?: string | null
  submissionUrl?: string | null
  submissionNotes?: string | null
  submittedAt?: Date | null
  /** The agency decision fields. */
  sanctionedAmount?: number | null
  sanctionReference?: string | null
  sanctionDate?: Date | null
  agencyStatusNote?: string | null
  /** Unlocks clearing a proposal that never had a review shared. */
  overrideReason?: string | null
}

const OUTCOME_BY_STATUS: Record<string, 'AWARDED' | 'REJECTED' | 'WITHDRAWN'> = {
  SANCTIONED: 'AWARDED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
}

export async function transitionProposal(input: TransitionProposalInput) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    include: {
      ...proposalInclude,
      reviews: { where: { shared_at: { not: null } }, select: { id: true }, take: 1 },
    },
  })
  if (!proposal) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const settings = await getProposalSettings(input.tenantId)
  const from = proposal.status as ProposalStatus

  const check = validateProposalTransition({
    from,
    to: input.to,
    lens: input.lens,
    hasSharedReview: (proposal as any).reviews.length > 0,
    facultyMayRecordSubmission: settings.facultyMayRecordSubmission,
    requireReviewBeforeClearing: settings.requireReviewBeforeClearing,
    agencyTrackingEnabled: settings.agencyTrackingEnabled,
    overrideReason: input.overrideReason,
  })
  if (!check.ok) throw new ProposalError(check.error, 400, 'BAD_TRANSITION')

  // The checklist is the point of the clearance step: an officer who clears
  // over a missing endorsement letter should have to say so, not discover it
  // when the agency rejects the bundle.
  if (input.to === 'CLEARED' && settings.checklistEnabled) {
    const outstanding = await outstandingRequiredItems(input.proposalId)
    if (outstanding.length > 0 && !(input.overrideReason || '').trim()) {
      throw new ProposalError(
        `Still outstanding: ${outstanding.join(', ')}. Complete them, or give a reason to clear anyway.`,
        400,
        'CHECKLIST_INCOMPLETE'
      )
    }
  }

  const now = new Date()
  const data: Record<string, unknown> = { status: input.to }
  const payload: Record<string, unknown> = {}
  let submissionApplied = false

  if (input.to === 'CLEARED') {
    data.cleared_by_user_id = input.actorUserId
    data.cleared_at = now
    if (input.overrideReason) payload.overrideReason = input.overrideReason.trim().slice(0, 500)
  }

  if (input.to === 'IN_REVIEW' && (from === 'CLEARED' || from === 'REJECTED')) {
    // Reopening: the clearance no longer stands, and leaving it set would let a
    // stale "cleared on 3 August" sit above a draft nobody has read.
    data.cleared_by_user_id = null
    data.cleared_at = null
  }

  if (input.to === 'SUBMITTED') {
    const reference = input.submissionReference?.trim() || null
    const url = input.submissionUrl?.trim() || null
    const notes = input.submissionNotes?.trim() || null
    if (!reference && !url && !notes) {
      throw new ProposalError(
        'Add submission info (reference number, link or notes) before recording this as submitted.',
        400,
        'PROOF_REQUIRED'
      )
    }
    data.submitted_at = input.submittedAt || now
    data.submission_reference = reference
    data.submission_url = url
    data.agency_status_updated_at = now
    payload.submissionReference = reference
  }

  if (['UNDER_AGENCY_REVIEW', 'REVISION_REQUESTED', 'SANCTIONED', 'REJECTED'].includes(input.to)) {
    data.agency_status_updated_at = now
    if (input.agencyStatusNote !== undefined) {
      data.agency_status_note = input.agencyStatusNote?.trim().slice(0, 2000) || null
    }
  }

  if (input.to === 'SANCTIONED') {
    if (input.sanctionedAmount !== undefined) data.sanctioned_amount = input.sanctionedAmount
    if (input.sanctionReference !== undefined) {
      data.sanction_reference = input.sanctionReference?.trim().slice(0, 200) || null
    }
    data.sanction_date = input.sanctionDate || now
    payload.sanctionedAmount = input.sanctionedAmount ?? null
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.grantProposal.update({
      where: { id: proposal.id },
      data,
      include: proposalInclude,
    })

    // The assignment is the object every existing dashboard counts. Keep it in
    // step, through the one shared path.
    if (proposal.assignment_id) {
      if (input.to === 'SUBMITTED') {
        const assignment = await tx.callAssignment.findUnique({
          where: { id: proposal.assignment_id },
          select: {
            id: true,
            status: true,
            submission_reference: true,
            submission_url: true,
            submission_notes: true,
            submitted_at: true,
          },
        })
        if (assignment && !['CANCELLED', 'DECLINED'].includes(assignment.status)) {
          const submission = buildSubmissionUpdate({
            record: assignment,
            reference: input.submissionReference ?? null,
            url: input.submissionUrl ?? null,
            notes: input.submissionNotes ?? `Recorded on the proposal desk: ${proposal.title}`,
            submittedAt: input.submittedAt || now,
          })
          if (submission.ok) {
            await tx.callAssignment.update({ where: { id: assignment.id }, data: submission.data })
            submissionApplied = true
          }
        }
      }

      const outcome = OUTCOME_BY_STATUS[input.to]
      if (outcome) {
        await tx.callAssignment.update({
          where: { id: proposal.assignment_id },
          data: {
            outcome,
            decision_at: input.sanctionDate || now,
            ...(outcome === 'AWARDED' && input.sanctionedAmount != null
              ? { award_amount: input.sanctionedAmount, award_currency: proposal.currency }
              : {}),
          },
        })
      }
    }

    await recordProposalEvent(tx, {
      tenantId: input.tenantId,
      proposalId: proposal.id,
      actorUserId: input.actorUserId,
      kind:
        input.to === 'CLEARED'
          ? 'CLEARED'
          : input.to === 'SUBMITTED'
            ? 'SUBMITTED'
            : input.to === 'IN_REVIEW' && from === 'CLEARED'
              ? 'REOPENED'
              : 'AGENCY_STATUS',
      fromStatus: from,
      toStatus: input.to,
      payload,
    })

    return row
  })

  await notifyOfTransition({
    tenantId: input.tenantId,
    proposal: updated,
    from,
    to: input.to,
    actorUserId: input.actorUserId,
    assigneeOrgUnitId: (proposal as any).assignment?.assignee_org_unit_id || proposal.org_unit_id,
    submissionApplied,
  })

  return { proposal: updated, submissionApplied }
}

async function notifyOfTransition(input: {
  tenantId: string
  proposal: any
  from: ProposalStatus
  to: ProposalStatus
  actorUserId: string
  assigneeOrgUnitId: string | null
  submissionApplied: boolean
}) {
  try {
    const teamIds = await proposalTeamUserIds(input.proposal.id)
    const link = `/proposals/${input.proposal.id}`
    const title = input.proposal.title

    if (input.to === 'CLEARED') {
      await notifyQuietly({
        tenantId: input.tenantId,
        userIds: teamIds,
        excludeUserIds: [input.actorUserId],
        title: 'Cleared to submit',
        body: `${title} — the funding department has cleared this for submission.`,
        category: 'PROPOSAL',
        linkUrl: link,
        createdByUserId: input.actorUserId,
      })
      return
    }

    if (input.to === 'SUBMITTED') {
      // The same watchers an assignment submission tells: the covering officer
      // and the head, who answer for this school's numbers.
      const watchers = await submissionWatchers({
        tenantId: input.tenantId,
        assigneeOrgUnitId: input.assigneeOrgUnitId,
        excludeUserIds: [input.actorUserId],
      })
      const recipients = Array.from(new Set([...watchers, ...teamIds])).filter(
        (id) => id !== input.actorUserId
      )
      if (recipients.length) {
        await notifyQuietly({
          tenantId: input.tenantId,
          userIds: recipients,
          title: 'Proposal submitted to the agency',
          body: `${title} — ${input.proposal.agency_name}.`,
          category: 'PROPOSAL',
          linkUrl: link,
          createdByUserId: input.actorUserId,
        })
      }
      return
    }

    if (['SANCTIONED', 'REJECTED', 'REVISION_REQUESTED', 'UNDER_AGENCY_REVIEW'].includes(input.to)) {
      const watchers = await submissionWatchers({
        tenantId: input.tenantId,
        assigneeOrgUnitId: input.assigneeOrgUnitId,
        excludeUserIds: [input.actorUserId],
      })
      const recipients = Array.from(new Set([...watchers, ...teamIds])).filter(
        (id) => id !== input.actorUserId
      )
      if (!recipients.length) return

      const headline =
        input.to === 'SANCTIONED'
          ? 'Proposal sanctioned'
          : input.to === 'REJECTED'
            ? 'Proposal not funded'
            : input.to === 'REVISION_REQUESTED'
              ? 'The agency asked for changes'
              : 'Now under agency review'

      await notifyQuietly({
        tenantId: input.tenantId,
        userIds: recipients,
        title: headline,
        body: `${title} — ${input.proposal.agency_name}.`,
        category: 'PROPOSAL',
        linkUrl: link,
        createdByUserId: input.actorUserId,
      })
    }
  } catch (error) {
    console.error('[proposals] could not notify of a status change', error)
  }
}

/** A free-text note on the record. Officers may keep theirs private. */
export async function addProposalNote(input: {
  tenantId: string
  proposalId: string
  actorUserId: string
  lens: ProposalLens
  note: string
  visibleToFaculty: boolean
}) {
  const note = input.note.trim()
  if (!note) throw new ProposalError('Add a note.', 400, 'EMPTY_NOTE')

  // Only the department keeps private notes; a note from the applicant that
  // they themselves cannot see would be nonsense.
  const visible = input.lens === 'faculty' ? true : input.visibleToFaculty

  await recordProposalEvent(prisma, {
    tenantId: input.tenantId,
    proposalId: input.proposalId,
    actorUserId: input.actorUserId,
    kind: 'NOTE',
    payload: { note: note.slice(0, 5000) },
    visibleToFaculty: visible,
  })
}
