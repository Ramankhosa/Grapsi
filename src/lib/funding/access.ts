import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import type { PlatformPermissionCode } from '@/lib/platformTeamRoles'
import { getUserPlatformPermissionCodes } from '@/lib/services/platformTeamRoleService'

export interface FundingActor {
  id: string
  email: string
  roles: string[]
  tenantId: string | null
  tenantAtiId: string | null
  isSuperAdmin: boolean
  isSuperAdminWriter: boolean
  platformPermissions: PlatformPermissionCode[]
}

function hasRole(actor: { roles: string[] }, role: string) {
  return actor.roles.includes(role)
}

function isFundingAdminRole(actor: { roles: string[]; tenantAtiId?: string | null }) {
  return hasRole(actor, 'ADMIN') && actor.tenantAtiId === 'PLATFORM'
}

function isFundingAdminPermission(permissionCode: PlatformPermissionCode) {
  return permissionCode === 'funding.operations.write' || permissionCode === 'funding.publisher.write'
}

export function actorHasPlatformPermission(actor: FundingActor, permissionCode: PlatformPermissionCode) {
  return (
    actor.isSuperAdminWriter ||
    actor.platformPermissions.includes(permissionCode) ||
    (isFundingAdminRole(actor) && isFundingAdminPermission(permissionCode))
  )
}

export function actorHasPlatformReadAccess(actor: FundingActor) {
  return (
    actor.isSuperAdmin ||
    isFundingAdminRole(actor) ||
    actor.platformPermissions.includes('platform.support.read') ||
    actor.platformPermissions.includes('funding.operations.write') ||
    actor.platformPermissions.includes('funding.publisher.write')
  )
}

export async function requireFundingActor(
  request: NextRequest,
  options?: {
    allowPlatform?: boolean
    requireWriteSuperAdmin?: boolean
    requiredPlatformPermission?: PlatformPermissionCode
  }
): Promise<{ actor: FundingActor; user: any } | { response: NextResponse }> {
  const { user, error } = await authenticateUser(request)

  if (error || !user) {
    return {
      response: NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 }),
    }
  }

  let platformPermissions: PlatformPermissionCode[] = []
  try {
    platformPermissions = await getUserPlatformPermissionCodes(user.id)
  } catch (permissionError) {
    console.error('[FundingAccess] Platform permission lookup failed:', permissionError)
  }
  const actor: FundingActor = {
    id: user.id,
    email: user.email,
    roles: user.roles || [],
    tenantId: user.tenantId ?? null,
    tenantAtiId: user.tenant?.atiId ?? null,
    isSuperAdmin: hasRole(user, 'SUPER_ADMIN') || hasRole(user, 'SUPER_ADMIN_VIEWER'),
    isSuperAdminWriter: hasRole(user, 'SUPER_ADMIN'),
    platformPermissions,
  }

  const hasRequiredPlatformPermission = options?.requiredPlatformPermission
    ? actorHasPlatformPermission(actor, options.requiredPlatformPermission)
    : false
  const hasPlatformRoleAccess =
    options?.allowPlatform &&
    (actor.platformPermissions.length > 0 || (isFundingAdminRole(actor) && user.tenant?.atiId === 'PLATFORM'))

  if (!actor.tenantId && !actor.isSuperAdmin && !hasPlatformRoleAccess) {
    return {
      response: NextResponse.json(
        {
          error: 'A tenant-scoped account is required for funding access',
          message: 'A tenant-scoped account is required for funding access',
          code: 'TENANT_REQUIRED',
        },
        { status: 403 }
      ),
    }
  }

  if (
    options?.requireWriteSuperAdmin &&
    !actor.isSuperAdminWriter &&
    !hasRequiredPlatformPermission
  ) {
    return {
      response: NextResponse.json(
        { error: 'Platform write access required', message: 'Platform write access required' },
        { status: 403 }
      ),
    }
  }

  if (
    options?.requiredPlatformPermission &&
    !actor.isSuperAdminWriter &&
    !hasRequiredPlatformPermission
  ) {
    return {
      response: NextResponse.json(
        { error: 'Platform permission required', message: 'Platform permission required' },
        { status: 403 }
      ),
    }
  }

  // Super admins must not be constrained by tenant-level feature access controls.
  // Many platform operators are linked to a tenant record for other product areas.
  if (actor.isSuperAdmin || hasPlatformRoleAccess) {
    if (!actor.tenantId && !options?.allowPlatform) {
      return {
        response: NextResponse.json(
          {
            error: 'Tenant-scoped funding access is required',
            message: 'Tenant-scoped funding access is required',
            code: 'TENANT_REQUIRED',
          },
          { status: 403 }
        ),
      }
    }

    return { actor, user }
  }

  if (actor.tenantId) {
    const access = await enforceServiceAccess(actor.id, actor.tenantId, 'FUNDING_DISCOVERY')
    if (!access.allowed) {
      return { response: access.response }
    }
  } else if (!options?.allowPlatform) {
    return {
      response: NextResponse.json(
        {
          error: 'Tenant-scoped funding access is required',
          message: 'Tenant-scoped funding access is required',
          code: 'TENANT_REQUIRED',
        },
        { status: 403 }
      ),
    }
  }

  return { actor, user }
}

export function assertVisibilityAccess(
  actor: FundingActor,
  visibility: 'GLOBAL_PUBLISHED' | 'TENANT_PRIVATE'
): NextResponse | null {
  if (visibility === 'TENANT_PRIVATE') {
    if (!actor.tenantId) {
      return NextResponse.json(
        {
          error: 'Tenant-scoped users are required for private funding imports',
          message: 'Tenant-scoped users are required for private funding imports',
          code: 'TENANT_REQUIRED',
        },
        { status: 403 }
      )
    }
    return null
  }

  if (!actorHasPlatformPermission(actor, 'funding.operations.write')) {
    return NextResponse.json(
      {
        error: 'Funding operations write access required',
        message: 'Funding operations write access required',
        code: 'SUPER_ADMIN_REQUIRED',
      },
      { status: 403 }
    )
  }

  return null
}
