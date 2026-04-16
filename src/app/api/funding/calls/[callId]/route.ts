import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { toFundingCallDetail, toFundingImportJobView } from '@/lib/fundingIntake/compat'
import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const call = await prisma.fundingCall.findFirst({
      where: {
        AND: [{ id: params.callId }, buildFundingCallAccessWhere(auth.actor)],
      },
    })

    if (!call) {
      return NextResponse.json({ error: 'Funding call not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const recentJobRows = await prisma.fundingIntakeJob.findMany({
      where: { linked_funding_call_id: call.id },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true },
    })

    const recentJobDetails = await Promise.all(
      recentJobRows.map((job) => fundingIntakeService.getJobDetails(job.id, auth.operator))
    )

    return NextResponse.json({
      call: toFundingCallDetail(call, {
        recentJobs: recentJobDetails.filter(Boolean).map((detail) => toFundingImportJobView(detail)),
      }),
    })
  } catch (error) {
    console.error('[Funding/Calls/:callId] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch funding call' }, { status: 500 })
  }
}
