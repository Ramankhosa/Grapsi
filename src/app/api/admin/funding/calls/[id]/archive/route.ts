import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const details = await fundingCatalogService.archiveFundingCall(params.id, auth.operator)
    return NextResponse.json(details)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to archive funding call' },
      { status: 500 }
    )
  }
}
