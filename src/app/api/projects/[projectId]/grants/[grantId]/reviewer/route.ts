import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireProjectGrantActor } from '@/lib/grants/access'
import {
  applyManualGrantReviewerMapping,
  getIntegratedReviewerState,
  refreshIntegratedReviewerCall,
} from '@/lib/reviewer/template-bridge'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'

export const runtime = 'nodejs'

const refreshSchema = z.object({
  manualRubric: z.unknown().optional(),
  createRevisions: z.boolean().optional(),
})

const mappingSchema = z.object({
  assignments: z.array(z.object({
    grantSectionKey: z.string().min(1),
    reviewerBucketKey: z.string().min(1),
  })).min(1),
})

async function assertGrantWorkspace(projectId: string, grantId: string, tenantId: string) {
  const grantSession = await prisma.grantSession.findFirst({
    where: {
      id: grantId,
      projectId,
      tenantId,
    },
    select: {
      id: true,
      projectId: true,
      tenantId: true,
    },
  })

  return grantSession
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  const grantSession = await assertGrantWorkspace(projectId, grantId, actor.tenantId)
  if (!grantSession) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  const state = await getIntegratedReviewerState({
    grantSessionId: grantId,
    tenantId: actor.tenantId,
  })

  return NextResponse.json(state)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  const grantSession = await assertGrantWorkspace(projectId, grantId, actor.tenantId)
  if (!grantSession) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  const operationId = `grant-reviewer-refresh:${grantId}:${Date.now()}`
  try {
    const payload = refreshSchema.parse(await request.json().catch(() => ({})))
    await reserveServiceUsage({
      tenantId: actor.tenantId,
      userId: actor.id,
      serviceType: 'GRANT_DRAFTING',
      operationId,
      operationType: 'grant_reviewer_refresh',
      metadata: { grantSessionId: grantId }
    })

    const state = await refreshIntegratedReviewerCall({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      userId: actor.id,
      manualRubric: payload.manualRubric,
      createRevisions: payload.createRevisions === true,
    })

    await trackServiceUsage({
      tenantId: actor.tenantId,
      userId: actor.id,
      serviceType: 'GRANT_DRAFTING',
      operationId,
      operationType: 'grant_reviewer_refresh',
      isCompleted: true,
      metadata: { grantSessionId: grantId }
    })

    return NextResponse.json(state)
  } catch (error) {
    await releaseReservedServiceUsage(actor.tenantId, 'GRANT_DRAFTING', operationId).catch(() => undefined)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to prepare reviewer mappings' },
      { status: error instanceof ServiceQuotaExceededError ? 429 : 400 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  const grantSession = await assertGrantWorkspace(projectId, grantId, actor.tenantId)
  if (!grantSession) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  try {
    const payload = mappingSchema.parse(await request.json())
    const state = await applyManualGrantReviewerMapping({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      userId: actor.id,
      assignments: payload.assignments,
    })

    return NextResponse.json(state)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update reviewer mapping' },
      { status: 400 }
    )
  }
}
