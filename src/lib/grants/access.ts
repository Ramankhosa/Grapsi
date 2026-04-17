import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { enforceServiceAccess } from '@/lib/service-access-middleware'

export interface ProjectGrantActor {
  id: string
  email: string | null
  roles: string[]
  tenantId: string
}

export async function requireProjectGrantActor(
  request: NextRequest,
  projectId: string,
  capability: 'read' | 'editContent'
): Promise<ProjectGrantActor | NextResponse> {
  const { user, error } = await authenticateUser(request)
  if (error || !user) {
    return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 })
  }

  if (!user.tenantId) {
    return NextResponse.json(
      { error: 'A tenant-scoped account is required', code: 'TENANT_REQUIRED' },
      { status: 403 }
    )
  }

  const serviceAccess = await enforceServiceAccess(user.id, user.tenantId, 'GRANT_PREP')
  if (!serviceAccess.allowed) {
    return serviceAccess.response
  }

  try {
    await assertProjectCapability(projectId, user.id, user.tenantId, capability)
  } catch (projectError) {
    if (projectError instanceof ProjectAccessError) {
      return NextResponse.json(
        { error: projectError.message, code: projectError.code },
        { status: projectError.status }
      )
    }
    throw projectError
  }

  return {
    id: user.id,
    email: user.email ?? null,
    roles: user.roles || [],
    tenantId: user.tenantId,
  }
}
