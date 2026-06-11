import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { GRANT_PREP_STAGE_BY_KEY } from '@/lib/grantPrep/stageLibrary'
import { getCanonicalGrantPrepStageKey } from '@/lib/grantPrep/stageModel'
import {
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
} from '@/lib/grantPrep/server'

const requestSchema = z.object({
  stageKey: z.string().min(1),
})

export async function PUT(
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
    const payload = requestSchema.parse(await request.json())
    const stageKey = getCanonicalGrantPrepStageKey(payload.stageKey as keyof typeof GRANT_PREP_STAGE_BY_KEY)
    if (!GRANT_PREP_STAGE_BY_KEY[stageKey]) {
      return NextResponse.json({ message: 'Unknown stage key' }, { status: 400 })
    }

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

    const prepContext = inflateGrantPrepSessionContext(grantPrepSession)
    const stageState = prepContext.stageStates[stageKey]
    if (!stageState?.enabled || !stageState?.pickable) {
      return NextResponse.json({ message: 'That stage is not available in this session' }, { status: 400 })
    }

    const nextContext = {
      ...prepContext,
      activeStageKey: stageKey,
    }

    await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: normalizeGrantPrepForPersistence(nextContext),
    })

    return NextResponse.json({
      activeStageKey: nextContext.activeStageKey,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] active-stage error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to update active stage',
      },
      { status: 500 }
    )
  }
}
