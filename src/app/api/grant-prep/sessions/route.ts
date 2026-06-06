import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { serializeGrantPrepSession } from '@/lib/grantPrep/compat'
import { createOrReuseGrantPrepSession } from '@/lib/grantPrep/server'
import type { GrantPrepStageKey } from '@/lib/grantPrep/types'
import { normalizeGrantPrepEngagementMode } from '@/lib/grantPrep/types'

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  fundingCallId: z.string().min(1).optional().nullable(),
  engagementMode: z.preprocess(normalizeGrantPrepEngagementMode, z.enum(['expert', 'express'])).default('expert'),
  selectedThrustAreaRuleKeys: z.array(z.string()).optional(),
  selectedPriorityAreas: z.array(z.string()).optional(),
  enabledStageKeys: z.array(z.string()).optional(),
  disabledStageKeys: z.array(z.string()).optional(),
  restart: z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
  const auth = await requireGrantPrepActor(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const payload = createSessionSchema.parse(await request.json())
    const accessResult = await assertGrantPrepProjectCapability(auth.actor, payload.projectId, 'editContent')
    if (accessResult instanceof NextResponse) {
      return accessResult
    }

    const result = await createOrReuseGrantPrepSession({
      projectId: payload.projectId,
      tenantId: auth.actor.tenantId,
      user: auth.actor,
      fundingCallId: payload.fundingCallId ?? null,
      engagementMode: payload.engagementMode,
      selectedThrustAreaRuleKeys: payload.selectedPriorityAreas ?? payload.selectedThrustAreaRuleKeys,
      enabledStageKeys: payload.enabledStageKeys as GrantPrepStageKey[] | undefined,
      disabledStageKeys: payload.disabledStageKeys as GrantPrepStageKey[] | undefined,
      restart: payload.restart,
    })

    if (!result.session) {
      return NextResponse.json({ message: 'Failed to create Grant Prep session' }, { status: 500 })
    }

    return NextResponse.json(
      {
        session: serializeGrantPrepSession(result.session),
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201 }
    )
  } catch (error) {
    console.error('[Grant Prep Sessions] create error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to create Grant Prep session',
      },
      { status: 500 }
    )
  }
}
