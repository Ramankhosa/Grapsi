export const dynamic = 'force-dynamic'
import { directoryFilterSchema as filterSchema } from '@/lib/recommendations/directorySchema'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { RECOMMENDATION_SORT_OPTIONS } from '@/lib/recommendations/constants'
import { requireRecommendationUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { validateNormalizedControlledFilters } from '@/lib/recommendations/utils'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'

export const runtime = 'nodejs'


const requestSchema = z.object({
  query: z.string().max(300).optional(),
  filters: filterSchema,
})

async function cataloguePOST(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json())
    const validationError = validateNormalizedControlledFilters(parsed.filters || {})
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const result = await recommendationSearchService.getDirectoryFacets({
      query: parsed.query,
      filters: parsed.filters,
      access: toRecommendationAccessScope(auth.actor),
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

export const POST = withCatalogueProtection(cataloguePOST, 'metadata', 'FUNDING_DISCOVERY')
