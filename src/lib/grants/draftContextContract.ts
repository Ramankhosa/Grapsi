import crypto from 'crypto'

import {
  buildGrantComplianceReport,
  buildReviewerReadinessReport,
} from '@/lib/grants/compliance'
import {
  budgetStructuredDataHasConfirmedNumericValues,
  budgetStructuredDataHasMeaningfulRows,
  budgetStructuredDataHasNumericColumns,
  getBudgetStructuredOpenQuestions,
} from '@/lib/grants/budgetTemplate'
import { requiresMappedGrantEvidence } from '@/lib/grants/citationMode'
import {
  getGrantAiReviewReportFromResponses,
  grantAiReviewHasBlockingFindings,
  isGrantAiReviewStale,
} from '@/lib/grants/aiReviewReport'
import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type { GrantPrepIdeaAnchorV1 } from '@/lib/grantPrep/types'
import type {
  GrantCitationMode,
  GrantComplianceReport,
  GrantGenerationTrace,
  GrantPrepPromptBundle,
  GrantRuleProfile,
  GrantSectionComplianceContract,
  ReviewerReadinessReport,
} from '@/types/grant'

type GrantIdeaAnchorRelationship = 'identity_bearing' | 'supporting' | 'neutral'

type SectionContractInput = {
  sectionKey: string
  label?: string | null
  workflowMode?: string | null
  citationMode?: GrantCitationMode | string | null
  grantSemantic?: string | null
  ideaAnchorHash?: string | null
  ideaAnchorRelationship?: GrantIdeaAnchorRelationship | string | null
  mustCover?: string[] | null
  dimensions?: string[] | null
  grantRuleProfile?: GrantRuleProfile | null
  grantSectionComplianceContract?: GrantSectionComplianceContract | null
  authoritativePrepBundle?: GrantPrepPromptBundle | null
  relatedPrepAwareness?: GrantPrepPromptBundle | null
  wordBudget?: number | null
  characterLimit?: number | null
}

type EvidenceContractInput = {
  useMappedEvidence?: boolean
  allowedCitationKeys?: string[] | null
  dimensionEvidence?: Array<{ dimension: string; citations?: Array<{ citationKey?: string | null }> }> | null
  gaps?: string[] | null
  coverageAssignments?: Array<{ citationKey?: string | null }> | null
  evidenceDigest?: { mustCiteKeys?: string[]; optionalCiteKeys?: string[] } | null
}

export interface GrantDraftContextContract {
  version: 2
  sectionKey: string
  label: string | null
  workflowMode: string | null
  citationMode: string | null
  ideaAnchor: GrantPrepIdeaAnchorV1 | null
  ideaAnchorHash: string | null
  ideaAnchorRelationship: GrantIdeaAnchorRelationship
  requiredAnchorElements: string[]
  allowedUnresolvedQuestions: string[]
  scopeBoundaries: string[]
  wordBudget: number | null
  characterLimit: number | null
  fundingCallSummary: string[]
  grantRuleProfile: GrantRuleProfile | null
  grantSectionComplianceContract: GrantSectionComplianceContract | null
  authoritativePrepBundle: GrantPrepPromptBundle | null
  relatedPrepAwareness: GrantPrepPromptBundle | null
  mustCover: string[]
  dimensions: string[]
  evidence: {
    useMappedEvidence: boolean
    allowedCitationKeys: string[]
    dimensionEvidenceCount: number
    mappedDimensionCount: number
    coverageCitationKeys: string[]
    gaps: string[]
    mustCiteKeys: string[]
    optionalCiteKeys: string[]
  }
  readiness: {
    issues: string[]
    warnings: string[]
  }
  fingerprint: string
}

function normalizeStrings(value: unknown, limit = 80): string[] {
  const source = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of source) {
    const text = String(item || '').trim().replace(/\s+/g, ' ')
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    output.push(text)
    if (output.length >= limit) break
  }
  return output
}

function normalizeAnchorRelationship(value: unknown): GrantIdeaAnchorRelationship {
  return value === 'identity_bearing' || value === 'supporting' || value === 'neutral'
    ? value
    : 'supporting'
}

function buildRequiredAnchorElements(
  anchor: GrantPrepIdeaAnchorV1 | null,
  relationship: GrantIdeaAnchorRelationship
) {
  if (!anchor || relationship === 'neutral') return []
  const base = [
    anchor.title,
    anchor.oneSentenceSummary,
    anchor.coreApproach,
    anchor.targetBeneficiariesOrSetting,
  ]
  const expanded = relationship === 'identity_bearing'
    ? [
        ...base,
        anchor.problemOrOpportunity,
        ...anchor.nonNegotiables,
        ...anchor.distinguishingFeatures,
        ...anchor.funderFit,
      ]
    : base
  return normalizeStrings(expanded, relationship === 'identity_bearing' ? 16 : 8)
}

function contractFingerprint(value: Omit<GrantDraftContextContract, 'fingerprint'>): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)
}

function getStructuredResponseValue(section: {
  structuredResponses?: Array<{ fieldKey?: string | null; responseJson?: unknown }>
}) {
  const responses = section.structuredResponses || []
  return responses.find((response) => response.fieldKey === 'structuredData')?.responseJson
    ?? responses[0]?.responseJson
}

function buildReadiness(input: {
  workflowMode?: string | null
  citationMode?: string | null
  dimensions: string[]
  contract?: GrantSectionComplianceContract | null
  authoritativePrepBundle?: GrantPrepPromptBundle | null
  evidence: GrantDraftContextContract['evidence']
  allowEvidenceBypass?: boolean
}) {
  const issues: string[] = []
  const warnings: string[] = []
  const appDraft = String(input.workflowMode || 'app_draft') === 'app_draft'
  const requiresEvidence = requiresMappedGrantEvidence(input.citationMode)
  const hasDimensions = input.dimensions.length > 0
  const hasMappedKeys = input.evidence.allowedCitationKeys.length > 0

  if (appDraft && requiresEvidence && hasDimensions && !hasMappedKeys && !input.allowEvidenceBypass) {
    issues.push('Mapped-evidence section has literature dimensions but no mapped citation keys. Run literature mapping or explicitly draft without mapped citations.')
  }

  if (appDraft && requiresEvidence && hasDimensions && !hasMappedKeys && input.allowEvidenceBypass) {
    warnings.push('Mapped evidence was explicitly bypassed even though this section has literature dimensions.')
  }

  const prepEvidenceCount = input.contract?.prepEvidence?.length || 0
  const prepAnchorCount = input.authoritativePrepBundle?.bullets?.length || 0
  if (appDraft && prepEvidenceCount > 0 && prepAnchorCount === 0) {
    warnings.push('Grant Prep evidence exists in the compliance contract but no authoritative section prep bullets are attached.')
  }

  return { issues, warnings }
}

export function buildGrantDraftContextContract(input: {
  section: SectionContractInput
  grantContextSummary?: {
    freezeSummary?: string[] | null
    ideaAnchor?: GrantPrepIdeaAnchorV1 | null
    ideaAnchorHash?: string | null
  } | null
  evidence?: EvidenceContractInput | null
  allowEvidenceBypass?: boolean
}): GrantDraftContextContract {
  const section = input.section
  const evidenceInput = input.evidence || null
  const coverageCitationKeys = normalizeStrings(
    (evidenceInput?.coverageAssignments || []).map((item) => item?.citationKey)
  )
  const allowedCitationKeys = normalizeStrings([
    ...(evidenceInput?.allowedCitationKeys || []),
    ...coverageCitationKeys,
  ])
  const dimensionEvidence = Array.isArray(evidenceInput?.dimensionEvidence)
    ? evidenceInput!.dimensionEvidence!
    : []
  const mappedDimensionCount = dimensionEvidence.filter((entry) =>
    (entry.citations || []).some((citation) => String(citation.citationKey || '').trim())
  ).length
  const ideaAnchor = input.grantContextSummary?.ideaAnchor || null
  const ideaAnchorHash = String(
    section.ideaAnchorHash || input.grantContextSummary?.ideaAnchorHash || ''
  ).trim() || null
  const ideaAnchorRelationship = normalizeAnchorRelationship(section.ideaAnchorRelationship)

  const withoutFingerprint: Omit<GrantDraftContextContract, 'fingerprint'> = {
    version: 2,
    sectionKey: section.sectionKey,
    label: section.label || null,
    workflowMode: section.workflowMode || null,
    citationMode: section.citationMode || null,
    ideaAnchor,
    ideaAnchorHash,
    ideaAnchorRelationship,
    requiredAnchorElements: buildRequiredAnchorElements(ideaAnchor, ideaAnchorRelationship),
    allowedUnresolvedQuestions: normalizeStrings(ideaAnchor?.unresolvedQuestions || [], 12),
    scopeBoundaries: normalizeStrings(ideaAnchor?.scopeBoundaries || [], 12),
    wordBudget: typeof section.wordBudget === 'number' ? section.wordBudget : null,
    characterLimit: typeof section.characterLimit === 'number' ? section.characterLimit : null,
    fundingCallSummary: normalizeStrings([
      ...(input.grantContextSummary?.freezeSummary || []),
      ...(section.grantSectionComplianceContract?.fundingCallSummary || []),
    ], 24),
    grantRuleProfile: section.grantRuleProfile || null,
    grantSectionComplianceContract: section.grantSectionComplianceContract || null,
    authoritativePrepBundle: section.authoritativePrepBundle || null,
    relatedPrepAwareness: section.relatedPrepAwareness || null,
    mustCover: normalizeStrings(section.mustCover || [], 32),
    dimensions: normalizeStrings(section.dimensions || [], 32),
    evidence: {
      useMappedEvidence: evidenceInput?.useMappedEvidence === true,
      allowedCitationKeys,
      dimensionEvidenceCount: dimensionEvidence.length,
      mappedDimensionCount,
      coverageCitationKeys,
      gaps: normalizeStrings(evidenceInput?.gaps || [], 32),
      mustCiteKeys: normalizeStrings(evidenceInput?.evidenceDigest?.mustCiteKeys || [], 32),
      optionalCiteKeys: normalizeStrings(evidenceInput?.evidenceDigest?.optionalCiteKeys || [], 32),
    },
    readiness: { issues: [], warnings: [] },
  }

  withoutFingerprint.readiness = buildReadiness({
    workflowMode: withoutFingerprint.workflowMode,
    citationMode: withoutFingerprint.citationMode,
    dimensions: withoutFingerprint.dimensions,
    contract: withoutFingerprint.grantSectionComplianceContract,
    authoritativePrepBundle: withoutFingerprint.authoritativePrepBundle,
    evidence: withoutFingerprint.evidence,
    allowEvidenceBypass: input.allowEvidenceBypass,
  })

  return {
    ...withoutFingerprint,
    fingerprint: contractFingerprint(withoutFingerprint),
  }
}

export function buildGrantPostGenerationValidation(input: {
  contract: GrantDraftContextContract
  content: string
  trace?: GrantGenerationTrace | null
  stage: GrantComplianceReport['stage']
}): {
  grantComplianceReport: GrantComplianceReport
  reviewerReadinessReport: ReviewerReadinessReport
} {
  const grantComplianceReport = buildGrantComplianceReport({
    stage: input.stage,
    content: input.content,
    contract: input.contract.grantSectionComplianceContract,
    trace: input.trace || undefined,
    wordBudget: input.contract.wordBudget,
    characterLimit: input.contract.characterLimit,
  })
  const reviewerReadinessReport = buildReviewerReadinessReport({
    contract: input.contract.grantSectionComplianceContract,
    report: grantComplianceReport,
    content: input.content,
  })

  return { grantComplianceReport, reviewerReadinessReport }
}

export function mergeGrantValidationReport(
  existing: unknown,
  input: {
    contract?: GrantDraftContextContract | null
    grantComplianceReport?: GrantComplianceReport | null
    reviewerReadinessReport?: ReviewerReadinessReport | null
    readinessOverride?: GrantDraftContextContract['readiness'] | null
  }
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {}

  if (input.contract) {
    base.grantDraftContextContract = input.contract
    base.grantDraftContextFingerprint = input.contract.fingerprint
    base.grantDraftReadiness = input.readinessOverride || input.contract.readiness
  }
  if (input.grantComplianceReport) {
    base.grantComplianceReport = input.grantComplianceReport
  }
  if (input.reviewerReadinessReport) {
    base.reviewerReadinessReport = input.reviewerReadinessReport
  }

  return base
}

export function validateGrantFinalExportReadiness(input: {
  currentIdeaAnchorHash?: string | null
  sections: Array<{
    sectionKey: string
    label?: string | null
    sectionType?: string | null
    workflowMode?: string | null
    required?: boolean | null
    content?: string | null
    structuredResponses?: Array<{ fieldKey?: string | null; responseJson?: unknown }>
    status?: string | null
    grantComplianceReport?: GrantComplianceReport | null
    validationReport?: unknown
    isStale?: boolean | null
    sourceIdeaAnchorHash?: string | null
  }>
}): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const currentIdeaAnchorHash = String(input.currentIdeaAnchorHash || '').trim() || null
  for (const section of input.sections) {
    const paperDraftable = section.sectionType
      ? isGrantSectionAutoDraftable({
          sectionKey: section.sectionKey,
          sectionType: section.sectionType,
          workflowMode: section.workflowMode,
        })
      : section.workflowMode === 'app_draft'
    const label = section.label || section.sectionKey
    if (section.sectionType === 'budget_rows') {
      if (section.required !== false) {
        const structuredData = getStructuredResponseValue(section)
        const openQuestions = getBudgetStructuredOpenQuestions(structuredData)
        if (!budgetStructuredDataHasMeaningfulRows(structuredData)) {
          issues.push(`${label} has no prepared budget rows.`)
        }
        if (
          budgetStructuredDataHasNumericColumns(structuredData)
          && !budgetStructuredDataHasConfirmedNumericValues(structuredData)
        ) {
          issues.push(`${label} has no confirmed numeric budget amounts.`)
        }
        if (openQuestions.length > 0) {
          issues.push(`${label} has unresolved budget questions: ${openQuestions.join('; ')}`)
        }
      }
      if (section.isStale) {
        issues.push(`${label} is stale after blueprint, guideline, prep, or evidence changes.`)
      }
      addAnchorReadinessIssues(section, issues, label, currentIdeaAnchorHash)
      continue
    }
    if (!paperDraftable) continue

    const validation = section.validationReport && typeof section.validationReport === 'object' && !Array.isArray(section.validationReport)
      ? section.validationReport as Record<string, unknown>
      : {}
    const readiness = validation.grantDraftReadiness && typeof validation.grantDraftReadiness === 'object' && !Array.isArray(validation.grantDraftReadiness)
      ? validation.grantDraftReadiness as { issues?: unknown }
      : null
    const readinessIssues = normalizeStrings(readiness?.issues || [], 12)
    const content = String(section.content || '').trim()

    if (section.required !== false && !content) {
      issues.push(`${label} has no final draft content.`)
    }
    if (section.isStale) {
      issues.push(`${label} is stale after blueprint, guideline, prep, or evidence changes.`)
    }
    addAnchorReadinessIssues(section, issues, label, currentIdeaAnchorHash)
    if (readinessIssues.length > 0) {
      issues.push(`${label} is not ready: ${readinessIssues.join('; ')}`)
    }
    // Agency rules are enforced by the LLM review stage, not the deterministic
    // keyword matcher — the AI reviewer's verdict is the export gate.
    if (content) {
      const aiReview = getGrantAiReviewReportFromResponses(section.structuredResponses)
      if (!aiReview) {
        issues.push(`${label} has not been AI-reviewed against the agency rules yet.`)
      } else if (isGrantAiReviewStale(aiReview, content)) {
        issues.push(`${label} changed after its last AI review — run the review again.`)
      } else if (grantAiReviewHasBlockingFindings(aiReview)) {
        issues.push(`${label} has unresolved critical findings from the AI review.`)
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

function getValidationContract(section: { validationReport?: unknown }): Partial<GrantDraftContextContract> | null {
  const validation = section.validationReport && typeof section.validationReport === 'object' && !Array.isArray(section.validationReport)
    ? section.validationReport as Record<string, unknown>
    : {}
  const contract = validation.grantDraftContextContract
  return contract && typeof contract === 'object' && !Array.isArray(contract)
    ? contract as Partial<GrantDraftContextContract>
    : null
}

function addAnchorReadinessIssues(
  section: {
    sourceIdeaAnchorHash?: string | null
    validationReport?: unknown
  },
  issues: string[],
  label: string,
  currentIdeaAnchorHash: string | null
) {
  const validationContract = getValidationContract(section)
  const validationHash = validationContract?.ideaAnchorHash
    ? String(validationContract.ideaAnchorHash).trim()
    : null
  const expectedHash = currentIdeaAnchorHash || validationHash
  const sourceHash = String(section.sourceIdeaAnchorHash || '').trim() || validationHash
  if (expectedHash && sourceHash !== expectedHash) {
    issues.push(`${label} was prepared against a different finalized idea.`)
  }
}
