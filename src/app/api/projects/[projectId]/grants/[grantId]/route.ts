import { NextRequest, NextResponse } from 'next/server'

import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { serializeGrantPrepSession } from '@/lib/grantPrep/compat'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const { user, error } = await authenticateUser(request)
  if (error || !user) {
    return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 })
  }

  if (!user.tenantId) {
    return NextResponse.json({ error: 'A tenant-scoped account is required', code: 'TENANT_REQUIRED' }, { status: 403 })
  }

  const serviceAccess = await enforceServiceAccess(user.id, user.tenantId, 'GRANT_PREP')
  if (!serviceAccess.allowed) {
    return serviceAccess.response
  }

  try {
    await assertProjectCapability(projectId, user.id, user.tenantId, 'read')
  } catch (projectError) {
    if (projectError instanceof ProjectAccessError) {
      return NextResponse.json(
        { error: projectError.message, code: projectError.code },
        { status: projectError.status }
      )
    }
    throw projectError
  }

  const grantPrepSession = await loadGrantPrepSession({
    sessionId: grantId,
    tenantId: user.tenantId,
  })
  if (!grantPrepSession || grantPrepSession.project_id !== projectId) {
    return NextResponse.json({ message: 'Grant Prep session not found' }, { status: 404 })
  }

  const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, {
    id: user.id,
    email: user.email ?? null,
    tenantId: user.tenantId,
  })
  const prepContext = inflateGrantPrepSessionContext(grantPrepSession, {
    warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
  })

  const grantSession = grantPrepSession.funding_call_id
    ? await prisma.grantSession.findFirst({
        where: {
          projectId,
          tenantId: user.tenantId,
          fundingCallId: grantPrepSession.funding_call_id,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      })
    : null

  return NextResponse.json({
    session: serializeGrantPrepSession(grantPrepSession),
    grantSession,
    prepContext,
    fundingContext: serverContext.fundingContext,
    draftingContext: {
      approvedGuidelineRevision: serverContext.draftingContext?.approvedGuidelineRevision || null,
      approvedTemplate: serverContext.draftingContext?.approvedTemplate || null,
    },
  })
}
