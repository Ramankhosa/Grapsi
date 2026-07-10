import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { generateGrantPrepText, resolveGrantPrepTenantContext } from '@/lib/grantPrep/llm'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import {
  applyMarkerToStageStates,
  collectGlobalKeywords,
  isGrantPrepSessionReady,
} from '@/lib/grantPrep/sessionState'
import { isPostLaunchGrantPrepStatus, resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'
import { getNextEnabledPickableStageKey } from '@/lib/grantPrep/stageLibrary'
import { normalizeGuidelinePack } from '@/lib/fundingGuidelines/utils'
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types'
import { parseJsonResponse } from '@/lib/fundingIntake/utils'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'
import {
  applyAiFillToLedger,
  buildDraftZeroCatalog,
  buildDraftZeroStageMarkers,
  parseDraftZeroAiFill,
  syncDraftZeroStateWithStageStates,
} from '@/lib/draftZero/extraction'
import { buildDraftZeroAiFillPrompt } from '@/lib/draftZero/promptComposer'
import { DRAFT_ZERO_AI_FILL_PROMPT_VERSION, normalizeDraftZeroState } from '@/lib/draftZero/types'

const requestSchema = z.object({
  /** Gap ids (`stageKey.pointKey`) to fill. Omit to fill every open gap. */
  points: z.array(z.string().min(3).max(180)).max(120).optional(),
  clientRequestId: z.string().min(1).max(120),
  expectedSessionUpdatedAt: z.string().datetime(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled('ENABLE_DRAFT_ZERO')) {
    return NextResponse.json({ message: 'Draft Zero is not enabled.' }, { status: 404 })
  }
  const auth = await requireGrantPrepActor(request)
  if ('response' in auth) return auth.response
  const { id } = await params
  let reservedOperationId: string | null = null

  try {
    const payload = requestSchema.parse(await request.json())
    const session = await loadGrantPrepSession({ sessionId: id, tenantId: auth.actor.tenantId })
    if (!session) return NextResponse.json({ message: 'Grant Prep session not found' }, { status: 404 })
    const access = await assertGrantPrepProjectCapability(auth.actor, session.project_id, 'editContent')
    if (access instanceof NextResponse) return access
    if (session.status === 'archived') {
      return NextResponse.json({ message: 'Archived Grant Prep sessions cannot be changed.' }, { status: 409 })
    }
    if (isPostLaunchGrantPrepStatus(session.status)) {
      return NextResponse.json(
        { message: 'This session already launched a workspace. Claims are read-only now.' },
        { status: 409 }
      )
    }

    const serverContext = await resolveGrantPrepContext(session.project_id, auth.actor, {
      grantSessionId: session.grant_session_id,
      fundingCallId: session.funding_call_id,
    })
    const prepContext = inflateGrantPrepSessionContext(session, {
      warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
    })
    const storedState = normalizeDraftZeroState(session.draft_zero_state_json)
    if (!storedState) {
      return NextResponse.json({ message: 'Generate Draft Zero before asking the AI to fill gaps.' }, { status: 400 })
    }
    let draftZeroState = syncDraftZeroStateWithStageStates(storedState, prepContext.stageStates)

    const requestedIds = payload.points?.length ? new Set(payload.points) : null
    const enabledStageKeys = new Set(
      Object.values(prepContext.stageStates)
        .filter((stage) => stage.enabled && stage.pickable)
        .map((stage) => String(stage.stageKey))
    )
    const targetGaps = draftZeroState.gaps.filter(
      (gap) =>
        gap.status === 'open' &&
        gap.stageKey !== 'ideation' &&
        enabledStageKeys.has(gap.stageKey) &&
        (!requestedIds || requestedIds.has(gap.id))
    )

    // Nothing left to fill (e.g. a retried request after a lost response) —
    // return the current state instead of billing another LLM call.
    if (!targetGaps.length) {
      return NextResponse.json({
        prepContext,
        draftZero: draftZeroState,
        sessionStatus: session.status,
        sessionUpdatedAt: session.updated_at.toISOString(),
        warnings: [],
        filledCount: 0,
      })
    }

    if (session.updated_at.toISOString() !== new Date(payload.expectedSessionUpdatedAt).toISOString()) {
      return NextResponse.json({ message: 'Grant Prep changed while this sweep was open. Refresh and continue.' }, { status: 409 })
    }

    const tenantContext = await resolveGrantPrepTenantContext(auth.actor.tenantId, auth.actor.id)
    if (!tenantContext) {
      return NextResponse.json(
        { message: 'Draft Zero requires an active tenant plan before LLM usage can be metered.' },
        { status: 403 }
      )
    }

    reservedOperationId = `draft-zero-ai-fill:${session.id}:${payload.clientRequestId}`
    await reserveServiceUsage({
      tenantId: auth.actor.tenantId,
      userId: auth.actor.id,
      serviceType: 'GRANT_PREP',
      operationId: reservedOperationId,
      operationType: 'draft_zero_ai_fill',
      metadata: { grantPrepSessionId: session.id, gapCount: targetGaps.length },
    })

    let guidelinePack: GuidelinePackDocument | null = null
    try {
      const rawPack = serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json
        ?? (serverContext.draftingContext?.approvedGuidelineRevision as { extractedPayload?: unknown } | null | undefined)?.extractedPayload
      guidelinePack = rawPack ? normalizeGuidelinePack(rawPack) : null
    } catch {
      guidelinePack = null
    }

    const catalog = buildDraftZeroCatalog(prepContext)
    const prompt = buildDraftZeroAiFillPrompt({
      gaps: targetGaps,
      catalog,
      claims: draftZeroState.claims,
      ideaTitle: prepContext.stageStates.ideation?.decision?.anchor?.title || draftZeroState.generation.ideaTitle,
      ideaSummary:
        prepContext.stageStates.ideation?.decision?.anchor?.oneSentenceSummary || draftZeroState.generation.ideaSummary,
      seedText: draftZeroState.seed.text || '',
      fundingContext: serverContext.fundingContext,
      guidelinePack,
      selectedPriorityAreas: prepContext.selectedThrustAreaRuleKeys,
    })

    const rawOutput = await generateGrantPrepText({
      prompt,
      tenantContext,
      action: 'draft_zero_ai_fill',
      idempotencyKey: `${reservedOperationId}:fill`,
      parameters: {
        purpose: 'draft_zero',
        temperature: 0.3,
        responseMimeType: 'application/json',
        response_format: { type: 'json_object' },
      },
      metadata: {
        sessionId: session.id,
        promptChars: prompt.length,
        promptVersion: DRAFT_ZERO_AI_FILL_PROMPT_VERSION,
      },
    })
    const parsed = parseDraftZeroAiFill(parseJsonResponse(rawOutput), targetGaps)
    if (!parsed.claims.length) {
      await releaseReservedServiceUsage(auth.actor.tenantId, 'GRANT_PREP', reservedOperationId).catch(() => undefined)
      reservedOperationId = null
      return NextResponse.json(
        { message: 'The AI could not draft usable answers for these gaps. Try again or answer them yourself.' },
        { status: 502 }
      )
    }

    // AI drafts land exactly like extraction claims: amber/violet needs_review
    // captures that stay launch-blocking until the researcher confirms them.
    const markerOptions = {
      engagementMode: prepContext.engagementMode,
      selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
      availableFocusAreas: serverContext.fundingContext.focusAreas || [],
      budgetLimits: serverContext.fundingContext.budgetLimits || null,
      projectDuration: serverContext.fundingContext.projectDuration || null,
    }
    const effectivePriorityAreas = prepContext.selectedThrustAreaRuleKeys.length
      ? prepContext.selectedThrustAreaRuleKeys
      : (serverContext.fundingContext.focusAreas || []).slice(0, 3)
    let nextStageStates = prepContext.stageStates
    const stageMarkers = buildDraftZeroStageMarkers(parsed.claims, { priorityAreas: effectivePriorityAreas })
    for (const [stageKey, marker] of stageMarkers) {
      nextStageStates = applyMarkerToStageStates(nextStageStates, stageKey, marker, markerOptions)
    }

    draftZeroState = syncDraftZeroStateWithStageStates(
      applyAiFillToLedger(draftZeroState, parsed.claims),
      nextStageStates
    )

    const nextContext = {
      ...prepContext,
      activeStageKey: getNextEnabledPickableStageKey(nextStageStates, 'ideation') || prepContext.activeStageKey,
      stageStates: nextStageStates,
      globalKeywords: collectGlobalKeywords(nextStageStates),
    }
    const nextStatus = resolveMutableGrantPrepStatus({
      currentStatus: session.status,
      isReady: isGrantPrepSessionReady(nextStageStates, prepContext.engagementMode),
    })
    const persistence = normalizeGrantPrepForPersistence(nextContext)
    const updated = await prisma.grantPrepSession.updateMany({
      where: { id: session.id, updated_at: session.updated_at },
      data: {
        ...persistence,
        status: nextStatus,
        last_handoff_error: null,
        draft_zero_state_json: draftZeroState as unknown as Prisma.InputJsonValue,
      },
    })
    if (updated.count !== 1) {
      await releaseReservedServiceUsage(auth.actor.tenantId, 'GRANT_PREP', reservedOperationId).catch(() => undefined)
      reservedOperationId = null
      return NextResponse.json({ message: 'Grant Prep changed during the AI fill. Refresh and try again.' }, { status: 409 })
    }

    await trackServiceUsage({
      tenantId: auth.actor.tenantId,
      userId: auth.actor.id,
      serviceType: 'GRANT_PREP',
      operationId: reservedOperationId,
      operationType: 'draft_zero_ai_fill',
      isCompleted: true,
      metadata: {
        grantPrepSessionId: session.id,
        requestedGaps: targetGaps.length,
        filledCount: parsed.claims.length,
      },
    })
    reservedOperationId = null

    const refreshed = await prisma.grantPrepSession.findUnique({
      where: { id: session.id },
      select: { updated_at: true },
    })
    return NextResponse.json({
      prepContext: nextContext,
      draftZero: draftZeroState,
      sessionStatus: nextStatus,
      sessionUpdatedAt: refreshed?.updated_at.toISOString() || new Date().toISOString(),
      warnings: parsed.warnings,
      filledCount: parsed.claims.length,
    })
  } catch (error) {
    if (reservedOperationId) {
      await releaseReservedServiceUsage(auth.actor.tenantId, 'GRANT_PREP', reservedOperationId).catch(() => undefined)
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid request payload.' }, { status: 400 })
    }
    console.error('[Draft Zero] ai-fill error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'AI fill failed' },
      { status: error instanceof ServiceQuotaExceededError ? 429 : 500 }
    )
  }
}
