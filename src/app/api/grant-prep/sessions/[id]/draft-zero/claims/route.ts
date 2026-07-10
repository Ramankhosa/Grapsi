import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { assertGrantPrepProjectCapability, requireGrantPrepActor } from '@/lib/grantPrep/access'
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
  recomputeStageState,
} from '@/lib/grantPrep/sessionState'
import { isPostLaunchGrantPrepStatus, resolveMutableGrantPrepStatus } from '@/lib/grantPrep/status'
import { getNextEnabledPickableStageKey } from '@/lib/grantPrep/stageLibrary'
import type {
  GrantPrepMarkerPayload,
  GrantPrepMarkerPoint,
  GrantPrepStageKey,
} from '@/lib/grantPrep/types'
import { buildDraftZeroConfirmationMarkerPoint, syncDraftZeroStateWithStageStates } from '@/lib/draftZero/extraction'
import { normalizeDraftZeroState, type DraftZeroState } from '@/lib/draftZero/types'

const actionSchema = z.object({
  stageKey: z.string().min(1).max(60),
  pointKey: z.string().min(1).max(120),
  action: z.enum(['confirm', 'edit', 'fill_gap', 'reject']),
  text: z.string().trim().max(2000).optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
})

const requestSchema = z.object({
  actions: z.array(actionSchema).min(1).max(60),
  expectedSessionUpdatedAt: z.string().datetime(),
})

function updateLedger(
  state: DraftZeroState,
  stageKey: string,
  pointKey: string,
  action: 'confirm' | 'edit' | 'fill_gap' | 'reject',
  text: string | null
): DraftZeroState {
  const id = `${stageKey}.${pointKey}`
  const decidedAt = new Date().toISOString()
  const claims = state.claims.map((claim) => {
    if (claim.id !== id) return claim
    if (action === 'reject') return { ...claim, status: 'rejected' as const, decidedAt }
    if (action === 'confirm') return { ...claim, status: 'confirmed' as const, decidedAt }
    return {
      ...claim,
      status: 'edited' as const,
      decidedAt,
      claimText: text || claim.claimText,
      factBullets: text ? [text] : claim.factBullets,
    }
  })
  let gaps = state.gaps.map((gap) =>
    gap.id === id && (action === 'fill_gap' || action === 'edit' || action === 'confirm')
      ? { ...gap, status: 'filled' as const }
      : gap
  )
  if (action === 'reject') {
    // A rejected claim leaves its point pending (a launch blocker) — reopen it
    // as a gap so the Proof Room still offers a way to supply the fact.
    const rejectedClaim = state.claims.find((claim) => claim.id === id)
    const existingGap = gaps.find((gap) => gap.id === id)
    if (existingGap) {
      gaps = gaps.map((gap) => (gap.id === id ? { ...gap, status: 'open' as const } : gap))
    } else if (rejectedClaim) {
      gaps = [
        ...gaps,
        {
          id,
          stageKey: rejectedClaim.stageKey,
          pointKey: rejectedClaim.pointKey,
          pointLabel: rejectedClaim.pointLabel,
          priority: rejectedClaim.priority,
          ask: `Provide: ${rejectedClaim.pointLabel}`,
          status: 'open' as const,
        },
      ]
    }
  }
  return { ...state, claims, gaps }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled('ENABLE_DRAFT_ZERO')) {
    return NextResponse.json({ message: 'Draft Zero is not enabled.' }, { status: 404 })
  }
  const auth = await requireGrantPrepActor(request)
  if ('response' in auth) return auth.response
  const { id } = await params

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
    if (session.updated_at.toISOString() !== new Date(payload.expectedSessionUpdatedAt).toISOString()) {
      return NextResponse.json({ message: 'Grant Prep changed while this sweep was open. Refresh and continue.' }, { status: 409 })
    }

    const serverContext = await resolveGrantPrepContext(session.project_id, auth.actor, {
      grantSessionId: session.grant_session_id,
      fundingCallId: session.funding_call_id,
    })
    const prepContext = inflateGrantPrepSessionContext(session, {
      warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
    })
    let draftZeroState = normalizeDraftZeroState(session.draft_zero_state_json)
    if (!draftZeroState) {
      return NextResponse.json({ message: 'Generate Draft Zero before reviewing claims.' }, { status: 400 })
    }

    const markerOptions = {
      engagementMode: prepContext.engagementMode,
      selectedThrustAreaRuleKeys: prepContext.selectedThrustAreaRuleKeys,
      availableFocusAreas: serverContext.fundingContext.focusAreas || [],
      budgetLimits: serverContext.fundingContext.budgetLimits || null,
      projectDuration: serverContext.fundingContext.projectDuration || null,
    }

    let nextStageStates = prepContext.stageStates
    const markerPointsByStage = new Map<GrantPrepStageKey, GrantPrepMarkerPoint[]>()

    // Same-point actions in one batch are order-ambiguous (rejects mutate
    // inline, markers apply after the loop) — keep only the last action per point.
    const dedupedActions = Array.from(
      new Map(payload.actions.map((action) => [`${action.stageKey}.${action.pointKey}`, action])).values()
    )

    for (const action of dedupedActions) {
      const stageKey = action.stageKey as GrantPrepStageKey
      const stage = nextStageStates[stageKey]
      if (!stage || !stage.enabled) {
        return NextResponse.json({ message: `Stage "${action.stageKey}" is not part of this session.` }, { status: 400 })
      }
      if (stageKey === 'ideation') {
        return NextResponse.json({ message: 'The finalized idea is managed through the idea anchor, not claim actions.' }, { status: 400 })
      }
      const point = stage.points.find((entry) => entry.key === action.pointKey)
      if (!point) {
        return NextResponse.json({ message: `Point "${action.pointKey}" was not found in ${stage.title}.` }, { status: 404 })
      }

      // Scope actions to the Draft Zero ledger: this route must not be usable
      // to bulk-clear compliance review on arbitrary (e.g. chat-path) captures.
      const ledgerId = `${stageKey}.${action.pointKey}`
      const ledgerClaim = draftZeroState.claims.find((claim) => claim.id === ledgerId)
      const ledgerGap = draftZeroState.gaps.find((gap) => gap.id === ledgerId)
      if (!ledgerClaim && !ledgerGap) {
        return NextResponse.json({ message: `"${point.label}" is not part of this Draft Zero review.` }, { status: 400 })
      }
      if ((action.action === 'confirm' || action.action === 'reject') && !ledgerClaim) {
        return NextResponse.json({ message: `"${point.label}" has no Draft Zero claim to ${action.action}.` }, { status: 400 })
      }

      if (action.action === 'reject') {
        // Direct state mutation, mirroring the points route: back to pending.
        point.status = 'pending'
        point.capture = null
        recomputeStageState(stage)
        draftZeroState = updateLedger(draftZeroState, stageKey, action.pointKey, 'reject', null)
        continue
      }

      const text = action.text?.trim() || null
      if ((action.action === 'edit' || action.action === 'fill_gap') && !text) {
        return NextResponse.json({ message: `Provide text to ${action.action === 'edit' ? 'edit' : 'fill'} "${point.label}".` }, { status: 400 })
      }
      if (action.action === 'confirm' && !point.capture) {
        return NextResponse.json({ message: `"${point.label}" has nothing to confirm yet.` }, { status: 400 })
      }

      const factBullets =
        action.action === 'confirm'
          ? point.capture?.factBullets || []
          : [text as string]
      // Edits/gap-fills replace the capture text wholesale: inheriting old
      // keywords would re-trip deterministic rule scanners the user is trying
      // to correct their way out of.
      const keywords = action.keywords?.length
        ? action.keywords
        : action.action === 'confirm'
          ? point.capture?.keywords || []
          : []
      const thrustLinkage =
        action.pointKey === 'priority_match'
          ? point.capture?.thrustLinkage?.length
            ? point.capture.thrustLinkage
            : markerOptions.selectedThrustAreaRuleKeys.length
              ? markerOptions.selectedThrustAreaRuleKeys
              : markerOptions.availableFocusAreas.slice(0, 3)
          : undefined
      const markerPoint = buildDraftZeroConfirmationMarkerPoint({
        pointKey: action.pointKey,
        keywords,
        factBullets,
        previousBasis: point.capture?.captureBasis || [],
        thrustLinkage,
      })
      const existing = markerPointsByStage.get(stageKey) || []
      existing.push(markerPoint)
      markerPointsByStage.set(stageKey, existing)
      draftZeroState = updateLedger(draftZeroState, stageKey, action.pointKey, action.action, text)
    }

    for (const [stageKey, pointsCovered] of markerPointsByStage) {
      const marker: GrantPrepMarkerPayload = {
        version: 'brainstorm_marker_v1',
        stageKey,
        pointsCovered,
        currentPoint: null,
        suggestedAnswers: null,
        qualityAssessment: null,
        steeringEvents: [],
      }
      nextStageStates = applyMarkerToStageStates(nextStageStates, stageKey, marker, markerOptions)
    }

    // Deterministic rule scanners (budget/duration ceilings, trap phrases) can
    // keep a point in needs_review even after a confirm — surface that instead
    // of returning a silent success while the ledger reverts.
    const warnings: Array<{ stageKey: string; pointKey: string; message: string }> = []
    for (const [stageKey, pointsCovered] of markerPointsByStage) {
      for (const markerPoint of pointsCovered) {
        const point = nextStageStates[stageKey]?.points.find((entry) => entry.key === markerPoint.pointKey)
        if (point && point.status !== 'covered') {
          const steeringEvent = [...(nextStageStates[stageKey]?.steeringEvents || [])]
            .reverse()
            .find((event) => event.pointKey === markerPoint.pointKey)
          warnings.push({
            stageKey,
            pointKey: markerPoint.pointKey,
            message:
              steeringEvent?.message
              || `"${point.label}" could not be confirmed — it conflicts with a funding-call rule. Rewrite it to fit the call limits.`,
          })
        }
      }
    }

    draftZeroState = syncDraftZeroStateWithStageStates(draftZeroState, nextStageStates)
    const nextContext = {
      ...prepContext,
      // Keep the chat path from pinning to ideation (Draft Zero sessions have
      // no messages, so the inflate quirk forces ideation otherwise).
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
      return NextResponse.json({ message: 'Grant Prep changed during this sweep. Refresh and continue.' }, { status: 409 })
    }
    const refreshed = await prisma.grantPrepSession.findUnique({
      where: { id: session.id },
      select: { updated_at: true },
    })
    return NextResponse.json({
      prepContext: nextContext,
      draftZero: draftZeroState,
      sessionStatus: nextStatus,
      sessionUpdatedAt: refreshed?.updated_at.toISOString() || new Date().toISOString(),
      warnings,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid request payload.' }, { status: 400 })
    }
    console.error('[Draft Zero] claims error:', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update Draft Zero claims' },
      { status: 500 }
    )
  }
}
