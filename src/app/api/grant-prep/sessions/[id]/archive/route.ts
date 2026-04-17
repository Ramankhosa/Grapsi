import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { loadGrantPrepSession } from '@/lib/grantPrep/server'

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

    await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: {
        status: 'archived',
      },
    })

    return NextResponse.json({
      status: 'archived',
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] archive error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to archive Grant Prep session',
      },
      { status: 500 }
    )
  }
}
