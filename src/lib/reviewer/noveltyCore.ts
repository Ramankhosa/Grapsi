// Pure core of the reviewer's novelty & positioning verdict.
//
// The model names a verdict and cites retrieved records; everything else is
// enforced here: verdicts outside the enum become `unassessed`, citations to
// unknown records are dropped, and thin evidence caps what may be claimed.
// Kept dependency-free so it can be unit-tested without the server graph.

import type { ReviewerLandscape } from '@/lib/reviewer/landscapeCore'

export type NoveltyVerdict = 'generic' | 'incremental' | 'differentiated' | 'novel_within_evidence' | 'unassessed'
export type NoveltyConfidence = 'high' | 'medium' | 'low'
export type EvidenceCoverage = 'strong' | 'partial' | 'thin'

export type NoveltyAssessment = {
  version: 1
  verdict: NoveltyVerdict
  confidence: NoveltyConfidence
  /** Computed from the landscape sources, never asked of the model. */
  evidence_coverage: EvidenceCoverage
  positioning_summary: string
  already_done: Array<{ ref: string; kind: 'funded' | 'patent'; title: string; overlap: string; leaves_open: string }>
  distinctive_claims: string[]
  generic_signals: string[]
  what_would_make_it_distinctive: Array<{ change: string; why: string; effort: 'quick' | 'moderate' | 'substantial'; section: string }>
  source: 'llm' | 'fallback'
  generated_at: string
}

export type NoveltyReference = { ref: string; kind: 'funded' | 'patent'; title: string }

const VERDICTS = new Set<NoveltyVerdict>(['generic', 'incremental', 'differentiated', 'novel_within_evidence', 'unassessed'])
const CONFIDENCES = new Set<NoveltyConfidence>(['high', 'medium', 'low'])
const EFFORTS = new Set(['quick', 'moderate', 'substantial'])

function text(value: unknown, maxLength = 600): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function list(value: unknown, maxItems: number, maxLength = 300): string[] {
  return (Array.isArray(value) ? value : []).map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
}

/**
 * How much the verdict can lean on: strong when both corpora answered with
 * a reasonable number of items, thin when the project corpus was nearly
 * silent or patents were not searched.
 */
export function computeEvidenceCoverage(landscape: Pick<ReviewerLandscape, 'sources' | 'priorWork'> | null | undefined): EvidenceCoverage {
  if (!landscape) return 'thin'
  const projects = landscape.sources?.projects?.count ?? 0
  const patentsSearched = landscape.sources?.patents?.status === 'ok'
  const rows = landscape.priorWork?.rows?.length ?? 0
  if (projects >= 8 && patentsSearched && rows >= 6) return 'strong'
  if (projects >= 3 || (patentsSearched && rows >= 2)) return 'partial'
  return 'thin'
}

/** The refs the model may cite: award ids, patent ids and family members, publication numbers. */
export function collectNoveltyReferences(landscape: Pick<ReviewerLandscape, 'priorWork'> | null | undefined): NoveltyReference[] {
  const refs: NoveltyReference[] = []
  for (const row of landscape?.priorWork?.rows ?? []) {
    if (row.kind === 'funded' && row.award) {
      refs.push({ ref: row.award.id, kind: 'funded', title: row.title })
      for (const duplicate of row.award.duplicateIds || []) refs.push({ ref: duplicate, kind: 'funded', title: row.title })
    } else if (row.kind === 'patented' && row.patent) {
      for (const id of row.patent.familyIds || []) refs.push({ ref: id, kind: 'patent', title: row.title })
      if (row.patent.publicationNumber) refs.push({ ref: row.patent.publicationNumber, kind: 'patent', title: row.title })
    }
  }
  return refs
}

export function fallbackNoveltyAssessment(evidenceCoverage: EvidenceCoverage, now: Date): NoveltyAssessment {
  return {
    version: 1,
    verdict: 'unassessed',
    confidence: 'low',
    evidence_coverage: evidenceCoverage,
    positioning_summary: '',
    already_done: [],
    distinctive_claims: [],
    generic_signals: [],
    what_would_make_it_distinctive: [],
    source: 'fallback',
    generated_at: now.toISOString(),
  }
}

/**
 * Coerce the model's JSON into a verdict the report can stand behind.
 *
 * - `incremental` must cite at least one retrieved record, else it becomes
 *   `unassessed` — "done before" needs a "by whom".
 * - Thin evidence caps confidence at `low` and forbids `novel_within_evidence`:
 *   absence of matches in a small corpus is not novelty.
 * - `generic` is a judgement about the proposal's own text and stands on its
 *   generic_signals; with none listed it becomes `unassessed`.
 */
export function normalizeNoveltyAssessment(
  raw: unknown,
  context: { references: NoveltyReference[]; evidenceCoverage: EvidenceCoverage; now: Date }
): NoveltyAssessment {
  const fallback = fallbackNoveltyAssessment(context.evidenceCoverage, context.now)
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!value) return fallback

  const referenceByRef = new Map(context.references.map((reference) => [reference.ref.toLowerCase(), reference]))
  const alreadyDone = (Array.isArray(value.already_done) ? value.already_done : [])
    .map((item: any) => {
      const reference = referenceByRef.get(text(item?.ref, 240).toLowerCase())
      if (!reference) return null
      return {
        ref: reference.ref,
        kind: reference.kind,
        title: text(item?.title, 240) || reference.title,
        overlap: text(item?.overlap, 300),
        leaves_open: text(item?.leaves_open, 300),
      }
    })
    .filter(Boolean)
    .slice(0, 8) as NoveltyAssessment['already_done']

  const genericSignals = list(value.generic_signals, 8)
  const distinctiveClaims = list(value.distinctive_claims, 6)
  const changes = (Array.isArray(value.what_would_make_it_distinctive) ? value.what_would_make_it_distinctive : [])
    .map((item: any) => ({
      change: text(item?.change, 300),
      why: text(item?.why, 300),
      effort: (EFFORTS.has(String(item?.effort)) ? String(item?.effort) : 'moderate') as 'quick' | 'moderate' | 'substantial',
      section: text(item?.section, 120),
    }))
    .filter((item: { change: string }) => item.change)
    .slice(0, 6)

  let verdict = String(value.verdict || '').toLowerCase() as NoveltyVerdict
  if (!VERDICTS.has(verdict)) verdict = 'unassessed'
  if (verdict === 'incremental' && alreadyDone.length === 0) verdict = 'unassessed'
  if (verdict === 'generic' && genericSignals.length === 0) verdict = 'unassessed'
  if (context.evidenceCoverage === 'thin' && verdict === 'novel_within_evidence') verdict = 'unassessed'

  let confidence = String(value.confidence || '').toLowerCase() as NoveltyConfidence
  if (!CONFIDENCES.has(confidence)) confidence = 'low'
  if (context.evidenceCoverage === 'thin') confidence = 'low'
  if (verdict === 'unassessed') confidence = 'low'

  return {
    version: 1,
    verdict,
    confidence,
    evidence_coverage: context.evidenceCoverage,
    positioning_summary: text(value.positioning_summary, 900),
    already_done: alreadyDone,
    distinctive_claims: distinctiveClaims,
    generic_signals: genericSignals,
    what_would_make_it_distinctive: changes,
    source: 'llm',
    generated_at: context.now.toISOString(),
  }
}
