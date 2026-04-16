import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'

export interface FundingActor {
  id: string
  email: string
  roles: string[]
  tenantId: string | null
  isSuperAdmin: boolean
  isSuperAdminWriter: boolean
}

function hasRole(actor: { roles: string[] }, role: string) {
  return actor.roles.includes(role)
}

export async function requireFundingActor(
  request: NextRequest,
  options?: {
    allowPlatform?: boolean
    requireWriteSuperAdmin?: boolean
  }
): Promise<{ actor: FundingActor; user: any } | { response: NextResponse }> {
  const { user, error } = await authenticateUser(request)

  if (error || !user) {
    return {
      response: NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 }),
    }
  }

  const actor: FundingActor = {
    id: user.id,
    email: user.email,
    roles: user.roles || [],
    tenantId: user.tenantId ?? null,
    isSuperAdmin: hasRole(user, 'SUPER_ADMIN') || hasRole(user, 'SUPER_ADMIN_VIEWER'),
    isSuperAdminWriter: hasRole(user, 'SUPER_ADMIN'),
  }

  if (!actor.tenantId && !actor.isSuperAdmin) {
    return {
      response: NextResponse.json(
        { error: 'A tenant-scoped account is required for funding access', code: 'TENANT_REQUIRED' },
        { status: 403 }
      ),
    }
  }

  if (options?.requireWriteSuperAdmin && !actor.isSuperAdminWriter) {
    return {
      response: NextResponse.json({ error: 'Super admin write access required' }, { status: 403 }),
    }
  }

  if (actor.tenantId) {
    const access = await enforceServiceAccess(actor.id, actor.tenantId, 'FUNDING_DISCOVERY')
    if (!access.allowed) {
      return { response: access.response }
    }
  } else if (!options?.allowPlatform) {
    return {
      response: NextResponse.json(
        { error: 'Tenant-scoped funding access is required', code: 'TENANT_REQUIRED' },
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
        { error: 'Tenant-scoped users are required for private funding imports', code: 'TENANT_REQUIRED' },
        { status: 403 }
      )
    }
    return null
  }

  if (!actor.isSuperAdminWriter) {
    return NextResponse.json(
      { error: 'Only super admins can create or moderate global funding calls', code: 'SUPER_ADMIN_REQUIRED' },
      { status: 403 }
    )
  }

  return null
}
