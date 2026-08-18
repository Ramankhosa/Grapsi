import { NextRequest, NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import { requireFundingActor } from '@/lib/funding/access'
import {
  CHAT_CREATE_RATE_LIMIT_MAX_REQUESTS,
  CHAT_CREATE_RATE_LIMIT_WINDOW_MS,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from '@/lib/recommendations/constants'
import { buildFinderRateLimitKey, checkRateLimit } from '@/lib/recommendations/rateLimit'
import type { RecommendationAccessScope } from '@/lib/recommendations/types'

type AuthResult =
  | { actor: FundingActor; userId: string; tenantId: string | null }
  | { response: NextResponse }

type TenantAuthResult =
  | { actor: FundingActor; userId: string; tenantId: string }
  | { response: NextResponse }

export async function requireRecommendationUser(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) {
    return auth
  }

  return {
    actor: auth.actor,
    userId: auth.actor.id,
    tenantId: auth.actor.tenantId,
  }
}

/**
 * Auth for the AI funding chatbot (conversational recommendations). Enforces the
 * FUNDING_CHAT module (Pro tier) rather than the plain funding directory, so
 * Starter tenants can browse the directory but not use the chatbot.
 */
export async function requireRecommendationChatUser(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requiredServiceType: 'FUNDING_CHAT',
  })
  if ('response' in auth) {
    return auth
  }

  return {
    actor: auth.actor,
    userId: auth.actor.id,
    tenantId: auth.actor.tenantId,
  }
}

// Chatbot conversation routes are all tenant-scoped and gated on FUNDING_CHAT
// (Pro tier). Routed through the chat actor so Starter tenants are blocked.
export async function requireRecommendationTenantUser(request: NextRequest): Promise<TenantAuthResult> {
  const auth = await requireRecommendationChatUser(request)
  if ('response' in auth) {
    return auth
  }

  if (!auth.tenantId) {
    return {
      response: NextResponse.json(
        {
          error: 'A tenant-scoped account is required for recommendation conversations',
          code: 'TENANT_REQUIRED',
        },
        { status: 403 }
      ),
    }
  }

  return {
    actor: auth.actor,
    userId: auth.userId,
    tenantId: auth.tenantId,
  }
}

/**
 * Per-user rate limit for the finder chat. `chat` covers every route that runs a
 * search or an LLM call on a conversation; `create` covers conversation creation.
 * Returns the 429 response to send, or null when the request may proceed.
 */
export function enforceChatRateLimit(userId: string, bucket: 'chat' | 'create' = 'chat'): NextResponse | null {
  const rateLimit =
    bucket === 'create'
      ? checkRateLimit(
          buildFinderRateLimitKey('create', userId),
          CHAT_CREATE_RATE_LIMIT_MAX_REQUESTS,
          CHAT_CREATE_RATE_LIMIT_WINDOW_MS
        )
      : checkRateLimit(buildFinderRateLimitKey('chat', userId), CHAT_RATE_LIMIT_MAX_REQUESTS, CHAT_RATE_LIMIT_WINDOW_MS)

  if (rateLimit.allowed) return null

  return NextResponse.json(
    {
      error:
        bucket === 'create'
          ? 'Too many new funding chats. Please wait and try again.'
          : 'Too many funding chat requests. Please wait and try again.',
      code: 'RATE_LIMITED',
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))) },
    }
  )
}

export function toRecommendationAccessScope(actor: FundingActor): RecommendationAccessScope {
  return {
    tenantId: actor.tenantId,
    isSuperAdmin: actor.isSuperAdmin,
  }
}
