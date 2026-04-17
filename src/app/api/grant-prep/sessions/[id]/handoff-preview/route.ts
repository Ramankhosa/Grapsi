import { NextRequest, NextResponse } from 'next/server'

import { buildGrantPrepLocalLaunchPreview } from '@/lib/grants/workspace'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { loadGrantPrepSession } from '@/lib/grantPrep/server'

export async function GET(
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
    const grantPrepSession = await loadGrantPrepSession({
      sessionId: id,
      tenantId: auth.actor.tenantId,
    })
    if (!grantPrepSession) {
      return NextResponse.json({ message: 'Grant Prep session not found' }, { status: 404 })
    }

    const accessResult = await assertGrantPrepProjectCapability(auth.actor, grantPrepSession.project_id, 'read')
    if (accessResult instanceof NextResponse) {
      return accessResult
    }

    const preview = await buildGrantPrepLocalLaunchPreview(id, auth.actor)

    return NextResponse.json({
      preview,
      canLaunch: preview.canLaunch,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] handoff-preview error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to build launch preview',
      },
      { status: 500 }
    )
  }
}
