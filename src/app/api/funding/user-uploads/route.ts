import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  if (!auth.actor.tenantId) {
    return NextResponse.json({ message: 'A tenant-scoped account is required' }, { status: 403 })
  }

  try {
    const [calls, activeJobs] = await Promise.all([
      prisma.fundingCall.findMany({
        where: {
          tenantId: auth.actor.tenantId,
          visibility: 'TENANT_PRIVATE',
          createdByUserId: auth.actor.id,
          source: 'user-funding-intake',
        },
        orderBy: { updatedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          title: true,
          agency_name: true,
          scheme_title: true,
          source_url: true,
          close_date: true,
          is_rolling: true,
          catalog_status: true,
          guideline_status: true,
          template_status: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.fundingIntakeJob.findMany({
        where: {
          submitted_by_user_id: auth.actor.id,
          status: { in: ['queued', 'fetching', 'extracting', 'needs_review', 'failed'] },
        },
        orderBy: { updated_at: 'desc' },
        take: 10,
        select: {
          id: true,
          input_type: true,
          source_url: true,
          status: true,
          duplicate_status: true,
          linked_funding_call_id: true,
          error_message: true,
          created_at: true,
          updated_at: true,
        },
      }),
    ])

    return NextResponse.json({
      calls: calls.map((call) => ({
        id: call.id,
        title: call.scheme_title || call.title || 'Untitled funding call',
        agencyName: call.agency_name || null,
        sourceUrl: call.source_url || null,
        closeDate: call.close_date ? call.close_date.toISOString() : null,
        isRolling: Boolean(call.is_rolling),
        catalogStatus: call.catalog_status || null,
        guidelineStatus: call.guideline_status || 'none',
        templateStatus: call.template_status || 'none',
        adminReviewStatus:
          typeof (call.metadata as any)?.admin_review_status === 'string'
            ? (call.metadata as any).admin_review_status
            : typeof (call.metadata as any)?.verification_status === 'string'
              ? (call.metadata as any).verification_status
              : null,
        createdAt: call.createdAt.toISOString(),
        updatedAt: call.updatedAt.toISOString(),
      })),
      activeJobs: activeJobs.map((job) => ({
        id: job.id,
        inputType: job.input_type,
        sourceUrl: job.source_url || null,
        status: job.status,
        duplicateStatus: job.duplicate_status,
        linkedFundingCallId: job.linked_funding_call_id,
        errorMessage: job.error_message,
        createdAt: job.created_at.toISOString(),
        updatedAt: job.updated_at.toISOString(),
      })),
    })
  } catch (error) {
    console.error('[Funding/UserUploads] GET error:', error)
    return NextResponse.json({ message: 'Failed to load uploaded funding calls' }, { status: 500 })
  }
}
