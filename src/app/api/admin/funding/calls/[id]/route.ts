export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { expectedReviewSchema, MonitorConflictError } from '@/lib/monitor/writeGuard'

export const runtime = 'nodejs'

async function catalogueGET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingReadOperatorRequest(request)
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

async function cataloguePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = await request.json()
    const { expectedReview, ...values } = payload
    const details = await fundingCatalogService.updateFundingCall(params.id, values, auth.operator, expectedReview === undefined ? undefined : expectedReviewSchema.parse(expectedReview))
    return NextResponse.json(details)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update funding call' },
      { status: error instanceof MonitorConflictError ? 409 : 400 }
    )
  }
}

export const GET = withCatalogueProtection(catalogueGET, 'detail', 'FUNDING_DISCOVERY')

export const PATCH = withCatalogueProtection(cataloguePATCH, 'detail', 'FUNDING_DISCOVERY')
