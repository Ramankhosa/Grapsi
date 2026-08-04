import type { GrantTemplateIntent } from '@/types/grant'

/**
 * The reviewer's canonical section vocabulary. Every rule, every drafted
 * section, and every extracted requirement is folded into one of these buckets
 * so that template-backed, guideline-backed, and URL-extracted calls all score
 * against the same structure.
 */
export const BUCKET_LABELS: Record<string, string> = {
  summary: 'Summary / Abstract',
  problem_need: 'Problem, Need & Call Fit',
  objectives: 'Objectives & Specific Aims',
  methodology: 'Methodology / Approach',
  workplan: 'Workplan & Timeline',
  budget: 'Budget & Justification',
  evaluation: 'Evaluation Plan',
  impact_outcomes: 'Impact & Outcomes',
  team: 'Team & Capability',
  sustainability_risk: 'Sustainability, Risk & Mitigation',
  attachments_submission: 'Attachments & Submission Requirements',
  other: 'Other Proposal Material',
}

export const BUCKET_ORDER: string[] = [
  'summary',
  'problem_need',
  'objectives',
  'methodology',
  'workplan',
  'budget',
  'evaluation',
  'impact_outcomes',
  'team',
  'sustainability_risk',
  'attachments_submission',
  'other',
]

export function bucketLabel(bucketKey: string): string {
  return BUCKET_LABELS[bucketKey] || BUCKET_LABELS.other
}

export function normalizeBucketKey(value: string): string {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!key) return 'other'
  if (BUCKET_LABELS[key]) return key
  return 'other'
}

/**
 * Common real-world wordings for each reviewer section. This is what makes
 * "Aims & Objectives", "Objective of the Study", and "Specific Aims" all land
 * on the objectives section. Multi-word entries are preferred over single
 * words, so "budget justification" beats a bare "budget".
 *
 * Lives here rather than in `proposalSplit.ts` (its original home) because
 * `bucketFromText` needs it too: the keyword regexes below alone score 6/14 on
 * the section titles the picker creates, while this table scores 12/14. The
 * splitter imports it from here so there is one table, not two.
 */
export const BUCKET_SYNONYMS: Record<string, string[]> = {
  summary: [
    'executive summary', 'project summary', 'abstract', 'summary', 'synopsis',
    'overview', 'project brief', 'brief description', 'précis', 'precis',
  ],
  problem_need: [
    'statement of the problem', 'problem statement', 'statement of need',
    'needs assessment', 'need for the study', 'rationale', 'justification for the project',
    'background', 'context', 'motivation', 'significance', 'introduction',
    'problem', 'need', 'relevance', 'alignment with the call', 'innovation',
    'novelty', 'state of the art', 'literature review', 'review of literature',
  ],
  objectives: [
    'aims and objectives', 'goals and objectives', 'specific aims',
    'objective of the study', 'objectives of the project', 'research questions',
    'research question', 'hypothesis', 'hypotheses', 'objectives', 'objective',
    'aims', 'aim', 'goals', 'goal', 'targets',
  ],
  methodology: [
    'materials and methods', 'proposed methodology', 'research methodology',
    'technical approach', 'research design', 'study design', 'experimental design',
    'method of study', 'methodology', 'methods', 'method', 'approach',
    'technical plan', 'scientific approach', 'work methodology',
  ],
  workplan: [
    'work plan', 'workplan', 'plan of work', 'implementation plan',
    'project schedule', 'time schedule', 'timeline', 'time frame', 'timeframe',
    'milestones', 'milestone chart', 'gantt chart', 'activities', 'work packages',
    'work breakdown', 'phasing', 'schedule',
  ],
  budget: [
    'budget justification', 'budget breakdown', 'detailed budget',
    'budget estimate', 'estimated expenditure', 'financial plan', 'funds requested',
    'cost estimate', 'budget summary', 'budget', 'costs', 'cost', 'finance',
  ],
  evaluation: [
    'monitoring and evaluation', 'evaluation plan', 'monitoring plan',
    'success criteria', 'performance indicators', 'key indicators',
    'evaluation', 'monitoring', 'indicators', 'metrics', 'assessment',
  ],
  impact_outcomes: [
    'expected outcomes', 'expected outcome', 'expected results', 'anticipated impact',
    'societal impact', 'economic impact', 'outcomes and impact', 'benefits',
    'dissemination', 'utilisation', 'utilization', 'impact', 'outcomes', 'outcome',
    'deliverables', 'expected deliverables', 'outputs',
  ],
  team: [
    'team composition', 'project team', 'investigators', 'principal investigator',
    'key personnel', 'personnel', 'expertise', 'qualifications', 'team',
    'institutional capability', 'facilities available', 'infrastructure',
    'facilities', 'organisation profile', 'organization profile',
  ],
  sustainability_risk: [
    'risk and mitigation', 'risk mitigation', 'risk analysis', 'risk assessment',
    'risks', 'risk', 'mitigation', 'contingency plan', 'contingency',
    'sustainability', 'sustainability plan', 'limitations', 'challenges',
    'exit strategy',
  ],
}

/**
 * Attachment/submission wordings, kept out of `BUCKET_SYNONYMS` on purpose.
 *
 * `proposalSplit` uses the table above to decide whether a heading *is* a
 * section name; annexures and reference lists are handled there by a separate
 * exclusion pass, and folding these phrases into the shared table would change
 * that classification. `bucketFromText` consults both.
 */
const ATTACHMENT_SYNONYMS: string[] = [
  'attachments and submission', 'submission requirements', 'submission checklist',
  'supporting documents', 'supporting documentation', 'declarations',
  'certificates', 'annexures', 'annexure', 'appendices', 'appendix',
  'attachments', 'attachment', 'eligibility', 'compliance', 'checklist',
]

/** Lowercased, punctuation-flattened form used for all phrase matching. */
export function normalizeBucketText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ]+/g, ' ')
    .trim()
}

/** Whole-phrase containment — "budget" must not match inside "budgetary". */
export function containsPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false
  if (haystack === needle) return true
  return new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(haystack)
}

/** Longest matching synonym across all buckets, or null. */
export function matchSynonymBucket(
  headingNorm: string,
  extra?: Record<string, string[]>
): { bucketKey: string; length: number } | null {
  let best: { bucketKey: string; length: number } | null = null
  const tables = extra ? [BUCKET_SYNONYMS, extra] : [BUCKET_SYNONYMS]
  for (const table of tables) {
    for (const [bucketKey, phrases] of Object.entries(table)) {
      for (const phrase of phrases) {
        if (!containsPhrase(headingNorm, phrase)) continue
        if (!best || phrase.length > best.length) best = { bucketKey, length: phrase.length }
      }
    }
  }
  return best
}

/**
 * Best-effort bucket for a free-text section title or rule.
 *
 * Phrase table first (longest match wins), then inflection-tolerant keywords.
 * The keyword arms deliberately allow plurals and word forms: they used to be
 * `\b`-terminated singulars, which sent "Objectives", "Methodology",
 * "Deliverables", "Outcomes", "Aims" and "Goals" to `other` — and since this
 * function is the fallback that gives every user-created section its identity,
 * a miss here silently routes a section to the wrong rules.
 */
export function bucketFromText(value: string): string {
  const norm = normalizeBucketText(value)
  if (!norm) return 'other'

  const phrase = matchSynonymBucket(norm, { attachments_submission: ATTACHMENT_SYNONYMS })
  if (phrase) return phrase.bucketKey

  // `justification` is absent from the budget arm on purpose — it stole
  // "Justification for the project", which is problem_need. Bare `fit` is gone
  // for the same reason: it matched "fitness", "benefit". Both live as explicit
  // phrases in the table above.
  if (/\b(abstracts?|summar(?:y|ies)|overviews?|synops(?:is|es)|pr[ée]cis)\b/.test(norm)) return 'summary'
  if (/\b(problems?|needs?|background|significance|alignment|rationale|innovation|introduction|literature|novelty|state of the art|motivation|relevance|context)\b/.test(norm)) return 'problem_need'
  if (/\b(objectives?|aims?|goals?|hypothes(?:is|es)|research questions?|targets?)\b/.test(norm)) return 'objectives'
  if (/\b(method(?:s|ology|ologies)?|approach(?:es)?|research plan|designs?|experiments?|experimental|implementation)\b/.test(norm)) return 'methodology'
  if (/\b(work ?plans?|timelines?|milestones?|schedules?|gantt|deliverables?|work packages?|activities)\b/.test(norm)) return 'workplan'
  if (/\b(budgets?|costs?|financial?|expenditure|funds requested)\b/.test(norm)) return 'budget'
  if (/\b(evaluations?|monitoring|metrics?|assessments?|measures?|indicators?)\b/.test(norm)) return 'evaluation'
  if (/\b(impacts?|outcomes?|benefits?|results?|dissemination|outputs?)\b/.test(norm)) return 'impact_outcomes'
  if (/\b(teams?|expertise|cvs?|investigators?|personnel|institutions?|institutional|facilit(?:y|ies)|qualifications?)\b/.test(norm)) return 'team'
  if (/\b(sustainability|risks?|mitigation|contingenc(?:y|ies)|limitations?|challenges?|exit strategy)\b/.test(norm)) return 'sustainability_risk'
  if (/\b(attachments?|append(?:ix|ices)|annexures?|submission|eligibility|compliance|checklists?)\b/.test(norm)) return 'attachments_submission'
  return 'other'
}

/** Anything carrying enough information to identify a reviewer section. */
export interface SectionBucketSource {
  reviewerBucketKey?: string | null
  mappingJson?: unknown
  section_title?: string | null
}

/**
 * The one function every consumer calls to find out what kind of section this
 * is: stored column, then the seeder's `mappingJson.bucketKey`, then the title.
 *
 * The title fallback is what lets the backfill be incomplete — a row with a
 * NULL key resolves correctly on read, and improves for free whenever
 * `BUCKET_SYNONYMS` does. Note the explicit `BUCKET_LABELS` guard on the stored
 * values: `normalizeBucketKey` collapses anything unrecognised to `other`, so
 * without it a stale key like `timeline` would resolve to `other` instead of
 * falling through to a title that says "Project Timeline".
 */
export function resolveBucketKey(section: SectionBucketSource | string | null | undefined): string {
  if (!section) return 'other'
  if (typeof section === 'string') return bucketFromText(section)

  const stored = String(section.reviewerBucketKey || '').trim()
  if (stored && BUCKET_LABELS[stored]) return stored

  const mapping = section.mappingJson && typeof section.mappingJson === 'object'
    ? (section.mappingJson as Record<string, unknown>)
    : null
  const mapped = mapping ? String(mapping.bucketKey || '').trim() : ''
  if (mapped && BUCKET_LABELS[mapped]) return mapped

  return bucketFromText(section.section_title || '')
}

export function bucketFromIntent(intent?: GrantTemplateIntent | string | null, fallbackText = ''): string {
  const normalized = String(intent || '').trim().toLowerCase()
  switch (normalized) {
    case 'summary':
      return 'summary'
    case 'problem_need':
    case 'alignment':
    case 'innovation':
      return 'problem_need'
    case 'objectives':
      return 'objectives'
    case 'methodology':
      return 'methodology'
    case 'workplan':
      return 'workplan'
    case 'budget':
      return 'budget'
    case 'evaluation':
      return 'evaluation'
    case 'impact_outcomes':
      return 'impact_outcomes'
    case 'team':
    case 'institutional':
      return 'team'
    case 'sustainability':
    case 'risk':
      return 'sustainability_risk'
    case 'attachments':
    case 'submission':
    case 'eligibility':
      return 'attachments_submission'
    default:
      return bucketFromText(fallbackText)
  }
}

export function dedupeRuleText(values: unknown[], limit?: number): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
    if (limit && next.length >= limit) break
  }
  return next
}
