import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { RECOMMENDATION_SORT_OPTIONS } from '@/lib/recommendations/constants'
import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'

export const runtime = 'nodejs'

const filterSchema = z.object({
  geographyScope: z.array(z.string()).max(20).optional(),
  eligibleCountries: z.array(z.string()).max(20).optional(),
  eligibleRegions: z.array(z.string()).max(20).optional(),
  hostCountries: z.array(z.string()).max(20).optional(),
  funderCountries: z.array(z.string()).max(20).optional(),
  fundingKinds: z.array(z.string()).max(20).optional(),
  institutionTypes: z.array(z.string()).max(20).optional(),
  careerStages: z.array(z.string()).max(20).optional(),
  citizenshipRequirements: z.array(z.string()).max(20).optional(),
  residencyRequirements: z.array(z.string()).max(20).optional(),
  applicationLanguages: z.array(z.string()).max(20).optional(),
  sponsorTypes: z.array(z.string()).max(20).optional(),
  deadlineFrom: z.string().optional(),
  deadlineTo: z.string().optional(),
  rollingOnly: z.boolean().optional(),
  amountMin: z.number().nullable().optional(),
  amountMax: z.number().nullable().optional(),
  includeExpired: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  sort: z.enum(RECOMMENDATION_SORT_OPTIONS).optional(),
}).optional()

const requestSchema = z.object({
  query: z.string().max(300).optional(),
  filters: filterSchema,
})

export async function POST(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json())
    const result = await recommendationSearchService.getDirectoryFacets({
      query: parsed.query,
      filters: parsed.filters,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid facet request', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to load directory facets',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
