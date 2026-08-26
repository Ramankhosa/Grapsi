import { NextRequest, NextResponse } from 'next/server'

import type { FundingActor } from '@/lib/funding/access'
import { actorHasPlatformReadAccess, requireFundingActor } from '@/lib/funding/access'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { prisma } from '@/lib/prisma'
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

export async function requireFundingReadOperatorRequest(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) {
    return auth
  }

  const operator = toFundingOperator(auth.actor)
  if (!operator || operator.role === 'USER') {
    return {
      response: NextResponse.json({ message: 'Forbidden: platform funding access required' }, { status: 403 }),
    }
  }

  return { actor: auth.actor, operator }
}

export async function requireFundingOperatorRequest(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
    requiredPlatformPermission: 'funding.operations.write',
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

export async function requireFundingPublisherRequest(request: NextRequest): Promise<AuthResult> {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
    requiredPlatformPermission: 'funding.publisher.write',
  })
  if ('response' in auth) {
    return auth
  }

  const operator = toFundingOperator(auth.actor)
  if (!operator || operator.role === 'USER') {
    return {
      response: NextResponse.json({ message: 'Forbidden: funding publisher role required' }, { status: 403 }),
    }
  }

  return { actor: auth.actor, operator }
}

/** Tenant roles that curate the tenant's own call catalog. */
const TENANT_CALL_MANAGER_ROLES = ['OWNER', 'ADMIN', 'CALL_ADMIN']

function actorIsTenantCallManager(actor: FundingActor): boolean {
  return (
    Boolean(actor.tenantId) &&
    TENANT_CALL_MANAGER_ROLES.some((role) => actor.roles.includes(role))
  )
}

/**
 * Whether this actor may see the tenant's UNPUBLISHED calls: tenant admins and
 * active funding-department members (they run the intake desk). Everyone else
 * only sees published calls — a draft is work in progress, not an announcement.
 *
 * Async because department membership lives in the database; routes call this
 * once and pass the answer into `buildFundingCallAccessWhere`.
 */
export async function actorCanSeeTenantDrafts(actor: FundingActor): Promise<boolean> {
  if (actorHasPlatformReadAccess(actor)) return true
  if (actorIsTenantCallManager(actor)) return true
  if (!actor.tenantId) return false
  const membership = await prisma.fundingDeptMember.findFirst({
    where: { tenant_id: actor.tenantId, user_id: actor.id, is_active: true },
    select: { id: true },
  })
  return Boolean(membership)
}

export function buildFundingCallAccessWhere(
  actor: FundingActor,
  options: { includeTenantDrafts?: boolean } = {}
): Prisma.FundingCallWhereInput {
  if (actorHasPlatformReadAccess(actor)) {
    return {}
  }

  // Default is the cheap role-only check; routes that should extend draft
  // visibility to funding-department members resolve `actorCanSeeTenantDrafts`
  // and pass it in.
  const includeTenantDrafts = options.includeTenantDrafts ?? actorIsTenantCallManager(actor)
  return visibleFundingCallWhere(actor.tenantId, { includeTenantDrafts })
}
