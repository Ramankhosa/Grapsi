import { NextRequest, NextResponse } from 'next/server'

import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { serializeGrantPrepSession } from '@/lib/grantPrep/compat'
import { createOrReuseGrantPrepSession, loadGrantPrepSession } from '@/lib/grantPrep/server'
import type { GrantPrepStageKey } from '@/lib/grantPrep/types'

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

    const result = await createOrReuseGrantPrepSession({
      projectId: grantPrepSession.project_id,
      tenantId: auth.actor.tenantId,
      user: auth.actor,
      fundingCallId: grantPrepSession.funding_call_id,
      engagementMode: grantPrepSession.engagement_mode,
      selectedThrustAreaRuleKeys: grantPrepSession.selected_thrust_area_rule_keys,
      enabledStageKeys: grantPrepSession.enabled_stage_keys as GrantPrepStageKey[],
      disabledStageKeys: grantPrepSession.disabled_stage_keys as GrantPrepStageKey[],
      restart: true,
    })

    if (!result.session) {
      return NextResponse.json({ message: 'Failed to restart Grant Prep session' }, { status: 500 })
    }

    return NextResponse.json(
      {
        session: serializeGrantPrepSession(result.session),
        reused: result.reused,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[Grant Prep Sessions] restart error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to restart Grant Prep session',
      },
      { status: 500 }
    )
  }
}
