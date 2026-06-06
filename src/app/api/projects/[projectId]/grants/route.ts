import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { assertProjectCapability, ProjectAccessError } from '@/lib/project-access'
import { serializeGrantPrepSession } from '@/lib/grantPrep/compat'
import { createOrReuseGrantPrepSession } from '@/lib/grantPrep/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import type { GrantPrepStageKey } from '@/lib/grantPrep/types'
import { normalizeGrantPrepEngagementMode } from '@/lib/grantPrep/types'
import { buildGrantWorkspaceUrl } from '@/lib/grants/workspaceNavigation'
import {
  STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING,
  STANDARD_GRANT_TEMPLATE_VERSION,
} from '@/lib/fundingTemplates/standardGrantTemplate'

const createGrantSchema = z.object({
  fundingCallId: z.string().min(1).optional().nullable(),
  useDefaultGrantFormat: z.boolean().optional().default(false),
  engagementMode: z.preprocess(normalizeGrantPrepEngagementMode, z.enum(['expert', 'express'])).default('expert'),
  selectedThrustAreaRuleKeys: z.array(z.string()).optional(),
  selectedPriorityAreas: z.array(z.string()).optional(),
  enabledStageKeys: z.array(z.string()).optional(),
  disabledStageKeys: z.array(z.string()).optional(),
  restart: z.boolean().optional().default(false),
})

const DEFAULT_GRANT_FORMAT_SOURCE_PREFIX = 'default-grant-format'

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

async function ensureDefaultGrantFormatFundingCall(
  projectId: string,
  actor: { id: string; email?: string | null; tenantId: string }
) {
  const sourceFingerprint = `${DEFAULT_GRANT_FORMAT_SOURCE_PREFIX}:${projectId}`
  const existing = await prisma.fundingCall.findFirst({
    where: {
      tenantId: actor.tenantId,
      visibility: 'TENANT_PRIVATE',
      sourceFingerprint,
      createdByUserId: actor.id,
    },
    select: { id: true },
  })

  if (existing) {
    return existing.id
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      tenantId: actor.tenantId,
    },
    select: { name: true },
  })

  const titleBase = project?.name?.trim() || 'Grant Project'
  const title = `Default Grant Format - ${titleBase}`.slice(0, 200)
  const agencyName = 'Default Grant Format'

  const fundingCall = await prisma.fundingCall.create({
    data: {
      tenantId: actor.tenantId,
      visibility: 'TENANT_PRIVATE',
      status: 'READY_FOR_REVIEW',
      catalog_status: 'DRAFT',
      title,
      agencyName,
      scheme_title: title,
      agency_name: agencyName,
      summary: 'Private default grant-format scaffold for drafting without a specific funder opportunity.',
      description:
        'This private placeholder call lets Grant Prep use the standard grant application fallback template when no funding opportunity has been selected.',
      sourceType: 'MANUAL',
      sourceFingerprint,
      source: DEFAULT_GRANT_FORMAT_SOURCE_PREFIX,
      uploaded_by: actor.email || null,
      is_active: true,
      metadata: {
        kind: 'default_grant_format',
        project_id: projectId,
        template_version: STANDARD_GRANT_TEMPLATE_VERSION,
        fallback_template_reason: STANDARD_GRANT_TEMPLATE_FALLBACK_WARNING,
        owner_user_id: actor.id,
        user_import: {
          owner_user_id: actor.id,
          user_id: actor.id,
          source: DEFAULT_GRANT_FORMAT_SOURCE_PREFIX,
          verification_status: 'not_applicable',
        },
      },
      extractedFacts: {
        kind: 'default_grant_format',
        templateVersion: STANDARD_GRANT_TEMPLATE_VERSION,
      },
      normalizedMetadata: {
        defaultGrantFormat: true,
        fallbackTemplate: STANDARD_GRANT_TEMPLATE_VERSION,
      },
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
    },
    select: { id: true },
  })

  return fundingCall.id
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

  const grantSessionById = new Map(grantSessions.map((session) => [session.id, session]))
  const grantSessionByFundingCallId = new Map(
    grantSessions
      .filter((session) => session.fundingCallId)
      .map((session) => [session.fundingCallId, session])
  )

  return NextResponse.json({
    prepSessions: prepSessions.map((session) => {
      const linkedGrantSession =
        (session.grant_session_id ? grantSessionById.get(session.grant_session_id) : null) ||
        (session.funding_call_id ? grantSessionByFundingCallId.get(session.funding_call_id) : null) ||
        null

      return {
        ...serializeGrantPrepSession(session),
        papsi_launch_url: buildGrantWorkspaceUrl({
          projectId,
          grantSessionId: linkedGrantSession?.id || session.grant_session_id,
          prepStatus: session.status,
          grantStatus: linkedGrantSession?.status,
        }),
      }
    }),
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
    const effectiveFundingCallId =
      payload.fundingCallId ||
      (payload.useDefaultGrantFormat ? await ensureDefaultGrantFormatFundingCall(projectId, actor) : null)

    const result = await createOrReuseGrantPrepSession({
      projectId,
      tenantId: actor.tenantId,
      user: actor,
      fundingCallId: effectiveFundingCallId,
      engagementMode: payload.engagementMode,
      selectedThrustAreaRuleKeys: payload.selectedPriorityAreas ?? payload.selectedThrustAreaRuleKeys,
      enabledStageKeys: payload.enabledStageKeys as GrantPrepStageKey[] | undefined,
      disabledStageKeys: payload.disabledStageKeys as GrantPrepStageKey[] | undefined,
      restart: payload.restart,
    })

    if (!result.session) {
      return NextResponse.json({ message: 'Failed to create Grant Prep session' }, { status: 500 })
    }

    if (effectiveFundingCallId) {
      await prisma.project.update({
        where: { id: projectId },
        data: { projectType: 'GRANT' },
      })
    }

    return NextResponse.json(
      {
        session: serializeGrantPrepSession(result.session),
        reused: result.reused,
        fundingCallId: effectiveFundingCallId,
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
