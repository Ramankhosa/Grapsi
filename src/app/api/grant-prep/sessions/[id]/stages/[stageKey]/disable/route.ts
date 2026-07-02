import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import {
  applyGrantPrepManualStageSelection,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
} from '@/lib/grantPrep/server'
import { GRANT_PREP_STAGE_BY_KEY } from '@/lib/grantPrep/stageLibrary'
import { getCanonicalGrantPrepStageKey } from '@/lib/grantPrep/stageModel'
import { isGrantPrepUserFacingPoint } from '@/lib/grantPrep/sessionState'
import { getEnabledDependentStageKeys, sortStageKeys } from '@/lib/grantPrep/selection'
import type { GrantPrepStageKey, PointPriority } from '@/lib/grantPrep/types'

function hasProtectedCapturedContent(stage: { points: Array<{ priority?: PointPriority; capture: unknown; status: string; conversationRole?: string; sourceTemplatePointer?: string | null }> }) {
  return stage.points.some(
    (point) =>
      (point.priority === 'P1' || point.priority === 'P2') &&
      isGrantPrepUserFacingPoint(point) &&
      point.capture &&
      point.status !== 'skipped'
  )
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stageKey: string }> }
) {
  const auth = await requireGrantPrepActor(request)
  if ('response' in auth) {
    return auth.response
  }

  const { id, stageKey: rawStageKey } = await params
  const stageKey = getCanonicalGrantPrepStageKey(rawStageKey as GrantPrepStageKey)
  if (!id || !rawStageKey) {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 })
  }

  if (!GRANT_PREP_STAGE_BY_KEY[stageKey]) {
    return NextResponse.json({ message: 'Unknown stage key' }, { status: 400 })
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
      return NextResponse.json({ message: 'This Grant Prep session is archived' }, { status: 400 })
    }
    if (!GRANT_PREP_STAGE_BY_KEY[stageKey].pickable) {
      return NextResponse.json({ message: 'That stage cannot be toggled manually' }, { status: 400 })
    }
    if (stageKey === 'ideation') {
      return NextResponse.json({ message: 'Idea & Angle is required because it anchors the rest of Grant Prep.' }, { status: 400 })
    }

    const prepContext = inflateGrantPrepSessionContext(grantPrepSession)
    const typedStageKey = stageKey
    const currentStage = prepContext.stageStates[typedStageKey]
    const dependentStageKeys = getEnabledDependentStageKeys(typedStageKey, prepContext.enabledStageKeys)
    if (currentStage.selectionLevel === 'required' && dependentStageKeys.length > 0) {
      return NextResponse.json(
        {
          message: `Disable dependent stages first: ${dependentStageKeys.map((key) => GRANT_PREP_STAGE_BY_KEY[key].title).join(', ')}`,
        },
        { status: 400 }
      )
    }
    if (hasProtectedCapturedContent(currentStage)) {
      return NextResponse.json(
        {
          message: 'This stage has captured required or recommended content. Reopen or clear those points before excluding the stage.',
        },
        { status: 400 }
      )
    }
    const nextManualEnabledStageKeys = prepContext.manualEnabledStageKeys.filter((value) => value !== typedStageKey)
    const nextManualDisabledStageKeys = sortStageKeys([...prepContext.manualDisabledStageKeys, typedStageKey])
    const nextContext = applyGrantPrepManualStageSelection({
      sessionContext: prepContext,
      manualEnabledStageKeys: nextManualEnabledStageKeys,
      manualDisabledStageKeys: nextManualDisabledStageKeys,
    })

    await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: normalizeGrantPrepForPersistence(nextContext),
    })

    return NextResponse.json({
      prepContext: nextContext,
      enabledStageKeys: nextContext.enabledStageKeys,
      disabledStageKeys: nextContext.disabledStageKeys,
      activeStageKey: nextContext.activeStageKey,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] disable-stage error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to disable stage',
      },
      { status: 500 }
    )
  }
}
