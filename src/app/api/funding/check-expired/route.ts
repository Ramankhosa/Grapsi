import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const archivedCount = await fundingCatalogService.archiveExpiredPublishedCalls()
    return NextResponse.json({ archivedCount })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to archive expired funding calls' },
      { status: 500 }
    )
  }
}
