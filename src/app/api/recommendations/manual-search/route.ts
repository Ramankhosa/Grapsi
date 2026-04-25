import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  RECOMMENDATION_SORT_OPTIONS,
} from '@/lib/recommendations/constants'
import { checkRateLimit } from '@/lib/recommendations/rateLimit'
import { requireRecommendationUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import type { RecommendationDirectoryRequest } from '@/lib/recommendations/types'
import { summarizeFilters, validateNormalizedControlledFilters } from '@/lib/recommendations/utils'
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
  page: z.number().int().min(1).optional(),
  filters: filterSchema,
})

function getRequestIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return request.headers.get('x-real-ip') || 'unknown'
}

export async function POST(request: NextRequest) {
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

    const userKey = `${auth.userId}:${getRequestIp(request)}:manual`
    const rateLimit = checkRateLimit(userKey, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many manual funding searches. Please wait and try again.',
          resetAt: new Date(rateLimit.resetAt).toISOString(),
        },
        { status: 429 }
      )
    }

    console.info('[Manual Funding Search]', {
      mode: 'manual_directory',
      filters: summarizeFilters(parsed.filters || {}),
      limit: parsed.filters?.limit || 24,
      hasQuery: Boolean(parsed.query?.trim()),
    })

    const result = await recommendationSearchService.browseDirectory({
      query: parsed.query,
      page: parsed.page,
      access: toRecommendationAccessScope(auth.actor),
      filters: {
        ...parsed.filters,
        limit: parsed.filters?.limit || 8,
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
