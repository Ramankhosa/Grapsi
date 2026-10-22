export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

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
    const status = request.nextUrl.searchParams.get('status') as any
    const page = Math.max(1,Math.floor(Number(request.nextUrl.searchParams.get('page'))||1))
    const total = await prisma.fundingCall.count({where:{NOT:{visibility:'GLOBAL_CATALOG'},...(status && status!=='ALL'?{catalog_status:status}:{})}})
    const [
      calls,
      coverage,
      embeddingHealth,
      researchAreaCoverage,
      researcherProfileCoverage,
      fundingPublicationCoverage,
    ] = await Promise.all([
      fundingCatalogService.listFundingCalls(status && status !== 'ALL' ? status : null,{page,pageSize:50}),
      fundingCatalogService.getEmbeddingCoverageSummary(),
      Promise.resolve(fundingCatalogService.getEmbeddingServiceHealth()),
      researcherProfileService.getResearchAreaEmbeddingCoverage(),
      researcherProfileService.getResearcherProfileEmbeddingCoverage(),
      fundingPublicationService.getEmbeddingCoverage(),
    ])
    return NextResponse.json({
      calls,
      page,total,pageSize:50,
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
