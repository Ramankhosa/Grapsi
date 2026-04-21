import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireProjectGrantActor } from '@/lib/grants/access'
import { getGrantWorkspace } from '@/lib/grants/workspace'

const sectionCollectionActionSchema = z.object({
  action: z.enum(['generate_all']),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'read')
  if (actor instanceof NextResponse) {
    return actor
  }

  const workspace = await getGrantWorkspace({
    grantSessionId: grantId,
    tenantId: actor.tenantId,
  })

  if (!workspace || workspace.grantSession.projectId !== projectId) {
    return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
  }

  return NextResponse.json({
    grantSession: workspace.grantSession,
    blueprint: workspace.blueprint,
    sections: workspace.blueprint?.sectionDrafts || [],
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; grantId: string }> }
) {
  const { projectId, grantId } = await params
  const actor = await requireProjectGrantActor(request, projectId, 'editContent')
  if (actor instanceof NextResponse) {
    return actor
  }

  try {
    const payload = sectionCollectionActionSchema.parse(await request.json())
    if (payload.action !== 'generate_all') {
      return NextResponse.json({ message: 'Unsupported action' }, { status: 400 })
    }

    const workspace = await getGrantWorkspace({
      grantSessionId: grantId,
      tenantId: actor.tenantId,
    })
    if (!workspace || workspace.grantSession.projectId !== projectId || !workspace.blueprint) {
      return NextResponse.json({ message: 'Grant workspace not found' }, { status: 404 })
    }

    return NextResponse.json(
      {
        message: 'App Draft sections are generated in the linked literature workspace.',
      },
      { status: 409 }
    )
  } catch (error) {
    console.error('[Grant Sections] generate-all error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to generate grant sections',
      },
      { status: 500 }
    )
  }
}
