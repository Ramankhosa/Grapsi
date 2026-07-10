import { NextRequest, NextResponse } from 'next/server'

import { requireFundingPublisherRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json().catch(() => ({}))
    const batchId =
      typeof body?.batchId === 'string' && body.batchId.trim() ? body.batchId.trim() : undefined

    const result = await fundingCatalogService.bulkPublishReadyFundingCalls(auth.operator, { batchId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to bulk publish funding calls' },
      { status: 500 }
    )
  }
}
