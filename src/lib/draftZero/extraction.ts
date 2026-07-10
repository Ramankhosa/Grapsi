import { isVisibleGrantPrepStageKey } from '@/lib/grantPrep/stageModel'
import type {
  CaptureBasis,
  GrantPrepMarkerPayload,
  GrantPrepMarkerPoint,
  GrantPrepSessionContext,
  GrantPrepStageKey,
  GrantPrepStageStates,
} from '@/lib/grantPrep/types'
import {
  DRAFT_ZERO_PROMPT_VERSION,
  DRAFT_ZERO_STATE_VERSION,
  type DraftZeroCatalogPoint,
  type DraftZeroClaim,
  type DraftZeroExtractionOutput,
  type DraftZeroGap,
  type DraftZeroProvenance,
  type DraftZeroSeed,
  type DraftZeroState,
} from '@/lib/draftZero/types'

export const DRAFT_ZERO_CONFIRM_REASON = 'Confirm this Draft Zero suggestion before launch.'

/** Phrases that trip the deterministic hard-block scanner in getGrantPrepPointStatus. */
const TRAP_PHRASE_PATTERN = /\b(out of scope|ineligible|forbidden|not allowed)\b/gi

function scrub(text: string): string {
  return text.replace(TRAP_PHRASE_PATTERN, 'outside the call scope').trim()
}

function clamp01(value: unknown, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(1, Math.max(0, num))
}

function asStringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => scrub(entry))
    .filter(Boolean)
    .slice(0, cap)
}

/**
 * Build the extraction catalog from the live session context. Only enabled,
 * pickable, visible stages participate; ideation is excluded because the idea
 * anchor covers it through the existing decision flow. context_only points are
 * plumbing, never surfaced.
 */
export function buildDraftZeroCatalog(context: GrantPrepSessionContext): DraftZeroCatalogPoint[] {
  const catalog: DraftZeroCatalogPoint[] = []
  for (const stage of Object.values(context.stageStates)) {
    if (!stage.enabled || !stage.pickable) continue
    if (!isVisibleGrantPrepStageKey(stage.stageKey)) continue
    if (stage.stageKey === 'ideation') continue
    for (const point of stage.points) {
      if (point.conversationRole === 'context_only') continue
      // Never offer points the user already owns: regeneration (or a first
      // generate over chat-path progress) must not overwrite covered or
      // user-confirmed captures — mirrors seedGrantPrepStagePointsFromIdeaAnchor.
      if (point.status === 'covered' || point.capture?.captureBasis?.includes('user_confirmed')) continue
      const mapped = context.stageMapping[stage.stageKey]?.discussionPoints?.find((entry) => entry.key === point.key)
      catalog.push({
        stageKey: stage.stageKey,
        stageTitle: stage.title,
        pointKey: point.key,
        label: point.label,
        priority: point.priority,
        conversationRole: point.conversationRole || null,
        helpText: mapped?.helpText || '',
      })
    }
  }
  return catalog
}

export interface ParsedDraftZeroExtraction {
  idea: DraftZeroExtractionOutput['idea']
  claims: DraftZeroClaim[]
  gaps: DraftZeroGap[]
  warnings: string[]
}

function normalizeForQuoteMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Validate the raw LLM output against the catalog. Unknown point ids are
 * dropped (the stage-state marker application would silently skip them anyway
 * — we surface that as a warning instead). "quoted" provenance is only trusted
 * when the quote actually appears in the seed material; otherwise the claim is
 * downgraded to "inferred". Every user-facing catalog point that ends up with
 * neither a claim nor a gap becomes a synthetic gap so the proof room never
 * under-reports what launch will block on.
 */
export function parseDraftZeroExtraction(
  raw: unknown,
  catalog: DraftZeroCatalogPoint[],
  seedText = ''
): ParsedDraftZeroExtraction {
  const warnings: string[] = []
  const normalizedSeed = normalizeForQuoteMatch(seedText)
  const output = (raw && typeof raw === 'object' ? raw : {}) as Partial<DraftZeroExtractionOutput>
  const catalogById = new Map(catalog.map((point) => [`${point.stageKey}.${point.pointKey}`, point]))

  const idea = {
    title: typeof output.idea?.title === 'string' ? output.idea.title.trim().slice(0, 90) : '',
    summary: typeof output.idea?.summary === 'string' ? output.idea.summary.trim() : '',
    problem: typeof output.idea?.problem === 'string' ? output.idea.problem.trim() : '',
    approach: typeof output.idea?.approach === 'string' ? output.idea.approach.trim() : '',
    beneficiaries: typeof output.idea?.beneficiaries === 'string' ? output.idea.beneficiaries.trim() : '',
  }

  const claims: DraftZeroClaim[] = []
  const seenPoints = new Set<string>()
  for (const entry of Array.isArray(output.claims) ? output.claims : []) {
    const pointId = typeof entry?.point === 'string' ? entry.point.trim() : ''
    const catalogPoint = catalogById.get(pointId)
    if (!catalogPoint) {
      if (pointId) warnings.push(`Dropped claim for unknown point "${pointId}".`)
      continue
    }
    if (seenPoints.has(pointId)) continue
    const claimText = typeof entry.claim === 'string' ? scrub(entry.claim) : ''
    if (!claimText) continue
    seenPoints.add(pointId)
    let provenance: DraftZeroProvenance = entry.provenance === 'quoted' ? 'quoted' : 'inferred'
    let sourceQuote =
      provenance === 'quoted' && typeof entry.sourceQuote === 'string' && entry.sourceQuote.trim()
        ? entry.sourceQuote.trim().slice(0, 400)
        : null
    // "quoted" is the highest-trust ink — only honor it when the quote is
    // actually present in the seed material (hallucinated or injected quotes
    // must not render as "from your notes").
    if (provenance === 'quoted') {
      const quoteVerified = Boolean(sourceQuote) && normalizedSeed.includes(normalizeForQuoteMatch(sourceQuote as string))
      if (!quoteVerified) {
        provenance = 'inferred'
        sourceQuote = null
        warnings.push(`Downgraded "${catalogPoint.label}" to inferred — its quote was not found in your material.`)
      }
    }
    const confidence = clamp01(entry.confidence, provenance === 'quoted' ? 0.9 : 0.6)
    claims.push({
      id: pointId,
      stageKey: catalogPoint.stageKey,
      pointKey: catalogPoint.pointKey,
      pointLabel: catalogPoint.label,
      priority: catalogPoint.priority,
      conversationRole: catalogPoint.conversationRole,
      claimText,
      factBullets: asStringArray(entry.facts, 3),
      keywords: asStringArray(entry.keywords, 6),
      provenance,
      sourceQuote,
      confidence: provenance === 'inferred' ? Math.min(confidence, 0.75) : confidence,
      spotCheck: typeof entry.spotCheck === 'string' && entry.spotCheck.trim() ? entry.spotCheck.trim() : null,
      status: 'unconfirmed',
      decidedAt: null,
    })
  }

  const gaps: DraftZeroGap[] = []
  const gapPoints = new Set<string>()
  for (const entry of Array.isArray(output.gaps) ? output.gaps : []) {
    const pointId = typeof entry?.point === 'string' ? entry.point.trim() : ''
    const catalogPoint = catalogById.get(pointId)
    if (!catalogPoint || seenPoints.has(pointId) || gapPoints.has(pointId)) continue
    gapPoints.add(pointId)
    gaps.push({
      id: pointId,
      stageKey: catalogPoint.stageKey,
      pointKey: catalogPoint.pointKey,
      pointLabel: catalogPoint.label,
      priority: catalogPoint.priority,
      ask: typeof entry.ask === 'string' && entry.ask.trim() ? entry.ask.trim() : `Provide: ${catalogPoint.label}`,
      status: 'open',
    })
  }

  // Safety net: user-facing points with neither claim nor gap still block
  // launch, so surface them as gaps rather than letting them hide.
  for (const point of catalog) {
    const pointId = `${point.stageKey}.${point.pointKey}`
    const userFacing = point.conversationRole === 'user_required' || point.conversationRole === 'can_infer_and_confirm'
    if (!userFacing || point.priority === 'P3') continue
    if (seenPoints.has(pointId) || gapPoints.has(pointId)) continue
    gapPoints.add(pointId)
    gaps.push({
      id: pointId,
      stageKey: point.stageKey,
      pointKey: point.pointKey,
      pointLabel: point.label,
      priority: point.priority,
      ask: `Provide: ${point.label}`,
      status: 'open',
    })
  }

  return { idea, claims, gaps, warnings }
}

/**
 * Points whose coverage requires a thrust/priority linkage — without it the
 * deterministic hard block in getGrantPrepPointStatus keeps them needs_review
 * forever, even after user confirmation.
 */
const THRUST_LINKED_POINT_KEYS = new Set(['priority_match'])

/**
 * Project extracted claims into per-stage synthetic markers. Claims land as
 * ruleCompliance needs_review so they stay amber (and launch-blocking) until
 * the researcher confirms them — mirroring how idea-anchor seeding works.
 */
export function buildDraftZeroStageMarkers(
  claims: DraftZeroClaim[],
  options?: { priorityAreas?: string[] }
): Map<GrantPrepStageKey, GrantPrepMarkerPayload> {
  const priorityAreas = options?.priorityAreas || []
  const markers = new Map<GrantPrepStageKey, GrantPrepMarkerPayload>()
  for (const claim of claims) {
    const factBullets = [claim.claimText, ...claim.factBullets.filter((fact) => fact !== claim.claimText)].slice(0, 4)
    const markerPoint: GrantPrepMarkerPoint = {
      pointKey: claim.pointKey,
      keywords: claim.keywords,
      factBullets,
      confidence: claim.confidence,
      captureBasis: [claim.provenance === 'quoted' ? 'from_pitch' : 'inferred_from_call'],
      ruleCompliance: { status: 'needs_review', reason: DRAFT_ZERO_CONFIRM_REASON, rescopeNeeded: false },
    }
    if (THRUST_LINKED_POINT_KEYS.has(claim.pointKey) && priorityAreas.length) {
      markerPoint.thrustLinkage = priorityAreas
    }
    const marker = markers.get(claim.stageKey) || {
      version: 'brainstorm_marker_v1' as const,
      stageKey: claim.stageKey,
      pointsCovered: [],
      currentPoint: null,
      suggestedAnswers: null,
      qualityAssessment: null,
      steeringEvents: [],
    }
    marker.pointsCovered = [...(marker.pointsCovered || []), markerPoint]
    markers.set(claim.stageKey, marker)
  }
  return markers
}

/** Marker point used when the researcher confirms or edits a claim / fills a gap. */
export function buildDraftZeroConfirmationMarkerPoint(input: {
  pointKey: string
  keywords: string[]
  factBullets: string[]
  previousBasis: string[]
  thrustLinkage?: string[]
}): GrantPrepMarkerPoint {
  const basis = new Set<CaptureBasis>(
    input.previousBasis.filter((entry): entry is CaptureBasis => entry === 'from_pitch' || entry === 'inferred_from_call')
  )
  basis.add('user_confirmed')
  const markerPoint: GrantPrepMarkerPoint = {
    pointKey: input.pointKey,
    keywords: input.keywords.map(scrub).filter(Boolean),
    factBullets: input.factBullets.map(scrub).filter(Boolean),
    confidence: 1,
    captureBasis: Array.from(basis),
    ruleCompliance: { status: 'ok', reason: null, rescopeNeeded: false },
  }
  if (input.thrustLinkage?.length) {
    markerPoint.thrustLinkage = input.thrustLinkage
  }
  return markerPoint
}

export function buildDraftZeroState(input: {
  seed: DraftZeroSeed
  claims: DraftZeroClaim[]
  gaps: DraftZeroGap[]
  clientRequestId: string
  idea: DraftZeroExtractionOutput['idea']
  anchorCompilationSource: 'llm' | 'deterministic_fallback'
  warnings: string[]
}): DraftZeroState {
  return {
    version: DRAFT_ZERO_STATE_VERSION,
    seed: input.seed,
    claims: input.claims,
    gaps: input.gaps,
    generation: {
      clientRequestId: input.clientRequestId,
      generatedAt: new Date().toISOString(),
      promptVersion: DRAFT_ZERO_PROMPT_VERSION,
      seedCharCount: input.seed.charCount,
      claimCount: input.claims.length,
      gapCount: input.gaps.length,
      ideaTitle: input.idea.title,
      ideaSummary: input.idea.summary,
      anchorCompilationSource: input.anchorCompilationSource,
      warnings: input.warnings,
    },
  }
}

/**
 * Reconcile the ledger with authoritative stage states: a claim whose point
 * got independently covered (e.g. through the chat path) reads as confirmed;
 * a filled gap closes.
 */
export function syncDraftZeroStateWithStageStates(state: DraftZeroState, stageStates: GrantPrepStageStates): DraftZeroState {
  const findPoint = (stageKey: GrantPrepStageKey, pointKey: string) =>
    stageStates[stageKey]?.points?.find((point) => point.key === pointKey) || null

  const claims = state.claims.map((claim) => {
    const point = findPoint(claim.stageKey, claim.pointKey)
    if (!point) return claim
    if (claim.status === 'rejected') return claim
    if (point.status === 'covered' && claim.status === 'unconfirmed') {
      return { ...claim, status: 'confirmed' as const, decidedAt: claim.decidedAt || new Date().toISOString() }
    }
    if (point.status !== 'covered' && (claim.status === 'confirmed' || claim.status === 'edited')) {
      return { ...claim, status: 'unconfirmed' as const }
    }
    return claim
  })

  const gaps = state.gaps.map((gap) => {
    const point = findPoint(gap.stageKey, gap.pointKey)
    if (!point) return gap
    const filled = point.status === 'covered'
    if (filled && gap.status === 'open') return { ...gap, status: 'filled' as const }
    if (!filled && gap.status === 'filled') return { ...gap, status: 'open' as const }
    return gap
  })

  return { ...state, claims, gaps }
}
