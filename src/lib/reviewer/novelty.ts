// Novelty & positioning verdict for the reviewer's final report.
//
// One LLM call that reads the proposal digests and the retrieved landscape
// (funded projects + Indian patents with their facet tags) and returns an
// evidence-bounded verdict: generic / incremental / differentiated / novel
// within the available evidence. It runs after the panel report and is never
// shown to the panel model — reference for the PI, not an input to the score.
// Never throws; every failure degrades to an `unassessed` fallback.

import { extractJsonObject } from '@/lib/recommendations/conversationUtils'
import {
  buildSectionDigests,
  runReviewerAuxiliaryText,
  type ReviewerLandscapeInput,
} from '@/lib/reviewer/landscape'
import type { ReviewerLandscape } from '@/lib/reviewer/landscapeCore'
import {
  collectNoveltyReferences,
  computeEvidenceCoverage,
  fallbackNoveltyAssessment,
  normalizeNoveltyAssessment,
  type NoveltyAssessment,
} from '@/lib/reviewer/noveltyCore'
import { resolveReviewerCallOwner } from '@/lib/reviewer/usage'

export const REVIEWER_NOVELTY_BUDGET_MS = 45_000
const NOVELTY_STAGE_CODE = 'GRANT_REVIEWER_NOVELTY'
const FUNDED_LIMIT = 8
const PATENT_LIMIT = 6

export function reviewerNoveltyEnabled(): boolean {
  return String(process.env.REVIEWER_NOVELTY_ENABLED || '').toLowerCase() !== 'false'
}

export interface NoveltyInput {
  callId: string
  projectTitle: string
  parsedContext: Record<string, any> | null
  modelType: 'O' | 'G'
  sections: ReviewerLandscapeInput['sections']
  landscape: ReviewerLandscape
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function describeCoverage(landscape: ReviewerLandscape, coverage: string): string {
  const projects = landscape.sources?.projects?.count ?? 0
  const patents = landscape.sources?.patents?.status === 'ok'
    ? `searched (${landscape.sources.patents.count} retrieved)`
    : landscape.sources?.patents?.status === 'not_configured' ? 'not searched' : 'unavailable'
  return `${coverage} — ${projects} funded projects retrieved, Indian patents ${patents}`
}

async function assessNoveltyInner(input: NoveltyInput, now: Date): Promise<NoveltyAssessment> {
  const coverage = computeEvidenceCoverage(input.landscape)
  const references = collectNoveltyReferences(input.landscape)
  const owner = await resolveReviewerCallOwner(input.callId)
  const digests = buildSectionDigests(input.sections)
  const parsed = input.parsedContext && typeof input.parsedContext === 'object' ? input.parsedContext : {}
  const callContext = clip(parsed.reviewer_context_text || parsed.description || parsed.call_summary || '', 1200)
  const thrust = Array.isArray(parsed.thrust_areas) ? parsed.thrust_areas.map((item: unknown) => clip(item, 120)).filter(Boolean).join('; ') : ''

  const rows = input.landscape.priorWork?.rows ?? []
  const funded = rows
    .filter((row) => row.kind === 'funded' && row.award)
    .slice(0, FUNDED_LIMIT)
    .map((row) => ({
      ref: row.award!.id,
      title: clip(row.title, 200),
      agency: row.award!.agencyName,
      year: row.year,
      aspects_it_covers: row.facetsCovered,
      abstract: clip(row.award!.abstract, 800) || null,
    }))
  const patents = rows
    .filter((row) => row.kind === 'patented' && row.patent)
    .slice(0, PATENT_LIMIT)
    .map((row) => ({
      ref: row.patent!.publicationNumber || row.patent!.familyIds?.[0] || row.key,
      title: clip(row.title, 200),
      assignee: row.patent!.assignee,
      number: row.patent!.publicationNumber,
      year: row.year,
      aspects_it_covers: row.facetsCovered,
    }))

  const prompt = `You assess how novel and specific a grant proposal is, positioned against what has already been funded or patented. You are not scoring fundability.

PROPOSAL: ${input.projectTitle || 'Untitled proposal'}
${thrust ? `CALL PRIORITIES: ${thrust}\n` : ''}${callContext ? `CALL CONTEXT: ${callContext}\n` : ''}
WHAT THE PROPOSAL SAYS:
${digests.map((digest) => `${digest.title}: ${digest.text}`).join('\n') || '(no section text available)'}

PROPOSAL ASPECTS (facets): ${JSON.stringify(input.landscape.facets)}

COMPARABLE FUNDED PROJECTS (cite by ref):
${JSON.stringify(funded)}

COMPARABLE INDIAN PATENTS (cite by ref):
${JSON.stringify(patents)}

EVIDENCE COVERAGE: ${describeCoverage(input.landscape, coverage)}

Return JSON only:
{
 "verdict": "generic" | "incremental" | "differentiated" | "novel_within_evidence",
 "confidence": "high" | "medium" | "low",
 "positioning_summary": "2-3 sentences: what already exists, and where this proposal sits relative to it",
 "already_done": [ { "ref": "exact ref from the lists", "overlap": "which aspects it already covers", "leaves_open": "what it does not do" } ],
 "distinctive_claims": ["what this proposal does that no listed item does — empty if nothing"],
 "generic_signals": ["concrete signs of a generic idea visible in the proposal text itself: no named population, material, site or dataset; no measurable outcome or baseline; a problem statement that fits any domain; objectives that restate the call's priorities"],
 "what_would_make_it_distinctive": [ { "change": "specific change", "why": "why it matters", "effort": "quick" | "moderate" | "substantial", "section": "which section to revise" } ]
}

Rules:
- "generic" is a judgement about the proposal's OWN text (vagueness, restated call language), never about how many matches were found; list the signals you see.
- "incremental" requires at least one already_done entry citing a ref from the lists above; cite only those refs.
- If evidence coverage is thin, confidence must be "low" and the verdict may not be "novel_within_evidence" — say that no comparable work was retrieved rather than calling the idea novel.
- Do not judge fundability, feasibility or score. Do not invent prior work.`

  const rawText = await runReviewerAuxiliaryText({
    stageCode: NOVELTY_STAGE_CODE,
    prompt,
    systemPrompt: 'You position a grant proposal against retrieved prior work. Return JSON only.',
    owner,
    modelType: input.modelType,
    maxTokensOut: 1800,
  })
  if (!rawText) return fallbackNoveltyAssessment(coverage, now)

  let parsedJson: unknown = null
  try {
    parsedJson = extractJsonObject(rawText)
  } catch {
    return fallbackNoveltyAssessment(coverage, now)
  }
  return normalizeNoveltyAssessment(parsedJson, { references, evidenceCoverage: coverage, now })
}

/**
 * Returns null only when the kill switch is off; otherwise always resolves
 * with a persistable assessment (an `unassessed` fallback on any failure).
 */
export async function assessNovelty(input: NoveltyInput): Promise<NoveltyAssessment | null> {
  if (!reviewerNoveltyEnabled()) return null
  const now = new Date()
  const coverage = computeEvidenceCoverage(input.landscape)
  if (!input.landscape || input.landscape.status === 'error') return fallbackNoveltyAssessment(coverage, now)

  let budgetTimer: NodeJS.Timeout | undefined
  const budget = new Promise<NoveltyAssessment>((resolve) => {
    budgetTimer = setTimeout(() => resolve(fallbackNoveltyAssessment(coverage, now)), REVIEWER_NOVELTY_BUDGET_MS)
  })
  try {
    return await Promise.race([assessNoveltyInner(input, now), budget])
  } catch (error) {
    console.error('[ReviewerNovelty] assessment failed:', error)
    return fallbackNoveltyAssessment(coverage, now)
  } finally {
    if (budgetTimer) clearTimeout(budgetTimer)
  }
}
