/**
 * Sending a review back to the applicant.
 *
 * Sharing freezes a copy. The reviewer workspace keeps moving as later versions
 * are imported and re-reviewed, so a live read would quietly rewrite what a
 * faculty member was told in August by the time they look again in December.
 * A judgement that changes after it was delivered is not a judgement.
 *
 * The Word document is built once, here, and stored beside the draft: the
 * applicant downloading it a month later must not trigger a regeneration that
 * bills the tenant's quota and produces a different report.
 */
import { buildAtrForCall } from '@/lib/reviewer/atrExport'
import { resolveSectionVersions } from '@/lib/reviewer/finalReport'
import { writeFundingBufferAsset } from '@/lib/funding/storage'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'

import { proposalReviewSharedTemplate } from '@/lib/email-templates'

import { recordProposalEvent } from './events'
import { emailProposalRecipients, recipientsFor } from './notify'
import { ProposalError } from './proposalService'
import { proposalTeamUserIds } from './teamService'

export interface ShareReviewInput {
  tenantId: string
  proposalId: string
  reviewId: string
  actorUserId: string
  officerNote?: string | null
  internalNote?: string | null
}

export async function shareProposalReview(input: ShareReviewInput) {
  const review = await prisma.grantProposalReview.findFirst({
    where: { id: input.reviewId, proposal_id: input.proposalId },
    include: {
      version: { select: { id: true, version_no: true } },
      proposal: { select: { id: true, title: true, tenant_id: true, status: true } },
    },
  })
  if (!review) throw new ProposalError('That review was not found.', 404, 'NOT_FOUND')
  if (review.status !== 'DONE') {
    throw new ProposalError(
      'This review has not finished yet, so there is nothing to send.',
      400,
      'NOT_READY'
    )
  }

  // Re-sharing is allowed (an officer may add a covering note they forgot), but
  // the frozen report is written once: the applicant's copy must not change
  // under them.
  const alreadyShared = Boolean(review.shared_at)

  let snapshot = review.report_snapshot as any
  let docxPath = review.docx_storage_path

  if (!alreadyShared || !snapshot) {
    const call = await prisma.reviewerCall.findUnique({
      where: { id: review.reviewer_call_id },
      select: {
        id: true,
        project_title: true,
        agency_name: true,
        overall_review_json: true,
      },
    })
    if (!call?.overall_review_json) {
      throw new ProposalError(
        'The panel report is missing. Run the review again before sharing it.',
        400,
        'NO_REPORT'
      )
    }

    const sections = await prisma.reviewerSection.findMany({
      where: { call_id: review.reviewer_call_id },
    })

    // Only the versions the report actually scored. Without this the snapshot
    // carries both v1 and v2 of a revised section and the applicant reads two
    // contradictory verdicts on the same text.
    const resolution = resolveSectionVersions(sections as any, null)
    const effective = (resolution.effective.length > 0 ? resolution.effective : sections) as any[]

    snapshot = {
      overall: call.overall_review_json,
      projectTitle: call.project_title,
      agencyName: call.agency_name,
      generatedAt: new Date().toISOString(),
      versionNo: review.version?.version_no ?? null,
      sections: effective.map((section: any) => ({
        id: section.id,
        section_title: section.section_title,
        user_input: section.user_input,
        ai_review_json: section.ai_review_json,
        status: section.status,
        version: section.version,
        is_revision: section.is_revision,
        last_reviewed_at: section.last_reviewed_at,
      })),
    }

    // The Word document, built from the report as it stands right now.
    // `refresh: false` on purpose: an officer sharing must not silently
    // regenerate the report and bill the tenant a second time.
    try {
      const atr = await buildAtrForCall(review.reviewer_call_id, { refresh: false })
      if (atr.ok) {
        const stored = await writeFundingBufferAsset({
          jobId: `proposals/${input.proposalId}`,
          fileName: `review-v${review.version?.version_no ?? 1}.docx`,
          buffer: atr.buffer,
        })
        docxPath = stored.storagePath
      } else {
        console.error('[proposals] ATR export refused', atr.error)
      }
    } catch (error) {
      // A missing Word file is a degraded share, not a failed one: the report
      // itself is what the applicant needs.
      console.error('[proposals] could not build the ATR document', error)
    }
  }

  const shared = await prisma.$transaction(async (tx) => {
    const row = await tx.grantProposalReview.update({
      where: { id: review.id },
      data: {
        report_snapshot: snapshot,
        docx_storage_path: docxPath,
        shared_at: review.shared_at || new Date(),
        shared_by_user_id: input.actorUserId,
        ...(input.officerNote !== undefined
          ? { officer_note: input.officerNote?.trim().slice(0, 5000) || null }
          : {}),
        ...(input.internalNote !== undefined
          ? { internal_note: input.internalNote?.trim().slice(0, 5000) || null }
          : {}),
      },
    })

    await tx.grantProposalVersion.update({
      where: { id: review.version_id },
      data: { review_status: 'SHARED' },
    })

    await recordProposalEvent(tx, {
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
      kind: 'REVIEW_SHARED',
      payload: {
        versionNo: review.version?.version_no ?? null,
        score: review.overall_score,
        note: input.officerNote?.trim().slice(0, 500) || null,
      },
    })

    return row
  })

  // Tell the applicant and every internal co-investigator: a review nobody
  // knows about is a review nobody acts on. This one earns an email as well as
  // the in-app notice — it asks them to do work by a date.
  try {
    const recipientIds = (await proposalTeamUserIds(input.proposalId)).filter(
      (id) => id !== input.actorUserId
    )
    if (recipientIds.length) {
      await notifyQuietly({
        tenantId: input.tenantId,
        userIds: recipientIds,
        title: 'Your proposal review is ready',
        body: `${review.proposal?.title}${
          review.overall_score != null ? ` — scored ${review.overall_score.toFixed(1)}` : ''
        }. Read the remarks and upload your revision.`,
        category: 'PROPOSAL',
        linkUrl: `/proposals/${input.proposalId}`,
        createdByUserId: input.actorUserId,
      })

      const actions = ((snapshot?.overall?.priority_actions || []) as any[])
        .map((action) =>
          typeof action === 'string' ? action : String(action?.action || action?.title || '')
        )
        .filter(Boolean)

      const officer = await prisma.user.findUnique({
        where: { id: input.actorUserId },
        select: { name: true, email: true },
      })

      await emailProposalRecipients(
        input.tenantId,
        await recipientsFor(recipientIds),
        (recipient) =>
          proposalReviewSharedTemplate({
            email: recipient.email,
            name: recipient.name,
            proposalTitle: review.proposal?.title || 'your proposal',
            agency: snapshot?.agencyName || null,
            score: review.overall_score ?? null,
            recommendation: review.recommendation ?? null,
            officerNote: shared.officer_note ?? null,
            officerName: officer?.name || null,
            priorityActions: actions,
            proposalId: input.proposalId,
          })
      )
    }
  } catch (error) {
    console.error('[proposals] could not notify of a shared review', error)
  }

  return shared
}

/** The frozen report, for whoever may read it. */
export async function loadSharedReport(proposalId: string, reviewId: string) {
  const review = await prisma.grantProposalReview.findFirst({
    where: { id: reviewId, proposal_id: proposalId },
    select: {
      id: true,
      status: true,
      shared_at: true,
      officer_note: true,
      overall_score: true,
      recommendation: true,
      report_snapshot: true,
      reviewer_call_id: true,
      docx_storage_path: true,
      version: { select: { version_no: true } },
    },
  })
  if (!review) throw new ProposalError('That review was not found.', 404, 'NOT_FOUND')
  return review
}
