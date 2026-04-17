import { NextRequest, NextResponse } from 'next/server'

import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { serializeGrantPrepSession } from '@/lib/grantPrep/compat'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'

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

    const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, auth.actor)
    const prepContext = inflateGrantPrepSessionContext(grantPrepSession, {
      warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
    })

    return NextResponse.json({
      session: serializeGrantPrepSession(grantPrepSession),
      prepContext,
      fundingContext: serverContext.fundingContext,
      draftingContext: {
        approvedGuidelineRevision: serverContext.draftingContext?.approvedGuidelineRevision || null,
        approvedTemplate: serverContext.draftingContext?.approvedTemplate || null,
      },
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] get error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to load Grant Prep session',
      },
      { status: 500 }
    )
  }
}
