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
import {
  deriveGrantPrepPriorityAreaOptions,
  normalizeGrantPrepPriorityAreaSelection,
} from '@/lib/grantPrep/priorityAreas'
import {
  collectGlobalKeywords,
  reassessGrantPrepStageStates,
} from '@/lib/grantPrep/sessionState'

const requestSchema = z.object({
  selectedPriorityAreas: z.array(z.string().trim().min(1).max(200)).max(12),
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

    const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, auth.actor, {
      grantSessionId: grantPrepSession.grant_session_id,
      fundingCallId: grantPrepSession.funding_call_id,
    })
    const options = deriveGrantPrepPriorityAreaOptions(serverContext.fundingContext)
    const normalized = normalizeGrantPrepPriorityAreaSelection({
      selectedPriorityAreas: payload.selectedPriorityAreas,
      availablePriorityAreas: options,
      autoSelectSingle: true,
    })

    if (normalized.invalidPriorityAreas.length > 0) {
      return NextResponse.json(
        {
          message: `Selected priority areas are not available for this call: ${normalized.invalidPriorityAreas.join(', ')}`,
        },
        { status: 400 }
      )
    }

    if (options.length > 1 && normalized.selectedPriorityAreas.length === 0) {
      return NextResponse.json(
        { message: 'Select at least one target priority area.' },
        { status: 400 }
      )
    }

    const warning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
    const prepContext = inflateGrantPrepSessionContext(grantPrepSession, { warning })
    const stageStates = reassessGrantPrepStageStates(prepContext.stageStates, {
      engagementMode: prepContext.engagementMode,
      selectedThrustAreaRuleKeys: normalized.selectedPriorityAreas,
      availableFocusAreas: serverContext.fundingContext.focusAreas || [],
      budgetLimits: serverContext.fundingContext.budgetLimits || null,
      projectDuration: serverContext.fundingContext.projectDuration || null,
    })
    const prioritiesChanged = JSON.stringify([...prepContext.selectedThrustAreaRuleKeys].sort())
      !== JSON.stringify([...normalized.selectedPriorityAreas].sort())
    if (prioritiesChanged && stageStates.ideation.decision) {
      stageStates.ideation.decision.status = 'needs_revalidation'
    }
    const nextContext = {
      ...prepContext,
      selectedThrustAreaRuleKeys: normalized.selectedPriorityAreas,
      stageStates,
      globalKeywords: collectGlobalKeywords(stageStates),
    }

    await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: normalizeGrantPrepForPersistence(nextContext),
    })

    return NextResponse.json({
      selectedPriorityAreas: normalized.selectedPriorityAreas,
      prepContext: nextContext,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] priority-areas error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid target priority area payload' }, { status: 400 })
    }

    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to update target priority areas',
      },
      { status: 500 }
    )
  }
}
