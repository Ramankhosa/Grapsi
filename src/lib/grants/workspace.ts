import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { resolveGrantWorkflowTenantContext } from '@/lib/grantWorkflowTenantContext'
import { buildGrantPrepFreezePayload } from '@/lib/grantPrep/handoff/handoffBuilder'
import type { GrantPrepActor } from '@/lib/grantPrep/access'
import type { GrantPrepIdeaAnchorV1 } from '@/lib/grantPrep/types'
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
  normalizeGrantDimensionTyping,
  normalizeGrantMustCoverTyping,
  normalizeGrantSuggestedCitationCount,
} from '@/lib/grants/blueprintMetadata'
import { resolveGrantTemplateSectionType } from '@/lib/grants/templateSectionType'
import {
  GRANT_BIBLIOGRAPHY_SECTION_KEY,
  isGrantBibliographySection,
  isGrantSectionAutoDraftable,
  normalizeGrantSectionWorkflowMode,
  normalizeGrantWorkflowMode,
} from '@/lib/grants/workflowMode'
import { buildGrantWorkspaceUrl } from '@/lib/grants/workspaceNavigation'
import { sanitizeGrantRuleText, splitGrantRuleTextIntoPoints } from '@/lib/grants/ruleText'
import {
  normalizeGrantTemplateIntent,
  normalizeGrantTemplateIntentConfidence,
  normalizeGrantTemplateIntentList,
  shouldTrustTemplateIntent,
  templateIntentToGrantSemantic,
} from '@/lib/grants/templateIntent'
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
import { computeOverallReadiness } from '@/lib/grantPrep/sessionState'
import type { GuidelinePackDocument } from '@/lib/fundingGuidelines/types'
import { normalizeGuidelinePack } from '@/lib/fundingGuidelines/utils'
import type { GrantTemplateDocument, FundingTemplateItem } from '@/lib/fundingTemplates/types'
import { normalizeGrantTemplate } from '@/lib/fundingTemplates/utils'
import {
  buildBudgetStructuredScaffold,
  buildBudgetTemplateFromFundingBudget,
} from '@/lib/grants/budgetTemplate'
import type { TenantContext } from '@/lib/metering'
import { blueprintService, type BlueprintFreezeReadiness } from '@/lib/services/blueprint-service'
import type {
  CompiledGrantTemplate,
  CompiledGrantTemplateSection,
  CompiledGrantTemplateSectionType,
  GrantBlueprintPlanSection,
  GrantBlueprintDimensionType,
  GrantCitationMode,
  GrantComplianceReport,
  GrantThematicBlueprint,
  GrantWorkflowMode,
  ReviewerReadinessReport,
} from '@/types/grant'

type JsonObject = Record<string, unknown>

function buildGrantIdeaIntentLock(anchor?: GrantPrepIdeaAnchorV1 | null, anchorHash?: string | null) {
  if (!anchor || !anchorHash) return null
  return {
    source: 'grant_idea_anchor',
    version: anchor.version,
    ideaAnchorHash: anchorHash,
    researchQuestions: anchor.unresolvedQuestions,
    thesisStatement: anchor.oneSentenceSummary,
    contributions: [...anchor.distinguishingFeatures, ...anchor.funderFit].slice(0, 7),
    scopeBoundaries: anchor.scopeBoundaries,
    allowedClaims: anchor.nonNegotiables,
    forbiddenClaims: anchor.scopeBoundaries.map((item) => `Do not expand beyond: ${item}`),
    paperType: 'grant proposal',
    keywords: anchor.keywords,
    coreApproach: anchor.coreApproach,
    targetBeneficiariesOrSetting: anchor.targetBeneficiariesOrSetting,
  }
}

export interface LocalGrantLaunchPreview {
  blockers: Array<{ stageKey: string; pointKey: string; message: string }>
  payload: ReturnType<typeof buildGrantPrepFreezePayload>['payload']
  payloadHash: string
  overallReadiness: number
  generationReady: boolean
  generationReadinessThreshold: number
  generationBlockedMessage: string | null
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

export const GRANT_PREP_GENERATION_READY_THRESHOLD = 0.5

export interface GrantBlueprintSectionOverridePatch {
  sectionKey: string
  citationMode?: GrantCitationMode | null
  dimensions?: string[]
  dimensionTyping?: Record<string, GrantBlueprintDimensionType>
  suggestedCitationCount?: number | null
}

const GRANT_BIBLIOGRAPHY_SECTION_LABEL = 'Bibliography'

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

function normalizeCompiledSection(
  section: Partial<CompiledGrantTemplateSection>,
  index: number
): CompiledGrantTemplateSection {
  const mustCover = Array.isArray(section.mustCover) ? section.mustCover : []
  const mustAvoid = Array.isArray(section.mustAvoid) ? section.mustAvoid : []
  const dimensions = Array.isArray(section.dimensions) ? section.dimensions : []
  const dimensionTyping = normalizeGrantDimensionTyping(dimensions, section.dimensionTyping)
  const mustCoverTyping = normalizeGrantMustCoverTyping(mustCover, section.mustCoverTyping)
  const suggestedCitationCount = normalizeGrantSuggestedCitationCount(section.suggestedCitationCount)
  const thematicBlueprint = section.thematicBlueprint
    ? buildGrantThematicBlueprint({
        mustCover,
        mustAvoid,
        dimensions,
        dimensionTyping,
        mustCoverTyping,
        suggestedCitationCount,
      })
    : undefined
  const templateIntent = normalizeGrantTemplateIntent(section.templateIntent) || 'default'
  const templateIntentAlternates = normalizeGrantTemplateIntentList(section.templateIntentAlternates, 2)
    .filter((intent) => intent !== templateIntent)
  const templateIntentConfidence = normalizeGrantTemplateIntentConfidence(section.templateIntentConfidence)

  return {
    sectionKey: String(section.sectionKey || `section_${index + 1}`),
    label: String(section.label || section.sectionKey || `Section ${index + 1}`),
    order: Number.isFinite(section.order) ? Number(section.order) : index + 1,
    sectionType: (section.sectionType || 'narrative') as CompiledGrantTemplateSectionType,
    workflowMode: normalizeGrantSectionWorkflowMode({
      sectionType: section.sectionType,
      workflowMode: section.workflowMode,
    }),
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
    templateIntent,
    templateIntentAlternates,
    templateIntentConfidence,
    mustCover,
    mustAvoid,
    ...(dimensions.length > 0 ? { dimensions } : {}),
    ...(dimensionTyping ? { dimensionTyping } : {}),
    ...(mustCoverTyping ? { mustCoverTyping } : {}),
    ...(typeof suggestedCitationCount === 'number' ? { suggestedCitationCount } : {}),
    ...(thematicBlueprint ? { thematicBlueprint } : {}),
    ...(section.grantSemantic ? { grantSemantic: section.grantSemantic } : {}),
    ...(section.prepContextBlock ? { prepContextBlock: section.prepContextBlock } : {}),
    ...(section.authoritativePrepBundle ? { authoritativePrepBundle: section.authoritativePrepBundle } : {}),
    ...(section.relatedPrepAwareness ? { relatedPrepAwareness: section.relatedPrepAwareness } : {}),
    ...(section.grantRuleProfile ? { grantRuleProfile: section.grantRuleProfile } : {}),
    ...(section.grantTemplateGuidance ? { grantTemplateGuidance: section.grantTemplateGuidance } : {}),
    ...(section.budgetTemplate ? { budgetTemplate: section.budgetTemplate } : {}),
    ...(section.grantSectionComplianceContract ? { grantSectionComplianceContract: section.grantSectionComplianceContract } : {}),
    ...(section.grantComplianceReport ? { grantComplianceReport: section.grantComplianceReport } : {}),
    ...(section.reviewerReadinessReport ? { reviewerReadinessReport: section.reviewerReadinessReport } : {}),
  }
}

function compiledTemplateHasWorkflowModes(value: CompiledGrantTemplate | null | undefined) {
  return Boolean(
    value
    && Array.isArray(value.sections)
    && value.sections.every((section) => normalizeGrantSectionWorkflowMode({
      sectionType: (section as CompiledGrantTemplateSection).sectionType,
      workflowMode: (section as CompiledGrantTemplateSection).workflowMode,
    }) === (section as CompiledGrantTemplateSection).workflowMode)
  )
}

function documentRequiresBudgetTemplate(document: GrantTemplateDocument) {
  return Boolean(
    document.budget
    && (
      document.budget.required
      || document.budget.categories.length > 0
      || (document.budget.columns || []).length > 0
    )
  )
}

function compiledTemplateHasBudgetTemplate(value: CompiledGrantTemplate | null | undefined) {
  const budgetSection = value?.sections?.find((section) =>
    section.sectionType === 'budget_rows' || section.templateIntent === 'budget'
  )
  return !budgetSection || Boolean(budgetSection.budgetTemplate)
}

function compiledTemplateMatchesBudgetTemplateSupport(
  value: CompiledGrantTemplate | null | undefined,
  document: GrantTemplateDocument
) {
  return !documentRequiresBudgetTemplate(document) || compiledTemplateHasBudgetTemplate(value)
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
    const sectionType = forcedType || resolveGrantTemplateSectionType(item)
    const workflowMode = normalizeGrantWorkflowMode(item.workflowMode)
    const templateIntent = normalizeGrantTemplateIntent(item.templateIntent) || 'default'
    const templateIntentAlternates = normalizeGrantTemplateIntentList(item.templateIntentAlternates, 2)
      .filter((intent) => intent !== templateIntent)
    const templateIntentConfidence = normalizeGrantTemplateIntentConfidence(item.templateIntentConfidence)
    const trustedGrantSemantic = shouldTrustTemplateIntent({
      intent: templateIntent,
      confidence: templateIntentConfidence,
      alternates: templateIntentAlternates,
      workflowMode,
      sectionType,
    })
      ? templateIntentToGrantSemantic(templateIntent)
      : null
    // Extractor output can embed raw source URLs inside the prose — strip them
    // before the text becomes prompts, purposes, or compliance requirements.
    const guidance = sanitizeGrantRuleText(item.guidanceText || item.guidance || '')
    const requiredFacts = dedupeStringList(item.requiredFacts || [])
      .map((fact: string) => sanitizeGrantRuleText(fact))
      .filter(Boolean)
    const forbiddenMoves = dedupeStringList(item.forbiddenMoves || [])
      .map((move: string) => sanitizeGrantRuleText(move))
      .filter(Boolean)
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
      sectionType,
      workflowMode,
      citationMode: normalizeGrantCitationMode(null, {
        sectionType,
        workflowMode,
      }),
      required: item.required !== false,
      wordBudget: item.wordLimit ?? null,
      characterLimit: item.charLimit ?? null,
      purpose: guidance || `Prepare ${label}.`,
      reviewerIntent: item.reviewerGoal || guidance || null,
      dependencies: [],
      sourceTemplatePointer: rawKey,
      templateIntent,
      templateIntentAlternates,
      templateIntentConfidence,
      // A template item without discrete requiredFacts used to dump its ENTIRE
      // guidance paragraph as one mustCover entry — an unmatchable requirement
      // that failed the section forever. Split it into atomic points instead.
      mustCover: requiredFacts.length > 0 ? requiredFacts : splitGrantRuleTextIntoPoints(guidance, { maxPoints: 5 }),
      mustAvoid: forbiddenMoves,
      ...(trustedGrantSemantic ? { grantSemantic: trustedGrantSemantic } : {}),
      grantTemplateGuidance: templateGuidance,
    })
  }

  for (const section of input.document.sections || []) {
    pushItem(section, section.label || 'Narrative Section')
  }

  for (const question of input.document.questions || []) {
    pushItem(question, question.label || 'Response', 'short_answer')
  }

  if (
    input.document.budget
    && (
      input.document.budget.required
      || input.document.budget.categories.length > 0
      || (input.document.budget.columns || []).length > 0
    )
  ) {
    const budgetTemplate = buildBudgetTemplateFromFundingBudget(input.document.budget)
    order += 1
    sections.push({
      sectionKey: 'budget',
      label: 'Budget',
      order,
      sectionType: 'budget_rows',
      workflowMode: 'app_draft',
      citationMode: 'no_citations',
      required: input.document.budget.required,
      wordBudget: null,
      characterLimit: null,
      purpose: input.document.budget.justificationNotes || 'Provide the requested project budget.',
      reviewerIntent: input.document.budget.justificationNotes || null,
      dependencies: [],
      sourceTemplatePointer: 'budget',
      templateIntent: 'budget',
      templateIntentAlternates: [],
      templateIntentConfidence: 1,
      mustCover: input.document.budget.categories.map((category) => category.label),
      mustAvoid: [],
      budgetTemplate,
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
      templateIntent: 'attachments',
      templateIntentAlternates: [],
      templateIntentConfidence: 1,
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
      templateIntent: 'default',
      templateIntentAlternates: [],
      templateIntentConfidence: null,
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
      const document = normalizeGrantTemplate(revision.grant_template_json)
      const compiled = isCompiledGrantTemplate(revision.compiledGrantTemplateJson)
        && compiledTemplateHasWorkflowModes(revision.compiledGrantTemplateJson)
        && compiledTemplateMatchesBudgetTemplateSupport(revision.compiledGrantTemplateJson, document)
        ? revision.compiledGrantTemplateJson
        : compileGrantTemplateDocument({
            fundingCallId: input.fundingCallId,
            templateRevisionId: revision.id,
            guidelineRevisionId: input.guidelineRevisionId,
            document,
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
  const document = normalizeGrantTemplate(template.grant_template_json)
  const compiled = isCompiledGrantTemplate(template.compiledGrantTemplateJson)
    && compiledTemplateHasWorkflowModes(template.compiledGrantTemplateJson)
    && compiledTemplateMatchesBudgetTemplateSupport(template.compiledGrantTemplateJson, document)
    ? template.compiledGrantTemplateJson
    : compileGrantTemplateDocument({
        fundingCallId: input.fundingCallId,
        templateRevisionId,
        guidelineRevisionId: input.guidelineRevisionId,
        document,
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
    if (compiledTemplateHasBudgetTemplate(storedCompiled)) {
      return storedCompiled
    }
  }

  try {
    const resolved = await resolveApprovedTemplateForSession({
      fundingCallId: input.blueprint.fundingCallId,
      templateRevisionId: input.blueprint.sourceTemplateRevisionId,
      guidelineRevisionId: input.blueprint.sourceGuidelineRevisionId,
    })
    return resolved.compiledTemplate
  } catch {
    return storedCompiled
      ? {
          ...storedCompiled,
          sections: storedCompiled.sections.map((section) => ({
            ...section,
            workflowMode: normalizeGrantSectionWorkflowMode({
              sectionType: section.sectionType,
              workflowMode: section.workflowMode,
            }),
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
  const completedEvidence = (payload.prepEvidence || [])
    .filter((item) => item.status === 'covered')
    .slice(0, 8)

  const bulletLines = [
    payload.ideaAnchor ? `Finalized idea: ${payload.ideaAnchor.oneSentenceSummary}` : null,
    payload.ideaAnchor?.coreApproach ? `Idea core approach: ${payload.ideaAnchor.coreApproach}` : null,
    payload.ideaAnchor?.scopeBoundaries?.length ? `Idea scope boundaries: ${payload.ideaAnchor.scopeBoundaries.join('; ')}` : null,
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
    payload.guidance.selectedThrustAreaRuleKeys.length > 0
      ? `Selected target priority areas: ${payload.guidance.selectedThrustAreaRuleKeys.join(', ')}`
      : null,
    payload.globalKeywords.length > 0 ? `Global keywords: ${payload.globalKeywords.join(', ')}` : null,
    section.mustCover.length > 0 ? `This section must cover: ${section.mustCover.join('; ')}` : null,
    ...completedEvidence.map((item) => {
      const facts = item.factBullets.length > 0
        ? item.factBullets.slice(0, 2).join(' ; ')
        : item.keywords.slice(0, 5).join(', ')
      const notes = item.ruleNotes.length > 0 ? ` Rule note: ${item.ruleNotes[0]}` : ''
      return facts ? `${item.label}: ${facts}.${notes}` : null
    }),
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
      workflowMode: normalizeGrantSectionWorkflowMode({
        sectionType: section.sectionType,
        workflowMode: section.workflowMode,
      }),
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
      templateIntent: section.templateIntent || null,
      templateIntentAlternates: section.templateIntentAlternates || [],
      templateIntentConfidence: section.templateIntentConfidence ?? null,
      mustCover: section.mustCover || [],
      mustAvoid: section.mustAvoid || [],
      dimensions: section.dimensions || [],
      ...(section.dimensionTyping ? { dimensionTyping: section.dimensionTyping } : {}),
      ...(section.mustCoverTyping ? { mustCoverTyping: section.mustCoverTyping } : {}),
      ...(typeof section.suggestedCitationCount === 'number'
        ? { suggestedCitationCount: section.suggestedCitationCount }
        : {}),
      ...(section.thematicBlueprint ? { thematicBlueprint: section.thematicBlueprint } : {}),
      ...(section.grantSemantic ? { grantSemantic: section.grantSemantic } : {}),
      ...(section.prepContextBlock ? { prepContextBlock: section.prepContextBlock } : {}),
      ...(section.authoritativePrepBundle ? { authoritativePrepBundle: section.authoritativePrepBundle } : {}),
      ...(section.relatedPrepAwareness ? { relatedPrepAwareness: section.relatedPrepAwareness } : {}),
      ...(section.grantRuleProfile ? { grantRuleProfile: section.grantRuleProfile } : {}),
      ...(section.grantTemplateGuidance ? { grantTemplateGuidance: section.grantTemplateGuidance } : {}),
      ...(section.budgetTemplate ? { budgetTemplate: section.budgetTemplate } : {}),
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
    ideaAnchor: input.payload.ideaAnchor || null,
    ideaAnchorHash: input.payload.ideaAnchorHash || null,
    projectTitle: input.projectTitle || input.payload.project.title,
    projectDescription: input.projectDescription || input.payload.project.description || null,
    fundingCallTitle: input.fundingCallTitle || input.payload.fundingCall.title || null,
    agencyName: input.agencyName || input.payload.fundingCall.agencyName || null,
    globalKeywords: input.payload.globalKeywords,
    focusAreas: input.payload.fundingCall.focusAreas,
    selectedPriorityAreas: input.payload.guidance.selectedThrustAreaRuleKeys,
    capturedKeywords: collectGrantCapturedKeywords(input.payload.stageStates),
    prepEvidence: input.payload.prepEvidence || [],
    prepEvidenceBySection: input.payload.prepEvidenceBySection || {},
    globalCaptureSummary: input.payload.globalCaptureSummary || [],
    stageStates: input.payload.stageStates,
    guidelinePack: input.guidelinePack || null,
  }
}

function buildGrantBlueprintHydrationContext(input: {
  blueprint: {
    freezePayloadJson: unknown
    globalKeywordsJson: unknown
  }
  projectTitle?: string | null
  projectDescription?: string | null
  fundingCallTitle?: string | null
  agencyName?: string | null
  guidelinePack?: GuidelinePackDocument | null
}): GrantBlueprintEnrichmentContext {
  const payload = asObject(input.blueprint.freezePayloadJson)
  const project = asObject(payload.project)
  const fundingCall = asObject(payload.fundingCall)
  const stageStates = asObject(payload.stageStates)
  const payloadKeywords = asStringArray(payload.globalKeywords)
  const ideaAnchor = asObject(payload.ideaAnchor)

  return {
    ideaAnchor: Object.keys(ideaAnchor).length > 0
      ? ideaAnchor as unknown as GrantBlueprintEnrichmentContext['ideaAnchor']
      : null,
    ideaAnchorHash: String(payload.ideaAnchorHash || '').trim() || null,
    projectTitle: input.projectTitle || String(project.title || '').trim() || null,
    projectDescription: input.projectDescription || String(project.description || '').trim() || null,
    fundingCallTitle: input.fundingCallTitle || String(fundingCall.title || '').trim() || null,
    agencyName: input.agencyName || String(fundingCall.agencyName || '').trim() || null,
    globalKeywords: payloadKeywords.length > 0
      ? payloadKeywords
      : asStringArray(input.blueprint.globalKeywordsJson),
    focusAreas: asStringArray(fundingCall.focusAreas),
    selectedPriorityAreas: asStringArray(asObject(payload.guidance).selectedThrustAreaRuleKeys),
    capturedKeywords: collectGrantCapturedKeywords(stageStates),
    prepEvidence: Array.isArray(payload.prepEvidence)
      ? payload.prepEvidence as GrantBlueprintEnrichmentContext['prepEvidence']
      : [],
    prepEvidenceBySection: asObject(payload.prepEvidenceBySection) as GrantBlueprintEnrichmentContext['prepEvidenceBySection'],
    globalCaptureSummary: asStringArray(payload.globalCaptureSummary),
    stageStates: Object.keys(stageStates).length > 0
      ? stageStates as GrantBlueprintEnrichmentContext['stageStates']
      : null,
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

  return buildBudgetStructuredScaffold({
    section,
    currency: payload.fundingCall.funding.match(/[A-Z]{3}/)?.[0] || null,
  })
}

function isDraftableGrantSection(
  input: {
    sectionKey?: string | null
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
        workflowMode: normalizeGrantSectionWorkflowMode({
          sectionType: section.sectionType,
          workflowMode: section.workflowMode,
        }),
        citationMode: normalizeGrantCitationMode(section.citationMode, {
          sectionType: section.sectionType,
          workflowMode: section.workflowMode,
          suggestedCitationCount: section.suggestedCitationCount,
        }),
        budgetTemplate: section.budgetTemplate || null,
      },
    ] as const)
  )

  return sectionPlan.map((section) => ({
    ...section,
    workflowMode: compiledByKey.get(section.sectionKey)?.workflowMode
      || normalizeGrantSectionWorkflowMode({
        sectionType: section.sectionType,
        workflowMode: (section as Partial<GrantBlueprintPlanSection>).workflowMode,
      }),
    citationMode: normalizeGrantCitationMode(
      section.citationMode ?? compiledByKey.get(section.sectionKey)?.citationMode,
      {
        sectionType: section.sectionType,
        workflowMode: compiledByKey.get(section.sectionKey)?.workflowMode || section.workflowMode,
        suggestedCitationCount: section.suggestedCitationCount,
      }
    ),
    budgetTemplate: compiledByKey.get(section.sectionKey)?.budgetTemplate || section.budgetTemplate || null,
  }))
}

function enrichGrantSectionDrafts<T extends { sectionKey: string; sectionType?: string }>(
  drafts: T[],
  sectionPlan: GrantBlueprintPlanSection[]
) {
  const sectionMetaByKey = new Map(
    sectionPlan.map((section) => [
      section.sectionKey,
      {
        sectionType: section.sectionType,
        workflowMode: normalizeGrantSectionWorkflowMode({
          sectionType: section.sectionType,
          workflowMode: section.workflowMode,
        }),
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
    sectionType: sectionMetaByKey.get(draft.sectionKey)?.sectionType || draft.sectionType || 'narrative',
    workflowMode: sectionMetaByKey.get(draft.sectionKey)?.workflowMode || 'team_manual',
    citationMode: sectionMetaByKey.get(draft.sectionKey)?.citationMode || 'direct_draft',
  }))
}

export function buildGrantBibliographyPlanSection(
  sectionPlan: Array<Pick<GrantBlueprintPlanSection, 'order'>>
): GrantBlueprintPlanSection {
  const maxOrder = sectionPlan.reduce((current, section) => {
    const order = Number(section.order || 0)
    return Number.isFinite(order) ? Math.max(current, order) : current
  }, 0)

  return {
    sectionKey: GRANT_BIBLIOGRAPHY_SECTION_KEY,
    label: GRANT_BIBLIOGRAPHY_SECTION_LABEL,
    order: maxOrder + 1,
    sectionType: 'narrative',
    workflowMode: 'app_draft',
    citationMode: 'direct_draft',
    required: false,
    wordBudget: null,
    characterLimit: null,
    purpose: 'Generated bibliography for active grant citations.',
    reviewerIntent: 'Provide a complete bibliography for cited sources in the grant proposal.',
    dependencies: [],
    sourceTemplatePointer: null,
    mustCover: [],
    mustAvoid: [],
    dimensions: [],
    dimensionTyping: {},
    mustCoverTyping: {},
    suggestedCitationCount: null,
    thematicBlueprint: null,
    seededContext: '',
    grantSemantic: 'default',
    prepContextBlock: null,
    authoritativePrepBundle: null,
    relatedPrepAwareness: null,
    grantRuleProfile: null,
    grantTemplateGuidance: null,
    budgetTemplate: null,
    grantSectionComplianceContract: null,
    grantComplianceReport: null,
    reviewerReadinessReport: null,
  }
}

export function appendGrantBibliographySectionIfNeeded(
  sectionPlan: GrantBlueprintPlanSection[],
  activeCitationCount: number
): GrantBlueprintPlanSection[] {
  if (activeCitationCount <= 0) {
    return sectionPlan.filter((section) => section.sectionKey !== GRANT_BIBLIOGRAPHY_SECTION_KEY)
  }
  if (sectionPlan.some((section) => section.sectionKey === GRANT_BIBLIOGRAPHY_SECTION_KEY)) {
    const bibliographySection = buildGrantBibliographyPlanSection(
      sectionPlan.filter((section) => section.sectionKey !== GRANT_BIBLIOGRAPHY_SECTION_KEY)
    )
    return sectionPlan.map((section) =>
      section.sectionKey === GRANT_BIBLIOGRAPHY_SECTION_KEY
        ? bibliographySection
        : section
    )
  }
  return [
    ...sectionPlan,
    buildGrantBibliographyPlanSection(sectionPlan),
  ]
}

async function countActiveGrantCitations(draftingSessionId: string | null | undefined): Promise<number> {
  const sessionId = String(draftingSessionId || '').trim()
  if (!sessionId) return 0
  return prisma.citation.count({
    where: {
      sessionId,
      isActive: true,
    },
  })
}

async function ensureGrantBibliographyDraftRecord(input: {
  grantSessionId: string
  blueprintId: string
  tenantId: string
  projectId: string
  userId: string
  sectionPlan: GrantBlueprintPlanSection[]
}) {
  const bibliographySection = input.sectionPlan.find((section) => section.sectionKey === GRANT_BIBLIOGRAPHY_SECTION_KEY)
  if (!bibliographySection) return false

  const existing = await prisma.grantSectionDraft.findUnique({
    where: {
      grantSessionId_sectionKey: {
        grantSessionId: input.grantSessionId,
        sectionKey: GRANT_BIBLIOGRAPHY_SECTION_KEY,
      },
    },
    select: {
      id: true,
      label: true,
      sectionOrder: true,
      blueprintId: true,
      sectionType: true,
      required: true,
    },
  })

  const metadata = {
    blueprintId: input.blueprintId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    label: bibliographySection.label,
    sectionType: bibliographySection.sectionType,
    sectionOrder: bibliographySection.order,
    required: bibliographySection.required,
    wordBudget: bibliographySection.wordBudget,
    characterLimit: bibliographySection.characterLimit,
    purpose: bibliographySection.purpose,
    reviewerIntent: bibliographySection.reviewerIntent,
    dependenciesJson: asJson(bibliographySection.dependencies),
    mustCoverJson: asJson(bibliographySection.mustCover),
    mustAvoidJson: asJson(bibliographySection.mustAvoid),
    sourceTemplatePointer: bibliographySection.sourceTemplatePointer,
    updatedByUserId: input.userId,
  }

  if (existing) {
    const needsUpdate = existing.blueprintId !== input.blueprintId
      || existing.label !== bibliographySection.label
      || existing.sectionType !== bibliographySection.sectionType
      || existing.sectionOrder !== bibliographySection.order
      || existing.required !== bibliographySection.required
    if (!needsUpdate) return false

    await prisma.grantSectionDraft.update({
      where: { id: existing.id },
      data: metadata,
    })
    return true
  }

  await prisma.grantSectionDraft.create({
    data: {
      grantSessionId: input.grantSessionId,
      sectionKey: GRANT_BIBLIOGRAPHY_SECTION_KEY,
      ...metadata,
      createdByUserId: input.userId,
    },
  })
  return true
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

export async function resolveGrantTenantContext(
  tenantId: string,
  userId: string
): Promise<TenantContext | null> {
  return resolveGrantWorkflowTenantContext(tenantId, userId)
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
      const dimensions = Array.isArray(section.dimensions) ? section.dimensions : []
      const dimensionTyping =
        normalizeGrantDimensionTyping(dimensions, section.dimensionTyping)
        || normalizeGrantDimensionTyping(dimensions, section.thematicBlueprint?.dimensionTyping)
        || normalizeGrantDimensionTyping(dimensions, existing.dimensionTyping)
        || normalizeGrantDimensionTyping(dimensions, existingThematic.dimensionTyping)
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
        dimensions,
        dimensionTyping,
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
        dimensions,
        seededContext: section.seededContext,
        sectionType: section.sectionType,
        reviewerIntent: section.reviewerIntent,
        characterLimit: section.characterLimit,
        templateIntent: section.templateIntent || null,
        templateIntentAlternates: section.templateIntentAlternates || [],
        templateIntentConfidence: section.templateIntentConfidence ?? null,
        grantSemantic: section.grantSemantic || null,
        prepContextBlock: section.prepContextBlock || null,
        authoritativePrepBundle: section.authoritativePrepBundle || null,
        relatedPrepAwareness: section.relatedPrepAwareness || null,
        authoritativePrepPointCount: section.authoritativePrepBundle?.bullets.length || 0,
        grantRuleProfile: section.grantRuleProfile || null,
        grantTemplateGuidance: section.grantTemplateGuidance || null,
        grantSectionComplianceContract: section.grantSectionComplianceContract || null,
        grantComplianceReport: section.grantComplianceReport || null,
        reviewerReadinessReport: section.reviewerReadinessReport || null,
        ideaAnchorHash: section.ideaAnchorHash || null,
        ideaAnchorRelationship: section.ideaAnchorRelationship || 'supporting',
        anchorReviewRequired: section.anchorReviewRequired || false,
        manualOverrideAnchorHash: section.manualOverrideAnchorHash || null,
        workflowMode: section.workflowMode,
        citationMode,
        ...(typeof section.wordBudget === 'number'
          ? { wordBudget: section.wordBudget }
          : {}),
        dependencies: [...section.dependencies],
        outputsPromised: asStringArray(existing.outputsPromised),
        ...(dimensionTyping ? { dimensionTyping } : {}),
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
    ideaAnchor?: GrantPrepIdeaAnchorV1 | null
    ideaAnchorHash?: string | null
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
  const grantIntentLock = buildGrantIdeaIntentLock(input.ideaAnchor, input.ideaAnchorHash)

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
        ...(grantIntentLock ? { intentLock: asJson(grantIntentLock) } : {}),
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
    ...(grantIntentLock ? { intentLock: grantIntentLock } : {}),
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
    intentLock: currentBlueprint.intentLock,
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
        ...(grantIntentLock ? { intentLock: asJson(grantIntentLock) } : {}),
        version: { increment: 1 },
      },
    })
    if (input.resetStatus) {
      await tx.paperSection.updateMany({
        where: { sessionId: draftingSession.id },
        data: { isStale: true },
      })
    }
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
        workflowMode: normalizeGrantSectionWorkflowMode({
          sectionType: (section as Partial<GrantBlueprintPlanSection>).sectionType,
          workflowMode: (section as Partial<GrantBlueprintPlanSection>).workflowMode,
        }),
        citationMode: normalizeGrantCitationMode((section as Partial<GrantBlueprintPlanSection>).citationMode, {
          sectionType: (section as Partial<GrantBlueprintPlanSection>).sectionType,
          workflowMode: (section as Partial<GrantBlueprintPlanSection>).workflowMode,
          suggestedCitationCount: (section as Partial<GrantBlueprintPlanSection>).suggestedCitationCount,
        }),
      }))
  const sectionPlan = enrichGrantBlueprintSections(
    baseSectionPlan,
    buildGrantBlueprintHydrationContext({
      blueprint,
      projectTitle: grantSession.project.name,
      fundingCallTitle: grantSession.fundingCall?.scheme_title || null,
      guidelinePack: await resolveGuidelinePackForRevision(blueprint.sourceGuidelineRevisionId || null),
    }),
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
      ideaAnchor: asObject(asObject(blueprint.freezePayloadJson).ideaAnchor) as unknown as GrantPrepIdeaAnchorV1,
      ideaAnchorHash: String(asObject(blueprint.freezePayloadJson).ideaAnchorHash || '').trim() || null,
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
      if (existing.fundingCallId !== input.fundingCallId) {
        throw new Error('Linked grant session funding call does not match the Grant Prep funding context.')
      }
      return tx.grantSession.update({
        where: { id: existing.id },
        data: {
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

  const serverContext = await resolveGrantPrepContext(prepSession.project_id, actor, {
    grantSessionId: prepSession.grant_session_id,
    fundingCallId: prepSession.funding_call_id,
  })
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
  const overallReadiness = computeOverallReadiness(prepContext.stageStates)
  const generationReady = overallReadiness >= GRANT_PREP_GENERATION_READY_THRESHOLD
  const generationBlockedMessage = generationReady
    ? null
    : `Grant Prep is ${Math.round(overallReadiness * 100)}% complete. You can open and inspect the workspace, but generation actions are held until Grant Prep reaches at least ${Math.round(GRANT_PREP_GENERATION_READY_THRESHOLD * 100)}% completion.`

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
    overallReadiness,
    generationReady,
    generationBlockedMessage,
  }
}

export async function buildGrantPrepLocalLaunchPreview(sessionId: string, actor: GrantPrepActor): Promise<LocalGrantLaunchPreview> {
  const state = await buildLaunchState(sessionId, actor)
  const launchUrl = buildGrantWorkspaceUrl({
    projectId: state.prepSession.project_id,
    grantSessionId: state.grantSessionId,
    prepStatus: state.prepSession.status,
  })

  return {
    blockers: state.freeze.blockers,
    payload: state.freeze.payload,
    payloadHash: state.freeze.payloadHash,
    overallReadiness: state.overallReadiness,
    generationReady: state.generationReady,
    generationReadinessThreshold: GRANT_PREP_GENERATION_READY_THRESHOLD,
    generationBlockedMessage: state.generationBlockedMessage,
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
  /** Regeneration bypasses the already-launched short-circuit. */
  forceRelaunch?: boolean
}) {
  const state = await buildLaunchState(input.sessionId, input.actor)

  // Idempotent launch. Re-hitting handoff for an already-launched session whose
  // frozen payload has not changed (double-click, retry after a lost response,
  // the workspace BLUEPRINT auto-launch effect firing again on refresh) must NOT
  // re-run the blueprint LLM or rewrite drafts. It previously did both — burning
  // tokens on every attempt and, before the upsert fix, crashing on P2002.
  // Regeneration passes forceRelaunch to intentionally rebuild.
  if (
    !input.forceRelaunch &&
    state.prepSession.status === 'launched' &&
    state.prepSession.grant_session_id &&
    state.prepSession.frozen_payload_hash === state.freeze.payloadHash
  ) {
    const existingBlueprint = await prisma.grantBlueprint.findUnique({
      where: { grantSessionId: state.prepSession.grant_session_id },
      select: { id: true },
    })
    if (existingBlueprint) {
      return {
        grantSessionId: state.prepSession.grant_session_id,
        blueprintId: existingBlueprint.id,
        launchUrl:
          state.prepSession.papsi_launch_url
          || buildGrantWorkspaceUrl({
            projectId: state.prepSession.project_id,
            grantSessionId: state.prepSession.grant_session_id,
            stage: 'SECTION_DRAFTING',
          })
          || `/projects/${state.prepSession.project_id}/grants/${state.prepSession.grant_session_id}/workspace?stage=SECTION_DRAFTING`,
        alreadyLaunched: true as const,
      }
    }
  }

  const overrideReason = input.overrideReason?.trim()
    || (state.freeze.blockers.length > 0
      ? 'User confirmed launch warning for incomplete Grant Prep.'
      : state.generationReady
        ? null
        : 'User opened the grant workspace while Grant Prep completion was below the generation threshold.')

  const frozenPayload = {
    ...state.freeze.payload,
    overrideReason,
    generationReadiness: {
      overallReadiness: state.overallReadiness,
      threshold: GRANT_PREP_GENERATION_READY_THRESHOLD,
      generationReady: state.generationReady,
      message: state.generationBlockedMessage,
    },
  }
  // Launch must finish well under the reverse-proxy timeout (~60s). The inline
  // blueprint LLM enrichment took 60-70s in production, so every handoff 504ed
  // at the proxy while the server kept working (and billing). The deterministic
  // plan below is exactly what generateGrantBlueprintWithLlm falls back to on
  // any LLM failure — complete for drafting. The LLM only adds literature
  // dimensions / citation hints, which stay available on demand through the
  // blueprint's explicit `generate_dimensions` action.
  const generatedBlueprint = {
    sectionPlan: state.sectionPlan,
    proposalFoundation: state.proposalFoundation,
  }

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
    const previousAnchorHash = String(asObject(existingBlueprint?.freezePayloadJson).ideaAnchorHash || '').trim() || null
    const anchorChanged = Boolean(existingBlueprint && previousAnchorHash !== (state.freeze.payload.ideaAnchorHash || null))

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

    // Dedupe the plan by sectionKey (last wins). A compiled template or LLM
    // merge that emits the same key twice must never reach a second create() on
    // the (grantSessionId, sectionKey) unique index — that was the P2002 crash.
    const planByKey = new Map<string, (typeof generatedBlueprint.sectionPlan)[number]>()
    for (const section of generatedBlueprint.sectionPlan) {
      planByKey.set(section.sectionKey, section)
    }
    const uniqueSectionPlan = Array.from(planByKey.values())

    const existingDrafts = await tx.grantSectionDraft.findMany({
      where: { grantSessionId: grantSession.id },
      select: { sectionKey: true },
    })
    const existingDraftKeys = new Set(existingDrafts.map((draft) => draft.sectionKey))

    for (const section of uniqueSectionPlan) {
      const isNewDraft = !existingDraftKeys.has(section.sectionKey)
      // Upsert on the compound unique so a retry / concurrent launch is
      // idempotent instead of crashing. The update path deliberately leaves
      // content, status, and version untouched so a re-launch never wipes a
      // draft the user already wrote.
      const draft = await tx.grantSectionDraft.upsert({
        where: {
          grantSessionId_sectionKey: {
            grantSessionId: grantSession.id,
            sectionKey: section.sectionKey,
          },
        },
        update: {
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
        create: {
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
          sourceIdeaAnchorHash: state.freeze.payload.ideaAnchorHash || null,
          isStale: false,
          createdByUserId: input.actor.id,
          updatedByUserId: input.actor.id,
        },
      })

      if (
        isNewDraft &&
        (section.sectionType === 'checklist' || section.sectionType === 'table' || section.sectionType === 'budget_rows')
      ) {
        // Only scaffold structured data for brand-new drafts, and upsert so a
        // retry after a partial failure cannot double-insert on
        // (sectionDraftId, fieldKey). An existing scaffold is left as-is to
        // preserve any structured data the user already entered.
        await tx.grantStructuredFieldResponse.upsert({
          where: {
            sectionDraftId_fieldKey: {
              sectionDraftId: draft.id,
              fieldKey: 'structuredData',
            },
          },
          update: {},
          create: {
            grantSessionId: grantSession.id,
            sectionDraftId: draft.id,
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

    await ensureGrantShadowWorkspaceTx(tx, {
      grantSessionId: grantSession.id,
      draftingSessionId: grantSession.draftingSessionId,
      tenantId: input.actor.tenantId,
      projectId: state.prepSession.project_id,
      projectName: state.prepSession.project.name || '',
      fundingCallTitle: state.serverContext.fundingContext.title || null,
      templateRevisionId: state.templateState.templateRevisionId,
      userId: input.actor.id,
      sectionPlan: uniqueSectionPlan,
      globalKeywords: state.freeze.payload.globalKeywords,
      blueprintStatus: 'DRAFT',
      foundation: generatedBlueprint.proposalFoundation,
      resetStatus: Boolean(existingBlueprint),
      ideaAnchor: state.freeze.payload.ideaAnchor || null,
      ideaAnchorHash: state.freeze.payload.ideaAnchorHash || null,
    })

    if (existingBlueprint) {
      await tx.grantSectionDraft.updateMany({
        where: { grantSessionId: grantSession.id },
        data: {
          isStale: true,
          staleReason: anchorChanged
            ? 'The finalized idea changed. Review or regenerate this section.'
            : 'Grant Prep or blueprint context changed. Review this section.',
        },
      })
    }

    // Fast path bypasses the blueprint review stage: land the user straight in
    // section drafting. The blueprint plan is still generated (as data); we just
    // don't stop at the review/freeze UI.
    const launchUrl = buildGrantWorkspaceUrl({
      projectId: state.prepSession.project_id,
      grantSessionId: grantSession.id,
      stage: 'SECTION_DRAFTING',
    }) || `/projects/${state.prepSession.project_id}/grants/${grantSession.id}/workspace?stage=SECTION_DRAFTING`
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
        // Skip the BLUEPRINT review stage — the fast path drives Draft One,
        // which drafts each section without requiring a frozen blueprint.
        status: 'DRAFTING',
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

  const activeCitationCount = await countActiveGrantCitations(grantSession.draftingSessionId)
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
        workflowMode: normalizeGrantSectionWorkflowMode({
          sectionType: (section as Partial<GrantBlueprintPlanSection>).sectionType,
          workflowMode: (section as Partial<GrantBlueprintPlanSection>).workflowMode,
        }),
        citationMode: normalizeGrantCitationMode((section as Partial<GrantBlueprintPlanSection>).citationMode, {
          sectionType: (section as Partial<GrantBlueprintPlanSection>).sectionType,
          workflowMode: (section as Partial<GrantBlueprintPlanSection>).workflowMode,
          suggestedCitationCount: (section as Partial<GrantBlueprintPlanSection>).suggestedCitationCount,
        }),
      }))
  let sectionPlan = grantSession.blueprint
    ? enrichGrantBlueprintSections(
        baseSectionPlan,
        buildGrantBlueprintHydrationContext({
          blueprint: grantSession.blueprint,
          projectTitle: grantSession.project.name,
          fundingCallTitle: grantSession.fundingCall?.scheme_title || null,
          agencyName: grantSession.fundingCall?.agency_name || null,
          guidelinePack: await resolveGuidelinePackForRevision(grantSession.blueprint.sourceGuidelineRevisionId || null),
        }),
        'hydrate'
      )
    : baseSectionPlan
  sectionPlan = appendGrantBibliographySectionIfNeeded(sectionPlan, activeCitationCount)
  if (grantSession.blueprint && activeCitationCount > 0) {
    const bibliographyDraftChanged = await ensureGrantBibliographyDraftRecord({
      grantSessionId: grantSession.id,
      blueprintId: grantSession.blueprint.id,
      tenantId: grantSession.tenantId,
      projectId: grantSession.projectId,
      userId: grantSession.updatedByUserId,
      sectionPlan,
    })
    if (bibliographyDraftChanged) {
      const refreshedGrantSession = await loadGrantWorkspaceRecord(input)
      if (!refreshedGrantSession) {
        return null
      }
      grantSession = refreshedGrantSession
    }
  }
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
    if (!isGrantSectionAutoDraftable({
      sectionKey: draft.sectionKey,
      sectionType: draft.sectionType,
      workflowMode: draft.workflowMode,
    })) {
      return draft
    }

    const paperSection = paperSectionsByKey.get(draft.sectionKey)
    const paperValidationReport = asObject(paperSection?.validationReport)
    const draftRecord = asObject(draft)
    const persistedGrantContent = typeof draft.content === 'string' && draft.content.trim().length > 0
      ? draft.content
      : ''
    const shadowContent = typeof paperSection?.content === 'string' && paperSection.content.trim().length > 0
      ? paperSection.content
      : paperDraftSections[draft.sectionKey] || ''

    return {
      ...draft,
      content: persistedGrantContent || shadowContent || null,
      status: persistedGrantContent
        ? String(draft.status || 'NOT_STARTED')
        : String(paperSection?.status || draft.status || 'NOT_STARTED'),
      isStale: Boolean(paperSection?.isStale),
      validationReport: paperValidationReport,
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
        sectionType: section.sectionType,
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
        sectionType: section.sectionType,
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

  const persistedSectionPlan = workspace.blueprint.sectionPlan.filter((section) =>
    !isGrantBibliographySection(section.sectionKey)
  )
  const nextSections = (input.sections || persistedSectionPlan).filter((section) =>
    !isGrantBibliographySection(section.sectionKey)
  )
  if (!input.sections && !input.foundation) {
    throw new Error('No blueprint changes were provided')
  }
  if (input.sections && nextSections.length === 0) {
    throw new Error('Blueprint section updates must include at least one grant template section.')
  }

  const existingPlan = persistedSectionPlan
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
    const dimensions = Array.isArray(section.dimensions) ? section.dimensions : []
    const dimensionTyping =
      normalizeGrantDimensionTyping(dimensions, section.dimensionTyping)
      || normalizeGrantDimensionTyping(dimensions, section.thematicBlueprint?.dimensionTyping)
      || normalizeGrantDimensionTyping(dimensions, existing?.dimensionTyping)
      || normalizeGrantDimensionTyping(dimensions, existing?.thematicBlueprint?.dimensionTyping)
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
      dimensions,
      dimensionTyping,
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
      dimensions,
      citationMode,
      ...(dimensionTyping ? { dimensionTyping } : { dimensionTyping: undefined }),
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
      ideaAnchor: asObject(asObject(blueprint.freezePayloadJson).ideaAnchor) as unknown as GrantPrepIdeaAnchorV1,
      ideaAnchorHash: String(asObject(blueprint.freezePayloadJson).ideaAnchorHash || '').trim() || null,
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

export function applyGrantBlueprintSectionOverride(
  sectionPlan: GrantBlueprintPlanSection[],
  patch: GrantBlueprintSectionOverridePatch
): { sectionPlan: GrantBlueprintPlanSection[]; section: GrantBlueprintPlanSection } {
  const sectionKey = String(patch.sectionKey || '').trim()
  if (!sectionKey || isGrantBibliographySection(sectionKey)) {
    throw new Error('A valid grant template section is required for section overrides.')
  }

  const sectionIndex = sectionPlan.findIndex((section) => section.sectionKey === sectionKey)
  if (sectionIndex < 0) {
    throw new Error(`Unknown blueprint section: ${sectionKey}`)
  }

  const existing = sectionPlan[sectionIndex]
  const nextDimensions = patch.dimensions
    ? dedupeStringList(patch.dimensions)
    : dedupeStringList(existing.dimensions || existing.thematicBlueprint?.dimensions || [])
  let suggestedCitationCount = normalizeGrantSuggestedCitationCount(
    patch.suggestedCitationCount
      ?? existing.suggestedCitationCount
      ?? existing.thematicBlueprint?.suggestedCitationCount
  )
  const citationMode = normalizeGrantCitationMode(
    patch.citationMode ?? existing.citationMode,
    {
      sectionType: existing.sectionType,
      workflowMode: existing.workflowMode,
      suggestedCitationCount,
    }
  )
  const evidenceMapped = citationMode === 'mapped_evidence'
  const dimensions = evidenceMapped ? nextDimensions : []

  if (!evidenceMapped) {
    suggestedCitationCount = 0
  } else if (typeof suggestedCitationCount !== 'number' && dimensions.length > 0) {
    suggestedCitationCount = Math.max(2, dimensions.length)
  }

  const dimensionTyping = evidenceMapped
    ? normalizeGrantDimensionTyping(
        dimensions,
        patch.dimensionTyping
          ?? existing.dimensionTyping
          ?? existing.thematicBlueprint?.dimensionTyping
      )
    : undefined
  const mustCoverTyping =
    normalizeGrantMustCoverTyping(existing.mustCover, existing.mustCoverTyping)
    || normalizeGrantMustCoverTyping(existing.mustCover, existing.thematicBlueprint?.mustCoverTyping)
  const thematicBlueprint = buildGrantThematicBlueprint({
    mustCover: existing.mustCover,
    mustAvoid: existing.mustAvoid,
    dimensions,
    dimensionTyping,
    mustCoverTyping,
    suggestedCitationCount,
  })
  const section: GrantBlueprintPlanSection = {
    ...existing,
    dimensions,
    citationMode,
    ...(dimensionTyping ? { dimensionTyping } : { dimensionTyping: undefined }),
    ...(mustCoverTyping ? { mustCoverTyping } : { mustCoverTyping: undefined }),
    suggestedCitationCount: suggestedCitationCount ?? null,
    thematicBlueprint,
  }

  const nextSectionPlan = sectionPlan.map((item, index) => (
    index === sectionIndex ? section : item
  ))

  return {
    sectionPlan: nextSectionPlan,
    section,
  }
}

export async function updateBlueprintSectionOverride(input: {
  grantSessionId: string
  tenantId: string
  projectId?: string
  userId: string
  sectionOverride: GrantBlueprintSectionOverridePatch
}) {
  const grantSession = await prisma.grantSession.findFirst({
    where: {
      id: input.grantSessionId,
      tenantId: input.tenantId,
    },
    select: {
      id: true,
      projectId: true,
      draftingSessionId: true,
      blueprint: {
        select: {
          id: true,
          status: true,
          version: true,
          sectionPlanJson: true,
        },
      },
      draftingSession: {
        select: {
          paperBlueprint: {
            select: {
              sessionId: true,
              sectionPlan: true,
            },
          },
        },
      },
    },
  })

  if (!grantSession?.blueprint) {
    throw new Error('Grant blueprint not found')
  }
  if (input.projectId && grantSession.projectId !== input.projectId) {
    throw new Error('Grant workspace not found')
  }
  if (grantSession.blueprint.status === 'FROZEN') {
    throw new Error('Cannot update a frozen grant blueprint. Unfreeze it first.')
  }

  const persistedSectionPlan = Array.isArray(grantSession.blueprint.sectionPlanJson)
    ? (grantSession.blueprint.sectionPlanJson as unknown as GrantBlueprintPlanSection[]).filter((section) =>
        !isGrantBibliographySection(section.sectionKey)
      )
    : []
  const { sectionPlan, section } = applyGrantBlueprintSectionOverride(
    persistedSectionPlan,
    input.sectionOverride
  )
  const paperBlueprint = grantSession.draftingSession?.paperBlueprint || null
  const nextPaperSectionPlan = paperBlueprint
    ? buildPaperSectionPlanFromGrantSections(sectionPlan, paperBlueprint.sectionPlan)
    : null
  const shouldUpdatePaperBlueprint = Boolean(
    paperBlueprint
    && nextPaperSectionPlan
    && JSON.stringify(paperBlueprint.sectionPlan) !== JSON.stringify(nextPaperSectionPlan)
  )

  const updatedBlueprint = await prisma.$transaction(async (tx) => {
    const updated = await tx.grantBlueprint.update({
      where: { id: grantSession.blueprint!.id },
      data: {
        sectionPlanJson: asJson(sectionPlan),
        status: 'DRAFT',
        version: { increment: 1 },
        updatedByUserId: input.userId,
        frozenAt: null,
      },
      select: {
        id: true,
        status: true,
        version: true,
      },
    })

    if (paperBlueprint && nextPaperSectionPlan && shouldUpdatePaperBlueprint) {
      await tx.paperBlueprint.update({
        where: { sessionId: paperBlueprint.sessionId },
        data: {
          sectionPlan: asJson(nextPaperSectionPlan),
          version: { increment: 1 },
        },
      })
    }

    await tx.grantSession.update({
      where: { id: input.grantSessionId },
      data: {
        status: 'BLUEPRINT',
        updatedByUserId: input.userId,
      },
    })

    return updated
  })

  return {
    blueprintId: updatedBlueprint.id,
    status: updatedBlueprint.status,
    version: updatedBlueprint.version,
    section,
  }
}

export async function generateBlueprintLiteratureDimensions(input: {
  grantSessionId: string
  tenantId: string
  userId: string
}) {
  const workspace = await getGrantWorkspace({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
  })
  if (!workspace?.blueprint) {
    throw new Error('Grant blueprint not found')
  }
  if (workspace.blueprint.status === 'FROZEN') {
    throw new Error('Cannot generate literature dimensions for a frozen grant blueprint. Unfreeze it first.')
  }

  const blueprint = workspace.blueprint
  const guidelinePack = await resolveGuidelinePackForRevision(blueprint.sourceGuidelineRevisionId || null)
  const enrichmentContext = buildGrantBlueprintHydrationContext({
    blueprint,
    projectTitle: workspace.grantSession.project.name,
    fundingCallTitle: workspace.grantSession.fundingCall?.scheme_title || null,
    agencyName: workspace.grantSession.fundingCall?.agency_name || null,
    guidelinePack,
  })
  const tenantContext = await resolveGrantTenantContext(input.tenantId, input.userId)
  const generated = await generateGrantBlueprintWithLlm({
    baseSectionPlan: workspace.blueprint.sectionPlan.filter((section) =>
      !isGrantBibliographySection(section.sectionKey)
    ),
    context: enrichmentContext,
    proposalFoundationHint: {
      thesisStatement: workspace.proposalFoundation.thesisStatement || '',
      centralObjective: workspace.proposalFoundation.centralObjective || '',
      keyContributions: workspace.proposalFoundation.keyContributions || [],
    },
    tenantContext,
    sessionId: input.grantSessionId,
    requireLlm: true,
  })

  await updateBlueprintPlan({
    grantSessionId: input.grantSessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    sections: generated.sectionPlan,
  })

  return generated
}

export async function setGrantBlueprintStatus(input: {
  grantSessionId: string
  tenantId: string
  userId: string
  status: 'DRAFT' | 'FROZEN'
  overrideReason?: string | null
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
      const canOverrideGrantSectionWarnings = readiness.issues.every((issue) =>
        issue.startsWith('Grant-backed section ')
      )
      if (!input.overrideReason?.trim() || !canOverrideGrantSectionWarnings) {
        throw new Error(readiness.issues.join('\n'))
      }
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
