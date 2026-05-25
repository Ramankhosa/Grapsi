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
  normalizeGrantPrepForPersistence,
  refreshGrantPrepSessionContext,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import { isGrantPrepSessionReady } from '@/lib/grantPrep/sessionState'
import { buildGrantWorkspaceUrl } from '@/lib/grants/workspaceNavigation'
import { getGrantPrepPostLaunchImpact } from '@/lib/grants/prepImpact'

function resolveWorkspaceLaunchUrl(input: {
  projectId: string
  grantSessionId?: string | null
  prepStatus?: string | null
  grantStatus?: string | null
}) {
  return buildGrantWorkspaceUrl(input)
}

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
        directPrepSession.papsi_launch_url !== resolveWorkspaceLaunchUrl({
          projectId: input.projectId,
          grantSessionId: grantSession.id,
          prepStatus: directPrepSession.status,
          grantStatus: grantSession.status,
        }))
    ) {
      directPrepSession = await prisma.grantPrepSession.update({
        where: { id: directPrepSession.id },
        data: {
          grant_session_id: grantSession.id,
          papsi_launch_url: resolveWorkspaceLaunchUrl({
            projectId: input.projectId,
            grantSessionId: grantSession.id,
            prepStatus: directPrepSession.status,
            grantStatus: grantSession.status,
          }),
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
          papsi_launch_url: resolveWorkspaceLaunchUrl({
            projectId: input.projectId,
            grantSessionId: grantSession.id,
            prepStatus: grantPrepSession.status,
            grantStatus: grantSession.status,
          }),
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
  let { grantPrepSession, grantSession } = resolved

  const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, {
    id: user.id,
    email: user.email ?? null,
    tenantId: user.tenantId,
  }, {
    grantSessionId: grantPrepSession.grant_session_id || grantSession?.id || null,
    fundingCallId: grantPrepSession.funding_call_id || grantSession?.fundingCallId || null,
  })
  const warning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
  let prepContext = inflateGrantPrepSessionContext(grantPrepSession, {
    warning,
  })
  const canRefresh =
    grantPrepSession.status !== 'archived' &&
    grantPrepSession.status !== 'handed_off' &&
    grantPrepSession.status !== 'launched'
  const isStale =
    grantPrepSession.template_revision_id !== serverContext.templateRevisionId ||
    grantPrepSession.guideline_revision_id !== serverContext.guidelineRevisionId
  if (canRefresh && isStale) {
    prepContext = refreshGrantPrepSessionContext({
      sessionContext: prepContext,
      templateJson: serverContext.draftingContext?.approvedTemplate?.grant_template_json || null,
      guidelinePack: (serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as any) || null,
      fundingContext: serverContext.fundingContext,
      warning,
    })
    grantPrepSession = await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: {
        ...normalizeGrantPrepForPersistence(prepContext),
        template_revision_id: serverContext.templateRevisionId,
        guideline_revision_id: serverContext.guidelineRevisionId,
        status: isGrantPrepSessionReady(prepContext.stageStates, prepContext.engagementMode) ? 'ready' : 'active',
        last_handoff_error: null,
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
    prepContext = inflateGrantPrepSessionContext(grantPrepSession, {
      warning,
    })
  }

  return NextResponse.json({
    session: serializeGrantPrepSession(grantPrepSession),
    grantSession,
    prepContext,
    fundingContext: serverContext.fundingContext,
    draftingContext: {
      approvedGuidelineRevision: serverContext.draftingContext?.approvedGuidelineRevision || null,
      approvedTemplate: serverContext.draftingContext?.approvedTemplate || null,
    },
    postLaunchImpact: await getGrantPrepPostLaunchImpact({
      tenantId: user.tenantId,
      grantSessionId: grantSession?.id || grantPrepSession.grant_session_id,
      prepSessionId: grantPrepSession.id,
    }),
  })
}
