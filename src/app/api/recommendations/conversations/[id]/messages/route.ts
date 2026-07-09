import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService'
import { CHAT_RATE_LIMIT_MAX_REQUESTS, CHAT_RATE_LIMIT_WINDOW_MS } from '@/lib/recommendations/constants'
import { conversationMessageRequestSchema } from '@/lib/recommendations/messageSchema'
import { checkRateLimit } from '@/lib/recommendations/rateLimit'
import { requireRecommendationTenantUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const requestSchema = conversationMessageRequestSchema

function getRequestIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return request.headers.get('x-real-ip') || 'unknown'
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const rateLimit = checkRateLimit(
      `${auth.userId}:${getRequestIp(request)}:chat:${params.id}`,
      CHAT_RATE_LIMIT_MAX_REQUESTS,
      CHAT_RATE_LIMIT_WINDOW_MS
    )
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many funding chat messages. Please wait and try again.',
          resetAt: new Date(rateLimit.resetAt).toISOString(),
        },
        { status: 429 }
      )
    }

    const parsed = requestSchema.parse(await request.json())
    const response = await recommendationConversationService.processMessage(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid chat message payload', details: error.flatten() },
        { status: 400 }
      )
    }

    if (isGeminiRateLimitErrorLike(error)) {
      const retryAfterMs = getGeminiRetryAfterMs(error)
      return NextResponse.json(
        {
          error: 'AI service is temporarily rate limited. Please retry shortly.',
          code: 'GEMINI_RATE_LIMITED',
          retryAfterMs: retryAfterMs ?? null,
        },
        {
          status: 429,
          headers: retryAfterMs
            ? { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }
            : undefined,
        }
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
