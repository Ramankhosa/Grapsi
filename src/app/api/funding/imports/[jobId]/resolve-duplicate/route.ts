import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { toFundingImportJobView } from '@/lib/fundingIntake/compat'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { jobId: string } }) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json()
    const resolution =
      body?.resolution === 'reuse_existing'
        ? 'reuse_existing'
        : body?.resolution === 'create_new'
          ? 'create_new'
          : null

    if (!resolution) {
      return NextResponse.json(
        { error: 'resolution must be reuse_existing or create_new', code: 'INVALID_DUPLICATE_RESOLUTION' },
        { status: 400 }
      )
    }

    const details = await fundingIntakeService.getJobDetails(params.jobId, auth.operator)
    if (!details) {
      return NextResponse.json({ error: 'Funding import job not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    if (resolution === 'reuse_existing') {
      const fundingCallId = typeof body?.fundingCallId === 'string' ? body.fundingCallId : details.duplicates?.[0]?.candidate_funding_call_id
      if (!fundingCallId) {
        return NextResponse.json({ error: 'fundingCallId is required', code: 'MISSING_FUNDING_CALL' }, { status: 400 })
      }

      await prisma.fundingIntakeJob.update({
        where: { id: params.jobId },
        data: {
          status: 'draft_created',
          duplicate_status: 'resolved',
          linked_funding_call_id: fundingCallId,
          completed_at: new Date(),
        },
      })

      await prisma.fundingIntakeDuplicate.updateMany({
        where: { job_id: params.jobId },
        data: {
          resolution: 'ignored',
          resolved_by_user_id: auth.operator.userId,
          resolved_at: new Date(),
        },
      })
    } else {
      const duplicateResolutions = (details.duplicates || []).map((duplicate: any) => ({
        duplicateId: duplicate.id,
        resolution: 'create_new_anyway' as const,
      }))

      await fundingIntakeService.createOrUpdateDraft(
        params.jobId,
        details.draftValues,
        auth.operator,
        duplicateResolutions,
        false
      )
    }

    const refreshed = await fundingIntakeService.getJobDetails(params.jobId, auth.operator)
    return NextResponse.json({ job: refreshed ? toFundingImportJobView(refreshed) : null })
  } catch (error) {
    console.error('[Funding/Imports/:jobId/resolve-duplicate] POST error:', error)
    return NextResponse.json({ error: 'Failed to resolve funding import duplicate' }, { status: 500 })
  }
}
