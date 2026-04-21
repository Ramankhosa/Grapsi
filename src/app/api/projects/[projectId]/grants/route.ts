import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { serializeGrantPrepSession } from '@/lib/grantPrep/compat'
import { createOrReuseGrantPrepSession } from '@/lib/grantPrep/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import type { GrantPrepStageKey } from '@/lib/grantPrep/types'

const createGrantSchema = z.object({
  fundingCallId: z.string().min(1).optional().nullable(),
  engagementMode: z.enum(['guided', 'hybrid', 'express']).default('guided'),
  selectedThrustAreaRuleKeys: z.array(z.string()).default([]),
  enabledStageKeys: z.array(z.string()).optional(),
  disabledStageKeys: z.array(z.string()).optional(),
  restart: z.boolean().optional().default(false),
})

async function requireProjectGrantActor(request: NextRequest, projectId: string, capability: 'read' | 'editContent') {
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read')
  if (actor instanceof NextResponse) {
    return actor
  }

  const [prepSessions, grantSessions] = await Promise.all([
    prisma.grantPrepSession.findMany({
      where: {
        project_id: projectId,
        tenantId: actor.tenantId,
      },
      include: {
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
    }),
    prisma.grantSession.findMany({
      where: {
        projectId,
        tenantId: actor.tenantId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
  ])

  return NextResponse.json({
    prepSessions: prepSessions.map((session) => serializeGrantPrepSession(session)),
    grantSessions,
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const payload = createGrantSchema.parse(await request.json())
    const result = await createOrReuseGrantPrepSession({
      projectId,
      tenantId: actor.tenantId,
      user: actor,
      fundingCallId: payload.fundingCallId ?? null,
      engagementMode: payload.engagementMode,
      selectedThrustAreaRuleKeys: payload.selectedThrustAreaRuleKeys,
      enabledStageKeys: payload.enabledStageKeys as GrantPrepStageKey[] | undefined,
      disabledStageKeys: payload.disabledStageKeys as GrantPrepStageKey[] | undefined,
      restart: payload.restart,
    })

    if (!result.session) {
      return NextResponse.json({ message: 'Failed to create Grant Prep session' }, { status: 500 })
    }

    return NextResponse.json(
      {
        session: serializeGrantPrepSession(result.session),
        reused: result.reused,
        grantSessionId: result.grantSessionId || null,
        launchUrl: result.launchUrl || null,
        prepUrl: result.prepUrl || null,
      },
      { status: result.reused ? 200 : 201 }
    )
  } catch (error) {
    console.error('[Project Grants] create error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to create grant prep session',
      },
      { status: 500 }
    )
  }
}
