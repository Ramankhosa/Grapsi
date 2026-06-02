import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string } }
) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const batch = await fundingIntakeService.getBatchDetails(params.batchId)
    if (!batch) {
      return NextResponse.json({ message: 'Funding intake batch not found' }, { status: 404 })
    }

    return NextResponse.json({ batch })
  } catch (error) {
    console.error('[Funding Intake Batch] details error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funding intake batch' },
      { status: 500 }
    )
  }
}
