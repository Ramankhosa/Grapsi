export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { requireFundingPublisherRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { expectedReviewSchema, MonitorConflictError } from '@/lib/monitor/writeGuard'

export const runtime = 'nodejs'

async function cataloguePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = await request.json().catch(() => ({}))
    const details = await fundingCatalogService.publishFundingCall(params.id, auth.operator, payload.expectedReview === undefined ? undefined : expectedReviewSchema.parse(payload.expectedReview))
    return NextResponse.json(details)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to publish funding call' },
      { status: error instanceof MonitorConflictError ? 409 : 400 }
    )
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'detail', 'FUNDING_DISCOVERY')
