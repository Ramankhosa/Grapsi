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

async function resolveProjectGrantPrepSession(input: {
  projectId: string
  grantId: string
  tenantId: string
}) {
  let directPrepSession = await loadGrantPrepSession({
    sessionId: input.grantId,
    tenantId: input.tenantId,
  })

  if (directPrepSession?.project_id === input.projectId) {
    const grantSession = directPrepSession.grant_session_id
      ? await prisma.grantSession.findFirst({
          where: {
            id: directPrepSession.grant_session_id,
            projectId: input.projectId,
            tenantId: input.tenantId,
          },
        })
      : directPrepSession.funding_call_id
        ? await prisma.grantSession.findFirst({
            where: {
              projectId: input.projectId,
              tenantId: input.tenantId,
              fundingCallId: directPrepSession.funding_call_id,
            },
            orderBy: {
              updatedAt: 'desc',
            },
          })
        : null

    if (
      grantSession &&
      (directPrepSession.grant_session_id !== grantSession.id ||
        directPrepSession.papsi_launch_url !== `/projects/${input.projectId}/grants/${grantSession.id}/workspace?stage=GRANTMENTOR`)
    ) {
      directPrepSession = await prisma.grantPrepSession.update({
        where: { id: directPrepSession.id },
        data: {
          grant_session_id: grantSession.id,
          papsi_launch_url: `/projects/${input.projectId}/grants/${grantSession.id}/workspace?stage=GRANTMENTOR`,
        },
        include: {
          messages: {
            orderBy: {
              created_at: 'asc',
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              tenantId: true,
            },
          },
        },
      })
    }

    return {
      grantPrepSession: directPrepSession,
      grantSession,
    }
  }

  const grantSession = await prisma.grantSession.findFirst({
    where: {
      id: input.grantId,
      projectId: input.projectId,
      tenantId: input.tenantId,
    },
    include: {
      prepSession: {
        include: {
          messages: {
            orderBy: {
              created_at: 'asc',
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              tenantId: true,
            },
          },
        },
      },
    },
  })

  if (!grantSession) {
    return null
  }

  let grantPrepSession = grantSession.prepSession
  if (!grantPrepSession && grantSession.fundingCallId) {
    grantPrepSession = await prisma.grantPrepSession.findFirst({
      where: {
        project_id: input.projectId,
        tenantId: input.tenantId,
        funding_call_id: grantSession.fundingCallId,
        status: {
          not: 'archived',
        },
      },
      include: {
        messages: {
          orderBy: {
            created_at: 'asc',
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            tenantId: true,
          },
        },
      },
      orderBy: {
        updated_at: 'desc',
      },
    })

    if (grantPrepSession) {
      grantPrepSession = await prisma.grantPrepSession.update({
        where: { id: grantPrepSession.id },
        data: {
          grant_session_id: grantSession.id,
          papsi_launch_url: `/projects/${input.projectId}/grants/${grantSession.id}/workspace?stage=GRANTMENTOR`,
        },
        include: {
          messages: {
            orderBy: {
              created_at: 'asc',
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              tenantId: true,
            },
          },
        },
      })
    }
  }

  return {
    grantPrepSession,
    grantSession,
  }
}

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

  const resolved = await resolveProjectGrantPrepSession({
    projectId,
    grantId,
    tenantId: user.tenantId,
  })
  if (!resolved?.grantPrepSession || resolved.grantPrepSession.project_id !== projectId) {
    return NextResponse.json({ message: 'Grant Prep session not found' }, { status: 404 })
  }
  const { grantPrepSession, grantSession } = resolved

  const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, {
    id: user.id,
    email: user.email ?? null,
    tenantId: user.tenantId,
  })
  const prepContext = inflateGrantPrepSessionContext(grantPrepSession, {
    warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
  })

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
