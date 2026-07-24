import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ZodError } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireProjectGrantActor } from '@/lib/grants/access'
import {
  updateDiagramSpecAndRender,
  deleteDiagram,
  toGrantDiagramResponse,
  DiagramStudioError,
} from '@/lib/diagram-studio'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  spec: z.unknown().optional(),
  themeKey: z.string().max(30).optional(),
  title: z.string().max(160).optional(),
  caption: z.string().max(2000).nullable().optional(),
})

async function loadDiagram(params: {
  diagramId: string
  grantId: string
  projectId: string
  tenantId: string
}) {
  return prisma.grantDiagram.findFirst({
    where: {
      id: params.diagramId,
      grantSessionId: params.grantId,
      projectId: params.projectId,
      tenantId: params.tenantId,
    },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; diagramId: string }> }
) {
  const { projectId, grantId, diagramId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  try {
    const payload = patchSchema.parse(await request.json())
    const diagram = await loadDiagram({ diagramId, grantId, projectId, tenantId: actor.tenantId })
    if (!diagram) {
      return NextResponse.json({ message: 'Diagram not found' }, { status: 404 })
    }

    const updated = await updateDiagramSpecAndRender({
      diagram,
      projectId,
      grantId,
      spec: payload.spec,
      themeKey: payload.themeKey,
      title: payload.title,
      caption: payload.caption,
      userId: actor.id,
    })

    return NextResponse.json({ diagram: updated })
  } catch (error) {
    console.error('[DiagramStudio] update error:', error)
    if (error instanceof ZodError) {
      return NextResponse.json(
        { message: 'Invalid diagram spec', issues: error.issues },
        { status: 400 }
      )
    }
    if (error instanceof DiagramStudioError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode })
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Diagram update failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; diagramId: string }> }
) {
  const { projectId, grantId, diagramId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  const diagram = await loadDiagram({ diagramId, grantId, projectId, tenantId: actor.tenantId })
  if (!diagram) {
    return NextResponse.json({ message: 'Diagram not found' }, { status: 404 })
  }

  await deleteDiagram(diagram)
  return NextResponse.json({ success: true })
}
