import { NextRequest, NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import { requireFundingActor } from '@/lib/funding/access'

type AuthResult =
  | { actor: FundingActor; userId: string }
  | { response: NextResponse }

export async function requireRecommendationUser(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) {
    return auth
  }

  return {
    actor: auth.actor,
    userId: auth.actor.id,
  }
}
