import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingPublicationService } from '@/lib/researcherProfile/funding-publications'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const status = request.nextUrl.searchParams.get('status') as any
    const [
      calls,
      coverage,
      embeddingHealth,
      researchAreaCoverage,
      researcherProfileCoverage,
      fundingPublicationCoverage,
    ] = await Promise.all([
      fundingCatalogService.listFundingCalls(status && status !== 'ALL' ? status : null),
      fundingCatalogService.getEmbeddingCoverageSummary(),
      Promise.resolve(fundingCatalogService.getEmbeddingServiceHealth()),
      researcherProfileService.getResearchAreaEmbeddingCoverage(),
      researcherProfileService.getResearcherProfileEmbeddingCoverage(),
      fundingPublicationService.getEmbeddingCoverage(),
    ])
    return NextResponse.json({
      calls,
      coverage,
      embeddingHealth,
      researchAreaCoverage,
      researcherProfileCoverage,
      fundingPublicationCoverage,
    })
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to load funding catalog',
      },
      { status: 500 }
    )
  }
}
