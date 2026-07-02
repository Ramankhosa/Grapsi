import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { fundingDocumentService } from '@/lib/fundingDocuments/service'
import { fundingPublicationService } from '@/lib/researcherProfile/funding-publications'
import { fundingCatalogService } from '@/lib/services/fundingCatalogService'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

type BackfillTarget = 'funding_calls' | 'funding_documents' | 'research_areas' | 'researcher_profiles' | 'funding_publications' | 'all'

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

    const fundingDocuments =
      target === 'funding_documents' || target === 'all'
        ? await fundingDocumentService.backfillDocumentEmbeddings(cappedLimit)
        : null

    const researcherProfiles =
      target === 'researcher_profiles' || target === 'all'
        ? await researcherProfileService.backfillResearcherProfileEmbeddings(cappedLimit)
        : null

    const fundingPublications =
      target === 'funding_publications' || target === 'all'
        ? await fundingPublicationService.backfillEmbeddings(cappedLimit)
        : null

    return NextResponse.json({
      ok: true,
      target,
      funding,
      fundingDocuments,
      researchAreas,
      researcherProfiles,
      fundingPublications,
      coverage: await fundingCatalogService.getEmbeddingCoverageSummary(),
      embeddingHealth: fundingCatalogService.getEmbeddingServiceHealth(),
      fundingDocumentEmbeddingHealth: fundingDocumentService.getEmbeddingHealth(),
      researchAreaCoverage: await researcherProfileService.getResearchAreaEmbeddingCoverage(),
      researcherProfileCoverage: await researcherProfileService.getResearcherProfileEmbeddingCoverage(),
      fundingPublicationCoverage: await fundingPublicationService.getEmbeddingCoverage(),
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
