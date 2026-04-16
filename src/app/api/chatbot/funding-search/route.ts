import { NextRequest, NextResponse } from 'next/server'

import { requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'
import type { RecommendationSearchRequest } from '@/lib/recommendations/types'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await requireFundingImporterRequest(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const body = await request.json()
    const { query, filters } = body as {
      query?: string
      filters?: {
        countries?: string[]
        applicantTypes?: string[]
        grantTypes?: string[]
        includeExpired?: boolean
        limit?: number
      }
    }

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required and must be a string' }, { status: 400 })
    }

    const searchRequest: RecommendationSearchRequest = {
      inputMode: 'research_area',
      query: { researchArea: query },
      filters: {
        eligibleCountries: filters?.countries || [],
        institutionTypes: filters?.applicantTypes || [],
        fundingKinds: filters?.grantTypes || [],
        includeExpired: Boolean(filters?.includeExpired),
        limit: filters?.limit || 5,
      },
    }

    const searchResult = await recommendationSearchService.search(searchRequest)
    const formattedResults = searchResult.rawResults.map((call) => ({
      id: call.id,
      agencyName: call.agencyName,
      schemeTitle: call.schemeTitle,
      description: call.fullDescription || call.shortDescription || call.description,
      deadline: call.closeDate,
      fundingAmount:
        call.amountMin !== null || call.amountMax !== null
          ? `${call.currency || ''} ${call.amountMin ?? ''}${call.amountMax !== null ? ` - ${call.amountMax}` : ''}`.trim()
          : null,
      eligibility: call.eligibilityText || call.eligibilitySummary,
      researchAreas: call.disciplines,
      urls: call.officialUrls,
      score: call.score,
    }))

    return NextResponse.json({
      results: formattedResults,
      totalResults: formattedResults.length,
      degradedMode: searchResult.degradedMode,
      noResultsReason: searchResult.noResultsReason,
      relaxationSuggestions: searchResult.relaxationSuggestions,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to search funding calls',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
