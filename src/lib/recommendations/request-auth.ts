import { NextRequest, NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import { requireFundingActor } from '@/lib/funding/access'
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

export function toRecommendationAccessScope(actor: FundingActor): RecommendationAccessScope {
  return {
    tenantId: actor.tenantId,
    isSuperAdmin: actor.isSuperAdmin,
  }
}
