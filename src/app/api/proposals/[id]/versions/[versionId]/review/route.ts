import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { checkServiceAccess } from '@/lib/org-access-service'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { ensureReviewerWorkspace, kickProposalReview } from '@/lib/proposals/reviewRunner'
import { getProposalSettings } from '@/lib/proposals/settings'
import { lensCanManage, LIVE_REVIEW_STATUSES, serializeReview } from '@/lib/proposals/shared'
import { recordProposalEventQuietly } from '@/lib/proposals/events'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Start the AI review of one draft.
 *
 * The run happens server-side: this route creates the row, kicks the worker and
 * returns. The officer can close the tab — a run whose worker dies is picked up
 * by the sweep, which is why nothing here waits for the result.
 */

const postSchema = z.object({
  /** Re-run after the officer mapped the sections by hand in the workspace. */
  skipImport: z.boolean().default(false),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; versionId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json(
      { error: 'Only the funding department runs the review.' },
      { status: 403 }
    )
  }

  // Two separate gates, in the order that gives the clearest message. First:
  // has this institution chosen to run the review step at all?
  const settings = await getProposalSettings(context.tenantId)
  if (!settings.aiReviewEnabled) {
    return NextResponse.json(
      {
        error: 'AI review of drafts is switched off for this institution.',
        code: 'FEATURE_DISABLED',
      },
      { status: 403 }
    )
  }

  // Second, the plan gate, before a row exists: a tenant without AI grant
  // review must be told now, not left with a queued job that fails on the
  // first model call.
  const plan = await checkServiceAccess(context.user.id, context.tenantId, 'GRANT_REVIEW')
  if (!plan.allowed) {
    return NextResponse.json(
      { error: plan.reason || 'AI grant review is not included in your plan.', code: 'SERVICE_ACCESS_DENIED' },
      { status: 403 }
    )
  }

  let payload: z.infer<typeof postSchema>
  try {
    payload = postSchema.parse(await request.json().catch(() => ({})))
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const version = await prisma.grantProposalVersion.findFirst({
    where: { id: params.versionId, proposal_id: params.id },
    select: { id: true, version_no: true, tenant_id: true },
  })
  if (!version) return NextResponse.json({ error: 'That version was not found.' }, { status: 404 })

  try {
    // The workspace is created here rather than inside the runner so the row
    // can point at it from the moment it exists — and so "Open the reviewer
    // workspace" works immediately, including when the run later fails on an
    // import the officer needs to fix by hand. Zero LLM calls; it reads the
    // call's rules and seeds empty sections.
    const proposal = await prisma.grantProposal.findUnique({ where: { id: params.id } })
    if (!proposal) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
    const reviewerCallId = await ensureReviewerWorkspace(proposal, context.user.id)

    const existing = await prisma.grantProposalReview.findUnique({
      where: { version_id: version.id },
      select: { id: true, status: true },
    })

    if (existing && LIVE_REVIEW_STATUSES.includes(existing.status as any)) {
      return NextResponse.json(
        { error: 'A review of this draft is already running.', reviewId: existing.id },
        { status: 409 }
      )
    }

    // One review row per version: a re-run resets this row rather than piling
    // up attempts, so "the review of v2" is never ambiguous.
    const review = existing
      ? await prisma.grantProposalReview.update({
          where: { id: existing.id },
          data: {
            status: 'QUEUED',
            skip_import: payload.skipImport,
            error: null,
            error_code: null,
            finished_at: null,
            heartbeat_at: null,
            progress: undefined,
          },
        })
      : await prisma.grantProposalReview.create({
          data: {
            tenant_id: context.tenantId,
            proposal_id: params.id,
            version_id: version.id,
            reviewer_call_id: reviewerCallId,
            run_by_user_id: context.user.id,
            status: 'QUEUED',
            skip_import: payload.skipImport,
          },
        })

    await prisma.grantProposalVersion.update({
      where: { id: version.id },
      data: { review_status: 'QUEUED' },
    })

    await recordProposalEventQuietly({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      kind: 'REVIEW_QUEUED',
      payload: { versionNo: version.version_no },
      visibleToFaculty: false,
    })

    // Detached on purpose. The response is the receipt, not the result.
    kickProposalReview(review.id)

    return NextResponse.json({ review: serializeReview(review, access.lens) }, { status: 202 })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] could not queue a review', error)
    return NextResponse.json({ error: 'Could not start the review.' }, { status: 500 })
  }
}
