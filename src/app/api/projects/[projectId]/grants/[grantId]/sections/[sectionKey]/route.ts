import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { generateGrantSectionDraft, saveGrantSectionDraft } from '@/lib/grants/drafting'
import { requireProjectGrantActor } from '@/lib/grants/access'
import { getGrantWorkspace } from '@/lib/grants/workspace'

const generateSchema = z.object({
  action: z.enum(['generate', 'regenerate']).default('generate'),
})

const saveSchema = z.object({
  content: z.string().optional().nullable(),
  structuredData: z.unknown().optional(),
  markReviewed: z.boolean().optional().default(false),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; sectionKey: string }> }
) {
  const { projectId, grantId, sectionKey } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read')
  if (actor instanceof NextResponse) {
    return actor
  }

  const workspace = await getGrantWorkspace({
    grantSessionId: grantId,
    tenantId: actor.tenantId,
  })
  if (!workspace || workspace.grantSession.projectId !== projectId || !workspace.blueprint) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  const section = workspace.blueprint.sectionDrafts.find((draft) => draft.sectionKey === sectionKey)
  if (!section) {
    return NextResponse.json({ message: 'Grant section not found' }, { status: 404 })
  }

  return NextResponse.json({ section })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; sectionKey: string }> }
) {
  const { projectId, grantId, sectionKey } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    generateSchema.parse(await request.json())
    const section = await generateGrantSectionDraft({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      sectionKey,
      userId: actor.id,
    })

    return NextResponse.json({ section })
  } catch (error) {
    console.error('[Grant Section] generate error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to generate the grant section',
      },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string; sectionKey: string }> }
) {
  const { projectId, grantId, sectionKey } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const payload = saveSchema.parse(await request.json())
    const section = await saveGrantSectionDraft({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
      sectionKey,
      userId: actor.id,
      content: payload.content,
      structuredData: payload.structuredData,
      markReviewed: payload.markReviewed,
    })

    return NextResponse.json({ section })
  } catch (error) {
    console.error('[Grant Section] save error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to save the grant section',
      },
      { status: 500 }
    )
  }
}
