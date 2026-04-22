import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'

const requestSchema = z.object({
  engagementMode: z.enum(['expert', 'express']),
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
      return NextResponse.json({ message: 'Archived Grant Prep sessions are read-only' }, { status: 400 })
    }

    if (grantPrepSession.status === 'handed_off' || grantPrepSession.status === 'launched') {
      return NextResponse.json(
        {
          message: 'This Grant Prep session is already in Grapsi. Start a new prep revision to make further changes.',
        },
        { status: 400 }
      )
    }

    const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, auth.actor)
    const warning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
    const prepContext = inflateGrantPrepSessionContext(grantPrepSession, { warning })
    const nextContext = {
      ...prepContext,
      engagementMode: payload.engagementMode,
      warning,
    }

    await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: normalizeGrantPrepForPersistence(nextContext),
    })

    return NextResponse.json({
      engagementMode: nextContext.engagementMode,
      prepContext: nextContext,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] engagement-mode error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to update engagement mode',
      },
      { status: 500 }
    )
  }
}
