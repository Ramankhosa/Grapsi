import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { enforceServiceAccess } from '@/lib/service-access-middleware'

export interface GrantPrepActor {
  id: string
  email: string | null
  roles: string[]
  tenantId: string
}

export async function requireGrantPrepActor(
  request: NextRequest
): Promise<{ actor: GrantPrepActor } | { response: NextResponse }> {
  const { user, error } = await authenticateUser(request)

  if (error || !user) {
    return {
      response: NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 }),
    }
  }

  if (!user.tenantId) {
    return {
      response: NextResponse.json(
        { error: 'A tenant-scoped account is required for grant prep', code: 'TENANT_REQUIRED' },
        { status: 403 }
      ),
    }
  }

  const access = await enforceServiceAccess(user.id, user.tenantId, 'GRANT_PREP')
  if (!access.allowed) {
    return { response: access.response }
  }

  return {
    actor: {
      id: user.id,
      email: user.email ?? null,
      roles: user.roles || [],
      tenantId: user.tenantId,
    },
  }
}

export async function assertGrantPrepProjectCapability(
  actor: GrantPrepActor,
  projectId: string,
  capability: 'read' | 'editContent'
) {
  try {
    return await assertProjectCapability(projectId, actor.id, actor.tenantId, capability)
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    throw error
  }
}
