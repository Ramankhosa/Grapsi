import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { buildGrantPrepFreezePayload } from '@/lib/grantPrep/handoff/handoffBuilder'
import type { GrantPrepActor } from '@/lib/grantPrep/access'
import {
  buildGeneratedGrantProposalFoundation,
  collectGrantCapturedKeywords,
  enrichGrantBlueprintSections,
  type GrantBlueprintEnrichmentContext,
  shouldBackfillProposalFoundation,
} from '@/lib/grants/blueprintEnrichment'
import { generateGrantBlueprintWithLlm } from '@/lib/grants/blueprintLlmGeneration'
import { normalizeGrantCitationMode } from '@/lib/grants/citationMode'
import {
  buildGrantThematicBlueprint,
  normalizeGrantMustCoverTyping,
  normalizeGrantSuggestedCitationCount,
} from '@/lib/grants/blueprintMetadata'
import {
  isGrantSectionAutoDraftable,
  normalizeGrantWorkflowMode,
} from '@/lib/grants/workflowMode'
import {
  buildProposalGrantComplianceReport,
  buildProposalReviewerReadinessReport,
} from '@/lib/grants/compliance'
import {
  buildGrantPrepModeWarning,
  inflateGrantPrepSessionContext,
  loadGrantPrepSession,
  resolveGrantPrepContext,
} from '@/lib/grantPrep/server'
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types'
import { normalizeGuidelinePack } from '@/lib/fundingGuidelines/utils'
import type { GrantTemplateDocument, FundingTemplateItem } from '@/lib/fundingTemplates/types'
import { normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'
import type { TenantContext } from '@/lib/metering'
import { blueprintService, type BlueprintFreezeReadiness } from '@/lib/services/blueprint-service'
import type {
  CompiledGrantTemplate,
  CompiledGrantTemplateSection,
  CompiledGrantTemplateSectionType,
  GrantBlueprintPlanSection,
  GrantComplianceReport,
  GrantThematicBlueprint,
  GrantWorkflowMode,
  ReviewerReadinessReport,
} from '@/types/grant'

type JsonObject = Record<string, unknown>

export interface LocalGrantLaunchPreview {
  blockers: Array<{ stageKey: string; pointKey: string; message: string }>
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
  payloadHash: string
  sectionPreview: Array<{
    sectionKey: string
    label: string
    sectionType: CompiledGrantTemplateSectionType
    workflowMode: GrantWorkflowMode
    required: boolean
  }>
  canLaunch: boolean
  grantSessionId: string | null
  launchUrl: string | null
}

export interface GrantProposalFoundation {
  thesisStatement: string
  centralObjective: string
  keyContributions: string[]
  status: string | null
  version: number | null
}

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function asGrantComplianceReport(value: unknown): GrantComplianceReport | null {
  const record = asObject(value)
  return Object.keys(record).length > 0 ? (record as unknown as GrantComplianceReport) : null
}

function asReviewerReadinessReport(value: unknown): ReviewerReadinessReport | null {
  const record = asObject(value)
  return Object.keys(record).length > 0 ? (record as unknown as ReviewerReadinessReport) : null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

function dedupeStringList(values: unknown): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of Array.isArray(values) ? values : []) {
    const normalized = String(item || '').trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(normalized)
  }
  return next
}

function normalizeDraftTextMap(value: unknown): Record<string, string> {
  if (!value) return {}

  const record = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value) as Record<string, unknown>
        } catch {
          return {}
        }
      })()
    : asObject(value)

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, item]) => [String(key || '').trim(), String(item || '').trim()] as const)
      .filter(([key, item]) => Boolean(key) && item.length > 0)
  )
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isCompiledGrantTemplate(value: unknown): value is CompiledGrantTemplate {
  const record = asObject(value)
  return Array.isArray(record.sections) && typeof record.version === 'string'
}

function looksNarrativeField(item: FundingTemplateItem): boolean {
  const text = `${item.label || ''} ${item.guidance || ''}`.toLowerCase()
  const narrativeSignals = /(summary|synopsis|description|detailed|methodology|approach|technical plan|project plan|work ?plan|implementation|background|need statement|justification|impact|outcome|functioning|innovation|proposal)/.test(text)
  const conciseSignals = /(title|name|objective|aim|scope|keyword|identifier|code|category|city|state|country|institution|contact|email|phone)/.test(text)
  return narrativeSignals && !conciseSignals
}

function resolveSectionType(item: FundingTemplateItem): CompiledGrantTemplateSectionType {
  if (item.type === 'table') return 'table'
  if (item.type === 'budget') return 'budget_rows'
  if (item.type === 'checklist' || item.type === 'attachment') return 'checklist'
  if (looksNarrativeField(item)) return 'narrative'
  if (item.type === 'field') {
    if ((item.wordLimit || 0) > 350 || (item.charLimit || 0) > 2500) {
      return 'narrative'
    }
    return 'short_answer'
  }
  if ((item.wordLimit || 0) <= 350 && (item.charLimit || 0) <= 2500) {
    return 'short_answer'
  }
  return 'narrative'
}

function normalizeCompiledSection(
  section: Partial<CompiledGrantTemplateSection>,
  index: number
): CompiledGrantTemplateSection {
  const mustCover = Array.isArray(section.mustCover) ? section.mustCover : []
  const mustAvoid = Array.isArray(section.mustAvoid) ? section.mustAvoid : []
  const mustCoverTyping = normalizeGrantMustCoverTyping(mustCover, section.mustCoverTyping)
  const suggestedCitationCount = normalizeGrantSuggestedCitationCount(section.suggestedCitationCount)
  const thematicBlueprint = section.thematicBlueprint
    ? buildGrantThematicBlueprint({
        mustCover,
        mustAvoid,
        mustCoverTyping,
        suggestedCitationCount,
      })
    : undefined

  return {
    sectionKey: String(section.sectionKey || `section_${index + 1}`),
    label: String(section.label || section.sectionKey || `Section ${index + 1}`),
    order: Number.isFinite(section.order) ? Number(section.order) : index + 1,
    sectionType: (section.sectionType || 'narrative') as CompiledGrantTemplateSectionType,
    workflowMode: normalizeGrantWorkflowMode(section.workflowMode),
    citationMode: normalizeGrantCitationMode(section.citationMode, {
      sectionType: section.sectionType,
      workflowMode: section.workflowMode,
      suggestedCitationCount,
    }),
    required: section.required !== false,
    wordBudget: section.wordBudget ?? null,
    characterLimit: section.characterLimit ?? null,
    purpose: String(section.purpose || ''),
    reviewerIntent: section.reviewerIntent ?? null,
    dependencies: Array.isArray(section.dependencies) ? section.dependencies : [],
    sourceTemplatePointer: section.sourceTemplatePointer ?? null,
    mustCover,
    mustAvoid,
    ...(mustCoverTyping ? { mustCoverTyping } : {}),
    ...(typeof suggestedCitationCount === 'number' ? { suggestedCitationCount } : {}),
    ...(thematicBlueprint ? { thematicBlueprint } : {}),
    ...(section.grantSemantic ? { grantSemantic: section.grantSemantic } : {}),
    ...(section.prepContextBlock ? { prepContextBlock: section.prepContextBlock } : {}),
    ...(section.grantRuleProfile ? { grantRuleProfile: section.grantRuleProfile } : {}),
    ...(section.grantTemplateGuidance ? { grantTemplateGuidance: section.grantTemplateGuidance } : {}),
    ...(section.grantSectionComplianceContract ? { grantSectionComplianceContract: section.grantSectionComplianceContract } : {}),
    ...(section.grantComplianceReport ? { grantComplianceReport: section.grantComplianceReport } : {}),
    ...(section.reviewerReadinessReport ? { reviewerReadinessReport: section.reviewerReadinessReport } : {}),
  }
}

function compiledTemplateHasWorkflowModes(value: CompiledGrantTemplate | null | undefined) {
  return Boolean(
    value
    && Array.isArray(value.sections)
    && value.sections.every((section) => normalizeGrantWorkflowMode((section as CompiledGrantTemplateSection).workflowMode) === (section as CompiledGrantTemplateSection).workflowMode)
  )
}

function compileGrantTemplateDocument(input: {
  fundingCallId: string
  templateRevisionId: string
  guidelineRevisionId: string | null
  document: GrantTemplateDocument
}): CompiledGrantTemplate {
  const sections: CompiledGrantTemplateSection[] = []
  const seenKeys = new Set<string>()
  let order = 0

  const pushItem = (
    item: FundingTemplateItem,
    fallbackLabel: string,
    forcedType?: CompiledGrantTemplateSectionType
  ) => {
    const rawKey = item.key || slugify(item.label || fallbackLabel) || `section_${order + 1}`
    if (seenKeys.has(rawKey)) return
    seenKeys.add(rawKey)
    order += 1
    const label = item.label || fallbackLabel || rawKey
    const guidance = (item.guidanceText || item.guidance || '').trim()
    const requiredFacts = dedupeStringList(item.requiredFacts || [])
    const forbiddenMoves = dedupeStringList(item.forbiddenMoves || [])
    const templateGuidance = {
      pointer: `${forcedType === 'short_answer' ? 'questions' : 'sections'}.${rawKey}`,
      guidanceText: guidance ? [guidance] : [],
      requiredFacts,
      reviewerGoal: item.reviewerGoal || guidance || null,
      forbiddenMoves,
      draftingVsSubmission: item.draftingVsSubmission || 'drafting',
    } as const
    sections.push({
      sectionKey: rawKey,
      label,
      order,
      sectionType: forcedType || resolveSectionType(item),
      workflowMode: normalizeGrantWorkflowMode(item.workflowMode),
      citationMode: normalizeGrantCitationMode(null, {
        sectionType: forcedType || resolveSectionType(item),
        workflowMode: normalizeGrantWorkflowMode(item.workflowMode),
      }),
      required: item.required !== false,
      wordBudget: item.wordLimit ?? null,
      characterLimit: item.charLimit ?? null,
      purpose: guidance || `Prepare ${label}.`,
      reviewerIntent: item.reviewerGoal || guidance || null,
      dependencies: [],
      sourceTemplatePointer: rawKey,
      mustCover: requiredFacts.length > 0 ? requiredFacts : (guidance ? [guidance] : []),
      mustAvoid: forbiddenMoves,
      grantTemplateGuidance: templateGuidance,
    })
  }

  for (const section of input.document.sections || []) {
    pushItem(section, section.label || 'Narrative Section')
  }

  for (const question of input.document.questions || []) {
    pushItem(question, question.label || 'Response', 'short_answer')
  }

  if (input.document.budget && (input.document.budget.required || input.document.budget.categories.length > 0)) {
    order += 1
    sections.push({
      sectionKey: 'budget',
      label: 'Budget',
      order,
      sectionType: 'budget_rows',
      workflowMode: normalizeGrantWorkflowMode(input.document.budget.workflowMode, 'app_support'),
      citationMode: 'no_citations',
      required: input.document.budget.required,
      wordBudget: null,
      characterLimit: null,
      purpose: input.document.budget.justificationNotes || 'Provide the requested project budget.',
      reviewerIntent: input.document.budget.justificationNotes || null,
      dependencies: [],
      sourceTemplatePointer: 'budget',
      mustCover: input.document.budget.categories.map((category) => category.label),
      mustAvoid: [],
      grantTemplateGuidance: {
        pointer: 'budget',
        guidanceText: input.document.budget.justificationNotes ? [input.document.budget.justificationNotes] : [],
        requiredFacts: input.document.budget.categories.map((category) => category.label),
        reviewerGoal: input.document.budget.justificationNotes || null,
        forbiddenMoves: [],
        draftingVsSubmission: 'both',
      },
    })
  }

  if ((input.document.attachments || []).length > 0) {
    order += 1
    sections.push({
      sectionKey: 'attachments',
      label: 'Attachments Checklist',
      order,
      sectionType: 'checklist',
      workflowMode: 'team_manual',
      citationMode: 'no_citations',
      required: true,
      wordBudget: null,
      characterLimit: null,
      purpose: 'Track the supporting attachments required with the proposal.',
      reviewerIntent: null,
      dependencies: [],
      sourceTemplatePointer: 'attachments',
      mustCover: input.document.attachments.map((item) => item.label),
      mustAvoid: [],
      grantTemplateGuidance: {
        pointer: 'attachments',
        guidanceText: [],
        requiredFacts: input.document.attachments.map((item) => item.label),
        reviewerGoal: 'Track the required attachments before submission.',
        forbiddenMoves: [],
        draftingVsSubmission: 'submission',
      },
    })
  }

  if (sections.length === 0) {
    sections.push({
      sectionKey: 'proposal_narrative',
      label: 'Proposal Narrative',
      order: 1,
      sectionType: 'narrative',
      workflowMode: 'app_draft',
      citationMode: 'mapped_evidence',
      required: true,
      wordBudget: null,
      characterLimit: null,
      purpose: 'Draft the core proposal narrative.',
      reviewerIntent: null,
      dependencies: [],
      sourceTemplatePointer: 'proposal_narrative',
      mustCover: [],
      mustAvoid: [],
      grantTemplateGuidance: {
        pointer: 'proposal_narrative',
        guidanceText: ['Draft the core proposal narrative.'],
        requiredFacts: [],
        reviewerGoal: 'Present a reviewer-ready proposal narrative.',
        forbiddenMoves: [],
        draftingVsSubmission: 'drafting',
      },
    })
  }

  return {
    version: 'compiled_grant_template_v1',
    fundingCallId: input.fundingCallId,
    templateRevisionId: input.templateRevisionId,
    guidelineRevisionId: input.guidelineRevisionId,
    sections,
  }
}

async function resolveApprovedTemplateForSession(input: {
  fundingCallId: string
  templateRevisionId: string | null
  guidelineRevisionId: string | null
}) {
  if (input.templateRevisionId) {
    const revision = await prisma.fundingCallTemplateRevision.findUnique({
      where: { id: input.templateRevisionId },
      select: {
        id: true,
        compiledGrantTemplateJson: true,
        grant_template_json: true,
      },
    })
    if (revision) {
      const compiled = isCompiledGrantTemplate(revision.compiledGrantTemplateJson)
        && compiledTemplateHasWorkflowModes(revision.compiledGrantTemplateJson)
        ? revision.compiledGrantTemplateJson
        : compileGrantTemplateDocument({
            fundingCallId: input.fundingCallId,
            templateRevisionId: revision.id,
            guidelineRevisionId: input.guidelineRevisionId,
            document: normalizeGrantTemplate(revision.grant_template_json),
          })

      return {
        templateRevisionId: revision.id,
        compiledTemplate: {
          ...compiled,
          sections: compiled.sections.map(normalizeCompiledSection),
          fundingCallId: input.fundingCallId,
          templateRevisionId: revision.id,
          guidelineRevisionId: input.guidelineRevisionId,
        } satisfies CompiledGrantTemplate,
      }
    }
  }

  const template = await prisma.fundingCallTemplate.findUnique({
    where: { fundingCallId: input.fundingCallId },
    select: {
      id: true,
      status: true,
      current_revision_no: true,
      compiledGrantTemplateJson: true,
      grant_template_json: true,
    },
  })

  if (!template || template.status !== 'approved') {
    throw new Error('An approved template is required before launching the local grant workspace.')
  }

  const templateRevisionId = `${template.id}:current:${template.current_revision_no}`
  const compiled = isCompiledGrantTemplate(template.compiledGrantTemplateJson)
    && compiledTemplateHasWorkflowModes(template.compiledGrantTemplateJson)
    ? template.compiledGrantTemplateJson
    : compileGrantTemplateDocument({
        fundingCallId: input.fundingCallId,
        templateRevisionId,
        guidelineRevisionId: input.guidelineRevisionId,
        document: normalizeGrantTemplate(template.grant_template_json),
      })

  return {
    templateRevisionId,
    compiledTemplate: {
      ...compiled,
      sections: compiled.sections.map(normalizeCompiledSection),
      fundingCallId: input.fundingCallId,
      templateRevisionId,
      guidelineRevisionId: input.guidelineRevisionId,
    } satisfies CompiledGrantTemplate,
  }
}

async function resolveGuidelinePackForRevision(
  guidelineRevisionId: string | null | undefined
): Promise<GuidelinePackDocument | null> {
  const revisionId = String(guidelineRevisionId || '').trim()
  if (!revisionId) return null

  const revision = await prisma.fundingCallGuidelineRevision.findUnique({
    where: { id: revisionId },
    select: {
      guideline_pack_json: true,
      extractedPayload: true,
    },
  })

  if (!revision) {
    return null
  }

  return normalizeGuidelinePack(revision.guideline_pack_json ?? revision.extractedPayload)
}

async function resolveCompiledTemplateForGrantBlueprint(input: {
  blueprint: {
    compiledTemplateJson: unknown
    fundingCallId: string
    sourceTemplateRevisionId: string | null
    sourceGuidelineRevisionId: string | null
  }
}) {
  const storedCompiled = isCompiledGrantTemplate(input.blueprint.compiledTemplateJson)
    ? {
        ...input.blueprint.compiledTemplateJson,
        sections: input.blueprint.compiledTemplateJson.sections.map(normalizeCompiledSection),
      }
    : null

  if (storedCompiled && compiledTemplateHasWorkflowModes(storedCompiled)) {
    return storedCompiled
  }

  try {
    const resolved = await resolveApprovedTemplateForSession({
      fundingCallId: input.blueprint.fundingCallId,
      templateRevisionId: null,
      guidelineRevisionId: input.blueprint.sourceGuidelineRevisionId,
    })
    return resolved.compiledTemplate
  } catch {
    return storedCompiled
      ? {
          ...storedCompiled,
          sections: storedCompiled.sections.map((section) => ({
            ...section,
            workflowMode: normalizeGrantWorkflowMode(section.workflowMode),
          })),
        }
      : null
  }
}

function buildSeededContext(
  section: CompiledGrantTemplateSection,
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
) {
  const completedCaptures = Object.values(payload.stageStates)
    .filter((stage) => stage.enabled)
    .flatMap((stage) =>
      stage.points
        .filter((point) => point.status === 'covered' && point.capture)
        .map((point) => ({
          stageTitle: stage.title,
          pointLabel: point.label,
          keywords: point.capture?.keywords || [],
        }))
    )

  const bulletLines = [
    payload.project.title ? `Project: ${payload.project.title}` : null,
    payload.project.description ? `Project description: ${payload.project.description}` : null,
    payload.fundingCall.title ? `Funding call: ${payload.fundingCall.title}` : null,
    payload.fundingCall.agencyName ? `Agency: ${payload.fundingCall.agencyName}` : null,
    payload.fundingCall.deadline ? `Deadline: ${payload.fundingCall.deadline}` : null,
    payload.fundingCall.funding ? `Funding: ${payload.fundingCall.funding}` : null,
    payload.fundingCall.projectDuration ? `Project duration: ${payload.fundingCall.projectDuration}` : null,
    payload.fundingCall.eligibility ? `Eligibility: ${payload.fundingCall.eligibility}` : null,
    payload.fundingCall.deliverables ? `Deliverables: ${payload.fundingCall.deliverables}` : null,
    payload.fundingCall.focusAreas.length > 0 ? `Focus areas: ${payload.fundingCall.focusAreas.join(', ')}` : null,
    payload.globalKeywords.length > 0 ? `Global keywords: ${payload.globalKeywords.join(', ')}` : null,
    section.mustCover.length > 0 ? `This section must cover: ${section.mustCover.join('; ')}` : null,
    ...completedCaptures.slice(0, 8).map(
      (capture) => `${capture.stageTitle} - ${capture.pointLabel}: ${capture.keywords.join(', ')}`
    ),
  ]

  return bulletLines.filter(Boolean).join('\n')
}

export function buildBlueprintPlanFromCompiledTemplate(
  compiledTemplate: CompiledGrantTemplate,
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
) {
  return [...compiledTemplate.sections]
    .sort((left, right) => left.order - right.order)
    .map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      order: section.order,
      sectionType: section.sectionType,
      workflowMode: normalizeGrantWorkflowMode(section.workflowMode),
      citationMode: normalizeGrantCitationMode(section.citationMode, {
        sectionType: section.sectionType,
        workflowMode: section.workflowMode,
        suggestedCitationCount: section.suggestedCitationCount,
      }),
      required: section.required,
      wordBudget: section.wordBudget ?? null,
      characterLimit: section.characterLimit ?? null,
      purpose: section.purpose,
      reviewerIntent: section.reviewerIntent ?? null,
      dependencies: section.dependencies || [],
      sourceTemplatePointer: section.sourceTemplatePointer ?? null,
      mustCover: section.mustCover || [],
      mustAvoid: section.mustAvoid || [],
      ...(section.mustCoverTyping ? { mustCoverTyping: section.mustCoverTyping } : {}),
      ...(typeof section.suggestedCitationCount === 'number'
        ? { suggestedCitationCount: section.suggestedCitationCount }
        : {}),
      ...(section.thematicBlueprint ? { thematicBlueprint: section.thematicBlueprint } : {}),
      ...(section.grantSemantic ? { grantSemantic: section.grantSemantic } : {}),
      ...(section.prepContextBlock ? { prepContextBlock: section.prepContextBlock } : {}),
      ...(section.grantRuleProfile ? { grantRuleProfile: section.grantRuleProfile } : {}),
      ...(section.grantTemplateGuidance ? { grantTemplateGuidance: section.grantTemplateGuidance } : {}),
      ...(section.grantSectionComplianceContract ? { grantSectionComplianceContract: section.grantSectionComplianceContract } : {}),
      ...(section.grantComplianceReport ? { grantComplianceReport: section.grantComplianceReport } : {}),
      ...(section.reviewerReadinessReport ? { reviewerReadinessReport: section.reviewerReadinessReport } : {}),
      seededContext: buildSeededContext(section, payload),
    })) satisfies GrantBlueprintPlanSection[]
}

function buildGrantBlueprintEnrichmentContext(input: {
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
  projectTitle?: string | null
  projectDescription?: string | null
  fundingCallTitle?: string | null
  agencyName?: string | null
  guidelinePack?: GuidelinePackDocument | null
}): GrantBlueprintEnrichmentContext {
  return {
    projectTitle: input.projectTitle || input.payload.project.title,
    projectDescription: input.projectDescription || input.payload.project.description || null,
    fundingCallTitle: input.fundingCallTitle || input.payload.fundingCall.title || null,
    agencyName: input.agencyName || input.payload.fundingCall.agencyName || null,
    globalKeywords: input.payload.globalKeywords,
    focusAreas: input.payload.fundingCall.focusAreas,
    capturedKeywords: collectGrantCapturedKeywords(input.payload.stageStates),
    prepEvidenceBySection: input.payload.prepEvidenceBySection || {},
    globalCaptureSummary: input.payload.globalCaptureSummary || [],
    stageStates: input.payload.stageStates,
    guidelinePack: input.guidelinePack || null,
  }
}

function buildStructuredScaffold(
  section: GrantBlueprintPlanSection,
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
) {
  if (section.sectionType === 'checklist') {
    return {
      items: (section.mustCover.length > 0 ? section.mustCover : ['Required item']).map((label, index) => ({
        id: `${section.sectionKey}_${index + 1}`,
        label,
        completed: false,
        notes: '',
      })),
    }
  }

  if (section.sectionType === 'table') {
    return {
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'details', label: 'Details' },
      ],
      rows: [],
    }
  }

  return {
    currency: payload.fundingCall.funding.match(/[A-Z]{3}/)?.[0] || null,
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount' },
      { key: 'justification', label: 'Justification' },
    ],
    rows: [],
  }
}

function isDraftableGrantSection(
  input: {
    sectionType: CompiledGrantTemplateSectionType | string
    workflowMode: unknown
  }
): boolean {
  return isGrantSectionAutoDraftable(input)
}

function enrichGrantSectionPlan(
  sectionPlan: GrantBlueprintPlanSection[],
  compiledSections: CompiledGrantTemplateSection[]
) {
  const compiledByKey = new Map(
    compiledSections.map((section) => [
      section.sectionKey,
      {
        workflowMode: normalizeGrantWorkflowMode(section.workflowMode),
        citationMode: normalizeGrantCitationMode(section.citationMode, {
          sectionType: section.sectionType,
          workflowMode: section.workflowMode,
          suggestedCitationCount: section.suggestedCitationCount,
        }),
      },
    ] as const)
  )

  return sectionPlan.map((section) => ({
    ...section,
    workflowMode: compiledByKey.get(section.sectionKey)?.workflowMode
      || normalizeGrantWorkflowMode((section as Partial<GrantBlueprintPlanSection>).workflowMode),
    citationMode: normalizeGrantCitationMode(
      section.citationMode ?? compiledByKey.get(section.sectionKey)?.citationMode,
      {
        sectionType: section.sectionType,
        workflowMode: compiledByKey.get(section.sectionKey)?.workflowMode || section.workflowMode,
        suggestedCitationCount: section.suggestedCitationCount,
      }
    ),
  }))
}

function enrichGrantSectionDrafts<T extends { sectionKey: string }>(
  drafts: T[],
  sectionPlan: GrantBlueprintPlanSection[]
) {
  const sectionMetaByKey = new Map(
    sectionPlan.map((section) => [
      section.sectionKey,
      {
        workflowMode: normalizeGrantWorkflowMode(section.workflowMode),
        citationMode: normalizeGrantCitationMode(section.citationMode, {
          sectionType: section.sectionType,
          workflowMode: section.workflowMode,
          suggestedCitationCount: section.suggestedCitationCount,
        }),
      },
    ] as const)
  )

  return drafts.map((draft) => ({
    ...draft,
    workflowMode: sectionMetaByKey.get(draft.sectionKey)?.workflowMode || 'team_manual',
    citationMode: sectionMetaByKey.get(draft.sectionKey)?.citationMode || 'direct_draft',
  }))
}

function buildGrantPaperTypeCode(templateRevisionId: string | null | undefined) {
  const value = String(templateRevisionId || '').trim()
  return value ? `GRANT_TEMPLATE::${value}` : null
}

function sanitizeFoundation(input?: Partial<GrantProposalFoundation> | null) {
  return {
    thesisStatement: String(input?.thesisStatement || '').trim(),
    centralObjective: String(input?.centralObjective || '').trim(),
    keyContributions: asStringArray(input?.keyContributions || []),
  }
}

function buildShadowResearchTopic(input: {
  projectName: string
  fundingCallTitle: string | null
  sectionPlan: GrantBlueprintPlanSection[]
  globalKeywords: string[]
}) {
  const title = input.projectName.trim() || input.fundingCallTitle?.trim() || 'Grant proposal'
  const firstNarrative = input.sectionPlan.find((section) =>
    isDraftableGrantSection({
      sectionType: section.sectionType,
      workflowMode: section.workflowMode,
    })
  )

  return {
    title,
    topicDescription: input.fundingCallTitle
      ? `Grant proposal aligned to ${input.fundingCallTitle}.`
      : 'Grant proposal workspace.',
    researchQuestion: firstNarrative?.purpose?.trim()
      ? `How should the proposal satisfy ${firstNarrative.label} while addressing the funding call priorities?`
      : `How should this proposal satisfy the funding call requirements?`,
    methodology: 'OTHER' as const,
    contributionType: 'APPLIED' as const,
    keywords: input.globalKeywords,
    subQuestions: [] as string[],
    techniques: [] as string[],
    tools: [] as string[],
  }
}

async function resolveGrantTenantContext(
  tenantId: string,
  userId: string
): Promise<TenantContext | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      tenantPlans: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  })

  if (!tenant || tenant.status !== 'ACTIVE' || !tenant.tenantPlans[0]) {
    return null
  }

  return {
    tenantId: tenant.id,
    planId: tenant.tenantPlans[0].planId,
    tenantStatus: tenant.status,
    userId,
  }
}

export function buildPaperSectionPlanFromGrantSections(
  sectionPlan: GrantBlueprintPlanSection[],
  existingSectionPlan: unknown
) {
  const existingItems = Array.isArray(existingSectionPlan) ? existingSectionPlan : []
  const existingByKey = new Map(
    existingItems
      .map((item) => asObject(item))
      .map((item) => [String(item.sectionKey || '').trim(), item] as const)
      .filter(([sectionKey]) => Boolean(sectionKey))
  )

  return [...sectionPlan]
    .filter((section) =>
      isDraftableGrantSection({
        sectionType: section.sectionType,
        workflowMode: section.workflowMode,
      })
    )
    .sort((left, right) => left.order - right.order)
    .map((section) => {
      const existing = existingByKey.get(section.sectionKey) || {}
      const existingThematic = asObject(existing.thematicBlueprint)
      const mustCoverTyping =
        normalizeGrantMustCoverTyping(section.mustCover, section.mustCoverTyping)
        || normalizeGrantMustCoverTyping(section.mustCover, section.thematicBlueprint?.mustCoverTyping)
        || normalizeGrantMustCoverTyping(section.mustCover, existing.mustCoverTyping)
        || normalizeGrantMustCoverTyping(section.mustCover, existingThematic.mustCoverTyping)
      const suggestedCitationCountRaw =
        section.suggestedCitationCount
        ?? section.thematicBlueprint?.suggestedCitationCount
        ?? existing.suggestedCitationCount
        ?? existingThematic.suggestedCitationCount
      const suggestedCitationCount = normalizeGrantSuggestedCitationCount(suggestedCitationCountRaw)
      const citationMode = normalizeGrantCitationMode(
        section.citationMode ?? existing.citationMode,
        {
          sectionType: section.sectionType,
          workflowMode: section.workflowMode,
          suggestedCitationCount,
        }
      )
      const thematicBlueprint: GrantThematicBlueprint = buildGrantThematicBlueprint({
        mustCover: [...section.mustCover],
        mustAvoid: [...section.mustAvoid],
        mustCoverTyping,
        suggestedCitationCount,
      })

      return {
        sectionKey: section.sectionKey,
        displayLabel: section.label,
        required: section.required,
        purpose: section.purpose,
        mustCover: [...section.mustCover],
        mustAvoid: [...section.mustAvoid],
        sectionType: section.sectionType,
        reviewerIntent: section.reviewerIntent,
        characterLimit: section.characterLimit,
        grantSemantic: section.grantSemantic || null,
        prepContextBlock: section.prepContextBlock || null,
        grantRuleProfile: section.grantRuleProfile || null,
        grantTemplateGuidance: section.grantTemplateGuidance || null,
        grantSectionComplianceContract: section.grantSectionComplianceContract || null,
        grantComplianceReport: section.grantComplianceReport || null,
        reviewerReadinessReport: section.reviewerReadinessReport || null,
        workflowMode: section.workflowMode,
        citationMode,
        ...(typeof section.wordBudget === 'number'
          ? { wordBudget: section.wordBudget }
          : {}),
        dependencies: [...section.dependencies],
        outputsPromised: asStringArray(existing.outputsPromised),
        ...(mustCoverTyping ? { mustCoverTyping } : {}),
        ...(typeof suggestedCitationCount === 'number'
          ? { suggestedCitationCount }
          : {}),
        thematicBlueprint,
        ...(existing.rhetoricalBlueprint ? { rhetoricalBlueprint: existing.rhetoricalBlueprint } : {}),
      }
    })
}

async function ensureGrantShadowWorkspaceTx(
  tx: Prisma.TransactionClient,
  input: {
    grantSessionId: string
    draftingSessionId: string | null
    tenantId: string
    projectId: string
    projectName: string
    fundingCallTitle: string | null
    templateRevisionId: string | null
    userId: string
    sectionPlan: GrantBlueprintPlanSection[]
    globalKeywords: string[]
    blueprintStatus: 'DRAFT' | 'FROZEN'
    foundation?: Partial<GrantProposalFoundation> | null
    resetStatus?: boolean
  }
) {
  let draftingSession = input.draftingSessionId
    ? await tx.draftingSession.findUnique({
        where: { id: input.draftingSessionId },
        include: {
          paperBlueprint: true,
          researchTopic: true,
        },
      })
    : null

  if (!draftingSession) {
    const shadowPatentTitle = `[Grant Shadow ${input.grantSessionId}] ${input.projectName || input.fundingCallTitle || 'Grant proposal'}`
    const existingPatent = await tx.patent.findFirst({
      where: {
        projectId: input.projectId,
        title: shadowPatentTitle,
      },
      select: { id: true },
    })

    const patentId =
      existingPatent?.id ||
      (
        await tx.patent.create({
          data: {
            projectId: input.projectId,
            createdBy: input.userId,
            title: shadowPatentTitle,
          },
          select: { id: true },
        })
      ).id

    draftingSession = await tx.draftingSession.create({
      data: {
        patentId,
        userId: input.userId,
        tenantId: input.tenantId,
        status: 'IDEA_ENTRY',
        literatureReviewStatus: 'NOT_STARTED',
      },
      include: {
        paperBlueprint: true,
        researchTopic: true,
      },
    })

    await tx.grantSession.update({
      where: { id: input.grantSessionId },
      data: {
        draftingSessionId: draftingSession.id,
      },
    })
  }

  if (!draftingSession.researchTopic) {
    await tx.researchTopic.create({
      data: {
        sessionId: draftingSession.id,
        ...buildShadowResearchTopic({
          projectName: input.projectName,
          fundingCallTitle: input.fundingCallTitle,
          sectionPlan: input.sectionPlan,
          globalKeywords: input.globalKeywords,
        }),
      },
    })
  }

  const currentBlueprint = draftingSession.paperBlueprint
  const fallbackFoundation = buildGeneratedGrantProposalFoundation(input.sectionPlan, {
    projectTitle: input.projectName,
    fundingCallTitle: input.fundingCallTitle,
    globalKeywords: input.globalKeywords,
  })
  const currentFoundation = {
    thesisStatement: currentBlueprint?.thesisStatement || '',
    centralObjective: currentBlueprint?.centralObjective || '',
    keyContributions: currentBlueprint?.keyContributions || [],
  }
  const foundationSource = input.foundation
    ? input.foundation
    : shouldBackfillProposalFoundation(currentFoundation)
      ? fallbackFoundation
      : currentFoundation
  const foundation = sanitizeFoundation(foundationSource)
  const paperTypeCode = buildGrantPaperTypeCode(input.templateRevisionId)
  const nextSectionPlan = buildPaperSectionPlanFromGrantSections(
    input.sectionPlan,
    currentBlueprint?.sectionPlan
  )

  if (!currentBlueprint) {
    await tx.paperBlueprint.create({
      data: {
        sessionId: draftingSession.id,
        thesisStatement: foundation.thesisStatement,
        centralObjective: foundation.centralObjective,
        keyContributions: foundation.keyContributions,
        sectionPlan: asJson(nextSectionPlan),
        paperTypeCode,
        methodologyType: 'OTHER',
        status: input.blueprintStatus === 'FROZEN' ? 'FROZEN' : 'DRAFT',
        frozenAt: input.blueprintStatus === 'FROZEN' ? new Date() : null,
      },
    })

    return {
      draftingSessionId: draftingSession.id,
    }
  }

  const nextStatus = input.resetStatus
    ? 'DRAFT'
    : currentBlueprint.status
  const nextFrozenAt = input.resetStatus
    ? null
    : currentBlueprint.status === 'FROZEN'
      ? currentBlueprint.frozenAt || new Date()
      : null

  const paperBlueprintUpdate = {
    thesisStatement: foundation.thesisStatement,
    centralObjective: foundation.centralObjective,
    keyContributions: foundation.keyContributions,
    sectionPlan: nextSectionPlan,
    paperTypeCode,
    methodologyType: 'OTHER',
    status: nextStatus,
    frozenAt: nextFrozenAt,
  }

  const currentSnapshot = {
    thesisStatement: currentBlueprint.thesisStatement,
    centralObjective: currentBlueprint.centralObjective,
    keyContributions: currentBlueprint.keyContributions,
    sectionPlan: currentBlueprint.sectionPlan,
    paperTypeCode: currentBlueprint.paperTypeCode,
    methodologyType: currentBlueprint.methodologyType,
    status: currentBlueprint.status,
    frozenAt: currentBlueprint.frozenAt ? currentBlueprint.frozenAt.toISOString() : null,
  }

  const nextSnapshot = {
    ...paperBlueprintUpdate,
    frozenAt: paperBlueprintUpdate.frozenAt
      ? paperBlueprintUpdate.frozenAt.toISOString()
      : null,
  }

  if (JSON.stringify(currentSnapshot) !== JSON.stringify(nextSnapshot)) {
    await tx.paperBlueprint.update({
      where: { sessionId: draftingSession.id },
      data: {
        thesisStatement: foundation.thesisStatement,
        centralObjective: foundation.centralObjective,
        keyContributions: foundation.keyContributions,
        sectionPlan: asJson(nextSectionPlan),
        paperTypeCode,
        methodologyType: 'OTHER',
        status: nextStatus,
        frozenAt: nextFrozenAt,
        version: { increment: 1 },
      },
    })
  }

  return {
    draftingSessionId: draftingSession.id,
  }
}

async function ensureGrantShadowWorkspace(input: {
  grantSessionId: string
  tenantId: string
  userId?: string
}) {
  const grantSession = await prisma.grantSession.findFirst({
    where: {
      id: input.grantSessionId,
      tenantId: input.tenantId,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      fundingCall: {
        select: {
          scheme_title: true,
        },
      },
      blueprint: true,
    },
  })

  if (!grantSession?.blueprint) {
    return null
  }
  const blueprint = grantSession.blueprint

  const rawSectionPlan = Array.isArray(blueprint.sectionPlanJson)
    ? (blueprint.sectionPlanJson as unknown as GrantBlueprintPlanSection[])
    : []
  const compiledTemplate = await resolveCompiledTemplateForGrantBlueprint({ blueprint })
  const baseSectionPlan = compiledTemplate
    ? enrichGrantSectionPlan(rawSectionPlan, compiledTemplate.sections)
    : rawSectionPlan.map((section) => ({
        ...section,
        workflowMode: normalizeGrantWorkflowMode((section as Partial<GrantBlueprintPlanSection>).workflowMode),
        citationMode: normalizeGrantCitationMode((section as Partial<GrantBlueprintPlanSection>).citationMode, {
          sectionType: (section as Partial<GrantBlueprintPlanSection>).sectionType,
          workflowMode: (section as Partial<GrantBlueprintPlanSection>).workflowMode,
          suggestedCitationCount: (section as Partial<GrantBlueprintPlanSection>).suggestedCitationCount,
        }),
      }))
  const sectionPlan = enrichGrantBlueprintSections(
    baseSectionPlan,
    {
      projectTitle: grantSession.project.name,
      fundingCallTitle: grantSession.fundingCall?.scheme_title || null,
      globalKeywords: asStringArray(blueprint.globalKeywordsJson),
      stageStates: asObject(blueprint.freezePayloadJson).stageStates as never,
      guidelinePack: await resolveGuidelinePackForRevision(blueprint.sourceGuidelineRevisionId || null),
    },
    'hydrate'
  )

  return prisma.$transaction((tx) =>
    ensureGrantShadowWorkspaceTx(tx, {
      grantSessionId: grantSession.id,
      draftingSessionId: grantSession.draftingSessionId,
      tenantId: grantSession.tenantId,
      projectId: grantSession.projectId,
      projectName: grantSession.project.name || '',
      fundingCallTitle: grantSession.fundingCall?.scheme_title || null,
      templateRevisionId: blueprint.sourceTemplateRevisionId || null,
      userId: input.userId || grantSession.updatedByUserId,
      sectionPlan,
      globalKeywords: asStringArray(blueprint.globalKeywordsJson),
      blueprintStatus: blueprint.status,
    })
  )
}

async function loadGrantWorkspaceRecord(input: {
  grantSessionId: string
  tenantId: string
}) {
  return prisma.grantSession.findFirst({
    where: {
      id: input.grantSessionId,
      tenantId: input.tenantId,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          tenantId: true,
        },
      },
      fundingCall: {
        select: {
          id: true,
          scheme_title: true,
          agency_name: true,
          close_date: true,
          amount_min: true,
          amount_max: true,
          currency: true,
        },
      },
      prepSession: {
        include: {
          project: {
            select: {
              id: true,
              name: true,
              tenantId: true,
            },
          },
        },
      },
      draftingSession: {
        include: {
          paperBlueprint: true,
          paperSections: {
            orderBy: {
              updatedAt: 'desc',
            },
          },
          annexureDrafts: {
            where: {
              jurisdiction: 'PAPER',
            },
            orderBy: {
              version: 'desc',
            },
          },
        },
      },
      blueprint: {
        include: {
          sectionDrafts: {
            include: {
              structuredResponses: true,
            },
            orderBy: {
              sectionOrder: 'asc',
            },
          },
        },
      },
    },
  })
}

async function ensureGrantSessionAnchor(tx: Prisma.TransactionClient, input: {
  prepSession: NonNullable<Awaited<ReturnType<typeof loadGrantPrepSession>>>
  fundingCallId: string
  tenantId: string
  userId: string
}) {
  if (input.prepSession.grant_session_id) {
    const existing = await tx.grantSession.findUnique({
      where: { id: input.prepSession.grant_session_id },
    })
    if (existing) {
      return tx.grantSession.update({
        where: { id: existing.id },
        data: {
          fundingCallId: input.fundingCallId,
          status: 'BLUEPRINT',
          updatedByUserId: input.userId,
        },
      })
    }
  }

  const existing = await tx.grantSession.findFirst({
    where: {
      projectId: input.prepSession.project_id,
      tenantId: input.tenantId,
      fundingCallId: input.fundingCallId,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  })

  if (existing) {
    return tx.grantSession.update({
      where: { id: existing.id },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.userId,
      },
    })
  }

  return tx.grantSession.create({
    data: {
      projectId: input.prepSession.project_id,
      tenantId: input.tenantId,
      fundingCallId: input.fundingCallId,
      status: 'BLUEPRINT',
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    },
  })
}

async function buildLaunchState(sessionId: string, actor: GrantPrepActor) {
  const prepSession = await loadGrantPrepSession({
    sessionId,
    tenantId: actor.tenantId,
  })

  if (!prepSession) {
    throw new Error('Grant Prep session not found')
  }

  const serverContext = await resolveGrantPrepContext(prepSession.project_id, actor)
  if (!serverContext.fundingCallId) {
    throw new Error('A linked funding call is required before launching the local grant workspace.')
  }

  const prepContext = inflateGrantPrepSessionContext(prepSession, {
    warning: buildGrantPrepModeWarning(serverContext.mode, serverContext.fundingContext.warning),
  })

  const templateState = await resolveApprovedTemplateForSession({
    fundingCallId: serverContext.fundingCallId,
    templateRevisionId: prepSession.template_revision_id || serverContext.templateRevisionId,
    guidelineRevisionId: prepSession.guideline_revision_id || serverContext.guidelineRevisionId,
  })
  const freeze = buildGrantPrepFreezePayload({
    project: {
      id: prepSession.project.id,
      title: prepSession.project.name || '',
      description: null,
    },
    fundingContext: serverContext.fundingContext,
    session: prepContext,
    guidelineRevisionId: prepSession.guideline_revision_id,
    templateRevisionId: prepSession.template_revision_id,
    compiledSections: templateState.compiledTemplate.sections.map((section) => ({
      sectionKey: section.sectionKey,
      sourceTemplatePointer: section.sourceTemplatePointer,
    })),
  })
  const guidelinePack = normalizeGuidelinePack(
    serverContext.draftingContext?.approvedGuidelineRevision?.guideline_pack_json || null
  )

  const baseSectionPlan = buildBlueprintPlanFromCompiledTemplate(templateState.compiledTemplate, freeze.payload)
  const enrichmentContext = buildGrantBlueprintEnrichmentContext({
    payload: freeze.payload,
    projectTitle: prepSession.project.name,
    fundingCallTitle: serverContext.fundingContext.title || null,
    agencyName: serverContext.fundingContext.agencyName || null,
    guidelinePack,
  })
  const sectionPlan = enrichGrantBlueprintSections(baseSectionPlan, enrichmentContext, 'generate')
  const proposalFoundation = buildGeneratedGrantProposalFoundation(sectionPlan, enrichmentContext)
  const grantSessionId = prepSession.grant_session_id || null

  return {
    prepSession,
    serverContext,
    prepContext,
    freeze,
    templateState,
    baseSectionPlan,
    enrichmentContext,
    sectionPlan,
    proposalFoundation,
    grantSessionId,
  }
}

export async function buildGrantPrepLocalLaunchPreview(sessionId: string, actor: GrantPrepActor): Promise<LocalGrantLaunchPreview> {
  const state = await buildLaunchState(sessionId, actor)
  const launchUrl = state.grantSessionId
    ? `/projects/${state.prepSession.project_id}/grants/${state.grantSessionId}/workspace`
    : null

  return {
    blockers: state.freeze.blockers,
    payload: state.freeze.payload,
    payloadHash: state.freeze.payloadHash,
    sectionPreview: state.sectionPlan.map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      sectionType: section.sectionType,
      workflowMode: section.workflowMode,
      required: section.required,
    })),
    canLaunch: state.freeze.blockers.length === 0,
    grantSessionId: state.grantSessionId,
    launchUrl,
  }
}

export async function launchGrantPrepToLocalWorkspace(input: {
  sessionId: string
  actor: GrantPrepActor
  overrideReason?: string | null
}) {
  const state = await buildLaunchState(input.sessionId, input.actor)
  if (state.freeze.blockers.length > 0 && !input.overrideReason?.trim()) {
    throw new Error('Grant Prep still has blockers. Provide an override reason to continue.')
  }

  const frozenPayload = {
    ...state.freeze.payload,
    overrideReason: input.overrideReason?.trim() || null,
  }
  const tenantContext = await resolveGrantTenantContext(input.actor.tenantId, input.actor.id)
  const generatedBlueprint = await generateGrantBlueprintWithLlm({
    baseSectionPlan: state.baseSectionPlan,
    context: state.enrichmentContext,
    proposalFoundationHint: state.proposalFoundation,
    tenantContext,
    sessionId: input.sessionId,
    overrideReason: input.overrideReason?.trim() || undefined,
  })

  return prisma.$transaction(async (tx) => {
    const grantSession = await ensureGrantSessionAnchor(tx, {
      prepSession: state.prepSession,
      fundingCallId: state.serverContext.fundingCallId!,
      tenantId: input.actor.tenantId,
      userId: input.actor.id,
    })

    const existingBlueprint = await tx.grantBlueprint.findUnique({
      where: { grantSessionId: grantSession.id },
    })

    const blueprint = existingBlueprint
      ? await tx.grantBlueprint.update({
          where: { id: existingBlueprint.id },
          data: {
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            fundingCallId: state.serverContext.fundingCallId!,
            sourcePrepSessionId: state.prepSession.id,
            sourceTemplateRevisionId: state.templateState.templateRevisionId,
            sourceGuidelineRevisionId: state.prepSession.guideline_revision_id,
            status: 'DRAFT',
            version: { increment: 1 },
            compiledTemplateJson: asJson(state.templateState.compiledTemplate),
            sectionPlanJson: asJson(generatedBlueprint.sectionPlan),
            freezePayloadJson: asJson(frozenPayload),
            globalKeywordsJson: asJson(state.freeze.payload.globalKeywords),
            updatedByUserId: input.actor.id,
            frozenAt: null,
          },
        })
      : await tx.grantBlueprint.create({
          data: {
            grantSessionId: grantSession.id,
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            fundingCallId: state.serverContext.fundingCallId!,
            sourcePrepSessionId: state.prepSession.id,
            sourceTemplateRevisionId: state.templateState.templateRevisionId,
            sourceGuidelineRevisionId: state.prepSession.guideline_revision_id,
            status: 'DRAFT',
            compiledTemplateJson: asJson(state.templateState.compiledTemplate),
            sectionPlanJson: asJson(generatedBlueprint.sectionPlan),
            freezePayloadJson: asJson(frozenPayload),
            globalKeywordsJson: asJson(state.freeze.payload.globalKeywords),
            createdByUserId: input.actor.id,
            updatedByUserId: input.actor.id,
          },
        })

    const existingDrafts = await tx.grantSectionDraft.findMany({
      where: { grantSessionId: grantSession.id },
    })
    const draftByKey = new Map(existingDrafts.map((draft) => [draft.sectionKey, draft]))

    for (const section of generatedBlueprint.sectionPlan) {
      const existingDraft = draftByKey.get(section.sectionKey)
      if (existingDraft) {
        await tx.grantSectionDraft.update({
          where: { id: existingDraft.id },
          data: {
            blueprintId: blueprint.id,
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            label: section.label,
            sectionType: section.sectionType,
            sectionOrder: section.order,
            required: section.required,
            wordBudget: section.wordBudget,
            characterLimit: section.characterLimit,
            purpose: section.purpose,
            reviewerIntent: section.reviewerIntent,
            dependenciesJson: asJson(section.dependencies),
            mustCoverJson: asJson(section.mustCover),
            mustAvoidJson: asJson(section.mustAvoid),
            sourceTemplatePointer: section.sourceTemplatePointer,
            updatedByUserId: input.actor.id,
          },
        })
      } else {
        const createdDraft = await tx.grantSectionDraft.create({
          data: {
            grantSessionId: grantSession.id,
            blueprintId: blueprint.id,
            tenantId: input.actor.tenantId,
            projectId: state.prepSession.project_id,
            sectionKey: section.sectionKey,
            label: section.label,
            sectionType: section.sectionType,
            sectionOrder: section.order,
            required: section.required,
            wordBudget: section.wordBudget,
            characterLimit: section.characterLimit,
            purpose: section.purpose,
            reviewerIntent: section.reviewerIntent,
            dependenciesJson: asJson(section.dependencies),
            mustCoverJson: asJson(section.mustCover),
            mustAvoidJson: asJson(section.mustAvoid),
            sourceTemplatePointer: section.sourceTemplatePointer,
            createdByUserId: input.actor.id,
            updatedByUserId: input.actor.id,
          },
        })

        if (section.sectionType === 'checklist' || section.sectionType === 'table' || section.sectionType === 'budget_rows') {
          await tx.grantStructuredFieldResponse.create({
            data: {
              grantSessionId: grantSession.id,
              sectionDraftId: createdDraft.id,
              tenantId: input.actor.tenantId,
              projectId: state.prepSession.project_id,
              sectionKey: section.sectionKey,
              fieldKey: 'structuredData',
              responseJson: asJson(buildStructuredScaffold(section, state.freeze.payload)),
              updatedByUserId: input.actor.id,
            },
          })
        }
      }
    }

    await ensureGrantShadowWorkspaceTx(tx, {
      grantSessionId: grantSession.id,
      draftingSessionId: grantSession.draftingSessionId,
      tenantId: input.actor.tenantId,
      projectId: state.prepSession.project_id,
      projectName: state.prepSession.project.name || '',
      fundingCallTitle: state.serverContext.fundingContext.title || null,
      templateRevisionId: state.templateState.templateRevisionId,
      userId: input.actor.id,
      sectionPlan: generatedBlueprint.sectionPlan,
      globalKeywords: state.freeze.payload.globalKeywords,
      blueprintStatus: 'DRAFT',
      foundation: generatedBlueprint.proposalFoundation,
    })

    const launchUrl = `/projects/${state.prepSession.project_id}/grants/${grantSession.id}/workspace`
    await tx.grantPrepSession.update({
      where: { id: state.prepSession.id },
      data: {
        grant_session_id: grantSession.id,
        frozen_payload_json: asJson(frozenPayload),
        frozen_payload_version: state.freeze.payload.version,
        frozen_payload_hash: state.freeze.payloadHash,
        frozen_at: new Date(state.freeze.payload.frozenAt),
        papsi_session_id: null,
        papsi_launch_url: launchUrl,
        status: 'launched',
        last_handoff_error: null,
      },
    })

    await tx.grantSession.update({
      where: { id: grantSession.id },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.actor.id,
      },
    })

    return {
      grantSessionId: grantSession.id,
      blueprintId: blueprint.id,
      launchUrl,
    }
  })
}

export async function getGrantWorkspace(input: {
  grantSessionId: string
  tenantId: string
}) {
  let grantSession = await loadGrantWorkspaceRecord(input)

  if (!grantSession) {
    return null
  }

  if (grantSession.blueprint) {
    await ensureGrantShadowWorkspace({
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      userId: grantSession.updatedByUserId,
    })
    grantSession = await loadGrantWorkspaceRecord(input)
    if (!grantSession) {
      return null
    }
  }

  const rawSectionPlan = Array.isArray(grantSession.blueprint?.sectionPlanJson)
    ? (grantSession.blueprint?.sectionPlanJson as unknown as GrantBlueprintPlanSection[])
    : []
  const compiledTemplate = grantSession.blueprint
    ? await resolveCompiledTemplateForGrantBlueprint({ blueprint: grantSession.blueprint })
    : null
  const baseSectionPlan = compiledTemplate
    ? enrichGrantSectionPlan(rawSectionPlan, compiledTemplate.sections)
    : rawSectionPlan.map((section) => ({
        ...section,
        workflowMode: normalizeGrantWorkflowMode((section as Partial<GrantBlueprintPlanSection>).workflowMode),
        citationMode: normalizeGrantCitationMode((section as Partial<GrantBlueprintPlanSection>).citationMode, {
          sectionType: (section as Partial<GrantBlueprintPlanSection>).sectionType,
          workflowMode: (section as Partial<GrantBlueprintPlanSection>).workflowMode,
          suggestedCitationCount: (section as Partial<GrantBlueprintPlanSection>).suggestedCitationCount,
        }),
      }))
  const sectionPlan = grantSession.blueprint
    ? enrichGrantBlueprintSections(
        baseSectionPlan,
        {
          projectTitle: grantSession.project.name,
          fundingCallTitle: grantSession.fundingCall?.scheme_title || null,
          globalKeywords: asStringArray(grantSession.blueprint.globalKeywordsJson),
          stageStates: asObject(grantSession.blueprint.freezePayloadJson).stageStates as never,
          guidelinePack: await resolveGuidelinePackForRevision(grantSession.blueprint.sourceGuidelineRevisionId || null),
        },
        'hydrate'
      )
    : baseSectionPlan
  const activeSectionKeys = new Set(sectionPlan.map((section) => section.sectionKey))
  const baseSectionDrafts = enrichGrantSectionDrafts(
    (grantSession.blueprint?.sectionDrafts || []).filter((draft) =>
      activeSectionKeys.size === 0 ? true : activeSectionKeys.has(draft.sectionKey)
    ),
    sectionPlan
  )
  const latestPaperDraft = grantSession.draftingSession?.annexureDrafts?.[0] || null
  const paperDraftSections = normalizeDraftTextMap(latestPaperDraft?.extraSections)
  const paperSectionsByKey = new Map<string, any>()
  for (const section of grantSession.draftingSession?.paperSections || []) {
    const key = String(section.sectionKey || '').trim()
    if (key && !paperSectionsByKey.has(key)) {
      paperSectionsByKey.set(key, section)
    }
  }
  const sectionDrafts = baseSectionDrafts.map((draft) => {
    if (draft.workflowMode !== 'app_draft') {
      return draft
    }

    const paperSection = paperSectionsByKey.get(draft.sectionKey)
    const paperValidationReport = asObject(paperSection?.validationReport)
    const draftRecord = asObject(draft)
    const shadowContent = typeof paperSection?.content === 'string' && paperSection.content.trim().length > 0
      ? paperSection.content
      : paperDraftSections[draft.sectionKey] || ''

    return {
      ...draft,
      content: shadowContent || null,
      status: String(paperSection?.status || draft.status || 'NOT_STARTED'),
      grantComplianceReport:
        asGrantComplianceReport(paperValidationReport.grantComplianceReport)
        || asGrantComplianceReport(draftRecord.grantComplianceReport)
        || null,
      reviewerReadinessReport:
        asReviewerReadinessReport(paperValidationReport.reviewerReadinessReport)
        || asReviewerReadinessReport(draftRecord.reviewerReadinessReport)
        || null,
    }
  })
  const proposalFoundation = grantSession.draftingSession?.paperBlueprint
    ? {
        thesisStatement: grantSession.draftingSession.paperBlueprint.thesisStatement,
        centralObjective: grantSession.draftingSession.paperBlueprint.centralObjective,
        keyContributions: grantSession.draftingSession.paperBlueprint.keyContributions,
        status: grantSession.draftingSession.paperBlueprint.status,
        version: grantSession.draftingSession.paperBlueprint.version,
      }
    : {
        thesisStatement: '',
        centralObjective: '',
        keyContributions: [],
        status: null,
        version: null,
      }
  const freezeReadiness: BlueprintFreezeReadiness = grantSession.draftingSession?.id
    ? await blueprintService.getFreezeReadiness(grantSession.draftingSession.id)
    : {
        ok: false,
        issues: ['Proposal foundation is not ready yet'],
      }
  const proposalComplianceReport = buildProposalGrantComplianceReport({
    sections: sectionPlan.map((section) => {
      const draft = sectionDrafts.find((entry) => entry.sectionKey === section.sectionKey)
      return {
        sectionKey: section.sectionKey,
        label: section.label,
        required: section.required,
        workflowMode: section.workflowMode,
        grantSemantic: section.grantSemantic,
        grantComplianceReport: asGrantComplianceReport((draft as JsonObject)?.grantComplianceReport) || section.grantComplianceReport || null,
        reviewerReadinessReport: asReviewerReadinessReport((draft as JsonObject)?.reviewerReadinessReport) || section.reviewerReadinessReport || null,
        content: typeof (draft as JsonObject)?.content === 'string' ? String((draft as JsonObject).content) : null,
        status: typeof (draft as JsonObject)?.status === 'string' ? String((draft as JsonObject).status) : null,
      }
    }),
    foundation: proposalFoundation,
  })
  const proposalReviewerReadinessReport = buildProposalReviewerReadinessReport({
    report: proposalComplianceReport,
    sections: sectionPlan.map((section) => {
      const draft = sectionDrafts.find((entry) => entry.sectionKey === section.sectionKey)
      return {
        sectionKey: section.sectionKey,
        label: section.label,
        required: section.required,
        workflowMode: section.workflowMode,
        grantSemantic: section.grantSemantic,
        grantComplianceReport: asGrantComplianceReport((draft as JsonObject)?.grantComplianceReport) || section.grantComplianceReport || null,
        reviewerReadinessReport: asReviewerReadinessReport((draft as JsonObject)?.reviewerReadinessReport) || section.reviewerReadinessReport || null,
        content: typeof (draft as JsonObject)?.content === 'string' ? String((draft as JsonObject).content) : null,
        status: typeof (draft as JsonObject)?.status === 'string' ? String((draft as JsonObject).status) : null,
      }
    }),
  })

  return {
    grantSession,
    blueprint: grantSession.blueprint
      ? {
          ...grantSession.blueprint,
          sectionPlan,
          sectionDrafts,
        }
      : null,
    proposalFoundation,
    proposalComplianceReport,
    proposalReviewerReadinessReport,
    freezeReadiness,
  }
}

export async function updateBlueprintPlan(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  sections?: GrantBlueprintPlanSection[]
  foundation?: Partial<GrantProposalFoundation> | null
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })
  if (!workspace?.blueprint) {
    throw new Error('Grant blueprint not found')
  }
  const blueprint = workspace.blueprint
  if (blueprint.status === 'FROZEN') {
    throw new Error('Cannot update a frozen grant blueprint. Unfreeze it first.')
  }

  const nextSections = input.sections || workspace.blueprint.sectionPlan
  if (!input.sections && !input.foundation) {
    throw new Error('No blueprint changes were provided')
  }

  const existingPlan = workspace.blueprint.sectionPlan
  const existingPlanByKey = new Map(existingPlan.map((section) => [section.sectionKey, section]))
  const lockedSectionMeta = new Map(
    existingPlan.map((section) => [
      section.sectionKey,
      {
        sectionType: section.sectionType,
        workflowMode: section.workflowMode,
        required: section.required,
        dependencies: [...section.dependencies].sort().join('|'),
      },
    ])
  )

  for (const section of nextSections) {
    const locked = lockedSectionMeta.get(section.sectionKey)
    if (!locked) {
      throw new Error(`Unknown blueprint section: ${section.sectionKey}`)
    }
    if (
      locked.sectionType !== section.sectionType ||
      locked.workflowMode !== section.workflowMode ||
      locked.required !== section.required ||
      locked.dependencies !== [...section.dependencies].sort().join('|')
    ) {
      throw new Error(`Section ${section.sectionKey} changed outside template-safe constraints`)
    }
  }

  const normalizedSections = nextSections.map((section) => {
    const existing = existingPlanByKey.get(section.sectionKey)
    const mustCoverTyping = normalizeGrantMustCoverTyping(
      section.mustCover,
      section.mustCoverTyping
        || section.thematicBlueprint?.mustCoverTyping
        || existing?.mustCoverTyping
        || existing?.thematicBlueprint?.mustCoverTyping
    )
    const suggestedCitationCount = normalizeGrantSuggestedCitationCount(
      section.suggestedCitationCount
        ?? section.thematicBlueprint?.suggestedCitationCount
        ?? existing?.suggestedCitationCount
        ?? existing?.thematicBlueprint?.suggestedCitationCount
    )
    const thematicBlueprint = buildGrantThematicBlueprint({
      mustCover: section.mustCover,
      mustAvoid: section.mustAvoid,
      mustCoverTyping,
      suggestedCitationCount,
    })
    const citationMode = normalizeGrantCitationMode(
      section.citationMode ?? existing?.citationMode,
      {
        sectionType: section.sectionType,
        workflowMode: section.workflowMode,
        suggestedCitationCount,
      }
    )

    return {
      ...section,
      citationMode,
      ...(mustCoverTyping ? { mustCoverTyping } : { mustCoverTyping: undefined }),
      suggestedCitationCount: suggestedCitationCount ?? null,
      thematicBlueprint,
    }
  })

  const orderedSections = [...normalizedSections]
    .sort((left, right) => left.order - right.order)
    .map((section, index) => ({ ...section, order: index + 1 }))

  await prisma.$transaction(async (tx) => {
    await ensureGrantShadowWorkspaceTx(tx, {
      grantSessionId: input.grantSessionId,
      draftingSessionId: workspace.grantSession.draftingSessionId,
      tenantId: input.tenantId,
      projectId: workspace.grantSession.projectId,
      projectName: workspace.grantSession.project.name || '',
      fundingCallTitle: workspace.grantSession.fundingCall?.scheme_title || null,
      templateRevisionId: blueprint.sourceTemplateRevisionId || null,
      userId: input.userId,
      sectionPlan: orderedSections,
      globalKeywords: asStringArray(blueprint.globalKeywordsJson),
      blueprintStatus: 'DRAFT',
      foundation: input.foundation,
      resetStatus: true,
    })

    await tx.grantBlueprint.update({
      where: { id: blueprint.id },
      data: {
        sectionPlanJson: asJson(orderedSections),
        status: 'DRAFT',
        version: { increment: 1 },
        updatedByUserId: input.userId,
        frozenAt: null,
      },
    })

    await tx.grantSession.update({
      where: { id: input.grantSessionId },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.userId,
      },
    })

    if (input.sections) {
      for (const section of orderedSections) {
        await tx.grantSectionDraft.updateMany({
          where: {
            grantSessionId: input.grantSessionId,
            sectionKey: section.sectionKey,
          },
          data: {
            label: section.label,
            sectionOrder: section.order,
            wordBudget: section.wordBudget,
            characterLimit: section.characterLimit,
            purpose: section.purpose,
            reviewerIntent: section.reviewerIntent,
            mustCoverJson: asJson(section.mustCover),
            mustAvoidJson: asJson(section.mustAvoid),
            updatedByUserId: input.userId,
          },
        })
      }
    }
  })
}

export async function setGrantBlueprintStatus(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  status: 'DRAFT' | 'FROZEN'
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })
  if (!workspace?.blueprint) {
    throw new Error('Grant blueprint not found')
  }
  const blueprint = workspace.blueprint

  if (input.status === 'FROZEN') {
    const shadowWorkspace = await ensureGrantShadowWorkspace({
      grantSessionId: input.grantSessionId,
      tenantId: input.tenantId,
      userId: input.userId,
    })

    if (!shadowWorkspace?.draftingSessionId) {
      throw new Error('Proposal foundation workspace could not be initialized')
    }

    const readiness = await blueprintService.getFreezeReadiness(shadowWorkspace.draftingSessionId)
    if (!readiness.ok) {
      throw new Error(readiness.issues.join('\n'))
    }

    await prisma.$transaction(async (tx) => {
      await tx.paperBlueprint.update({
        where: { sessionId: shadowWorkspace.draftingSessionId },
        data: {
          status: 'FROZEN',
          frozenAt: new Date(),
        },
      })

      await tx.grantBlueprint.update({
        where: { id: blueprint.id },
        data: {
          status: 'FROZEN',
          frozenAt: new Date(),
          updatedByUserId: input.userId,
        },
      })

      await tx.grantSession.update({
        where: { id: input.grantSessionId },
        data: {
          status: 'DRAFTING',
          updatedByUserId: input.userId,
        },
      })
    })

    return
  }

  await prisma.$transaction(async (tx) => {
    if (workspace.grantSession.draftingSessionId) {
      await tx.paperSection.updateMany({
        where: { sessionId: workspace.grantSession.draftingSessionId },
        data: { isStale: true },
      })

      await tx.paperBlueprint.updateMany({
        where: { sessionId: workspace.grantSession.draftingSessionId },
        data: {
          status: 'REVISION_PENDING',
          frozenAt: null,
          version: { increment: 1 },
        },
      })
    }

    await tx.grantBlueprint.update({
      where: { id: blueprint.id },
      data: {
        status: 'DRAFT',
        frozenAt: null,
        updatedByUserId: input.userId,
      },
    })

    await tx.grantSession.update({
      where: { id: input.grantSessionId },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.userId,
      },
    })
  })
}
