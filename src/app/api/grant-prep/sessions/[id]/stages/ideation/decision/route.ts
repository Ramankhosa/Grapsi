import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import {
  compileGrantPrepIdeaAnchor,
  hashGrantPrepIdeaAnchor,
  hashGrantPrepIdeaConstraints,
  normalizeGrantPrepIdeaAnchor,
} from '@/lib/grantPrep/ideaAnchor'
import { buildGrantPrepIdeationDecisionMarker } from '@/lib/grantPrep/decisionMarker'
import { resolveGrantPrepTenantContext } from '@/lib/grantPrep/llm'
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
  propagateDependentNeedsReview,
  seedGrantPrepStagePointsFromIdeaAnchor,
} from '@/lib/grantPrep/sessionState'
import { getNextEnabledPickableStageKey } from '@/lib/grantPrep/stageLibrary'
import { buildDeterministicGrantPrepStageMemory } from '@/lib/grantPrep/stageMemory'
import { resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'
import type { GrantPrepIdeationDecision, GrantPrepSuggestedAnswer } from '@/lib/grantPrep/types'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'

const requestSchema = z.object({
  sourceMessageId: z.string().min(1).max(160).optional(),
  optionLabel: z.string().min(1).max(20).optional(),
  ideaText: z.string().min(8).max(4000).optional(),
  previewOnly: z.boolean().optional(),
  compiledAnchor: z.unknown().optional(),
  previewAnchorHash: z.string().min(1).max(128).optional(),
  previewCompilationSource: z.enum(['llm', 'deterministic_fallback']).optional(),
  clientRequestId: z.string().min(1).max(120),
  expectedSessionUpdatedAt: z.string().datetime(),
}).refine(
  (value) => Boolean(value.ideaText || (value.sourceMessageId && value.optionLabel)),
  { message: 'Provide either a typed idea or a persisted idea option.' }
).refine(
  (value) => !value.previewOnly || Boolean(value.ideaText),
  { message: 'Anchor previews require a typed idea.' }
)

function findPersistedOption(message: { suggested_answers?: unknown }, label: string) {
  const options = Array.isArray(message.suggested_answers)
    ? message.suggested_answers as GrantPrepSuggestedAnswer[]
    : []
  return options.find((option) => String(option.label || '').trim().toLowerCase() === label.trim().toLowerCase()) || null
}

const buildDecisionMarker = buildGrantPrepIdeationDecisionMarker

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (session.updated_at.toISOString() !== new Date(payload.expectedSessionUpdatedAt).toISOString()) {
      return NextResponse.json({ message: 'Grant Prep changed while this idea was open. Refresh and confirm it again.' }, { status: 409 })
    }

    const serverContext = await resolveGrantPrepContext(session.project_id, auth.actor, {
      grantSessionId: session.grant_session_id,
      fundingCallId: session.funding_call_id,
    })
    const prepContext = inflateGrantPrepSessionContext(session, {
      warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
    })
    const currentDecision = prepContext.stageStates.ideation.decision
    if (currentDecision?.clientRequestId === payload.clientRequestId) {
      return NextResponse.json({
        prepContext,
        activeStageKey: prepContext.activeStageKey,
        sessionStatus: session.status,
        decision: currentDecision,
        warning: null,
      })
    }

    const typedIdea = payload.ideaText?.trim() || null
    const sourceMessage = typedIdea ? null : session.messages.find((message) =>
      message.id === payload.sourceMessageId && message.stage_key === 'ideation' && message.role === 'assistant'
    )
    if (!typedIdea && !sourceMessage) {
      return NextResponse.json({ message: 'That idea option is no longer available. Ask for three new ideas.' }, { status: 400 })
    }
    const option: GrantPrepSuggestedAnswer | null = typedIdea
      ? { label: 'User idea', text: typedIdea, rationale: null }
      : findPersistedOption(sourceMessage!, payload.optionLabel || '')
    if (!option?.text?.trim()) {
      return NextResponse.json({ message: 'That idea could not be verified.' }, { status: 400 })
    }
    if (
      sourceMessage
      &&
      currentDecision?.sourceMessageId === sourceMessage.id
      && currentDecision.selectedOption.label.toLowerCase() === option.label.toLowerCase()
    ) {
      return NextResponse.json({
        prepContext,
        activeStageKey: prepContext.activeStageKey,
        sessionStatus: session.status,
        decision: currentDecision,
        warning: null,
      })
    }

    const suppliedAnchor = typeof payload.compiledAnchor === 'undefined'
      ? null
      : normalizeGrantPrepIdeaAnchor(payload.compiledAnchor)
    if (typeof payload.compiledAnchor !== 'undefined' && !suppliedAnchor) {
      return NextResponse.json({ message: 'The compiled idea preview is invalid. Preview the idea again.' }, { status: 400 })
    }

    let compiled: {
      anchor: GrantPrepIdeationDecision['anchor']
      compilationSource: GrantPrepIdeationDecision['compilationSource']
      warning: string | null
    }
    if (suppliedAnchor) {
      const suppliedHash = hashGrantPrepIdeaAnchor(suppliedAnchor)
      if (!payload.previewAnchorHash || suppliedHash !== payload.previewAnchorHash) {
        return NextResponse.json({ message: 'The idea preview changed. Preview and confirm it again.' }, { status: 409 })
      }
      compiled = {
        anchor: suppliedAnchor,
        compilationSource: payload.previewCompilationSource || 'llm',
        warning: null,
      }
    } else {
      const tenantContext = await resolveGrantPrepTenantContext(auth.actor.tenantId, auth.actor.id)
      reservedOperationId = `grant-prep-finalize-idea:${session.id}:${payload.clientRequestId || randomUUID()}`
      await reserveServiceUsage({
        tenantId: auth.actor.tenantId,
        userId: auth.actor.id,
        serviceType: 'GRANT_PREP',
        operationId: reservedOperationId,
        operationType: 'grant_prep_finalize_idea',
        metadata: { grantPrepSessionId: session.id, sourceMessageId: sourceMessage?.id || null, optionLabel: option.label },
      })
      compiled = await compileGrantPrepIdeaAnchor({
        option,
        ideationStage: prepContext.stageStates.ideation,
        recentConversation: session.messages
          .filter((message) => message.stage_key === 'ideation')
          .map((message) => ({ role: message.role, content: message.content })),
        fundingContext: serverContext.fundingContext,
        selectedPriorityAreas: prepContext.selectedThrustAreaRuleKeys,
        tenantContext,
        idempotencyKey: reservedOperationId,
      })
    }
    const anchorHash = hashGrantPrepIdeaAnchor(compiled.anchor)
    if (payload.previewOnly) {
      if (reservedOperationId) {
        await trackServiceUsage({
          tenantId: auth.actor.tenantId,
          userId: auth.actor.id,
          serviceType: 'GRANT_PREP',
          operationId: reservedOperationId,
          operationType: 'grant_prep_finalize_idea',
          isCompleted: true,
          metadata: { grantPrepSessionId: session.id, anchorHash, previewOnly: true },
        })
        reservedOperationId = null
      }
      return NextResponse.json({
        preview: { anchor: compiled.anchor, anchorHash, compilationSource: compiled.compilationSource },
        warning: compiled.warning,
      })
    }
    const constraintHash = hashGrantPrepIdeaConstraints({
      fundingContext: serverContext.fundingContext,
      selectedPriorityAreas: prepContext.selectedThrustAreaRuleKeys,
      guidelineRevisionId: serverContext.guidelineRevisionId,
      templateRevisionId: serverContext.templateRevisionId,
    })
    let nextStageStates = applyMarkerToStageStates(
      prepContext.stageStates,
      'ideation',
      buildDecisionMarker(compiled.anchor, prepContext.selectedThrustAreaRuleKeys),
      {
        engagementMode: prepContext.engagementMode,
        selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
        availableFocusAreas: serverContext.fundingContext.focusAreas || [],
        budgetLimits: serverContext.fundingContext.budgetLimits || null,
        projectDuration: serverContext.fundingContext.projectDuration || null,
      }
    )
    const decision: GrantPrepIdeationDecision = {
      status: 'fixed',
      revision: (currentDecision?.revision || 0) + 1,
      fixedAt: new Date().toISOString(),
      sourceMessageId: sourceMessage?.id || `direct:${payload.clientRequestId}`,
      clientRequestId: payload.clientRequestId,
      selectedOption: { label: option.label, text: option.text, rationale: option.rationale || null },
      anchor: compiled.anchor,
      anchorHash,
      constraintHash,
      compilationSource: compiled.compilationSource,
    }
    nextStageStates.ideation.decision = decision
    nextStageStates.ideation.memory = buildDeterministicGrantPrepStageMemory(nextStageStates.ideation)
    if (currentDecision && currentDecision.anchorHash !== anchorHash) {
      nextStageStates = propagateDependentNeedsReview(
        nextStageStates,
        'ideation',
        'The chosen idea changed. Review downstream assumptions before handoff.'
      )
    }
    nextStageStates = seedGrantPrepStagePointsFromIdeaAnchor({
      stageStates: nextStageStates,
      anchor: compiled.anchor,
      selectedPriorityAreas: prepContext.selectedThrustAreaRuleKeys,
    })
    const activeStageKey = getNextEnabledPickableStageKey(nextStageStates, 'ideation') || 'ideation'
    const nextContext = {
      ...prepContext,
      activeStageKey,
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
      data: { ...persistence, status: nextStatus, last_handoff_error: null },
    })

    if (reservedOperationId) {
      await trackServiceUsage({
        tenantId: auth.actor.tenantId,
        userId: auth.actor.id,
        serviceType: 'GRANT_PREP',
        operationId: reservedOperationId,
        operationType: 'grant_prep_finalize_idea',
        isCompleted: true,
        metadata: { grantPrepSessionId: session.id, anchorHash, compilationSource: compiled.compilationSource },
      })
      reservedOperationId = null
    }

    if (updated.count !== 1) {
      return NextResponse.json({ message: 'Grant Prep changed during idea finalization. Refresh and confirm the idea again.' }, { status: 409 })
    }
    const refreshed = await prisma.grantPrepSession.findUnique({
      where: { id: session.id },
      select: { updated_at: true },
    })
    return NextResponse.json({
      prepContext: nextContext,
      activeStageKey,
      sessionStatus: nextStatus,
      decision,
      sessionUpdatedAt: refreshed?.updated_at.toISOString() || new Date().toISOString(),
      warning: compiled.warning,
    })
  } catch (error) {
    if (reservedOperationId) {
      await releaseReservedServiceUsage(auth.actor.tenantId, 'GRANT_PREP', reservedOperationId).catch(() => undefined)
    }
    console.error('[Grant Prep Sessions] finalize-idea error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to finalize the selected idea' },
      { status: error instanceof ServiceQuotaExceededError ? 429 : 500 }
    )
  }
}
