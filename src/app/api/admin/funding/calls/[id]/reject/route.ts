export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { requireFundingPublisherRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'

export const runtime = 'nodejs'

async function cataloguePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const details = await fundingCatalogService.rejectFundingCall(params.id, auth.operator)
    return NextResponse.json(details)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to reject funding call' },
      { status: 500 }
    )
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'detail', 'FUNDING_DISCOVERY')
