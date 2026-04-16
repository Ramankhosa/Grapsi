import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const status = request.nextUrl.searchParams.get('status') as any
    const calls = await fundingCatalogService.listFundingCalls(status && status !== 'ALL' ? status : null)
    return NextResponse.json({ calls })
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to load funding catalog',
      },
      { status: 500 }
    )
  }
}
