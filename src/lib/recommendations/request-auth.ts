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

export async function requireRecommendationTenantUser(request: NextRequest): Promise<TenantAuthResult> {
  const auth = await requireRecommendationUser(request)
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
