import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireProjectGrantActor } from '@/lib/grants/access'
import {
  applyManualGrantReviewerMapping,
  getIntegratedReviewerState,
  refreshIntegratedReviewerCall,
} from '@/lib/reviewer/template-bridge'

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
  const actor = await requireProjectGrantActor(request, projectId, 'read')
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
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
  if (actor instanceof NextResponse) return actor

  const grantSession = await assertGrantWorkspace(projectId, grantId, actor.tenantId)
  if (!grantSession) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  try {
    const payload = refreshSchema.parse(await request.json().catch(() => ({})))
    const state = await refreshIntegratedReviewerCall({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      userId: actor.id,
      manualRubric: payload.manualRubric,
      createRevisions: payload.createRevisions === true,
    })

    return NextResponse.json(state)
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to prepare reviewer mappings' },
      { status: 400 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
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
