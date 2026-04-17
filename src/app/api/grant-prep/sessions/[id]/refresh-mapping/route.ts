import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
  refreshGrantPrepSessionContext,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'

function isSessionReady(stageStates: ReturnType<typeof inflateGrantPrepSessionContext>['stageStates']) {
  return Object.values(stageStates).every((stage) => !stage.enabled || !stage.pickable || stage.readiness >= 0.65)
}

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

    if (grantPrepSession.status === 'archived') {
      return NextResponse.json({ message: 'Archived sessions cannot be refreshed' }, { status: 400 })
    }

    if (grantPrepSession.status === 'handed_off' || grantPrepSession.status === 'launched') {
      return NextResponse.json(
        {
          message: 'This session has already been handed off. Start a new prep revision to change the mapping.',
        },
        { status: 400 }
      )
    }

    const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, auth.actor)
    const warning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
    const prepContext = inflateGrantPrepSessionContext(grantPrepSession, { warning })
    const nextContext = refreshGrantPrepSessionContext({
      sessionContext: prepContext,
      templateJson: serverContext.draftingContext?.approvedTemplate?.grant_template_json || null,
      guidelinePack: (serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as any) || null,
      fundingContext: serverContext.fundingContext,
      warning,
    })
    const nextStatus = isSessionReady(nextContext.stageStates) ? 'ready' : 'active'

    await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: {
        ...normalizeGrantPrepForPersistence(nextContext),
        template_revision_id: serverContext.templateRevisionId,
        guideline_revision_id: serverContext.guidelineRevisionId,
        status: nextStatus,
        frozen_payload_json: Prisma.DbNull,
        frozen_payload_version: null,
        frozen_payload_hash: null,
        frozen_at: null,
        papsi_session_id: null,
        papsi_launch_url: null,
        last_handoff_error: null,
      },
    })

    return NextResponse.json({
      prepContext: nextContext,
      sessionStatus: nextStatus,
      templateRevisionId: serverContext.templateRevisionId,
      guidelineRevisionId: serverContext.guidelineRevisionId,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] refresh-mapping error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to refresh Grant Prep mapping',
      },
      { status: 500 }
    )
  }
}
