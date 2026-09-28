// Reconciles the panel report with the prior-work evidence.
//
// The panel model deliberately never sees the landscape or the novelty verdict
// — prior work must not move the score. The cost of that isolation was a report
// that could praise an idea as "highly innovative" in its summary while the
// novelty block, two screens down, listed three patents covering the same
// ground, and nothing on the page connected the two.
//
// These flags are that connection. They are computed, not generated: a regex
// over the panel's own words and the landscape's own coverage, so they cost no
// model call, cite only retrieved records, and never touch a score.
//
// Pure and dependency-free (type imports only) so it can be unit-tested and
// imported client-side.

import { summarizeLandscape, type ReviewerLandscape } from '@/lib/reviewer/landscapeCore'
import type { NoveltyAssessment } from '@/lib/reviewer/noveltyCore'

export type PriorWorkFlag = {
  kind: 'novelty_claim_conflict' | 'patented_aspect'
  severity: 'high' | 'medium' | 'low'
  issue: string
  action: string
  /** Publication numbers or record refs the flag rests on. */
  refs: string[]
}

const MAX_PATENTED_ASPECT_FLAGS = 3

// Words a panel uses when it credits an idea with novelty. Deliberately
// narrow: "new" and "original" appear in ordinary prose far too often.
const NOVELTY_CLAIM = /\b(novel|novelty|innovative|innovation|first[- ]of[- ]its[- ]kind|unique|pioneering|ground-?breaking|unprecedented|cutting[- ]edge)\b/i

const VERDICT_LABELS: Record<string, string> = {
  incremental: 'incremental',
  generic: 'generic',
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => clip(item, 600)).filter(Boolean) : []
}

/** The first panel sentence that credits the idea with novelty, and where it sits. */
function findNoveltyClaim(overall: Record<string, any>): { quote: string; where: string } | null {
  const sources: Array<[string, string[]]> = [
    ['executive summary', [clip(overall?.executive_summary, 4000)]],
    ['major strengths', asList(overall?.major_strengths)],
    ['funding rationale', [clip(overall?.funding_recommendation?.rationale, 1000)]],
  ]
  for (const [where, texts] of sources) {
    for (const text of texts) {
      if (!text || !NOVELTY_CLAIM.test(text)) continue
      const sentence = text.split(/(?<=[.!?])\s+/).find((part) => NOVELTY_CLAIM.test(part)) || text
      return { quote: clip(sentence, 220), where }
    }
  }
  return null
}

export function buildPriorWorkFlags(input: {
  overall: Record<string, any> | null | undefined
  novelty: Partial<NoveltyAssessment> | null | undefined
  landscape: Partial<ReviewerLandscape> | null | undefined
}): PriorWorkFlag[] {
  const flags: PriorWorkFlag[] = []
  const overall = input.overall && typeof input.overall === 'object' ? input.overall : {}
  const novelty = input.novelty && typeof input.novelty === 'object' ? input.novelty : null

  // 1. The panel claims novelty the prior-work check does not support.
  const verdict = String(novelty?.verdict || '')
  if (novelty && VERDICT_LABELS[verdict]) {
    const claim = findNoveltyClaim(overall)
    if (claim) {
      const done = Array.isArray(novelty.already_done) ? novelty.already_done : []
      const evidence = verdict === 'incremental' && done.length
        ? `${done.length} comparable ${done.length === 1 ? 'record already covers' : 'records already cover'} the same ground (${done.slice(0, 2).map((item) => clip(item?.title || item?.ref, 90)).join('; ')}${done.length > 2 ? '; …' : ''})`
        : `the proposal's own text reads as non-specific${asList(novelty.generic_signals).length ? ` (${clip(asList(novelty.generic_signals)[0], 140)})` : ''}`
      flags.push({
        kind: 'novelty_claim_conflict',
        severity: verdict === 'generic' ? 'high' : 'medium',
        issue: `The panel's ${claim.where} credits the idea with novelty ("${claim.quote}"), but the prior-work check rates it ${VERDICT_LABELS[verdict]}: ${evidence}.`,
        action: 'Before submission, state what this work does that the listed projects and patents do not — or narrow the novelty claim so a reviewer who finds them does not discount it.',
        refs: done.map((item) => clip(item?.ref, 120)).filter(Boolean).slice(0, 6),
      })
    }
  }

  // 2. Aspects of the proposal a retrieved patent already covers. Unfunded
  //    ones first: patented but never funded is the reading that needs a
  //    design-around rather than just a citation.
  const summary = summarizeLandscape(input.landscape)
  if (summary && input.landscape?.assessmentSource === 'llm') {
    const aspects = [...summary.patentedAspects].sort((a, b) => Number(b.unfunded) - Number(a.unfunded))
    for (const aspect of aspects.slice(0, MAX_PATENTED_ASPECT_FLAGS)) {
      const numbers = aspect.numbers.length ? aspect.numbers.join(', ') : 'a retrieved patent'
      flags.push({
        kind: 'patented_aspect',
        severity: aspect.unfunded ? 'medium' : 'low',
        issue: aspect.unfunded
          ? `"${clip(aspect.facet, 160)}" is already covered by ${numbers}, and no retrieved funded project has taken it on.`
          : `"${clip(aspect.facet, 160)}" is already covered by ${numbers}, alongside funded work in the same space.`,
        action: aspect.unfunded
          ? 'Explain how the proposal differs from these patents — or how it will design around or license them — in the novelty and IP sections.'
          : 'Cite these patents and position the proposal against them in the literature or novelty section.',
        refs: aspect.numbers,
      })
    }
  }

  return flags
}
