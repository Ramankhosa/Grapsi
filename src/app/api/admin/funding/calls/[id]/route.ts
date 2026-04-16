import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const details = await fundingCatalogService.getFundingCallDetails(params.id)
    return NextResponse.json(details)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funding call' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = await request.json()
    const details = await fundingCatalogService.updateFundingCall(params.id, payload, auth.operator)
    return NextResponse.json(details)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update funding call' },
      { status: 500 }
    )
  }
}
