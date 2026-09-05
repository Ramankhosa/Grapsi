import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { loadSharedReport } from '@/lib/proposals/shareService'
import { lensCanManage } from '@/lib/proposals/shared'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * The review report.
 *
 * The applicant reads the frozen snapshot taken when the officer shared it, so
 * what they were told in August still reads the same in December. The officer
 * reads the live workspace before sharing, because that is the thing they are
 * deciding whether to send.
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

  try {
    const review = await loadSharedReport(params.id, params.reviewId)
    const managing = lensCanManage(access.lens)

    if (!review.shared_at && !managing) {
      return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    }

    if (review.report_snapshot) {
      return NextResponse.json({
        report: review.report_snapshot,
        versionNo: review.version?.version_no ?? null,
        overallScore: review.overall_score,
        recommendation: review.recommendation,
        officerNote: review.officer_note,
        sharedAt: review.shared_at,
        frozen: true,
      })
    }

    // Not shared yet: an officer previewing what they are about to send reads
    // the live workspace. Nobody else ever reaches this branch.
    if (!managing) {
      return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    }

    const call = await prisma.reviewerCall.findUnique({
      where: { id: review.reviewer_call_id },
      select: { project_title: true, agency_name: true, overall_review_json: true },
    })
    if (!call?.overall_review_json) {
      return NextResponse.json(
        { error: 'The panel report has not been compiled yet.', code: 'NO_REPORT' },
        { status: 404 }
      )
    }

    const sections = await prisma.reviewerSection.findMany({
      where: { call_id: review.reviewer_call_id, status: 'reviewed' },
      orderBy: [{ section_title: 'asc' }, { version: 'desc' }],
    })

    return NextResponse.json({
      report: {
        overall: call.overall_review_json,
        projectTitle: call.project_title,
        agencyName: call.agency_name,
        versionNo: review.version?.version_no ?? null,
        sections,
      },
      versionNo: review.version?.version_no ?? null,
      overallScore: review.overall_score,
      recommendation: review.recommendation,
      officerNote: review.officer_note,
      sharedAt: null,
      frozen: false,
    })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] report read failed', error)
    return NextResponse.json({ error: 'Could not load the report.' }, { status: 500 })
  }
}
