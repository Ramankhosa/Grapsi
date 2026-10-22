export const dynamic = 'force-dynamic'
import { directoryFilterSchema as filterSchema } from '@/lib/recommendations/directorySchema'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import type { RecommendationDirectoryRequest, RecommendationPreferenceFlags, RecommendationProfileSnapshot } from '@/lib/recommendations/types'
import { summarizeFilters, validateNormalizedControlledFilters } from '@/lib/recommendations/utils'
import { recommendationSearchService } from '@/lib/services/recommendationSearchService'
import { buildRecommendationPreferenceSnapshot } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'


const requestSchema = z.object({
  query: z.string().max(300).optional(),
  page: z.number().int().min(1).optional(),
  filters: filterSchema,
  useProfileContext: z.boolean().optional(),
  useEligibilityProfile: z.boolean().optional(),
  usePublicationContext: z.boolean().optional(),
})

async function cataloguePOST(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json()) as RecommendationDirectoryRequest
    const validationError = validateNormalizedControlledFilters(parsed.filters || {})
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    console.info('[Manual Funding Search]', {
      mode: 'manual_directory',
      filters: summarizeFilters(parsed.filters || {}),
      limit: parsed.filters?.limit || 12,
      hasQuery: Boolean(parsed.query?.trim()),
    })

    const preferences: RecommendationPreferenceFlags = {
      useEligibilityProfile: parsed.useEligibilityProfile === true || parsed.useProfileContext === true,
      usePublicationContext: parsed.usePublicationContext === true,
    }

    let profileContext: RecommendationProfileSnapshot | null = null
    if (preferences.useEligibilityProfile || preferences.usePublicationContext) {
      try {
        profileContext = await buildRecommendationPreferenceSnapshot(auth.userId, preferences)
      } catch {
        profileContext = null
      }
    }

    const result = await recommendationSearchService.browseDirectory({
      query: parsed.query,
      page: parsed.page,
      access: toRecommendationAccessScope(auth.actor),
      profileContext,
      useProfileContext: Boolean(profileContext),
      useEligibilityProfile: preferences.useEligibilityProfile,
      usePublicationContext: preferences.usePublicationContext,
      filters: {
        ...parsed.filters,
        limit: parsed.filters?.limit || 12,
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid manual search request', details: error.flatten() },
        { status: 400 }
      )
    }

    console.error('Manual recommendation search error:', error)
    return NextResponse.json(
      {
        error: 'Failed to load funding directory',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'summary', 'FUNDING_DISCOVERY')
