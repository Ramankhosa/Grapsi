import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ZodError } from 'zod'

import { prisma } from '@/lib/prisma'
import { requireProjectGrantActor } from '@/lib/grants/access'
import {
  refineDiagramWithAI,
  DiagramStudioError,
} from '@/lib/diagram-studio'

export const dynamic = 'force-dynamic'

const refineSchema = z.object({
  instruction: z.string().min(3).max(2000),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; diagramId: string }> }
) {
  const { projectId, grantId, diagramId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent', 'GRANT_DRAFTING')
  if (actor instanceof NextResponse) return actor

  try {
    const payload = refineSchema.parse(await request.json())

    const [diagram, grantSession] = await Promise.all([
      prisma.grantDiagram.findFirst({
        where: {
          id: diagramId,
          grantSessionId: grantId,
          projectId,
          tenantId: actor.tenantId,
        },
      }),
      prisma.grantSession.findFirst({
        where: { id: grantId, projectId, tenantId: actor.tenantId },
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
      }),
    ])

    if (!diagram || !grantSession) {
      return NextResponse.json({ message: 'Diagram not found' }, { status: 404 })
    }

    const updated = await refineDiagramWithAI({
      diagram,
      grantSession: {
        id: grantSession.id,
        projectId: grantSession.projectId,
        tenantId: grantSession.tenantId,
        draftingSessionId: grantSession.draftingSessionId,
        fundingCall: grantSession.fundingCall,
      },
      projectId,
      grantId,
      instruction: payload.instruction,
      userId: actor.id,
      requestHeaders: Object.fromEntries(request.headers.entries()),
    })

    return NextResponse.json({ diagram: updated })
  } catch (error) {
    console.error('[DiagramStudio] refine error:', error)
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
      { message: error instanceof Error ? error.message : 'Diagram refinement failed' },
      { status: 500 }
    )
  }
}
