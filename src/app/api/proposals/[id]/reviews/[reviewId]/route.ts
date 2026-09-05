import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { lensCanManage, serializeReview } from '@/lib/proposals/shared'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * One review run: its live progress while it works, and its verdict afterwards.
 *
 * The officer's screen polls this. Every number in `progress` is a real count of
 * completed work — a section reviewed, the report compiled — never a timer
 * pretending to be progress.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; reviewId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  const review = await prisma.grantProposalReview.findFirst({
    where: { id: params.reviewId, proposal_id: params.id },
    include: {
      version: { select: { version_no: true } },
      run_by: { select: { id: true, name: true, email: true } },
      shared_by: { select: { id: true, name: true, email: true } },
    },
  })
  if (!review) return NextResponse.json({ error: 'Review not found.' }, { status: 404 })

  // An unshared run is the department's working state, not the applicant's news.
  if (!lensCanManage(access.lens) && !review.shared_at) {
    return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
  }

  return NextResponse.json({ review: serializeReview(review, access.lens) })
}

/** Stop a run that is going nowhere, so the officer can start a fresh one. */
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
    return NextResponse.json({ error: 'Only the funding department can do that.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  if (body?.action !== 'cancel') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }

  // Cancelling marks the row, it does not reach into the worker: the running
  // process finishes its current section and finds the row taken. The next
  // status write from a cancelled run is harmless because a new run claims a
  // fresh row.
  const updated = await prisma.grantProposalReview.updateMany({
    where: {
      id: params.reviewId,
      proposal_id: params.id,
      status: { in: ['QUEUED', 'IMPORTING', 'REVIEWING', 'REPORTING'] },
    },
    data: { status: 'CANCELLED', finished_at: new Date() },
  })

  if (updated.count === 0) {
    return NextResponse.json(
      { error: 'That run has already finished.' },
      { status: 409 }
    )
  }

  const review = await prisma.grantProposalReview.findUnique({
    where: { id: params.reviewId },
    select: { version_id: true },
  })
  if (review) {
    await prisma.grantProposalVersion
      .update({ where: { id: review.version_id }, data: { review_status: 'NONE' } })
      .catch(() => undefined)
  }

  return NextResponse.json({ cancelled: true })
}
