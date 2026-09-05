import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import {
  getProposalDossier,
  ProposalError,
  updateProposalDetails,
} from '@/lib/proposals/proposalService'
import { getProposalSettings } from '@/lib/proposals/settings'
import { lensCanManage } from '@/lib/proposals/shared'
import { proposalTeamUserIds } from '@/lib/proposals/teamService'
import { notifyQuietly } from '@/lib/notifications/notificationService'

export const dynamic = 'force-dynamic'

/**
 * One proposal, through the caller's lens.
 *
 * A caller with no business seeing it gets 404, never 403: "that exists but is
 * not yours" is itself a disclosure about who is applying for what.
 */

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  schemeTitle: z.string().trim().max(300).nullable().optional(),
  agencyName: z.string().trim().min(1).max(300).optional(),
  agencyDeadlineAt: z.string().trim().nullable().optional(),
  reviewCutoffAt: z.string().trim().nullable().optional(),
  durationMonths: z.number().int().min(1).max(240).nullable().optional(),
  requestedAmount: z.number().min(0).nullable().optional(),
  currency: z.string().trim().min(1).max(8).optional(),
})

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new ProposalError('That date is not valid.', 400, 'BAD_DATE')
  return date
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  try {
    const [dossier, settings] = await Promise.all([
      getProposalDossier(params.id, access.lens),
      getProposalSettings(context.tenantId),
    ])

    const managing = lensCanManage(access.lens)
    const editable = access.lens !== 'head'
    const open = ['DRAFT', 'IN_REVIEW'].includes(dossier.proposal.status)

    // Capabilities are the single answer to "what can this person do here",
    // combining who they are with what this institution actually runs. The UI
    // reads these rather than re-deriving the rules, so a stage switched off
    // disappears instead of failing when pressed.
    return NextResponse.json({
      ...dossier,
      settings,
      capabilities: {
        canManage: managing,
        canUploadVersion: editable,
        canRunReview: managing && settings.aiReviewEnabled,
        canShareReview: managing && settings.aiReviewEnabled,
        canSetCutoff: managing && settings.cutoffEnabled,
        canEditTeam: editable && settings.teamEnabled && (managing || open),
        canEditBudget: editable && settings.budgetEnabled && (managing || open),
        canTrackAgency: managing && settings.agencyTrackingEnabled,
        canIssueLetter: managing && settings.endorsementEnabled,
        canEditChecklist: managing && settings.checklistEnabled,
        canTrackPostAward: managing && settings.postAwardEnabled,
        canRecordSubmission:
          managing || (access.lens === 'faculty' && settings.facultyMayRecordSubmission),
      },
    })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] dossier failed', error)
    return NextResponse.json({ error: 'Could not load the proposal.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (access.lens === 'head') {
    return NextResponse.json({ error: 'This view is read-only.' }, { status: 403 })
  }

  let payload: z.infer<typeof patchSchema>
  try {
    payload = patchSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    const { proposal, cutoffChanged } = await updateProposalDetails({
      proposalId: params.id,
      tenantId: context.tenantId,
      actorUserId: context.user.id,
      lens: access.lens,
      title: payload.title,
      schemeTitle: payload.schemeTitle,
      agencyName: payload.agencyName,
      agencyDeadlineAt: parseDate(payload.agencyDeadlineAt),
      reviewCutoffAt: parseDate(payload.reviewCutoffAt),
      durationMonths: payload.durationMonths,
      requestedAmount: payload.requestedAmount,
      currency: payload.currency,
    })

    // A cut-off nobody was told about is a trap, so setting one is announced.
    if (cutoffChanged && proposal.review_cutoff_at) {
      const teamIds = await proposalTeamUserIds(params.id)
      await notifyQuietly({
        tenantId: context.tenantId,
        userIds: teamIds,
        excludeUserIds: [context.user.id],
        title: 'Internal cut-off set for your proposal',
        body: `${proposal.title} — upload your revised draft by ${proposal.review_cutoff_at.toDateString()}.`,
        category: 'PROPOSAL',
        linkUrl: `/proposals/${params.id}`,
        createdByUserId: context.user.id,
      })
    }

    const dossier = await getProposalDossier(params.id, access.lens)
    return NextResponse.json(dossier)
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] update failed', error)
    return NextResponse.json({ error: 'Could not update the proposal.' }, { status: 500 })
  }
}
