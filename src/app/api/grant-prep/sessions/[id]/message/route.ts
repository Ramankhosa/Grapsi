import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { generateFromGemini } from '@/lib/geminiService'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
import { getGrantPrepGeminiModel } from '@/lib/grantPrep/model'
import { buildGrantPrepPrompt } from '@/lib/grantPrep/promptComposer'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  normalizeGrantPrepForPersistence,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import {
  parseGrantPrepResponse,
  sanitizeGrantPrepMarkerPayload,
  tryRepairGrantPrepResponse,
} from '@/lib/grantPrep/marker'
import {
  applyMarkerToStageStates,
  collectGlobalKeywords,
  computeOverallReadiness,
  getNextPickableStageKey,
  hasStageContentChanged,
  propagateDependentNeedsReview,
} from '@/lib/grantPrep/sessionState'
import { GRANT_PREP_STAGE_BY_KEY } from '@/lib/grantPrep/stageLibrary'
import { runGrantPrepStageTidyPass } from '@/lib/grantPrep/tidyPass'
import type { GrantPrepMarkerPayload, GrantPrepStageKey } from '@/lib/grantPrep/types'

const messageSchema = z.object({
  content: z.string().min(1).max(12000),
  clientMessageId: z.string().min(1).max(120).optional(),
  stageKey: z.string().optional(),
})

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
    '  "currentPoint": "..." | null,',
    '  "steeringEvents": []',
    '}',
    '',
    `User message: ${input.userMessage}`,
    `Assistant message: ${input.assistantMessage}`,
  ].join('\n')

  const raw = await generateFromGemini(prompt, getGrantPrepGeminiModel())
  return tryParseJsonObject(raw)
}

async function compactAssistantMessage(message: string, hasAnswerOptions: boolean) {
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
    const compacted = await generateFromGemini(compactPrompt, getGrantPrepGeminiModel())
    return compacted.trim() || message
  } catch {
    return message
  }
}

function isSessionReady(stageStates: ReturnType<typeof inflateGrantPrepSessionContext>['stageStates']) {
  return Object.values(stageStates).every((stage) => !stage.enabled || !stage.pickable || stage.readiness >= 0.65)
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

    if (grantPrepSession.status === 'handed_off' || grantPrepSession.status === 'launched') {
      return NextResponse.json(
        {
          message: 'This Grant Prep session is already in Grapsi. Start a new prep revision to make further changes.',
        },
        { status: 400 }
      )
    }

    if (payload.clientMessageId) {
      const duplicate = grantPrepSession.messages.find((message) => message.client_message_id === payload.clientMessageId)
      if (duplicate) {
        return NextResponse.json({
          replayed: true,
          duplicateMessageId: duplicate.id,
        })
      }
    }

    const serverContext = await resolveGrantPrepContext(grantPrepSession.project_id, auth.actor)
    const prepWarning = buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning)
    const prepContext = inflateGrantPrepSessionContext(grantPrepSession, { warning: prepWarning })
    const stageKey = (payload.stageKey || prepContext.activeStageKey) as GrantPrepStageKey
    if (!GRANT_PREP_STAGE_BY_KEY[stageKey]) {
      return NextResponse.json({ message: 'Unknown stage key' }, { status: 400 })
    }

    if (!prepContext.stageStates[stageKey]?.enabled) {
      return NextResponse.json({ message: 'This stage is disabled for the current session' }, { status: 400 })
    }

    await prisma.grantPrepMessage.create({
      data: {
        session_id: grantPrepSession.id,
        stage_key: stageKey,
        role: 'user',
        content: payload.content,
        client_message_id: payload.clientMessageId || null,
      },
    })

    const prompt = buildGrantPrepPrompt({
      session: prepContext,
      stageKey,
      project: {
        title: grantPrepSession.project.name,
        description: null,
      },
      fundingContext: serverContext.fundingContext,
      guidelinePack: (serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json as any) || null,
      conversation: [
        ...grantPrepSession.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: payload.content },
      ],
      userMessage: payload.content,
    })

    const rawResponse = await generateFromGemini(prompt, getGrantPrepGeminiModel())

    const parsed = parseGrantPrepResponse(rawResponse)
    const repaired = parsed.marker
      ? parsed
      : await tryRepairGrantPrepResponse(
          rawResponse,
          (repairPrompt) => generateFromGemini(repairPrompt, getGrantPrepGeminiModel()),
          {
            stageKey,
            userMessage: payload.content,
            allowedPointKeys: prepContext.stageStates[stageKey].points.map((point) => point.key),
          }
        )

    const allowedPointKeys = prepContext.stageStates[stageKey].points.map((point) => point.key)
    const inferredMarker =
      repaired.marker ||
      (await inferMarkerFromTurn({
        stageKey,
        allowedPointKeys,
        userMessage: payload.content,
        assistantMessage: repaired.assistantMessage,
      }))

    const finalWarning =
      !repaired.marker && inferredMarker
        ? 'The assistant response marker was reconstructed from the turn before committing state.'
        : repaired.warning

    const hasAnswerOptions = !!(inferredMarker?.suggestedAnswers && inferredMarker.suggestedAnswers.length > 0)
    const assistantMessage = await compactAssistantMessage(repaired.assistantMessage, hasAnswerOptions)

    let nextContext = prepContext
    let nextStatus = grantPrepSession.status

    if (inferredMarker && inferredMarker.stageKey === stageKey) {
      const stageBeforeUpdate = prepContext.stageStates[stageKey]
      let nextStageStates = applyMarkerToStageStates(prepContext.stageStates, stageKey, inferredMarker, {
        selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
        availableFocusAreas: serverContext.fundingContext.focusAreas || [],
        budgetLimits: serverContext.fundingContext.budgetLimits || null,
        projectDuration: serverContext.fundingContext.projectDuration || null,
      })
      const stageAfterMarker = nextStageStates[stageKey]
      const stageChanged = hasStageContentChanged(stageBeforeUpdate, stageAfterMarker)
      const stageJustCompleted = stageBeforeUpdate.readiness < 0.65 && stageAfterMarker.readiness >= 0.65

      if (stageJustCompleted) {
        nextStageStates = {
          ...nextStageStates,
          [stageKey]: await runGrantPrepStageTidyPass({
            stageKey,
            stageState: nextStageStates[stageKey],
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

      const candidateActiveStage =
        nextStageStates[stageKey].readiness >= 0.65
          ? getNextPickableStageKey(nextStageStates, stageKey)
          : stageKey

      nextContext = {
        ...prepContext,
        activeStageKey: candidateActiveStage,
        stageStates: nextStageStates,
        globalKeywords: collectGlobalKeywords(nextStageStates),
        warning: prepWarning,
      }

      nextStatus = isSessionReady(nextStageStates) ? 'ready' : 'active'
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
        marker_status: inferredMarker ? repaired.markerStatus : 'invalid',
        readiness_snapshot: inferredMarker
          ? computeOverallReadiness(nextContext.stageStates)
          : grantPrepSession.overall_readiness,
        points_covered_snapshot: (inferredMarker?.pointsCovered || []) as any,
        current_point: inferredMarker?.currentPoint || null,
        captured_content_json: (inferredMarker?.pointsCovered || null) as any,
        steering_events_json: (inferredMarker?.steeringEvents || []) as any,
        suggested_follow_ups: inferredMarker?.suggestedFollowUps || [],
        suggested_answers: (inferredMarker?.suggestedAnswers || null) as any,
        quality_assessment: inferredMarker?.qualityAssessment || null,
      },
    })

    return NextResponse.json({
      message: assistantRecord,
      prepContext: nextContext,
      sessionStatus: nextStatus,
      warning: finalWarning,
    })
  } catch (error) {
    console.error('[Grant Prep Sessions] message error:', error)
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to process Grant Prep message',
      },
      { status: 500 }
    )
  }
}
