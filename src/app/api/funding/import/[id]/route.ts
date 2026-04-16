import { NextRequest, NextResponse } from 'next/server'

import { fundingIntakeService } from '@/lib/fundingIntake/service'
import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

export async function GET(
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
    await fundingIntakeService.maybeResume(jobId)
    const details = await fundingIntakeService.getJobDetails(jobId, auth.operator)
    if (!details) {
      return NextResponse.json({ message: 'Funding import job not found' }, { status: 404 })
    }

    return NextResponse.json(details)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funding import job' },
      { status: 500 }
    )
  }
}
