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
import { resolveUpstreamStageDependencies, sortStageKeys } from '@/lib/grantPrep/selection'
import type { GrantPrepStageKey } from '@/lib/grantPrep/types'

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

    const prepContext = inflateGrantPrepSessionContext(grantPrepSession)
    const stageKeysToEnable = resolveUpstreamStageDependencies([stageKey])
    const nextManualEnabledStageKeys = sortStageKeys([...prepContext.manualEnabledStageKeys, ...stageKeysToEnable])
    const nextManualDisabledStageKeys = prepContext.manualDisabledStageKeys.filter(
      (value) => !stageKeysToEnable.includes(value)
    )
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
    console.error('[Grant Prep Sessions] enable-stage error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to enable stage',
      },
      { status: 500 }
    )
  }
}
