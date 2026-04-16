import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingIntakeService } from '@/lib/fundingIntake/service'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    await fundingIntakeService.retryJob(params.id, auth.operator)
    return NextResponse.json({ ok: true, status: 'queued' })
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to retry funding intake job' },
      { status: 500 }
    )
  }
}
