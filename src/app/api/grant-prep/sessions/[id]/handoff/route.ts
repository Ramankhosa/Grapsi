import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { launchGrantPrepToLocalWorkspace } from '@/lib/grants/workspace'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { loadGrantPrepSession } from '@/lib/grantPrep/server'

const handoffSchema = z.object({
  overrideReason: z.string().trim().max(1000).optional(),
  // Which optional evidence stages the author picked in the launch modal.
  // Omitted by legacy clients — the launch then applies the defaults.
  pipeline: z
    .object({
      literatureSearch: z.boolean(),
      deepAnalysis: z.boolean(),
    })
    .optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireGrantPrepActor(request)
  if ('response' in auth) {
    return auth.response
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ message: 'Invalid session id' }, { status: 400 })
  }

  try {
    const payload = handoffSchema.parse(await request.json().catch(() => ({})))
    const grantPrepSession = await loadGrantPrepSession({
      sessionId: id,
      tenantId: auth.actor.tenantId,
    })
    if (!grantPrepSession) {
      return NextResponse.json({ message: 'Grant Prep session not found' }, { status: 404 })
    }

    const accessResult = await assertGrantPrepProjectCapability(auth.actor, grantPrepSession.project_id, 'editContent')
    if (accessResult instanceof NextResponse) {
      return accessResult
    }

    const result = await launchGrantPrepToLocalWorkspace({
      sessionId: id,
      actor: auth.actor,
      overrideReason: payload.overrideReason,
      pipeline: payload.pipeline,
    })

    return NextResponse.json({
      status: 'launched',
      grantSessionId: result.grantSessionId,
      blueprintId: result.blueprintId,
      launchUrl: result.launchUrl,
      pipeline: result.pipeline,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] local handoff error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to launch the local grant workspace',
      },
      { status: 500 }
    )
  }
}
