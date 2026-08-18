import { NextRequest, NextResponse } from 'next/server'

import { conversationContextFlagsSchema, conversationMessageFilterSchema } from '@/lib/recommendations/messageSchema'
import {
  enforceChatRateLimit,
  requireRecommendationTenantUser,
  toRecommendationAccessScope,
} from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const requestSchema = conversationContextFlagsSchema.extend({
  filters: conversationMessageFilterSchema,
})

/**
 * Direct filter manipulation from the UI. Deliberately separate from the chat
 * message endpoint: applying or removing a filter must not post a user message
 * or trigger any narrative LLM call. It still runs an embedding + search, so it
 * shares the per-user chat rate bucket (but is not metered against quota).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  const limited = enforceChatRateLimit(auth.userId)
  if (limited) return limited

  try {
    const parsed = requestSchema.parse(await request.json())
    const response = await recommendationConversationService.applyFilters(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    return NextResponse.json(response)
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to update conversation filters')
  }
}
