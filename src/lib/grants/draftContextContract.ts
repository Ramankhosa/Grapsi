import crypto from 'crypto'

import {
  buildGrantComplianceReport,
  buildReviewerReadinessReport,
} from '@/lib/grants/compliance'
import { requiresMappedGrantEvidence } from '@/lib/grants/citationMode'
import type {
  GrantCitationMode,
  GrantComplianceReport,
  GrantGenerationTrace,
  GrantPrepPromptBundle,
  GrantRuleProfile,
  GrantSectionComplianceContract,
  ReviewerReadinessReport,
} from '@/types/grant'

type SectionContractInput = {
  sectionKey: string
  label?: string | null
  workflowMode?: string | null
  citationMode?: GrantCitationMode | string | null
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
  version: 1
  sectionKey: string
  label: string | null
  workflowMode: string | null
  citationMode: string | null
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

function contractFingerprint(value: Omit<GrantDraftContextContract, 'fingerprint'>): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16)
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
  grantContextSummary?: { freezeSummary?: string[] | null } | null
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

  const withoutFingerprint: Omit<GrantDraftContextContract, 'fingerprint'> = {
    version: 1,
    sectionKey: section.sectionKey,
    label: section.label || null,
    workflowMode: section.workflowMode || null,
    citationMode: section.citationMode || null,
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
  sections: Array<{
    sectionKey: string
    label?: string | null
    workflowMode?: string | null
    required?: boolean | null
    content?: string | null
    status?: string | null
    grantComplianceReport?: GrantComplianceReport | null
    validationReport?: unknown
    isStale?: boolean | null
  }>
}): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  for (const section of input.sections) {
    if (section.workflowMode !== 'app_draft') continue
    const label = section.label || section.sectionKey
    const validation = section.validationReport && typeof section.validationReport === 'object' && !Array.isArray(section.validationReport)
      ? section.validationReport as Record<string, unknown>
      : {}
    const report = section.grantComplianceReport
      || (validation.grantComplianceReport && typeof validation.grantComplianceReport === 'object'
        ? validation.grantComplianceReport as GrantComplianceReport
        : null)
    const readiness = validation.grantDraftReadiness && typeof validation.grantDraftReadiness === 'object' && !Array.isArray(validation.grantDraftReadiness)
      ? validation.grantDraftReadiness as { issues?: unknown }
      : null
    const readinessIssues = normalizeStrings(readiness?.issues || [], 12)

    if (section.required !== false && !String(section.content || '').trim()) {
      issues.push(`${label} has no final draft content.`)
    }
    if (section.isStale) {
      issues.push(`${label} is stale after blueprint, guideline, prep, or evidence changes.`)
    }
    if (readinessIssues.length > 0) {
      issues.push(`${label} is not ready: ${readinessIssues.join('; ')}`)
    }
    if (!report) {
      issues.push(`${label} has not been validated against grant rules and Grant Prep evidence.`)
    } else if (!report.passed) {
      issues.push(`${label} still has grant compliance failures.`)
    }
  }

  return { ok: issues.length === 0, issues }
}
