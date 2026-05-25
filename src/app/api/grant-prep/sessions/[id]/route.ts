import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { serializeGrantPrepSession } from '@/lib/grantPrep/compat'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
  refreshGrantPrepSessionContext,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import { isGrantPrepSessionReady } from '@/lib/grantPrep/sessionState'
import { getGrantPrepPostLaunchImpact } from '@/lib/grants/prepImpact'

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
    let grantPrepSession = await loadGrantPrepSession({
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

    const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, auth.actor, {
      grantSessionId: grantPrepSession.grant_session_id,
      fundingCallId: grantPrepSession.funding_call_id,
    })
    const warning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
    let prepContext = inflateGrantPrepSessionContext(grantPrepSession, {
      warning,
    })
    const canRefresh =
      grantPrepSession.status !== 'archived' &&
      grantPrepSession.status !== 'handed_off' &&
      grantPrepSession.status !== 'launched'
    const isStale =
      grantPrepSession.template_revision_id !== serverContext.templateRevisionId ||
      grantPrepSession.guideline_revision_id !== serverContext.guidelineRevisionId
    if (canRefresh && isStale) {
      prepContext = refreshGrantPrepSessionContext({
        sessionContext: prepContext,
        templateJson: serverContext.draftingContext?.approvedTemplate?.grant_template_json || null,
        guidelinePack: (serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as any) || null,
        fundingContext: serverContext.fundingContext,
        warning,
      })
      await prisma.grantPrepSession.update({
        where: { id: grantPrepSession.id },
        data: {
          ...normalizeGrantPrepForPersistence(prepContext),
          template_revision_id: serverContext.templateRevisionId,
          guideline_revision_id: serverContext.guidelineRevisionId,
          status: isGrantPrepSessionReady(prepContext.stageStates, prepContext.engagementMode) ? 'ready' : 'active',
          last_handoff_error: null,
        },
      })
      grantPrepSession = await loadGrantPrepSession({
        sessionId: id,
        tenantId: auth.actor.tenantId,
      })
      if (!grantPrepSession) {
        return NextResponse.json({ message: 'Grant Prep session not found' }, { status: 404 })
      }
      prepContext = inflateGrantPrepSessionContext(grantPrepSession, {
        warning,
      })
    }

    return NextResponse.json({
      session: serializeGrantPrepSession(grantPrepSession),
      prepContext,
      fundingContext: serverContext.fundingContext,
      draftingContext: {
        approvedGuidelineRevision: serverContext.draftingContext?.approvedGuidelineRevision || null,
        approvedTemplate: serverContext.draftingContext?.approvedTemplate || null,
      },
      postLaunchImpact: await getGrantPrepPostLaunchImpact({
        tenantId: auth.actor.tenantId,
        grantSessionId: grantPrepSession.grant_session_id,
        prepSessionId: grantPrepSession.id,
      }),
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
