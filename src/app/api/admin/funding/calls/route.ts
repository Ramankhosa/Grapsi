export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { catalogFacets, parseCatalogSearch } from '@/lib/funding/catalogSearch'
import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingPublicationService } from '@/lib/researcherProfile/funding-publications'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

async function catalogueGET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const search = parseCatalogSearch(request.nextUrl.searchParams)
    const [
      { calls, total },
      facets,
      coverage,
      embeddingHealth,
      researchAreaCoverage,
      researcherProfileCoverage,
      fundingPublicationCoverage,
    ] = await Promise.all([
      fundingCatalogService.searchFundingCalls(search),
      catalogFacets(search),
      fundingCatalogService.getEmbeddingCoverageSummary(),
      Promise.resolve(fundingCatalogService.getEmbeddingServiceHealth()),
      researcherProfileService.getResearchAreaEmbeddingCoverage(),
      researcherProfileService.getResearcherProfileEmbeddingCoverage(),
      fundingPublicationService.getEmbeddingCoverage(),
    ])
    return NextResponse.json({
      calls,
      page: search.page, total, pageSize: search.pageSize,
      facets,
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

export const GET = withCatalogueProtection(catalogueGET, 'summary', 'FUNDING_DISCOVERY')
