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
  addGrantPrepSteeringEvent,
  canAutoAdvanceGrantPrepStage,
  collectGlobalKeywords,
  computeOverallReadiness,
  getGrantPrepPointStatus,
  hasStageContentChanged,
  isGrantPrepSessionReady,
  normalizeGrantPrepKeywords,
  normalizeGrantPrepStringArray,
  propagateDependentNeedsReview,
  recomputeStageState,
  requiresGrantPrepThrustLinkage,
} from '@/lib/grantPrep/sessionState'
import type { GrantPrepPointCapture, GrantPrepStageKey } from '@/lib/grantPrep/types'
import { runGrantPrepStageTidyPass } from '@/lib/grantPrep/tidyPass'
import { resolveGrantPrepTenantContext } from '@/lib/grantPrep/llm'
import { resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'

const requestSchema = z.discriminatedUnion('action', [
  z.object({
    stageKey: z.string().min(1),
    action: z.literal('reopen'),
  }),
  z.object({
    stageKey: z.string().min(1),
    action: z.literal('replace_keywords'),
    keywords: z.array(z.string()).max(30),
  }),
  z.object({
    stageKey: z.string().min(1),
    action: z.literal('skip'),
  }),
  z.object({
    stageKey: z.string().min(1),
    action: z.literal('unskip'),
  }),
])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pointKey: string }> }
) {
  const auth = await requireGrantPrepActor(request)
  if ('response' in auth) {
    return auth.response
  }

  const { id, pointKey } = await params
  if (!id || !pointKey) {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 })
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
    const warning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
    const prepContext = inflateGrantPrepSessionContext(grantPrepSession, { warning })
    const stageKey = payload.stageKey as GrantPrepStageKey
    const stageBeforeUpdate = prepContext.stageStates[stageKey]
    if (!stageBeforeUpdate?.enabled) {
      return NextResponse.json({ message: 'Stage is not available in this session' }, { status: 400 })
    }

    const pointBeforeUpdate = stageBeforeUpdate.points.find((point) => point.key === pointKey)
    if (!pointBeforeUpdate) {
      return NextResponse.json({ message: 'Discussion point not found' }, { status: 404 })
    }

    let nextStageStates = JSON.parse(JSON.stringify(prepContext.stageStates)) as typeof prepContext.stageStates
    const stageState = nextStageStates[stageKey]
    const point = stageState.points.find((item) => item.key === pointKey)
    if (!point) {
      return NextResponse.json({ message: 'Discussion point not found' }, { status: 404 })
    }

    if (payload.action === 'reopen') {
      point.status = point.capture ? 'needs_review' : 'pending'
      addGrantPrepSteeringEvent(
        stageState,
        'This point was reopened and should be reviewed before handoff.',
        'gentle_redirect',
        point.key
      )
    }

    if (payload.action === 'replace_keywords') {
      const nextKeywords = normalizeGrantPrepKeywords(payload.keywords || [])
      const nextCapture: GrantPrepPointCapture = {
        keywords: nextKeywords,
        thrustLinkage: normalizeGrantPrepStringArray(point.capture?.thrustLinkage),
        factBullets: normalizeGrantPrepStringArray(point.capture?.factBullets),
        ruleNotes: normalizeGrantPrepStringArray(point.capture?.ruleNotes),
        confidence: Number.isFinite(Number(point.capture?.confidence)) ? Number(point.capture?.confidence) : 0.7,
        captureBasis: ['user_confirmed'],
        sourceTemplatePointer: point.capture?.sourceTemplatePointer || point.sourceTemplatePointer || null,
        ruleCompliance: point.capture?.ruleCompliance || {
          status: 'ok',
          reason: null,
          rescopeNeeded: false,
        },
        updatedAt: new Date().toISOString(),
      }
      point.capture = nextCapture

      const statusResult = getGrantPrepPointStatus({
        stageKey,
        capture: nextCapture,
        requiresThrustLinkage: requiresGrantPrepThrustLinkage({
          selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
          availableFocusAreas: serverContext.fundingContext.focusAreas || [],
        }),
        engagementMode: prepContext.engagementMode,
        pointPriority: point.priority,
        budgetLimits: serverContext.fundingContext.budgetLimits || null,
        projectDuration: serverContext.fundingContext.projectDuration || null,
      })

      point.status = statusResult.status
      if (statusResult.steeringMessage && statusResult.steeringLevel) {
        addGrantPrepSteeringEvent(stageState, statusResult.steeringMessage, statusResult.steeringLevel, point.key)
      } else {
        addGrantPrepSteeringEvent(stageState, 'Keywords were updated manually for this point.', 'awareness_nudge', point.key)
      }
    }

    if (payload.action === 'skip') {
      if (point.priority !== 'P3') {
        return NextResponse.json({ message: 'Only priority-3 points can be skipped' }, { status: 400 })
      }
      point.capture = null
      point.status = 'skipped'
      addGrantPrepSteeringEvent(stageState, 'This optional point was skipped.', 'awareness_nudge', point.key)
    }

    if (payload.action === 'unskip') {
      point.status = normalizeGrantPrepKeywords(point.capture?.keywords).length > 0 ? 'needs_review' : 'pending'
      addGrantPrepSteeringEvent(stageState, 'This point was returned to the active checklist.', 'awareness_nudge', point.key)
    }

    recomputeStageState(stageState)

    const stageChanged = hasStageContentChanged(stageBeforeUpdate, stageState)
    const stageJustCompleted =
      !canAutoAdvanceGrantPrepStage(stageBeforeUpdate, prepContext.engagementMode) &&
      canAutoAdvanceGrantPrepStage(stageState, prepContext.engagementMode)
    if (stageJustCompleted) {
      const tenantContext = await resolveGrantPrepTenantContext(auth.actor.tenantId, auth.actor.id)
      if (!tenantContext) {
        return NextResponse.json(
          { message: 'Grant Prep tidy pass requires an active tenant plan before LLM usage can be metered.' },
          { status: 403 }
        )
      }

      nextStageStates = {
        ...nextStageStates,
        [stageKey]: await runGrantPrepStageTidyPass({
          stageKey,
          stageState: nextStageStates[stageKey],
          tenantContext,
        }),
      }
    }

    if (stageChanged) {
      nextStageStates = propagateDependentNeedsReview(
        nextStageStates,
        stageKey,
        `${stageBeforeUpdate.title} changed. Review downstream assumptions before handoff.`
      )
    }

    const nextContext = {
      ...prepContext,
      stageStates: nextStageStates,
      globalKeywords: collectGlobalKeywords(nextStageStates),
      warning,
    }
    const nextStatus = resolveMutableGrantPrepStatus({
      currentStatus: grantPrepSession.status,
      isReady: isGrantPrepSessionReady(nextStageStates, prepContext.engagementMode),
    })

    await prisma.grantPrepSession.update({
      where: { id: grantPrepSession.id },
      data: {
        ...normalizeGrantPrepForPersistence(nextContext),
        status: nextStatus,
        last_handoff_error: null,
      },
    })

    return NextResponse.json({
      prepContext: {
        ...nextContext,
        globalKeywords: normalizeGrantPrepKeywords(nextContext.globalKeywords),
      },
      sessionStatus: nextStatus,
      overallReadiness: computeOverallReadiness(nextStageStates),
      pointKey,
      stageKey,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] point update error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to update discussion point',
      },
      { status: 500 }
    )
  }
}
