import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService'
import type { FinderTurnStreamEvent } from '@/lib/recommendations/chatTypes'
import { CHAT_RATE_LIMIT_MAX_REQUESTS, CHAT_RATE_LIMIT_WINDOW_MS } from '@/lib/recommendations/constants'
import { conversationMessageRequestSchema } from '@/lib/recommendations/messageSchema'
import { checkRateLimit } from '@/lib/recommendations/rateLimit'
import { requireRecommendationTenantUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { createRecommendationSSEResponse } from '@/lib/recommendations/sse'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getRequestIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return request.headers.get('x-real-ip') || 'unknown'
}

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

  // The rate-limit key intentionally matches the classic route so both share one bucket.
  const rateLimit = checkRateLimit(
    `${auth.userId}:${getRequestIp(request)}:chat:${params.id}`,
    CHAT_RATE_LIMIT_MAX_REQUESTS,
    CHAT_RATE_LIMIT_WINDOW_MS
  )
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many funding chat messages. Please wait and try again.',
        code: 'RATE_LIMITED',
        resetAt: new Date(rateLimit.resetAt).toISOString(),
      },
      { status: 429 }
    )
  }

  let parsed: z.infer<typeof conversationMessageRequestSchema>
  try {
    parsed = conversationMessageRequestSchema.parse(await request.json())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid chat message payload', details: error.flatten() },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Invalid chat message payload' }, { status: 400 })
  }

  return createRecommendationSSEResponse(async (send) => {
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
        emit
      )
      send('final', { type: 'final', response })
    } catch (error) {
      if (isGeminiRateLimitErrorLike(error)) {
        const retryAfterMs = getGeminiRetryAfterMs(error)
        send('error', {
          type: 'error',
          error: 'AI service is temporarily rate limited. Please retry shortly.',
          code: 'GEMINI_RATE_LIMITED',
          retryAfterMs: retryAfterMs ?? null,
          persisted: turnPersisted,
        })
        return
      }

      send('error', {
        type: 'error',
        error: error instanceof Error ? error.message : 'Failed to process recommendation message',
        code: 'INTERNAL',
        persisted: turnPersisted,
      })
    }
  })
}
