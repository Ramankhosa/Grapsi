import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationTenantUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const requestSchema = z.object({
  useProfileContext: z.boolean().optional(),
  useEligibilityProfile: z.boolean().optional(),
  usePublicationContext: z.boolean().optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json().catch(() => ({})))
    const conversation = await recommendationConversationService.resetFilters(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    return NextResponse.json({ conversation })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to reset conversation filters',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
