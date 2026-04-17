import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

type BackfillTarget = 'funding_calls' | 'research_areas' | 'all'

export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json().catch(() => ({}))
    const target = (body?.target || 'funding_calls') as BackfillTarget
    const limit = Number(body?.limit || 25)
    const cappedLimit = Math.max(1, Math.min(limit, 100))

    const funding =
      target === 'funding_calls' || target === 'all'
        ? await fundingCatalogService.backfillPublishedEmbeddings(cappedLimit)
        : null

    const researchAreas =
      target === 'research_areas' || target === 'all'
        ? await researcherProfileService.backfillResearchAreaEmbeddings(cappedLimit)
        : null

    return NextResponse.json({
      ok: true,
      target,
      funding,
      researchAreas,
      coverage: await fundingCatalogService.getEmbeddingCoverageSummary(),
      embeddingHealth: fundingCatalogService.getEmbeddingServiceHealth(),
      researchAreaCoverage: await researcherProfileService.getResearchAreaEmbeddingCoverage(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to backfill embeddings',
      },
      { status: 500 }
    )
  }
}
