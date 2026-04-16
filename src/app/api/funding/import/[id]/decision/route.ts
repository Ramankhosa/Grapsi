import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { fundingIntakeService } from '@/lib/fundingIntake/service'
import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

const decisionSchema = z.object({
  action: z.enum(['use_existing', 'create_private_draft', 'cancel']),
  existingFundingCallId: z.string().optional(),
  draft: z.record(z.any()).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  const jobId = params.id
  if (!jobId) {
    return NextResponse.json({ message: 'Invalid import job id' }, { status: 400 })
  }

  try {
    const payload = decisionSchema.parse(await request.json())
    const details = await fundingIntakeService.getJobDetails(jobId, auth.operator)
    if (!details) {
      return NextResponse.json({ message: 'Funding import job not found' }, { status: 404 })
    }

    if (payload.action === 'cancel') {
      await prisma.fundingIntakeJob.update({
        where: { id: jobId },
        data: {
          status: 'canceled',
          completed_at: new Date(),
        },
      })
      return NextResponse.json({ status: 'canceled' })
    }

    if (payload.action === 'use_existing') {
      if (!payload.existingFundingCallId) {
        return NextResponse.json({ message: 'existingFundingCallId is required' }, { status: 400 })
      }

      const fundingCall = await prisma.fundingCall.findFirst({
        where: {
          AND: [{ id: payload.existingFundingCallId }, buildFundingCallAccessWhere(auth.actor)],
        },
        select: { id: true },
      })

      if (!fundingCall) {
        return NextResponse.json({ message: 'Funding call is not accessible' }, { status: 403 })
      }

      await prisma.fundingIntakeJob.update({
        where: { id: jobId },
        data: {
          status: 'draft_created',
          duplicate_status: 'resolved',
          linked_funding_call_id: payload.existingFundingCallId,
          completed_at: new Date(),
        },
      })

      return NextResponse.json({
        status: 'linked_existing',
        fundingCallId: payload.existingFundingCallId,
      })
    }

    const duplicateResolutions = details.duplicates
      .filter((duplicate: any) => duplicate.resolution === 'pending')
      .map((duplicate: any) => ({
        duplicateId: duplicate.id,
        resolution: 'create_new_anyway' as const,
      }))

    const result = await fundingIntakeService.createOrUpdateDraft(
      jobId,
      payload.draft || details.draftValues,
      auth.operator,
      duplicateResolutions,
      false
    )

    if (!result.ok && result.reason === 'duplicate_resolution_required') {
      return NextResponse.json(result, { status: 409 })
    }

    if (!result.ok && result.reason === 'missing_required_fields') {
      return NextResponse.json(result, { status: 400 })
    }

    const successResult = result as any

    return NextResponse.json({
      status: 'private_draft_created',
      fundingCallId: successResult.fundingCallId,
      guidelineStatus: successResult.guidelineStatus ?? null,
      guidelineRunId: successResult.guidelineRunId ?? null,
      guidelineExtractionError: successResult.guidelineExtractionError ?? null,
      templateStatus: successResult.templateStatus ?? null,
      templateRunId: successResult.templateRunId ?? null,
      templateAssetId: successResult.templateAssetId ?? null,
      templateExtractionError: successResult.templateExtractionError ?? null,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid decision payload', issues: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to resolve funding import' },
      { status: 500 }
    )
  }
}
