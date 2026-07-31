import prisma from '@/lib/prisma'
import { normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'
import type { FundingTemplateItem, GrantTemplateDocument } from '@/lib/fundingTemplates/types'
import type { GuidelinePackDocument, FundingGuidelineRuleItem } from '@/lib/fundingGuidelines/types'
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  bucketFromIntent,
  bucketFromText,
  bucketLabel,
  dedupeRuleText,
  normalizeBucketKey,
} from '@/lib/reviewer/buckets'
import { normalizeManualRubric, type ReviewerManualRubric } from '@/lib/reviewer/manualRubric'
import {
  REVIEWER_RULES_SOURCES,
  RULES_SOURCE_LABELS,
  type ReviewerRulesSource,
} from '@/lib/reviewer/rulesSource'

type JsonRecord = Record<string, unknown>

export { RULES_SOURCE_LABELS }
export type { ReviewerRulesSource }

export interface ReviewerTemplateSectionRule {
  key: string
  label: string
  bucketKey: string
  bucketLabel: string
  type: string
  workflowMode?: string | null
  required: boolean
  wordLimit?: number | null
  charLimit?: number | null
  reviewerGoal?: string | null
  guidanceText: string[]
  requiredFacts: string[]
  forbiddenMoves: string[]
}

export interface ReviewerScoringCriterion {
  key: string
  label: string
  weight: number | null
  description?: string | null
}

export interface ReviewerExtractionMeta {
  model: string
  promptVersion: string
  extractedAt: string
  sourceUrls: string[]
  sourceHash: string
  sourceChars: number
  promptChars: number
  truncated: boolean
  confidence: number | null
  warnings: string[]
  reusedFromCallId?: string | null
}

export interface ReviewerCallContext {
  title: string
  agency_name: string
  call_summary: string
  description: string
  funding_call_id: string | null
  template_id: string | null
  source_template_revision_id: string | null
  rules_source: ReviewerRulesSource
  source_urls: string[]
  template_sections: ReviewerTemplateSectionRule[]
  manual_rubric: ReviewerManualRubric
  evaluation_criteria: string[]
  scoring_criteria: ReviewerScoringCriterion[]
  reviewer_signals: string[]
  dos: string[]
  donts: string[]
  mandatory_sections: string[]
  format_rules: string[]
  submission_rules: string[]
  eligibility_criteria: string
  thrust_areas: string[]
  budget_cap: string | null
  project_duration_limit: string | null
  submission_deadline: string | null
  reviewer_context_text: string
  extraction: ReviewerExtractionMeta | null
}

const RULES_SOURCES = new Set<ReviewerRulesSource>(REVIEWER_RULES_SOURCES)

function asObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean)
  const text = asString(value)
  return text ? [text] : []
}

function asNumberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

function formatDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const text = asString(value)
  return text || null
}

function moneyRange(call: JsonRecord): string | null {
  const min = typeof call.amount_min === 'number' ? call.amount_min : null
  const max = typeof call.amount_max === 'number' ? call.amount_max : null
  const currency = asString(call.currency) || ''
  if (min !== null && max !== null) return `${currency} ${min} - ${max}`.trim()
  if (max !== null) return `${currency} ${max}`.trim()
  if (min !== null) return `${currency} ${min}+`.trim()
  return null
}

function durationText(call: JsonRecord): string | null {
  const explicit = asString(call.project_duration_text)
  if (explicit) return explicit
  const min = typeof call.project_duration_min_months === 'number' ? call.project_duration_min_months : null
  const max = typeof call.project_duration_max_months === 'number' ? call.project_duration_max_months : null
  if (min !== null && max !== null) return `${min} - ${max} months`
  if (max !== null) return `Up to ${max} months`
  if (min !== null) return `${min}+ months`
  return null
}

function slugify(value: string, fallback: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return key || fallback
}

// ---------------------------------------------------------------------------
// Section-rule normalization
// ---------------------------------------------------------------------------

export function normalizeTemplateSectionRule(value: unknown, index: number): ReviewerTemplateSectionRule | null {
  const record = asObject(value)
  const label = asString(record.label) || asString(record.title) || asString(record.name)
  if (!label) return null

  const bucketKey = record.bucketKey
    ? normalizeBucketKey(asString(record.bucketKey))
    : bucketFromIntent(asString(record.templateIntent), `${label} ${asString(record.guidance)}`)

  // workflowMode drives rule scoping in the reviewer prompt: `app_draft` rules
  // attach to their own section, anything else is treated as a non-scoring
  // submission reminder. A rule with no mode falls through to the global pool,
  // which would put every section's rules in every section's prompt — so
  // narrative buckets default to app_draft and attachments to external.
  const workflowMode =
    asString(record.workflowMode) || (bucketKey === 'attachments_submission' ? 'external' : 'app_draft')

  return {
    key: asString(record.key) || slugify(label, `section_${index + 1}`),
    label,
    bucketKey,
    bucketLabel: bucketLabel(bucketKey),
    type: asString(record.type) || 'narrative',
    workflowMode,
    required: record.required !== false,
    wordLimit: asNumberOrNull(record.wordLimit),
    charLimit: asNumberOrNull(record.charLimit),
    reviewerGoal: asString(record.reviewerGoal) || null,
    guidanceText: dedupeRuleText([
      ...asStringArray(record.guidanceText),
      asString(record.guidance),
    ], 8),
    requiredFacts: dedupeRuleText(asStringArray(record.requiredFacts), 10),
    forbiddenMoves: dedupeRuleText(asStringArray(record.forbiddenMoves), 10),
  }
}

function templateItemToRule(item: FundingTemplateItem): ReviewerTemplateSectionRule {
  const bucketKey = bucketFromIntent(item.templateIntent, `${item.label} ${item.guidance || ''}`)
  return {
    key: item.key,
    label: item.label,
    bucketKey,
    bucketLabel: bucketLabel(bucketKey),
    type: item.type,
    workflowMode: item.workflowMode || null,
    required: item.required !== false,
    wordLimit: typeof item.wordLimit === 'number' ? item.wordLimit : null,
    charLimit: typeof item.charLimit === 'number' ? item.charLimit : null,
    reviewerGoal: item.reviewerGoal || null,
    guidanceText: dedupeRuleText([item.guidance || '', item.guidanceText || '']),
    requiredFacts: asStringArray(item.requiredFacts),
    forbiddenMoves: asStringArray(item.forbiddenMoves),
  }
}

export function collectTemplateRules(template: GrantTemplateDocument): ReviewerTemplateSectionRule[] {
  const sectionItems = [
    ...template.sections,
    ...template.questions,
    ...template.attachments,
    ...template.evaluationCriteria,
    ...(template.submissionRules?.items || []),
  ]

  const rules = sectionItems
    .filter((item) => item.key && item.label)
    .map((item) => templateItemToRule(item))

  if (template.budget?.required || template.budget?.categories?.length) {
    rules.push({
      key: 'budget',
      label: 'Budget',
      bucketKey: 'budget',
      bucketLabel: BUCKET_LABELS.budget,
      type: 'budget',
      workflowMode: template.budget.workflowMode || null,
      required: template.budget.required !== false,
      wordLimit: null,
      charLimit: null,
      reviewerGoal: template.budget.justificationNotes || null,
      guidanceText: dedupeRuleText([
        template.budget.justificationNotes || '',
        ...template.budget.categories.map(
          (category) =>
            `${category.label}${category.cap ? `: ${category.cap}` : ''}${category.notes ? ` - ${category.notes}` : ''}`
        ),
      ]),
      requiredFacts: [],
      forbiddenMoves: [],
    })
  }

  return rules
}

// ---------------------------------------------------------------------------
// Context text (what the reviewer model actually reads)
// ---------------------------------------------------------------------------

export function buildReviewerContextText(context: Omit<ReviewerCallContext, 'reviewer_context_text'>): string {
  const scoringLines = context.scoring_criteria.length > 0
    ? context.scoring_criteria.map(
        (criterion) =>
          `- ${criterion.label}${criterion.weight !== null ? ` (weight ${criterion.weight})` : ''}${
            criterion.description ? `: ${criterion.description}` : ''
          }`
      )
    : context.evaluation_criteria.map((item) => `- Criterion: ${item}`)

  const lines = [
    `Funding call: ${context.title}`,
    `Agency: ${context.agency_name}`,
    context.description ? `Description: ${context.description}` : '',
    context.thrust_areas.length ? `Focus areas: ${context.thrust_areas.join(', ')}` : '',
    context.eligibility_criteria ? `Eligibility: ${context.eligibility_criteria}` : '',
    context.budget_cap ? `Budget cap: ${context.budget_cap}` : '',
    context.project_duration_limit ? `Duration: ${context.project_duration_limit}` : '',
    context.submission_deadline ? `Deadline: ${context.submission_deadline}` : '',
    '',
    'Required proposal sections:',
    ...(context.mandatory_sections.length
      ? context.mandatory_sections.map((item) => `- ${item}`)
      : ['- Not stated in the call']),
    '',
    'Section rules:',
    ...context.template_sections.map((section) => {
      const constraints = [
        section.wordLimit ? `${section.wordLimit} words` : '',
        section.charLimit ? `${section.charLimit} characters` : '',
        section.reviewerGoal ? `goal: ${section.reviewerGoal}` : '',
      ]
        .filter(Boolean)
        .join('; ')
      return `- ${section.label} (${section.bucketLabel})${constraints ? `: ${constraints}` : ''}`
    }),
    '',
    'Evaluation criteria:',
    ...scoringLines,
    '',
    ...(context.reviewer_signals.length
      ? ['Reviewer signals:', ...context.reviewer_signals.map((item) => `- ${item}`), '']
      : []),
    ...(context.dos.length ? ['Must address:', ...context.dos.map((item) => `- ${item}`), ''] : []),
    ...(context.donts.length ? ['Avoid:', ...context.donts.map((item) => `- ${item}`), ''] : []),
    ...(context.format_rules.length
      ? ['Format rules:', ...context.format_rules.map((item) => `- ${item}`), '']
      : []),
    ...(context.submission_rules.length
      ? [
          'Submission requirements (non-scoring reminders):',
          ...context.submission_rules.map((item) => `- ${item}`),
        ]
      : []),
  ]

  // Sections are emitted with their own blank-line spacing, so collapse the
  // runs left behind by any block that turned out to be empty.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function normalizeScoringCriteria(value: unknown): ReviewerScoringCriterion[] {
  const items = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const next: ReviewerScoringCriterion[] = []

  for (const item of items) {
    if (typeof item === 'string') {
      const label = item.trim()
      if (!label) continue
      const key = slugify(label, `criterion_${next.length + 1}`)
      if (seen.has(key)) continue
      seen.add(key)
      next.push({ key, label, weight: null, description: null })
      continue
    }

    const record = asObject(item)
    const label = asString(record.label) || asString(record.criterion) || asString(record.name) || asString(record.text)
    if (!label) continue
    const key = asString(record.key) || slugify(label, `criterion_${next.length + 1}`)
    if (seen.has(key)) continue
    seen.add(key)
    next.push({
      key,
      label,
      weight: asNumberOrNull(record.weight),
      description: asString(record.description) || asString(record.rationale) || null,
    })
  }

  return next.slice(0, 15)
}

/**
 * Coerce any partially-shaped context (LLM output, a client-edited preview, or
 * a legacy `parsed_json` row) into a complete `ReviewerCallContext`. Every
 * entry point runs through this, so downstream reviewer prompts can rely on the
 * shape without defensive checks.
 */
export function normalizeReviewerCallContext(input: unknown): ReviewerCallContext {
  const record = asObject(input)
  const manualRubric = normalizeManualRubric(record.manual_rubric ?? record.manualRubric)

  const templateSections = (Array.isArray(record.template_sections) ? record.template_sections : [])
    .map((item, index) => normalizeTemplateSectionRule(item, index))
    .filter((item): item is ReviewerTemplateSectionRule => Boolean(item))

  const rulesSourceRaw = asString(record.rules_source) as ReviewerRulesSource
  const rules_source: ReviewerRulesSource = RULES_SOURCES.has(rulesSourceRaw) ? rulesSourceRaw : 'url_extracted'

  const scoringCriteria = normalizeScoringCriteria(record.scoring_criteria)
  const evaluationCriteria = dedupeRuleText(
    [
      ...asStringArray(record.evaluation_criteria),
      ...scoringCriteria.map((criterion) =>
        criterion.weight !== null ? `${criterion.label} (weight ${criterion.weight})` : criterion.label
      ),
      ...manualRubric.evaluationCriteria,
    ],
    30
  )

  const title = asString(record.title) || 'Funding opportunity'
  const description = asString(record.description) || asString(record.call_summary)

  const withoutText: Omit<ReviewerCallContext, 'reviewer_context_text'> = {
    title,
    agency_name: asString(record.agency_name) || 'Funding agency',
    call_summary: asString(record.call_summary) || description || title,
    description,
    funding_call_id: asString(record.funding_call_id) || null,
    template_id: asString(record.template_id) || null,
    source_template_revision_id: asString(record.source_template_revision_id) || null,
    rules_source,
    source_urls: dedupeRuleText(asStringArray(record.source_urls), 5),
    template_sections: templateSections,
    manual_rubric: manualRubric,
    evaluation_criteria: evaluationCriteria,
    scoring_criteria: scoringCriteria,
    reviewer_signals: dedupeRuleText(
      [...asStringArray(record.reviewer_signals), ...manualRubric.reviewerSignals],
      25
    ),
    dos: dedupeRuleText([...asStringArray(record.dos), ...manualRubric.mustAddress], 30),
    donts: dedupeRuleText([...asStringArray(record.donts), ...manualRubric.avoid], 30),
    mandatory_sections: dedupeRuleText(asStringArray(record.mandatory_sections), 30),
    format_rules: dedupeRuleText([...asStringArray(record.format_rules), ...manualRubric.formatRules], 30),
    submission_rules: dedupeRuleText(asStringArray(record.submission_rules), 30),
    eligibility_criteria: asString(record.eligibility_criteria),
    thrust_areas: dedupeRuleText(asStringArray(record.thrust_areas), 20),
    budget_cap: asString(record.budget_cap) || null,
    project_duration_limit: asString(record.project_duration_limit) || null,
    submission_deadline: asString(record.submission_deadline) || null,
    extraction: normalizeExtractionMeta(record.extraction),
  }

  return {
    ...withoutText,
    reviewer_context_text: asString(record.reviewer_context_text) || buildReviewerContextText(withoutText),
  }
}

function normalizeExtractionMeta(value: unknown): ReviewerExtractionMeta | null {
  const record = asObject(value)
  if (!record || Object.keys(record).length === 0) return null
  return {
    model: asString(record.model) || 'unknown',
    promptVersion: asString(record.promptVersion) || 'unknown',
    extractedAt: asString(record.extractedAt) || new Date().toISOString(),
    sourceUrls: asStringArray(record.sourceUrls),
    sourceHash: asString(record.sourceHash),
    sourceChars: asNumberOrNull(record.sourceChars) ?? 0,
    promptChars: asNumberOrNull(record.promptChars) ?? 0,
    truncated: record.truncated === true,
    confidence: asNumberOrNull(record.confidence),
    warnings: asStringArray(record.warnings),
    reusedFromCallId: asString(record.reusedFromCallId) || null,
  }
}

// ---------------------------------------------------------------------------
// Guideline-pack derived context (no LLM call — the pack is already extracted)
// ---------------------------------------------------------------------------

function guidelineRuleTexts(items: FundingGuidelineRuleItem[] | undefined, limit = 12): string[] {
  if (!Array.isArray(items)) return []
  return dedupeRuleText(
    [...items]
      .sort((left, right) => importanceRank(right.importance) - importanceRank(left.importance))
      .map((item) => item?.text),
    limit
  )
}

function importanceRank(importance: unknown): number {
  switch (String(importance || '').toLowerCase()) {
    case 'high':
      return 3
    case 'medium':
      return 2
    case 'low':
      return 1
    default:
      return 0
  }
}

function sectionRulesFromGuidelinePack(pack: GuidelinePackDocument): ReviewerTemplateSectionRule[] {
  const byBucket = new Map<string, ReviewerTemplateSectionRule>()

  const push = (bucketKey: string, text: string, kind: 'guidance' | 'required' | 'forbidden') => {
    const key = normalizeBucketKey(bucketKey)
    let rule = byBucket.get(key)
    if (!rule) {
      rule = {
        key,
        label: bucketLabel(key),
        bucketKey: key,
        bucketLabel: bucketLabel(key),
        type: 'narrative',
        workflowMode: key === 'attachments_submission' ? 'external' : 'app_draft',
        required: true,
        wordLimit: null,
        charLimit: null,
        reviewerGoal: null,
        guidanceText: [],
        requiredFacts: [],
        forbiddenMoves: [],
      }
      byBucket.set(key, rule)
    }
    if (kind === 'required') rule.requiredFacts.push(text)
    else if (kind === 'forbidden') rule.forbiddenMoves.push(text)
    else rule.guidanceText.push(text)
  }

  const route = (items: FundingGuidelineRuleItem[] | undefined, kind: 'guidance' | 'required' | 'forbidden') => {
    for (const item of Array.isArray(items) ? items : []) {
      const text = asString(item?.text)
      if (!text) continue
      const appliesTo = Array.isArray(item?.appliesTo) ? item.appliesTo.filter(Boolean) : []
      const targets = appliesTo.length > 0 && !appliesTo.includes('all')
        ? appliesTo.map((value) => bucketFromIntent(value, `${value} ${text}`))
        : [bucketFromText(text)]
      for (const target of targets) push(target, text, kind)
    }
  }

  route(pack.mustAddress, 'required')
  route(pack.avoid, 'forbidden')
  route(pack.priorities, 'guidance')
  route(pack.budgetRules, 'guidance')
  route(pack.durationRules, 'guidance')
  route(pack.deliverableRules, 'guidance')

  for (const rule of byBucket.values()) {
    rule.guidanceText = dedupeRuleText(rule.guidanceText, 8)
    rule.requiredFacts = dedupeRuleText(rule.requiredFacts, 10)
    rule.forbiddenMoves = dedupeRuleText(rule.forbiddenMoves, 10)
  }

  return BUCKET_ORDER.map((key) => byBucket.get(key)).filter((rule): rule is ReviewerTemplateSectionRule =>
    Boolean(rule)
  )
}

// ---------------------------------------------------------------------------
// Default section skeleton (used when a call has no approved template)
// ---------------------------------------------------------------------------

/**
 * Sections a research proposal is expected to contain regardless of what the
 * call spells out. Without an approved template the reviewer starts from this
 * skeleton, so the workspace always has a sensible structure instead of one
 * assembled from whichever buckets the call's rules happened to land in.
 */
export const DEFAULT_REVIEWER_BUCKETS: string[] = [
  'summary',
  'problem_need',
  'objectives',
  'methodology',
  'workplan',
  'budget',
  'impact_outcomes',
  'team',
]

function emptySectionRule(bucketKey: string, required: boolean): ReviewerTemplateSectionRule {
  return {
    key: bucketKey,
    label: bucketLabel(bucketKey),
    bucketKey,
    bucketLabel: bucketLabel(bucketKey),
    type: 'narrative',
    workflowMode: bucketKey === 'attachments_submission' ? 'external' : 'app_draft',
    required,
    wordLimit: null,
    charLimit: null,
    reviewerGoal: null,
    guidanceText: [],
    requiredFacts: [],
    forbiddenMoves: [],
  }
}

export interface DefaultSectionMapping {
  sections: ReviewerTemplateSectionRule[]
  /** Rules that belong to no single section, so they apply call-wide. */
  unplaceable: { mustAddress: string[]; avoid: string[] }
  /** Rules about attachments/portal steps: reminders, never scored. */
  submissionReminders: string[]
  /** How many real sections the call's own rules actually reached. */
  matchedSectionCount: number
}

/**
 * Map the rules a call did provide onto the default section skeleton.
 *
 * Sections the call evidenced are marked required; skeleton-only sections are
 * seeded for the user to fill but are not claimed as call requirements, so the
 * final report never reports a "missing required section" the call never asked
 * for. Rules that reached no section become call-wide obligations rather than a
 * catch-all pseudo-section, which is what previously produced a single merged
 * "Other Proposal Material" section holding unrelated rules.
 */
export function mapRulesOntoDefaultSections(
  packSections: ReviewerTemplateSectionRule[]
): DefaultSectionMapping {
  const byBucket = new Map<string, ReviewerTemplateSectionRule>()
  for (const section of packSections) {
    byBucket.set(normalizeBucketKey(section.bucketKey), section)
  }

  const defaults = new Set(DEFAULT_REVIEWER_BUCKETS)
  const sections: ReviewerTemplateSectionRule[] = []
  let matchedSectionCount = 0

  for (const bucketKey of BUCKET_ORDER) {
    // `other` and `attachments_submission` are not proposal sections the user
    // writes: their rules are redirected below.
    if (bucketKey === 'other' || bucketKey === 'attachments_submission') continue

    const provided = byBucket.get(bucketKey)
    if (!provided && !defaults.has(bucketKey)) continue

    if (provided) {
      matchedSectionCount += 1
      sections.push({ ...provided, required: true })
    } else {
      sections.push(emptySectionRule(bucketKey, false))
    }
  }

  const unplaceableSection = byBucket.get('other')
  const attachmentsSection = byBucket.get('attachments_submission')

  return {
    sections,
    unplaceable: {
      mustAddress: dedupeRuleText(
        [...(unplaceableSection?.requiredFacts || []), ...(unplaceableSection?.guidanceText || [])],
        20
      ),
      avoid: dedupeRuleText(unplaceableSection?.forbiddenMoves || [], 20),
    },
    submissionReminders: dedupeRuleText(
      [
        ...(attachmentsSection?.requiredFacts || []),
        ...(attachmentsSection?.guidanceText || []),
        ...(attachmentsSection?.forbiddenMoves || []),
      ],
      20
    ),
    matchedSectionCount,
  }
}

// ---------------------------------------------------------------------------
// Stored funding-call context
// ---------------------------------------------------------------------------

export interface StoredCallContextResult {
  context: ReviewerCallContext
  templateSnapshot: JsonRecord
  readiness: ReviewerRulesSource
}

/**
 * Build reviewer context from a stored funding call.
 *
 * Degrades gracefully instead of hard-failing: an approved template gives the
 * richest rules, an extracted guideline pack is the next best source, and a
 * bare catalogue record still yields a usable reviewer context from its own
 * fields. None of these paths spends a single LLM token.
 */
export async function buildReviewerContextFromStoredCall(input: {
  fundingCallId: string
  manualRubric?: unknown
}): Promise<StoredCallContextResult> {
  const call = await prisma.fundingCall.findUnique({
    where: { id: input.fundingCallId },
    include: {
      active_template: true,
      template: true,
      active_guideline: true,
      guideline: true,
    },
  })

  if (!call) {
    throw new Error('Funding call not found')
  }

  const manualRubric = normalizeManualRubric(input.manualRubric)
  const callRecord = call as unknown as JsonRecord

  const template = call.active_template?.status === 'approved'
    ? call.active_template
    : call.template?.status === 'approved'
      ? call.template
      : null

  const guideline = call.active_guideline || call.guideline || null

  let templateSections: ReviewerTemplateSectionRule[] = []
  let readiness: ReviewerRulesSource = 'call_fields'
  let templateDocument: GrantTemplateDocument | null = null
  let revisionId: string | null = null
  let guidelinePack: GuidelinePackDocument | null = null
  let defaultMapping: DefaultSectionMapping | null = null

  if (template) {
    const revision = await prisma.fundingCallTemplateRevision.findFirst({
      where: {
        templateId: template.id,
        OR: [{ version: template.current_revision_no }, { revision_no: template.current_revision_no }],
      },
      orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
    })
    revisionId = revision?.id || null
    templateDocument = normalizeGrantTemplate(template.grant_template_json)
    templateSections = collectTemplateRules(templateDocument)
    readiness = 'template_manual'
  }

  if (guideline?.guideline_pack_json) {
    guidelinePack = guideline.guideline_pack_json as unknown as GuidelinePackDocument
  }

  // No approved template: fall back to the default proposal sections and map
  // whatever the call does provide onto them. A guideline pack contributes its
  // rules section by section; a bare catalogue record still yields the standard
  // structure. Either way the user gets a complete, predictable section set,
  // and no rule is stranded in a section that only exists because the keyword
  // router could not place it.
  if (templateSections.length === 0) {
    const packSections = guidelinePack ? sectionRulesFromGuidelinePack(guidelinePack) : []
    defaultMapping = mapRulesOntoDefaultSections(packSections)
    templateSections = defaultMapping.sections
    readiness = packSections.length > 0 ? 'guideline_manual' : 'call_fields'
  }

  const baseEvaluationCriteria = templateSections
    .filter((item) => item.type === 'rubric')
    .flatMap((item) => [item.label, ...item.guidanceText, item.reviewerGoal || ''])

  const title = asString(call.scheme_title) || asString(call.title) || 'Funding opportunity'
  const agency = asString(call.agency_name) || asString(call.agencyName) || 'Funding agency'
  const description = asString(call.description) || asString(call.summary) || asString(call.raw_text).slice(0, 4000)

  const withoutText: Omit<ReviewerCallContext, 'reviewer_context_text'> = {
    title,
    agency_name: agency,
    call_summary: description || title,
    description,
    funding_call_id: call.id,
    template_id: template?.id || null,
    source_template_revision_id: revisionId,
    rules_source: readiness,
    source_urls: dedupeRuleText([
      asString(call.source_url),
      asString(call.sourceUrl),
      ...asStringArray(call.official_urls),
    ], 5),
    template_sections: templateSections,
    manual_rubric: manualRubric,
    evaluation_criteria: dedupeRuleText(
      [
        ...baseEvaluationCriteria,
        ...guidelineRuleTexts(guidelinePack?.evaluationCriteria),
        ...manualRubric.evaluationCriteria,
      ],
      30
    ),
    scoring_criteria: normalizeScoringCriteria(
      guidelineRuleTexts(guidelinePack?.evaluationCriteria).length > 0
        ? guidelineRuleTexts(guidelinePack?.evaluationCriteria)
        : baseEvaluationCriteria
    ),
    reviewer_signals: dedupeRuleText(
      [
        ...templateSections.flatMap((item) => (item.reviewerGoal ? [item.reviewerGoal] : [])),
        ...guidelineRuleTexts(guidelinePack?.reviewerSignals),
        ...manualRubric.reviewerSignals,
      ],
      25
    ),
    // budget/duration/deliverable rules are merged here too: when the call has
    // an approved template, `sectionRulesFromGuidelinePack` never runs, and
    // without this these three pack blocks reached the reviewer nowhere at all.
    dos: dedupeRuleText(
      [
        ...templateSections.flatMap((item) => item.requiredFacts),
        // Rules the router could not tie to any one section apply call-wide.
        ...(defaultMapping?.unplaceable.mustAddress || []),
        ...guidelineRuleTexts(guidelinePack?.mustAddress),
        ...guidelineRuleTexts(guidelinePack?.priorities, 6),
        ...guidelineRuleTexts(guidelinePack?.budgetRules, 8),
        ...guidelineRuleTexts(guidelinePack?.durationRules, 4),
        ...guidelineRuleTexts(guidelinePack?.deliverableRules, 8),
        ...manualRubric.mustAddress,
      ],
      40
    ),
    donts: dedupeRuleText(
      [
        ...templateSections.flatMap((item) => item.forbiddenMoves),
        ...(defaultMapping?.unplaceable.avoid || []),
        ...guidelineRuleTexts(guidelinePack?.avoid),
        ...manualRubric.avoid,
      ],
      30
    ),
    mandatory_sections: dedupeRuleText(
      templateSections.filter((item) => item.required).map((item) => item.label),
      30
    ),
    format_rules: dedupeRuleText(
      [
        ...templateSections.flatMap((item) => [
          item.wordLimit ? `${item.label}: ${item.wordLimit} words` : '',
          item.charLimit ? `${item.label}: ${item.charLimit} characters` : '',
        ]),
        ...guidelineRuleTexts(guidelinePack?.formatRules),
        ...manualRubric.formatRules,
      ],
      30
    ),
    submission_rules: dedupeRuleText(
      [
        ...guidelineRuleTexts(guidelinePack?.submissionRules, 20),
        ...(defaultMapping?.submissionReminders || []),
      ],
      30
    ),
    eligibility_criteria: asString(call.eligibility_text),
    thrust_areas: dedupeRuleText(
      [...asStringArray(call.disciplines), ...asStringArray(call.funding_kinds)],
      20
    ),
    budget_cap: moneyRange(callRecord),
    project_duration_limit: durationText(callRecord),
    submission_deadline: formatDate(call.close_date || call.deadlineAt || call.expiration_date),
    extraction: null,
  }

  const context: ReviewerCallContext = {
    ...withoutText,
    reviewer_context_text: buildReviewerContextText(withoutText),
  }

  return {
    context,
    readiness,
    templateSnapshot: {
      templateId: template?.id || null,
      guidelineId: guideline?.id || null,
      fundingCallId: call.id,
      status: template?.status || guideline?.status || 'none',
      currentRevisionNo: template?.current_revision_no ?? null,
      sourceTemplateRevisionId: revisionId,
      grantTemplateJson: templateDocument,
      compiledGrantTemplateJson: template?.compiledGrantTemplateJson ?? null,
      guidelinePackJson: guidelinePack,
      capturedAt: new Date().toISOString(),
    },
  }
}
