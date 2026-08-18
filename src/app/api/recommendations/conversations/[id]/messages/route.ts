import { NextRequest, NextResponse } from 'next/server'

import { conversationMessageRequestSchema } from '@/lib/recommendations/messageSchema'
import {
  enforceChatRateLimit,
  requireRecommendationTenantUser,
  toRecommendationAccessScope,
} from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  // Same per-user bucket as the SSE route and the filter routes.
  const limited = enforceChatRateLimit(auth.userId)
  if (limited) return limited

  try {
    const parsed = conversationMessageRequestSchema.parse(await request.json())
    const response = await recommendationConversationService.processMessage(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    return NextResponse.json(response)
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to process recommendation message')
  }
}
