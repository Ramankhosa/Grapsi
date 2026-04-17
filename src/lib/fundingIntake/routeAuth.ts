import { NextRequest, NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import { requireFundingActor } from '@/lib/funding/access'
import type { Prisma } from '@/lib/prisma-generated'

import { toFundingOperator } from './auth'
import type { IntakeOperator } from './types'

type AuthResult =
  | { actor: FundingActor; operator: IntakeOperator }
  | { response: NextResponse }

export async function requireFundingImporterRequest(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) {
    return auth
  }

  const operator = toFundingOperator(auth.actor)
  if (!operator) {
    return {
      response: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { actor: auth.actor, operator }
}

export async function requireFundingOperatorRequest(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
  })
  if ('response' in auth) {
    return auth
  }

  const operator = toFundingOperator(auth.actor)
  if (!operator || operator.role === 'USER') {
    return {
      response: NextResponse.json({ message: 'Forbidden: funding operator role required' }, { status: 403 }),
    }
  }

  return { actor: auth.actor, operator }
}

export function buildFundingCallAccessWhere(actor: FundingActor): Prisma.FundingCallWhereInput {
  if (actor.isSuperAdmin) {
    return {}
  }

  return {
    OR: [
      {
        visibility: 'GLOBAL_PUBLISHED',
        is_active: { not: false },
        OR: [
          { status: 'PUBLISHED' },
          { catalog_status: 'PUBLISHED' },
        ],
      },
      ...(actor.tenantId
        ? [
            {
              visibility: 'TENANT_PRIVATE' as const,
              tenantId: actor.tenantId,
            },
          ]
        : []),
    ],
  }
}
