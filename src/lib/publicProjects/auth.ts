import { NextRequest, NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import { requireFundingActor } from '@/lib/funding/access'

type AuthResult = { actor: FundingActor; user: any } | { response: NextResponse }

export async function requirePublicProjectReadRequest(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) {
    return auth
  }

  if (!auth.actor.roles.includes('SUPER_ADMIN') && !auth.actor.roles.includes('SUPER_ADMIN_VIEWER')) {
    return {
      response: NextResponse.json(
        { error: 'Super Admin access required', message: 'Super Admin access required' },
        { status: 403 }
      ),
    }
  }

  return auth
}

export async function requirePublicProjectWriteRequest(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
  })
  if ('response' in auth) {
    return auth
  }

  if (!auth.actor.roles.includes('SUPER_ADMIN')) {
    return {
      response: NextResponse.json(
        { error: 'Super Admin write access required', message: 'Super Admin write access required' },
        { status: 403 }
      ),
    }
  }

  return auth
}
