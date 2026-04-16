import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import type { RecommendationSearchFilters } from '@/lib/recommendations/types'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const filterSchema: z.ZodType<RecommendationSearchFilters> = z.object({
  geographyScope: z.array(z.string()).optional(),
  eligibleCountries: z.array(z.string()).optional(),
  eligibleRegions: z.array(z.string()).optional(),
  hostCountries: z.array(z.string()).optional(),
  funderCountries: z.array(z.string()).optional(),
  fundingKinds: z.array(z.string()).optional(),
  institutionTypes: z.array(z.string()).optional(),
  careerStages: z.array(z.string()).optional(),
  citizenshipRequirements: z.array(z.string()).optional(),
  residencyRequirements: z.array(z.string()).optional(),
  applicationLanguages: z.array(z.string()).optional(),
  sponsorTypes: z.array(z.string()).optional(),
  deadlineFrom: z.string().optional(),
  deadlineTo: z.string().optional(),
  rollingOnly: z.boolean().optional(),
  amountMin: z.number().nullable().optional(),
  amountMax: z.number().nullable().optional(),
  includeExpired: z.boolean().optional(),
  limit: z.number().int().optional(),
  sort: z.enum(['best_match', 'deadline_soonest']).optional(),
})

const requestSchema = z.object({
  message: z.string().max(800).optional(),
  clientTurnId: z.string().max(120).optional(),
  inputMode: z.enum(['research_area', 'paper_metadata']).optional(),
  manualQueryPatch: z.record(z.any()).optional(),
  manualFilterPatch: filterSchema.optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json())
    const response = await recommendationConversationService.processMessage(auth.userId, params.id, parsed)
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid chat message payload', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to process recommendation message',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
