import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getGeminiRetryAfterMs, isGeminiRateLimitErrorLike } from '@/lib/geminiService'
import { RecommendationConversationError } from '@/lib/recommendations/errors'
import { ServiceQuotaExceededError } from '@/lib/service-usage-tracker'

export {
  RecommendationConversationError,
  conversationNotFound,
  noPendingPatch,
  pendingPatchStale,
} from '@/lib/recommendations/errors'

export type RecommendationErrorCode =
  | 'INVALID_REQUEST'
  | 'CONVERSATION_NOT_FOUND'
  | 'NO_PENDING_PATCH'
  | 'PENDING_PATCH_STALE'
  | 'QUOTA_EXCEEDED'
  | 'GEMINI_RATE_LIMITED'
  | 'RATE_LIMITED'
  | 'INTERNAL'

export const QUOTA_EXCEEDED_MESSAGE =
  'You have used up your funding chat allowance for now. Please try again later or contact your administrator.'
export const GEMINI_RATE_LIMITED_MESSAGE = 'AI service is temporarily rate limited. Please retry shortly.'

type ClassifiedError = {
  status: number
  code: string
  error: string
  retryAfterMs?: number | null
  quotaCode?: string
  details?: unknown
}

/**
 * Single classifier shared by the JSON routes and the SSE route. Anything that
 * is not one of the known shapes becomes an opaque INTERNAL error — the real
 * cause is logged server-side, never returned to the client.
 */
export function classifyRecommendationError(error: unknown, fallbackMessage: string): ClassifiedError {
  if (error instanceof z.ZodError) {
    return { status: 400, code: 'INVALID_REQUEST', error: 'Invalid request payload', details: error.flatten() }
  }

  if (error instanceof RecommendationConversationError) {
    return { status: error.status, code: error.code, error: error.message }
  }

  if (error instanceof ServiceQuotaExceededError) {
    return { status: 429, code: 'QUOTA_EXCEEDED', error: QUOTA_EXCEEDED_MESSAGE, quotaCode: error.code }
  }

  if (isGeminiRateLimitErrorLike(error)) {
    return {
      status: 429,
      code: 'GEMINI_RATE_LIMITED',
      error: GEMINI_RATE_LIMITED_MESSAGE,
      retryAfterMs: getGeminiRetryAfterMs(error) ?? null,
    }
  }

  console.error(`[recommendations] ${fallbackMessage}:`, error)
  return { status: 500, code: 'INTERNAL', error: fallbackMessage }
}

export function recommendationErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  const classified = classifyRecommendationError(error, fallbackMessage)
  const body: Record<string, unknown> = { error: classified.error, code: classified.code }
  if (classified.details !== undefined) body.details = classified.details
  if (classified.quotaCode) body.quotaCode = classified.quotaCode
  if (classified.retryAfterMs !== undefined) body.retryAfterMs = classified.retryAfterMs

  const headers: Record<string, string> = {}
  if (classified.retryAfterMs) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(classified.retryAfterMs / 1000)))
  }

  return NextResponse.json(body, { status: classified.status, headers })
}

/** SSE `error` event payload for the streaming chat route. */
export function recommendationErrorEvent(error: unknown, persisted: boolean, fallbackMessage: string) {
  const classified = classifyRecommendationError(error, fallbackMessage)
  return {
    type: 'error' as const,
    error: classified.error,
    code: classified.code as RecommendationErrorCode,
    retryAfterMs: classified.retryAfterMs ?? null,
    ...(classified.quotaCode ? { quotaCode: classified.quotaCode } : {}),
    persisted,
  }
}
