import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import type { FinderTurnStreamEvent } from '@/lib/recommendations/chatTypes'
import { conversationMessageRequestSchema } from '@/lib/recommendations/messageSchema'
import {
  enforceChatRateLimit,
  requireRecommendationTenantUser,
  toRecommendationAccessScope,
} from '@/lib/recommendations/request-auth'
import { recommendationErrorEvent, recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { createRecommendationSSEResponse } from '@/lib/recommendations/sse'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SSE variant of the chat message route. Same auth, same rate-limit bucket, and same
 * request schema as the classic POST — but emits progress events and narrative tokens
 * while the turn is processed, then a `final` event carrying the exact classic response.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  // Same per-user bucket as the classic route and the filter routes.
  const limited = enforceChatRateLimit(auth.userId)
  if (limited) return limited

  let parsed: z.infer<typeof conversationMessageRequestSchema>
  try {
    parsed = conversationMessageRequestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return recommendationErrorResponse(error, 'Invalid chat message payload')
    }
    return NextResponse.json({ error: 'Invalid chat message payload', code: 'INVALID_REQUEST' }, { status: 400 })
  }

  return createRecommendationSSEResponse(
    async (send, signal) => {
      let turnPersisted = false
      const emit = (event: FinderTurnStreamEvent) => {
        if (event.type === 'turn') {
          turnPersisted = true
        }
        send(event.type, event)
      }

      try {
        const response = await recommendationConversationService.processMessage(
          auth.userId,
          auth.tenantId,
          params.id,
          parsed,
          toRecommendationAccessScope(auth.actor),
          emit,
          signal
        )
        send('final', { type: 'final', response })
      } catch (error) {
        send('error', recommendationErrorEvent(error, turnPersisted, 'Failed to process recommendation message'))
      }
    },
    { signal: request.signal }
  )
}
