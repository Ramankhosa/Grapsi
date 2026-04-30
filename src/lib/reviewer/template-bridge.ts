import crypto from 'crypto'

import { Prisma } from '@/lib/prisma-generated'
import prisma from '@/lib/prisma'
import { getGrantWorkspace } from '@/lib/grants/workspace'
import { hasMeaningfulSectionContent } from '@/lib/reviewer/content'
import { normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'
import type { GrantBlueprintPlanSection, GrantTemplateIntent } from '@/types/grant'
import type { FundingTemplateItem, GrantTemplateDocument } from '@/lib/fundingTemplates/types'

type JsonRecord = Record<string, unknown>

export type ReviewerModeValue = 'standalone' | 'grant_integrated'

export interface ReviewerManualRubric {
  evaluationCriteria: string[]
  reviewerSignals: string[]
  mustAddress: string[]
  avoid: string[]
  formatRules: string[]
  sectionOverrides: Record<string, Partial<Omit<ReviewerManualRubric, 'sectionOverrides' | 'mappingOverrides'>>>
  mappingOverrides: Record<string, string>
}

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

export interface ReviewerTemplateContext {
  title: string
  agency_name: string
  call_summary: string
  description: string
  funding_call_id: string
  template_id: string
  source_template_revision_id: string | null
  rules_source: 'template_manual'
  template_sections: ReviewerTemplateSectionRule[]
  manual_rubric: ReviewerManualRubric
  evaluation_criteria: string[]
  reviewer_signals: string[]
  dos: string[]
  donts: string[]
  mandatory_sections: string[]
  format_rules: string[]
  thrust_areas: string[]
  budget_cap: string | null
  project_duration_limit: string | null
  submission_deadline: string | null
  reviewer_context_text: string
}

export interface ReviewerSectionMapping {
  bucketKey: string
  bucketLabel: string
  aggregateContent: string
  sourceHash: string
  linkedSections: Array<{
    grantSectionDraftId: string | null
    sectionKey: string
    label: string
    order: number
    sourceContentHash: string
    bucketKey: string
    workflowMode?: string | null
    reviewerIntent?: string | null
    mustCover?: string[]
    mustAvoid?: string[]
    grantSemantic?: string | null
    templateIntent?: string | null
    grantRuleProfile?: unknown
    grantTemplateGuidance?: unknown
    grantSectionComplianceContract?: unknown
  }>
}

export interface IntegratedReviewerState {
  call: any | null
  sections: any[]
  mappings: ReviewerSectionMapping[]
  diagnostics: {
    draftedSectionCount: number
    mappedSectionCount: number
    staleSectionCount: number
    rulesSource: 'template_manual'
  }
}

const BUCKET_LABELS: Record<string, string> = {
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

function asObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean)
  }
  const text = asString(value)
  return text ? [text] : []
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
  }
  return next
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
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

export function normalizeManualRubric(value: unknown): ReviewerManualRubric {
  const record = asObject(value)
  const sectionOverridesRecord = asObject(record.sectionOverrides)
  const sectionOverrides: ReviewerManualRubric['sectionOverrides'] = {}

  for (const [bucketKey, overrideValue] of Object.entries(sectionOverridesRecord)) {
    const override = asObject(overrideValue)
    sectionOverrides[bucketKey] = {
      evaluationCriteria: asStringArray(override.evaluationCriteria),
      reviewerSignals: asStringArray(override.reviewerSignals),
      mustAddress: asStringArray(override.mustAddress),
      avoid: asStringArray(override.avoid),
      formatRules: asStringArray(override.formatRules),
    }
  }

  const mappingOverridesRecord = asObject(record.mappingOverrides)
  const mappingOverrides: Record<string, string> = {}
  for (const [sectionKey, bucketKey] of Object.entries(mappingOverridesRecord)) {
    const normalizedSectionKey = asString(sectionKey)
    const normalizedBucketKey = normalizeBucketKey(asString(bucketKey))
    if (normalizedSectionKey && normalizedBucketKey) {
      mappingOverrides[normalizedSectionKey] = normalizedBucketKey
    }
  }

  return {
    evaluationCriteria: asStringArray(record.evaluationCriteria),
    reviewerSignals: asStringArray(record.reviewerSignals),
    mustAddress: asStringArray(record.mustAddress),
    avoid: asStringArray(record.avoid),
    formatRules: asStringArray(record.formatRules),
    sectionOverrides,
    mappingOverrides,
  }
}

function normalizeBucketKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!key) return 'other'
  if (BUCKET_LABELS[key]) return key
  return 'other'
}

function bucketFromIntent(intent?: GrantTemplateIntent | string | null, fallbackText = ''): string {
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

function bucketFromText(value: string): string {
  const text = value.toLowerCase()
  if (/\b(abstract|summary|overview|synopsis)\b/.test(text)) return 'summary'
  if (/\b(problem|need|background|significance|alignment|fit|rationale|innovation)\b/.test(text)) return 'problem_need'
  if (/\b(objective|aim|goal|hypothesis)\b/.test(text)) return 'objectives'
  if (/\b(method|approach|research plan|design|experiment|implementation)\b/.test(text)) return 'methodology'
  if (/\b(workplan|timeline|milestone|schedule|gantt|deliverable)\b/.test(text)) return 'workplan'
  if (/\b(budget|cost|justification|finance)\b/.test(text)) return 'budget'
  if (/\b(evaluation|monitoring|metric|assessment|measure)\b/.test(text)) return 'evaluation'
  if (/\b(impact|outcome|benefit|result|dissemination)\b/.test(text)) return 'impact_outcomes'
  if (/\b(team|expertise|cv|investigator|personnel|institution)\b/.test(text)) return 'team'
  if (/\b(sustainability|risk|mitigation|contingency)\b/.test(text)) return 'sustainability_risk'
  if (/\b(attachment|appendix|submission|eligibility|compliance|checklist)\b/.test(text)) return 'attachments_submission'
  return 'other'
}

function templateItemToRule(item: FundingTemplateItem, fallbackBucket?: string): ReviewerTemplateSectionRule {
  const bucketKey = fallbackBucket || bucketFromIntent(item.templateIntent, `${item.label} ${item.guidance || ''}`)
  return {
    key: item.key,
    label: item.label,
    bucketKey,
    bucketLabel: BUCKET_LABELS[bucketKey] || BUCKET_LABELS.other,
    type: item.type,
    workflowMode: item.workflowMode || null,
    required: item.required !== false,
    wordLimit: typeof item.wordLimit === 'number' ? item.wordLimit : null,
    charLimit: typeof item.charLimit === 'number' ? item.charLimit : null,
    reviewerGoal: item.reviewerGoal || null,
    guidanceText: dedupe([item.guidance || '', item.guidanceText || '']),
    requiredFacts: asStringArray(item.requiredFacts),
    forbiddenMoves: asStringArray(item.forbiddenMoves),
  }
}

function collectTemplateRules(template: GrantTemplateDocument): ReviewerTemplateSectionRule[] {
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
      guidanceText: dedupe([
        template.budget.justificationNotes || '',
        ...template.budget.categories.map((category) => `${category.label}${category.cap ? `: ${category.cap}` : ''}${category.notes ? ` - ${category.notes}` : ''}`),
      ]),
      requiredFacts: [],
      forbiddenMoves: [],
    })
  }

  return rules
}

function buildContextText(context: Omit<ReviewerTemplateContext, 'reviewer_context_text'>): string {
  const lines = [
    `Funding call: ${context.title}`,
    `Agency: ${context.agency_name}`,
    context.description ? `Description: ${context.description}` : '',
    context.budget_cap ? `Budget cap: ${context.budget_cap}` : '',
    context.project_duration_limit ? `Duration: ${context.project_duration_limit}` : '',
    context.submission_deadline ? `Deadline: ${context.submission_deadline}` : '',
    '',
    'Template reviewer rules:',
    ...context.template_sections.map((section) => {
      const constraints = [
        section.wordLimit ? `${section.wordLimit} words` : '',
        section.charLimit ? `${section.charLimit} characters` : '',
        section.reviewerGoal ? `goal: ${section.reviewerGoal}` : '',
      ].filter(Boolean).join('; ')
      return `- ${section.label} (${section.bucketLabel})${constraints ? `: ${constraints}` : ''}`
    }),
    '',
    'Manual rubric:',
    ...context.manual_rubric.evaluationCriteria.map((item) => `- Criterion: ${item}`),
    ...context.manual_rubric.reviewerSignals.map((item) => `- Reviewer signal: ${item}`),
    ...context.manual_rubric.mustAddress.map((item) => `- Must address: ${item}`),
    ...context.manual_rubric.avoid.map((item) => `- Avoid: ${item}`),
    ...context.manual_rubric.formatRules.map((item) => `- Format rule: ${item}`),
  ]

  return lines.filter(Boolean).join('\n')
}

export async function buildReviewerContextFromFundingCall(input: {
  fundingCallId: string
  manualRubric?: unknown
}): Promise<ReviewerTemplateContext & { templateSnapshot: JsonRecord }> {
  const call = await prisma.fundingCall.findUnique({
    where: { id: input.fundingCallId },
    include: {
      active_template: true,
      template: true,
    },
  })

  if (!call) {
    throw new Error('Funding call not found')
  }

  const template = call.active_template || call.template
  if (!template || template.status !== 'approved') {
    throw new Error('An approved funding template is required before reviewer setup.')
  }

  const revision = await prisma.fundingCallTemplateRevision.findFirst({
    where: {
      templateId: template.id,
      OR: [
        { version: template.current_revision_no },
        { revision_no: template.current_revision_no },
      ],
    },
    orderBy: [{ version: 'desc' }, { revision_no: 'desc' }],
  })

  const templateDocument = normalizeGrantTemplate(template.grant_template_json)
  const templateSections = collectTemplateRules(templateDocument)
  const manualRubric = normalizeManualRubric(input.manualRubric)
  const callRecord = call as unknown as JsonRecord

  const baseEvaluationCriteria = templateSections
    .filter((item) => item.type === 'rubric')
    .flatMap((item) => [item.label, ...item.guidanceText, item.reviewerGoal || ''])

  const title =
    asString(call.scheme_title)
    || asString(call.title)
    || 'Funding opportunity'
  const agency =
    asString(call.agency_name)
    || asString(call.agencyName)
    || 'Funding agency'
  const description =
    asString(call.description)
    || asString(call.summary)
    || asString(call.raw_text)

  const contextWithoutText: Omit<ReviewerTemplateContext, 'reviewer_context_text'> = {
    title,
    agency_name: agency,
    call_summary: description || title,
    description,
    funding_call_id: call.id,
    template_id: template.id,
    source_template_revision_id: revision?.id || null,
    rules_source: 'template_manual',
    template_sections: templateSections,
    manual_rubric: manualRubric,
    evaluation_criteria: dedupe([...baseEvaluationCriteria, ...manualRubric.evaluationCriteria]),
    reviewer_signals: dedupe([
      ...templateSections.flatMap((item) => item.reviewerGoal ? [item.reviewerGoal] : []),
      ...manualRubric.reviewerSignals,
    ]),
    dos: dedupe([
      ...templateSections.flatMap((item) => item.requiredFacts),
      ...manualRubric.mustAddress,
    ]),
    donts: dedupe([
      ...templateSections.flatMap((item) => item.forbiddenMoves),
      ...manualRubric.avoid,
    ]),
    mandatory_sections: dedupe(
      templateSections
        .filter((item) => item.required)
        .map((item) => item.label)
    ),
    format_rules: dedupe([
      ...templateSections.flatMap((item) => [
        item.wordLimit ? `${item.label}: ${item.wordLimit} words` : '',
        item.charLimit ? `${item.label}: ${item.charLimit} characters` : '',
      ]),
      ...manualRubric.formatRules,
    ]),
    thrust_areas: dedupe([
      ...asStringArray(call.disciplines),
      ...asStringArray(call.funding_kinds),
    ]),
    budget_cap: moneyRange(callRecord),
    project_duration_limit: durationText(callRecord),
    submission_deadline: formatDate(call.close_date || call.deadlineAt || call.expiration_date),
  }

  const context = {
    ...contextWithoutText,
    reviewer_context_text: buildContextText(contextWithoutText),
  }

  return {
    ...context,
    templateSnapshot: {
      templateId: template.id,
      fundingCallId: call.id,
      status: template.status,
      currentRevisionNo: template.current_revision_no,
      sourceTemplateRevisionId: revision?.id || null,
      grantTemplateJson: templateDocument,
      compiledGrantTemplateJson: template.compiledGrantTemplateJson ?? null,
      capturedAt: new Date().toISOString(),
    },
  }
}

function serializeGrantDraft(section: any): string {
  const content = asString(section?.content)
  if (hasMeaningfulSectionContent(content)) return content

  const responses = Array.isArray(section?.structuredResponses) ? section.structuredResponses : []
  const serialized = responses
    .map((response: any) => {
      const payload = response?.responseJson
      if (!payload) return ''
      try {
        return JSON.stringify(payload, null, 2)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')

  return hasMeaningfulSectionContent(serialized) ? serialized.trim() : ''
}

function resolvePlanSection(section: any, sectionPlanByKey: Map<string, GrantBlueprintPlanSection>) {
  return sectionPlanByKey.get(String(section?.sectionKey || '')) || null
}

export function buildReviewerSectionMappings(input: {
  sectionDrafts: any[]
  sectionPlan: GrantBlueprintPlanSection[]
  manualRubric?: unknown
}): ReviewerSectionMapping[] {
  const manualRubric = normalizeManualRubric(input.manualRubric)
  const sectionPlanByKey = new Map(input.sectionPlan.map((section) => [section.sectionKey, section]))
  const groups = new Map<string, ReviewerSectionMapping>()

  const orderedDrafts = [...input.sectionDrafts].sort((left, right) =>
    Number(left?.sectionOrder ?? left?.order ?? 0) - Number(right?.sectionOrder ?? right?.order ?? 0)
  )

  for (const draft of orderedDrafts) {
    const sectionKey = asString(draft?.sectionKey)
    if (!sectionKey) continue

    const planSection = resolvePlanSection(draft, sectionPlanByKey)
    const workflowMode = asString(planSection?.workflowMode) || asString(draft?.workflowMode)
    if (workflowMode !== 'app_draft') continue

    const content = serializeGrantDraft(draft)
    if (!hasMeaningfulSectionContent(content)) continue

    const overrideBucket = manualRubric.mappingOverrides[sectionKey]
    const bucketKey = overrideBucket || bucketFromIntent(
      planSection?.grantSemantic || planSection?.templateIntent || draft?.grantSemantic || draft?.templateIntent,
      `${draft?.label || ''} ${planSection?.label || ''} ${draft?.sectionType || ''}`
    )
    const bucketLabel = BUCKET_LABELS[bucketKey] || BUCKET_LABELS.other
    const order = Number(draft?.sectionOrder ?? planSection?.order ?? 0)
    const sourceContentHash = sha256({ sectionKey, content })

    let group = groups.get(bucketKey)
    if (!group) {
      group = {
        bucketKey,
        bucketLabel,
        aggregateContent: '',
        sourceHash: '',
        linkedSections: [],
      }
      groups.set(bucketKey, group)
    }

    group.linkedSections.push({
      grantSectionDraftId: asString(draft?.id) || null,
      sectionKey,
      label: asString(draft?.label) || asString(planSection?.label) || sectionKey,
      order,
      sourceContentHash,
      bucketKey,
      workflowMode,
      reviewerIntent: planSection?.reviewerIntent || null,
      mustCover: Array.isArray(planSection?.mustCover) ? planSection.mustCover : [],
      mustAvoid: Array.isArray(planSection?.mustAvoid) ? planSection.mustAvoid : [],
      grantSemantic: planSection?.grantSemantic || null,
      templateIntent: planSection?.templateIntent || null,
      grantRuleProfile: planSection?.grantRuleProfile || null,
      grantTemplateGuidance: planSection?.grantTemplateGuidance || null,
      grantSectionComplianceContract: planSection?.grantSectionComplianceContract || null,
    })
  }

  for (const group of groups.values()) {
    group.linkedSections.sort((left, right) => left.order - right.order)
    group.aggregateContent = group.linkedSections
      .map((link) => {
        const draft = orderedDrafts.find((item) => asString(item?.sectionKey) === link.sectionKey)
        const content = serializeGrantDraft(draft)
        return `## ${link.label} [${link.sectionKey}]\n${content}`
      })
      .join('\n\n')
    group.sourceHash = sha256({
      bucketKey: group.bucketKey,
      links: group.linkedSections.map((link) => ({
        sectionKey: link.sectionKey,
        hash: link.sourceContentHash,
      })),
    })
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftOrder = left.linkedSections[0]?.order ?? 9999
    const rightOrder = right.linkedSections[0]?.order ?? 9999
    return leftOrder - rightOrder
  })
}

function reviewerCallInputData(context: ReviewerTemplateContext, mode: ReviewerModeValue): string {
  return JSON.stringify({
    source: 'template_backed_reviewer',
    mode,
    fundingCallId: context.funding_call_id,
    templateId: context.template_id,
    sourceTemplateRevisionId: context.source_template_revision_id,
  })
}

function asInputJson(value: unknown) {
  return value as Prisma.InputJsonValue
}

export async function createStandaloneReviewerCall(input: {
  userId: string
  tenantId?: string | null
  fundingCallId: string
  projectTitle: string
  manualRubric?: unknown
  seedSections?: boolean
}) {
  const context = await buildReviewerContextFromFundingCall({
    fundingCallId: input.fundingCallId,
    manualRubric: input.manualRubric,
  })

  const created = await prisma.$transaction(async (tx) => {
    const call = await tx.reviewerCall.create({
      data: {
        user_id: input.userId,
        tenantId: input.tenantId || null,
        fundingCallId: input.fundingCallId,
        reviewerMode: 'standalone',
        templateSnapshotJson: asInputJson(context.templateSnapshot),
        manualRubricJson: asInputJson(context.manual_rubric),
        rulesSource: 'template_manual',
        sourceTemplateRevisionId: context.source_template_revision_id,
        project_title: input.projectTitle,
        agency_name: context.agency_name,
        call_input_type: 'template',
        call_input_data: reviewerCallInputData(context, 'standalone'),
        parsed_json: asInputJson(context),
        review_status: 'parsed',
        LLM_model_used: 'template',
      } as any,
    })

    if (input.seedSections) {
      const buckets = new Map<string, ReviewerTemplateSectionRule[]>()
      for (const rule of context.template_sections) {
        const existing = buckets.get(rule.bucketKey) || []
        existing.push(rule)
        buckets.set(rule.bucketKey, existing)
      }

      for (const [bucketKey, rules] of buckets.entries()) {
        await tx.reviewerSection.create({
          data: {
            call_id: call.id,
            section_title: BUCKET_LABELS[bucketKey] || BUCKET_LABELS.other,
            user_input: '',
            ai_review_json: {},
            status: 'draft',
            reviewerBucketKey: bucketKey,
            mappingJson: asInputJson({
              source: 'template_seed',
              templateRules: rules.map((rule) => rule.key),
            }),
          } as any,
        })
      }
    }

    return call
  })

  return created
}

async function replaceGrantLinks(tx: any, input: {
  reviewerCallId: string
  reviewerSectionId: string
  grantSessionId: string
  mapping: ReviewerSectionMapping
}) {
  for (const link of input.mapping.linkedSections) {
    await tx.reviewerSectionGrantLink.updateMany({
      where: {
        grantSessionId: input.grantSessionId,
        grantSectionKey: link.sectionKey,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    })
  }

  for (const link of input.mapping.linkedSections) {
    await tx.reviewerSectionGrantLink.create({
      data: {
        reviewerCallId: input.reviewerCallId,
        reviewerSectionId: input.reviewerSectionId,
        grantSessionId: input.grantSessionId,
        grantSectionDraftId: link.grantSectionDraftId,
        grantSectionKey: link.sectionKey,
        grantSectionLabel: link.label,
        sourceContentHash: link.sourceContentHash,
        order: link.order,
        isActive: true,
      },
    })
  }
}

export async function refreshIntegratedReviewerCall(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  manualRubric?: unknown
  createRevisions?: boolean
}): Promise<IntegratedReviewerState> {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })

  if (!workspace?.grantSession || !workspace.blueprint) {
    throw new Error('Grant workspace not found')
  }
  if (workspace.blueprint.status !== 'FROZEN') {
    throw new Error('Freeze the grant blueprint before preparing reviewer mappings.')
  }

  const existingCall = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: input.grantSessionId,
      reviewerMode: 'grant_integrated',
    } as any,
    orderBy: { updated_at: 'desc' },
  })

  const existingRubric = input.manualRubric ?? existingCall?.manualRubricJson ?? {}
  const context = await buildReviewerContextFromFundingCall({
    fundingCallId: workspace.grantSession.fundingCallId,
    manualRubric: existingRubric,
  })
  const mappings = buildReviewerSectionMappings({
    sectionDrafts: workspace.blueprint.sectionDrafts,
    sectionPlan: workspace.blueprint.sectionPlan,
    manualRubric: context.manual_rubric,
  })

  const draftedSectionCount = mappings.reduce((count, mapping) => count + mapping.linkedSections.length, 0)
  if (draftedSectionCount === 0) {
    throw new Error('Draft at least one mapped grant section before preparing reviewer mappings.')
  }

  const call = await prisma.$transaction(async (tx) => {
    const reviewerCall = existingCall
      ? await tx.reviewerCall.update({
          where: { id: existingCall.id },
          data: {
            project_title: workspace.grantSession.project?.name || existingCall.project_title,
            agency_name: context.agency_name,
            fundingCallId: workspace.grantSession.fundingCallId,
            templateSnapshotJson: asInputJson(context.templateSnapshot),
            manualRubricJson: asInputJson(context.manual_rubric),
            rulesSource: 'template_manual',
            sourceTemplateRevisionId: context.source_template_revision_id,
            call_input_type: 'template',
            call_input_data: reviewerCallInputData(context, 'grant_integrated'),
            parsed_json: asInputJson(context),
            review_status: 'parsed',
          } as any,
        })
      : await tx.reviewerCall.create({
          data: {
            user_id: input.userId,
            tenantId: input.tenantId,
            projectId: workspace.grantSession.projectId,
            grantSessionId: input.grantSessionId,
            fundingCallId: workspace.grantSession.fundingCallId,
            reviewerMode: 'grant_integrated',
            templateSnapshotJson: asInputJson(context.templateSnapshot),
            manualRubricJson: asInputJson(context.manual_rubric),
            rulesSource: 'template_manual',
            sourceTemplateRevisionId: context.source_template_revision_id,
            project_title: workspace.grantSession.project?.name || 'Grant proposal',
            agency_name: context.agency_name,
            call_input_type: 'template',
            call_input_data: reviewerCallInputData(context, 'grant_integrated'),
            parsed_json: asInputJson(context),
            review_status: 'parsed',
            LLM_model_used: 'template',
          } as any,
        })

    const existingSections = await tx.reviewerSection.findMany({
      where: { call_id: reviewerCall.id },
      orderBy: [{ version: 'desc' }, { last_reviewed_at: 'desc' }],
    })
    const latestByBucket = new Map<string, any>()
    for (const section of existingSections) {
      const bucketKey = section.reviewerBucketKey || bucketFromText(section.section_title)
      if (!latestByBucket.has(bucketKey)) {
        latestByBucket.set(bucketKey, section)
      }
    }

    for (const mapping of mappings) {
      const existingSection = latestByBucket.get(mapping.bucketKey)
      const mappingJson = {
        source: 'grant_section_mapping',
        bucketKey: mapping.bucketKey,
      linkedSections: mapping.linkedSections,
      workflowMode: 'app_draft',
      generatedAt: new Date().toISOString(),
    }

      let targetSection = existingSection
      const hashChanged = existingSection?.sourceHash && existingSection.sourceHash !== mapping.sourceHash

      if (!existingSection) {
        targetSection = await tx.reviewerSection.create({
          data: {
            call_id: reviewerCall.id,
            section_title: mapping.bucketLabel,
            user_input: mapping.aggregateContent,
            ai_review_json: {},
            status: 'draft',
            reviewerBucketKey: mapping.bucketKey,
            sourceHash: mapping.sourceHash,
            sourceStale: false,
            mappingJson: asInputJson(mappingJson),
          } as any,
        })
      } else if (existingSection.status === 'reviewed' && hashChanged) {
        await tx.reviewerSection.update({
          where: { id: existingSection.id },
          data: {
            sourceStale: true,
            mappingJson: asInputJson({
              ...mappingJson,
              staleReason: 'mapped_source_changed',
              nextSourceHash: mapping.sourceHash,
            }),
          } as any,
        })

        if (input.createRevisions) {
          targetSection = await tx.reviewerSection.create({
            data: {
              call_id: reviewerCall.id,
              section_title: existingSection.section_title,
              user_input: mapping.aggregateContent,
              ai_review_json: {},
              status: 'draft',
              is_revision: true,
              previous_section_id: existingSection.id,
              version: Number(existingSection.version || 1) + 1,
              reviewerBucketKey: mapping.bucketKey,
              sourceHash: mapping.sourceHash,
              sourceStale: false,
              mappingJson: asInputJson(mappingJson),
            } as any,
          })
        }
      } else if (existingSection.status !== 'reviewed' || !hashChanged) {
        targetSection = await tx.reviewerSection.update({
          where: { id: existingSection.id },
          data: {
            section_title: mapping.bucketLabel,
            user_input: existingSection.status === 'reviewed' ? existingSection.user_input : mapping.aggregateContent,
            reviewerBucketKey: mapping.bucketKey,
            sourceHash: mapping.sourceHash,
            sourceStale: false,
            mappingJson: asInputJson(mappingJson),
          } as any,
        })
      }

      await replaceGrantLinks(tx, {
        reviewerCallId: reviewerCall.id,
        reviewerSectionId: targetSection.id,
        grantSessionId: input.grantSessionId,
        mapping,
      })
    }

    return reviewerCall
  })

  return getIntegratedReviewerState({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  }).then((state) => ({
    ...state,
    call: state.call || call,
    mappings,
    diagnostics: {
      ...state.diagnostics,
      draftedSectionCount,
      mappedSectionCount: mappings.length,
    },
  }))
}

export async function getIntegratedReviewerState(input: {
  grantSessionId: string
  tenantId: string
}): Promise<IntegratedReviewerState> {
  const call = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      reviewerMode: 'grant_integrated',
    } as any,
    orderBy: { updated_at: 'desc' },
  })

  if (!call) {
    return {
      call: null,
      sections: [],
      mappings: [],
      diagnostics: {
        draftedSectionCount: 0,
        mappedSectionCount: 0,
        staleSectionCount: 0,
        rulesSource: 'template_manual',
      },
    }
  }

  const sections = await prisma.reviewerSection.findMany({
    where: { call_id: call.id },
    include: {
      grant_section_links: {
        where: { isActive: true },
        orderBy: { order: 'asc' },
      },
    } as any,
    orderBy: [{ reviewerBucketKey: 'asc' }, { version: 'desc' }],
  } as any)

  const mappings = sections
    .filter((section: any) => Array.isArray(section.grant_section_links) && section.grant_section_links.length > 0)
    .map((section: any) => ({
      bucketKey: section.reviewerBucketKey || bucketFromText(section.section_title),
      bucketLabel: section.section_title,
      aggregateContent: section.user_input || '',
      sourceHash: section.sourceHash || '',
      linkedSections: section.grant_section_links.map((link: any) => ({
        grantSectionDraftId: link.grantSectionDraftId || null,
        sectionKey: link.grantSectionKey,
        label: link.grantSectionLabel,
        order: link.order,
        sourceContentHash: link.sourceContentHash,
        bucketKey: section.reviewerBucketKey || bucketFromText(section.section_title),
      })),
    }))

  return {
    call,
    sections,
    mappings,
    diagnostics: {
      draftedSectionCount: mappings.reduce((count, mapping) => count + mapping.linkedSections.length, 0),
      mappedSectionCount: mappings.length,
      staleSectionCount: sections.filter((section: any) => section.sourceStale).length,
      rulesSource: 'template_manual',
    },
  }
}

export async function applyManualGrantReviewerMapping(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  assignments: Array<{ grantSectionKey: string; reviewerBucketKey: string }>
}) {
  const current = await prisma.reviewerCall.findFirst({
    where: {
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      reviewerMode: 'grant_integrated',
    } as any,
    orderBy: { updated_at: 'desc' },
  })

  const manualRubric = normalizeManualRubric(current?.manualRubricJson || {})
  for (const assignment of input.assignments) {
    const sectionKey = asString(assignment.grantSectionKey)
    const bucketKey = normalizeBucketKey(asString(assignment.reviewerBucketKey))
    if (sectionKey && bucketKey) {
      manualRubric.mappingOverrides[sectionKey] = bucketKey
    }
  }

  if (current) {
    await prisma.reviewerCall.update({
      where: { id: current.id },
      data: { manualRubricJson: asInputJson(manualRubric) } as any,
    })
  }

  return refreshIntegratedReviewerCall({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    manualRubric,
    createRevisions: true,
  })
}

export { BUCKET_LABELS as REVIEWER_BUCKET_LABELS }
