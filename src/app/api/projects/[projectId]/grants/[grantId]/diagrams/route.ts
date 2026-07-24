import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ZodError } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireProjectGrantActor } from '@/lib/grants/access'
import {
  createAndGenerateDiagram,
  markStaleDiagrams,
  toGrantDiagramResponse,
  DiagramStudioError,
} from '@/lib/diagram-studio'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  kind: z.enum(['gantt', 'flowchart', 'logic_model', 'chart', 'plot', 'sketch']),
  mode: z.enum(['structured', 'freeform']).optional(),
  sectionKeys: z.array(z.string().min(1).max(120)).min(1).max(6),
  title: z.string().max(160).optional(),
  guidance: z.string().max(2500).optional(),
  themeKey: z.string().max(30).optional(),
})

async function loadGrantSession(grantId: string, projectId: string, tenantId: string) {
  return prisma.grantSession.findFirst({
    where: { id: grantId, projectId, tenantId },
    include: {
      fundingCall: {
        select: {
          title: true,
          extractedFacts: true,
          normalizedMetadata: true,
          project_duration_max_months: true,
          project_duration_min_months: true,
        },
      },
    },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  const grantSession = await loadGrantSession(grantId, projectId, actor.tenantId)
  if (!grantSession) {
    return NextResponse.json({ message: 'Grant not found' }, { status: 404 })
  }

  await markStaleDiagrams(grantSession.id).catch(error => {
    console.error('[DiagramStudio] stale check failed:', error)
  })

  const diagrams = await prisma.grantDiagram.findMany({
    where: { grantSessionId: grantSession.id },
    orderBy: { figureNo: 'asc' },
  })

  return NextResponse.json({
    diagrams: diagrams.map(diagram =>
      toGrantDiagramResponse({ diagram, projectId, grantId })
    ),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  try {
    const payload = createSchema.parse(await request.json())
    const grantSession = await loadGrantSession(grantId, projectId, actor.tenantId)
    if (!grantSession) {
      return NextResponse.json({ message: 'Grant not found' }, { status: 404 })
    }

    const diagram = await createAndGenerateDiagram({
      grantSession: {
        id: grantSession.id,
        projectId: grantSession.projectId,
        tenantId: grantSession.tenantId,
        draftingSessionId: grantSession.draftingSessionId,
        fundingCall: grantSession.fundingCall,
      },
      projectId,
      grantId,
      kind: payload.kind,
      mode: payload.mode,
      sectionKeys: payload.sectionKeys,
      title: payload.title,
      guidance: payload.guidance,
      themeKey: payload.themeKey,
      userId: actor.id,
      requestHeaders: Object.fromEntries(request.headers.entries()),
    })

    return NextResponse.json({ diagram }, { status: 201 })
  } catch (error) {
    console.error('[DiagramStudio] create error:', error)
    if (error instanceof ZodError) {
      return NextResponse.json(
        { message: 'Invalid request', issues: error.issues },
        { status: 400 }
      )
    }
    if (error instanceof DiagramStudioError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode })
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Diagram generation failed' },
      { status: 500 }
    )
  }
}
