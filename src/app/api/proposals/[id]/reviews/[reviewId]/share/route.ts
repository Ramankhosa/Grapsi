import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { shareProposalReview } from '@/lib/proposals/shareService'
import { lensCanManage, serializeReview } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * Send the review to the applicant.
 *
 * This is the deliberate act that turns the department's working assessment
 * into something the researcher has been told. It freezes a copy at the same
 * moment, so what was sent stays what was sent.
 */

const postSchema = z.object({
  officerNote: z.string().trim().max(5000).nullable().optional(),
  internalNote: z.string().trim().max(5000).nullable().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; reviewId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json(
      { error: 'Only the funding department shares a review.' },
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

  try {
    const review = await shareProposalReview({
      tenantId: context.tenantId,
      proposalId: params.id,
      reviewId: params.reviewId,
      actorUserId: context.user.id,
      officerNote: payload.officerNote,
      internalNote: payload.internalNote,
    })
    return NextResponse.json({ review: serializeReview(review, access.lens) })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] share failed', error)
    return NextResponse.json({ error: 'Could not share the review.' }, { status: 500 })
  }
}
