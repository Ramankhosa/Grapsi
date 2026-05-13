import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  const id = params.id
  if (!id) {
    return NextResponse.json({ message: 'Invalid job id' }, { status: 400 })
  }

  try {
    await fundingIntakeService.maybeResume(id)
    const details = await fundingIntakeService.getJobDetails(id, auth.operator)
    if (!details) {
      return NextResponse.json({ message: 'Funding intake job not found' }, { status: 404 })
    }

    return NextResponse.json(details)
  } catch (error) {
    console.error('[Funding Intake] get job error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funding intake job' },
      { status: 500 }
    )
  }
}
