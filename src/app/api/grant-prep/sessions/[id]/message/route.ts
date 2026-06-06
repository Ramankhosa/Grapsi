import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'

import { prisma } from '@/lib/prisma'
import {
  releaseReservedServiceUsage,
  reserveServiceUsage,
  ServiceQuotaExceededError,
  trackServiceUsage,
} from '@/lib/service-usage-tracker'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { generateGrantPrepText, resolveGrantPrepTenantContext } from '@/lib/grantPrep/llm'
import { buildGrantPrepPrompt, buildIdeationPrompt } from '@/lib/grantPrep/promptComposer'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
  refreshGrantPrepSessionContext,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import {
  buildGrantPrepConversationBundle,
  getGrantPrepCrossStageAllowedPointKeys,
} from '@/lib/grantPrep/proactivePlanner'
import {
  parseGrantPrepResponse,
  sanitizeGrantPrepMarkerPayload,
  tryRepairGrantPrepResponse,
} from '@/lib/grantPrep/marker'
import {
  applyCrossStageMarkerToStageStates,
  applyMarkerToStageStates,
  canAutoAdvanceGrantPrepStage,
  collectGlobalKeywords,
  computeOverallReadiness,
  getNextPickableStageKey,
  hasStageContentChanged,
  isGrantPrepUserFacingPoint,
  isGrantPrepSessionReady,
  propagateDependentNeedsReview,
} from '@/lib/grantPrep/sessionState'
import { GRANT_PREP_STAGE_BY_KEY } from '@/lib/grantPrep/stageLibrary'
import { runGrantPrepStageTidyPass } from '@/lib/grantPrep/tidyPass'
import type {
  GrantPrepMarkerPayload,
  GrantPrepStageKey,
  GrantPrepStatus,
  GrantPrepSuggestedAnswer,
} from '@/lib/grantPrep/types'
import { resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'
import {
  mergeGrantPrepSuggestedAnswersWithInline,
  removeGrantPrepApprovalBundlePrefix,
} from '@/lib/grantPrep/suggestedAnswers'

const messageSchema = z.object({
  content: z.string().min(1).max(12000),
  clientMessageId: z.string().min(1).max(120).optional(),
  stageKey: z.string().optional(),
  selectedSuggestedAnswer: z.object({
    label: z.string().min(1).max(20),
    text: z.string().min(1).max(12000),
    rationale: z.string().max(1000).nullable().optional(),
    coverageSummary: z.string().max(1000).nullable().optional(),
    covers: z.array(z.object({
      stageKey: z.string().min(1).max(80),
      pointKey: z.string().min(1).max(160),
      label: z.string().min(1).max(240),
    })).max(12).optional(),
  }).optional(),
})

type GrantPrepTextGenerator = (
  prompt: string,
  action?: string,
  parameters?: Record<string, any>
) => Promise<string>

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function tryParseJsonObject(raw: string): GrantPrepMarkerPayload | null {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  try {
    const parsed = sanitizeGrantPrepMarkerPayload(JSON.parse(trimmed))
    if (parsed) {
      return parsed
    }
  } catch {}

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = sanitizeGrantPrepMarkerPayload(JSON.parse(trimmed.slice(start, end + 1)))
      if (parsed) {
        return parsed
      }
    } catch {}
  }

  return null
}

async function inferMarkerFromTurn(input: {
  stageKey: GrantPrepStageKey
  allowedPointKeys: string[]
  userMessage: string
  assistantMessage: string
  generateText: GrantPrepTextGenerator
}) {
  const prompt = [
    'Return only one JSON object.',
    'Infer a Grant Prep marker conservatively from the user message and assistant message below.',
    'Do not invent new facts.',
    `Stage key: ${input.stageKey}`,
    `Allowed point keys: ${input.allowedPointKeys.join(', ')}`,
    'Use only allowed point keys.',
    'Schema:',
    '{',
    '  "version": "brainstorm_marker_v1",',
    `  "stageKey": "${input.stageKey}",`,
    '  "pointsCovered": [{ "pointKey": "...", "keywords": ["..."], "thrustLinkage": [], "factBullets": ["specific drafting fact"], "ruleNotes": ["rule caveat"], "confidence": 0.8, "captureBasis": ["user_confirmed"], "ruleCompliance": { "status": "ok", "reason": null, "rescopeNeeded": false } }],',
    '  "crossStagePointsCovered": [],',
    '  "currentPoint": "..." | null,',
    '  "qualityAssessment": "strong" | "adequate" | "weak" | null,',
    '  "steeringEvents": []',
    '}',
    '',
    `User message: ${input.userMessage}`,
    `Assistant message: ${input.assistantMessage}`,
  ].join('\n')

  const raw = await input.generateText(prompt, 'marker_inference', { temperature: 0.2 })
  return tryParseJsonObject(raw)
}

async function compactAssistantMessage(
  message: string,
  hasAnswerOptions: boolean,
  generateText: GrantPrepTextGenerator
) {
  const charLimit = hasAnswerOptions ? 2500 : 1200
  const wordLimit = hasAnswerOptions ? 500 : 200

  if (message.length <= charLimit && countWords(message) <= wordLimit) {
    return message
  }

  const compactPrompt = hasAnswerOptions
    ? [
        'The assistant message below is too long. Rewrite it more concisely.',
        '',
        'RULES:',
        '1. PRESERVE ALL labeled answer options (A, B, C, etc.) word-for-word. Do not remove, merge, shorten, or reword them.',
        '2. Only shorten the prose paragraphs that come BEFORE the options.',
        '3. Limit the prose portion to 120 words max across 2 short paragraphs.',
        '4. Keep the question that introduces the options.',
        '5. Return the complete rewritten message with options intact.',
        '',
        '--- MESSAGE ---',
        message,
      ].join('\n')
    : [
        'The assistant message below is too long. Rewrite it more concisely.',
        'Keep the meaning and the single next question.',
        'Limit to 150 words max and 2 short paragraphs.',
        'Return only the rewritten assistant message.',
        '',
        '--- MESSAGE ---',
        message,
      ].join('\n')

  try {
    const compacted = await generateText(compactPrompt, 'assistant_compaction', { temperature: 0.2 })
    return compacted.trim() || message
  } catch {
    return message
  }
}

function buildSelectedSuggestedAnswerMarker(
  answer: GrantPrepSuggestedAnswer | undefined,
  stageKey: GrantPrepStageKey
): GrantPrepMarkerPayload | null {
  const covers = Array.isArray(answer?.covers) ? answer.covers : []
  const answerText = removeGrantPrepApprovalBundlePrefix(answer?.text || '').trim()
  if (!answer || !answerText || covers.length === 0) {
    return null
  }

  const buildPoint = (cover: NonNullable<GrantPrepSuggestedAnswer['covers']>[number]) => ({
    stageKey: cover.stageKey,
    pointKey: cover.pointKey,
    keywords: [answer.coverageSummary || cover.label].filter(Boolean) as string[],
    thrustLinkage: [],
    factBullets: [answerText],
    ruleNotes: answer.rationale ? [answer.rationale] : [],
    confidence: 0.92,
    captureBasis: ['user_confirmed'] as Array<'user_confirmed'>,
    ruleCompliance: {
      status: 'ok' as const,
      reason: null,
      rescopeNeeded: false,
    },
  })

  const pointsCovered = covers
    .filter((cover) => cover.stageKey === stageKey)
    .map(buildPoint)
  const crossStagePointsCovered = covers
    .filter((cover) => cover.stageKey !== stageKey)
    .map(buildPoint)

  if (pointsCovered.length === 0 && crossStagePointsCovered.length === 0) {
    return null
  }

  return {
    version: 'brainstorm_marker_v1',
    stageKey,
    pointsCovered,
    crossStagePointsCovered,
    currentPoint: null,
    suggestedFollowUps: null,
    suggestedAnswers: null,
    qualityAssessment: 'adequate',
    steeringEvents: [],
  }
}

function mergeSelectedSuggestedAnswerMarker(
  marker: GrantPrepMarkerPayload | null,
  selectedMarker: GrantPrepMarkerPayload | null
): GrantPrepMarkerPayload | null {
  if (!selectedMarker) {
    return marker
  }
  if (!marker || marker.stageKey !== selectedMarker.stageKey) {
    return selectedMarker
  }

  const mergePoints = (
    existing: NonNullable<GrantPrepMarkerPayload['pointsCovered']>,
    selected: NonNullable<GrantPrepMarkerPayload['pointsCovered']>
  ) => {
    const byKey = new Map<string, NonNullable<GrantPrepMarkerPayload['pointsCovered']>[number]>()
    for (const point of existing) {
      byKey.set(`${point.stageKey || marker.stageKey}:${point.pointKey}`, point)
    }
    for (const point of selected) {
      byKey.set(`${point.stageKey || selectedMarker.stageKey}:${point.pointKey}`, point)
    }
    return Array.from(byKey.values())
  }

  return {
    ...marker,
    pointsCovered: mergePoints(marker.pointsCovered || [], selectedMarker.pointsCovered || []),
    crossStagePointsCovered: mergePoints(marker.crossStagePointsCovered || [], selectedMarker.crossStagePointsCovered || []),
    qualityAssessment: marker.qualityAssessment || selectedMarker.qualityAssessment,
  }
}

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

  let reservedOperationId: string | null = null
  try {
    const payload = messageSchema.parse(await request.json())
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
    const prepWarning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
    let prepContext = inflateGrantPrepSessionContext(grantPrepSession, { warning: prepWarning })
    let currentSessionStatus = grantPrepSession.status as GrantPrepStatus
    const templateOrGuidelineStale =
      grantPrepSession.template_revision_id !== serverContext.templateRevisionId ||
      grantPrepSession.guideline_revision_id !== serverContext.guidelineRevisionId
    if (templateOrGuidelineStale) {
      prepContext = refreshGrantPrepSessionContext({
        sessionContext: prepContext,
        templateJson: serverContext.draftingContext?.approvedTemplate?.grant_template_json || null,
        guidelinePack: (serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as any) || null,
        fundingContext: serverContext.fundingContext,
        warning: prepWarning,
      })
      await prisma.grantPrepSession.update({
        where: { id: grantPrepSession.id },
        data: {
          ...normalizeGrantPrepForPersistence(prepContext),
          template_revision_id: serverContext.templateRevisionId,
          guideline_revision_id: serverContext.guidelineRevisionId,
          status: isGrantPrepSessionReady(prepContext.stageStates, prepContext.engagementMode) ? 'ready' : 'active',
          last_handoff_error: null,
        },
      })
      currentSessionStatus = isGrantPrepSessionReady(prepContext.stageStates, prepContext.engagementMode) ? 'ready' : 'active'
    }
    const duplicateUserMessage = payload.clientMessageId
      ? grantPrepSession.messages.find((message) => message.client_message_id === payload.clientMessageId)
      : null
    const stageKey = (duplicateUserMessage?.stage_key || payload.stageKey || prepContext.activeStageKey) as GrantPrepStageKey
    if (!GRANT_PREP_STAGE_BY_KEY[stageKey]) {
      return NextResponse.json({ message: 'Unknown stage key' }, { status: 400 })
    }

    if (!prepContext.stageStates[stageKey]?.enabled) {
      return NextResponse.json({ message: 'This stage is disabled for the current session' }, { status: 400 })
    }

    if (duplicateUserMessage) {
      const duplicateIndex = grantPrepSession.messages.findIndex((message) => message.id === duplicateUserMessage.id)
      const replayAssistant = duplicateIndex >= 0
        ? grantPrepSession.messages
            .slice(duplicateIndex + 1)
            .find((message) => message.role === 'assistant' && message.stage_key === stageKey)
        : null

      if (replayAssistant) {
        return NextResponse.json({
          replayed: true,
          duplicateMessageId: duplicateUserMessage.id,
          message: replayAssistant,
          prepContext,
          sessionStatus: currentSessionStatus,
        })
      }
    }

    const tenantContext = await resolveGrantPrepTenantContext(auth.actor.tenantId, auth.actor.id)
    if (!tenantContext) {
      return NextResponse.json(
        { message: 'Grant Prep chatbot requires an active tenant plan before LLM usage can be metered.' },
        { status: 403 }
      )
    }

    const generateText: GrantPrepTextGenerator = (llmPrompt, action = 'chat', parameters) =>
      generateGrantPrepText({
        prompt: llmPrompt,
        tenantContext,
        action,
        parameters,
        metadata: {
          sessionId: grantPrepSession.id,
          stageKey,
        },
      })
    const toPromptMessage = (message: { role: string; content: string }) => ({
      role: message.role,
      content: message.role === 'assistant'
        ? removeGrantPrepApprovalBundlePrefix(message.content)
        : message.content,
    })

    if (!duplicateUserMessage) {
      await prisma.grantPrepMessage.create({
        data: {
          session_id: grantPrepSession.id,
          stage_key: stageKey,
          role: 'user',
          content: payload.content,
          client_message_id: payload.clientMessageId || null,
        },
      })
    }

    const promptInput = {
      session: prepContext,
      stageKey,
      project: {
        title: grantPrepSession.project.name,
        description: null,
      },
      fundingContext: serverContext.fundingContext,
      guidelinePack: (serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as any) || null,
      conversation: duplicateUserMessage
        ? grantPrepSession.messages.map(toPromptMessage)
        : [
            ...grantPrepSession.messages.map(toPromptMessage),
            { role: 'user', content: payload.content },
          ],
      userMessage: payload.content,
    }
    const prompt = stageKey === 'ideation'
      ? buildIdeationPrompt(promptInput)
      : buildGrantPrepPrompt(promptInput)

    reservedOperationId = `grant-prep-message:${grantPrepSession.id}:${payload.clientMessageId || randomUUID()}`
    await reserveServiceUsage({
      tenantId: auth.actor.tenantId,
      userId: auth.actor.id,
      serviceType: 'GRANT_PREP',
      operationId: reservedOperationId,
      operationType: 'grant_prep_chat_message',
      metadata: { grantPrepSessionId: grantPrepSession.id, stageKey }
    })

    const rawResponse = await generateText(prompt, 'chat_response')

    const parsed = parseGrantPrepResponse(rawResponse)
    const repaired = parsed.marker
      ? parsed
      : await tryRepairGrantPrepResponse(
          rawResponse,
          (repairPrompt) => generateText(repairPrompt, 'marker_repair', { temperature: 0.2 }),
          {
            stageKey,
            userMessage: payload.content,
            allowedPointKeys: prepContext.stageStates[stageKey].points
              .filter((point) => isGrantPrepUserFacingPoint(point))
              .map((point) => point.key),
          }
        )

    const allowedPointKeys = prepContext.stageStates[stageKey].points
      .filter((point) => isGrantPrepUserFacingPoint(point))
      .map((point) => point.key)
    let inferredMarker =
      repaired.marker ||
      (await inferMarkerFromTurn({
        stageKey,
        allowedPointKeys,
        userMessage: payload.content,
        assistantMessage: repaired.assistantMessage,
        generateText,
      }))
    inferredMarker = mergeSelectedSuggestedAnswerMarker(
      inferredMarker,
      buildSelectedSuggestedAnswerMarker(payload.selectedSuggestedAnswer as GrantPrepSuggestedAnswer | undefined, stageKey)
    )
    if (inferredMarker) {
      const cleanedAssistantMessage = removeGrantPrepApprovalBundlePrefix(repaired.assistantMessage)
      const mergedSuggestedAnswers = mergeGrantPrepSuggestedAnswersWithInline(
        inferredMarker.suggestedAnswers || [],
        cleanedAssistantMessage
      )
      inferredMarker = {
        ...inferredMarker,
        suggestedAnswers: mergedSuggestedAnswers.length > 0 ? mergedSuggestedAnswers : null,
      }
    }

    const finalWarning =
      !repaired.marker && inferredMarker
        ? 'The assistant response marker was reconstructed from the turn before committing state.'
        : repaired.warning
    const finalMarkerStatus = inferredMarker
      ? (repaired.marker ? repaired.markerStatus : 'repaired')
      : 'invalid'

    const hasAnswerOptions = !!(inferredMarker?.suggestedAnswers && inferredMarker.suggestedAnswers.length > 0)
    const assistantMessage = await compactAssistantMessage(
      removeGrantPrepApprovalBundlePrefix(repaired.assistantMessage),
      hasAnswerOptions,
      generateText
    )
    if (inferredMarker) {
      const mergedSuggestedAnswers = mergeGrantPrepSuggestedAnswersWithInline(
        inferredMarker.suggestedAnswers || [],
        assistantMessage
      )
      inferredMarker = {
        ...inferredMarker,
        suggestedAnswers: mergedSuggestedAnswers.length > 0 ? mergedSuggestedAnswers : null,
      }
    }

    let nextContext = prepContext
    let nextStatus: GrantPrepStatus = resolveMutableGrantPrepStatus({
      currentStatus: currentSessionStatus,
      isReady: isGrantPrepSessionReady(prepContext.stageStates, prepContext.engagementMode),
    })

    if (inferredMarker && inferredMarker.stageKey === stageKey) {
      const allowedCrossStagePointKeys = getGrantPrepCrossStageAllowedPointKeys(
        buildGrantPrepConversationBundle({
          session: prepContext,
          stageKey,
          latestUserMessage: payload.content,
        })
      )
      const selectedCrossStagePointKeys = (payload.selectedSuggestedAnswer?.covers || [])
        .filter((cover) => cover.stageKey && cover.stageKey !== stageKey)
        .map((cover) => `${cover.stageKey}.${cover.pointKey}`)
      const effectiveAllowedCrossStagePointKeys = Array.from(new Set([
        ...allowedCrossStagePointKeys,
        ...selectedCrossStagePointKeys,
      ]))
      const stageBeforeUpdate = prepContext.stageStates[stageKey]
      let nextStageStates = applyMarkerToStageStates(prepContext.stageStates, stageKey, inferredMarker, {
        engagementMode: prepContext.engagementMode,
        selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
        availableFocusAreas: serverContext.fundingContext.focusAreas || [],
        budgetLimits: serverContext.fundingContext.budgetLimits || null,
        projectDuration: serverContext.fundingContext.projectDuration || null,
      })
      nextStageStates = applyCrossStageMarkerToStageStates(nextStageStates, inferredMarker, {
        engagementMode: prepContext.engagementMode,
        selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
        availableFocusAreas: serverContext.fundingContext.focusAreas || [],
        budgetLimits: serverContext.fundingContext.budgetLimits || null,
        projectDuration: serverContext.fundingContext.projectDuration || null,
        allowedCrossStagePointKeys: effectiveAllowedCrossStagePointKeys,
      })
      const stageAfterMarker = nextStageStates[stageKey]
      const stageChanged = hasStageContentChanged(stageBeforeUpdate, stageAfterMarker)
      const stageJustCompleted =
        !canAutoAdvanceGrantPrepStage(stageBeforeUpdate, prepContext.engagementMode) &&
        canAutoAdvanceGrantPrepStage(stageAfterMarker, prepContext.engagementMode)

      if (stageJustCompleted) {
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
          `${GRANT_PREP_STAGE_BY_KEY[stageKey].title} changed. Review downstream assumptions before handoff.`
        )
      }
      const crossStageChangedKeys = Array.from(
        new Set(
          (inferredMarker.crossStagePointsCovered || [])
            .map((point) => point.stageKey)
            .filter((value): value is GrantPrepStageKey => Boolean(value) && value !== stageKey)
        )
      )
      for (const targetStageKey of crossStageChangedKeys) {
        if (
          prepContext.stageStates[targetStageKey] &&
          nextStageStates[targetStageKey] &&
          hasStageContentChanged(prepContext.stageStates[targetStageKey], nextStageStates[targetStageKey])
        ) {
          nextStageStates = propagateDependentNeedsReview(
            nextStageStates,
            targetStageKey,
            `${GRANT_PREP_STAGE_BY_KEY[targetStageKey].title} changed from a proactive cross-stage capture. Review downstream assumptions before handoff.`
          )
        }
      }

      const candidateActiveStage =
        canAutoAdvanceGrantPrepStage(nextStageStates[stageKey], prepContext.engagementMode)
          ? getNextPickableStageKey(nextStageStates, stageKey)
          : stageKey
      const enabledStageKeys = Object.values(nextStageStates)
        .filter((stage) => stage.enabled)
        .map((stage) => stage.stageKey)
      const disabledStageKeys = Object.values(nextStageStates)
        .filter((stage) => !stage.enabled)
        .map((stage) => stage.stageKey)

      nextContext = {
        ...prepContext,
        activeStageKey: candidateActiveStage,
        enabledStageKeys,
        disabledStageKeys,
        stageStates: nextStageStates,
        globalKeywords: collectGlobalKeywords(nextStageStates),
        warning: prepWarning,
      }

      nextStatus = resolveMutableGrantPrepStatus({
        currentStatus: currentSessionStatus,
        isReady: isGrantPrepSessionReady(nextStageStates, prepContext.engagementMode),
      })
      const persistence = normalizeGrantPrepForPersistence(nextContext)
      await prisma.grantPrepSession.update({
        where: { id: grantPrepSession.id },
        data: {
          ...persistence,
          status: nextStatus,
          last_handoff_error: null,
        },
      })
    }

    const assistantRecord = await prisma.grantPrepMessage.create({
      data: {
        session_id: grantPrepSession.id,
        stage_key: stageKey,
        role: 'assistant',
        content: assistantMessage,
        marker_version: inferredMarker?.version || null,
        marker_status: finalMarkerStatus,
        readiness_snapshot: inferredMarker
          ? computeOverallReadiness(nextContext.stageStates)
          : grantPrepSession.overall_readiness,
        points_covered_snapshot: ([...(inferredMarker?.pointsCovered || []), ...(inferredMarker?.crossStagePointsCovered || [])]) as any,
        current_point: inferredMarker?.currentPoint || null,
        captured_content_json: (inferredMarker ? [...(inferredMarker.pointsCovered || []), ...(inferredMarker.crossStagePointsCovered || [])] : null) as any,
        steering_events_json: (inferredMarker?.steeringEvents || []) as any,
        suggested_follow_ups: inferredMarker?.suggestedFollowUps || [],
        suggested_answers: (inferredMarker?.suggestedAnswers || null) as any,
        quality_assessment: inferredMarker?.qualityAssessment || null,
      },
    })

    await trackServiceUsage({
      tenantId: auth.actor.tenantId,
      userId: auth.actor.id,
      serviceType: 'GRANT_PREP',
      operationId: reservedOperationId,
      operationType: 'grant_prep_chat_message',
      isCompleted: true,
      metadata: {
        grantPrepSessionId: grantPrepSession.id,
        stageKey
      }
    })

    return NextResponse.json({
      message: assistantRecord,
      prepContext: nextContext,
      sessionStatus: nextStatus,
      warning: finalWarning,
    })
  } catch (error) {
    if (reservedOperationId) {
      await releaseReservedServiceUsage(auth.actor.tenantId, 'GRANT_PREP', reservedOperationId).catch(() => undefined)
    }
    console.error('[Grant Prep Sessions] message error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to process Grant Prep message',
      },
      { status: error instanceof ServiceQuotaExceededError ? 429 : 500 }
    )
  }
}
