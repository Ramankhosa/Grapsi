import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import type { GrantComplianceReport, ReviewerReadinessReport } from '@/types/grant'

/**
 * Draft One: client-side orchestration logic over the EXISTING drafting
 * engine. No new generation code — these helpers normalize the sections GET
 * payload, order the drafting queue, derive per-section compliance status,
 * and compose the repair instructions fed back to the engine when a section
 * fails its agency-rule validation.
 */

export type DraftOneSectionStatus =
  | 'manual' // team_manual / app_support — not AI-drafted here
  | 'pending' // draftable, no content yet
  | 'unvalidated' // has content but no compliance report yet
  | 'issues' // compliance report failed
  | 'passed' // compliance report passed
  | 'stale' // blueprint/prep changed after drafting

export type DraftOneRunState = 'queued' | 'writing' | 'checking' | 'repairing' | 'done' | 'failed'

export interface DraftOneSection {
  sectionKey: string
  label: string
  sectionOrder: number
  sectionType: string
  workflowMode: string
  citationMode: string | null
  required: boolean
  wordBudget: number | null
  characterLimit: number | null
  content: string
  isStale: boolean
  autoDraftable: boolean
  status: DraftOneSectionStatus
  compliance: GrantComplianceReport | null
  readiness: ReviewerReadinessReport | null
  ruleProfile: {
    requiredPoints: string[]
    evaluationFocus: string[]
    reviewerSignals: string[]
    avoidRules: string[]
    formatConstraints: string[]
  } | null
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function countWords(text: string): number {
  const trimmed = String(text || '').trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Normalize one entry of GET .../sections into the Draft One view model. */
export function normalizeDraftOneSection(raw: Record<string, unknown>): DraftOneSection {
  const sectionKey = String(raw.sectionKey || '')
  const sectionType = String(raw.sectionType || 'narrative')
  const workflowMode = String(raw.workflowMode || 'team_manual')
  const content = typeof raw.content === 'string' ? raw.content : ''
  const isStale = Boolean(raw.isStale)
  const compliance = (raw.grantComplianceReport as GrantComplianceReport | null | undefined) || null
  const readiness = (raw.reviewerReadinessReport as ReviewerReadinessReport | null | undefined) || null
  const autoDraftable = isGrantSectionAutoDraftable({ sectionKey, sectionType, workflowMode })

  let status: DraftOneSectionStatus
  if (!autoDraftable) status = 'manual'
  else if (isStale) status = 'stale'
  else if (!content.trim()) status = 'pending'
  else if (!compliance) status = 'unvalidated'
  else status = compliance.passed ? 'passed' : 'issues'

  const profile = raw.grantRuleProfile as Record<string, unknown> | null | undefined
  return {
    sectionKey,
    label: String(raw.label || sectionKey),
    sectionOrder: Number(raw.sectionOrder ?? 0),
    sectionType,
    workflowMode,
    citationMode: typeof raw.citationMode === 'string' ? raw.citationMode : null,
    required: Boolean(raw.required),
    wordBudget: Number.isFinite(Number(raw.wordBudget)) && Number(raw.wordBudget) > 0 ? Number(raw.wordBudget) : null,
    characterLimit:
      Number.isFinite(Number(raw.characterLimit)) && Number(raw.characterLimit) > 0 ? Number(raw.characterLimit) : null,
    content,
    isStale,
    autoDraftable,
    status,
    compliance,
    readiness,
    ruleProfile: profile
      ? {
          requiredPoints: asStringArray(profile.requiredPoints),
          evaluationFocus: asStringArray(profile.evaluationFocus),
          reviewerSignals: asStringArray(profile.reviewerSignals),
          avoidRules: asStringArray(profile.avoidRules),
          formatConstraints: asStringArray(profile.formatConstraints),
        }
      : null,
  }
}

/** Sections the Run drafts, in agency template order. */
export function buildDraftOneQueue(sections: DraftOneSection[], options?: { includeDrafted?: boolean }): DraftOneSection[] {
  return sections
    .filter((section) => section.autoDraftable)
    .filter((section) => (options?.includeDrafted ? true : !section.content.trim() || section.isStale))
    .sort((a, b) => a.sectionOrder - b.sectionOrder)
}

/**
 * Compose the repair instructions (papers engine `instructions` field, max
 * 5000 chars) from a failed compliance report — the closed loop the engine
 * itself never runs.
 */
export function buildRepairInstructions(input: {
  section: Pick<DraftOneSection, 'label' | 'wordBudget' | 'characterLimit' | 'content'>
  compliance: GrantComplianceReport
  readiness?: ReviewerReadinessReport | null
  userNote?: string | null
}): string {
  const { compliance, readiness, section } = input
  const lines: string[] = [
    'REPAIR PASS — the previous draft of this section FAILED the agency compliance check.',
    'Rewrite the section fixing EVERY issue below while preserving all accurate facts and any [CITE:key] anchors.',
  ]
  if (compliance.unmetRequiredPoints.length) {
    lines.push(
      'REQUIRED POINTS THE DRAFT FAILED TO COVER (each must be explicitly and substantively addressed):',
      ...compliance.unmetRequiredPoints.slice(0, 10).map((point) => `- ${point}`)
    )
  }
  if (compliance.violatedAvoidRules.length) {
    lines.push(
      'AVOID-RULE VIOLATIONS (remove or rewrite the offending content):',
      ...compliance.violatedAvoidRules.slice(0, 6).map((rule) => `- ${rule}`)
    )
  }
  if (compliance.hardFailures.length) {
    lines.push(
      'HARD FAILURES:',
      ...compliance.hardFailures.slice(0, 8).map((finding) => `- ${finding.message}${finding.ruleText ? ` (rule: ${finding.ruleText})` : ''}`)
    )
  }
  const words = countWords(section.content)
  if (section.wordBudget && words > section.wordBudget) {
    lines.push(
      `WORD BUDGET: the draft is ${words} words; the agency limit is ${section.wordBudget}. Cut at least ${words - section.wordBudget} words without dropping required points.`
    )
  }
  if (section.characterLimit && section.content.length > section.characterLimit) {
    lines.push(`CHARACTER LIMIT: stay under ${section.characterLimit} characters.`)
  }
  if (readiness?.recommendedActions?.length) {
    lines.push('REVIEWER RECOMMENDATIONS:', ...readiness.recommendedActions.slice(0, 5).map((action) => `- ${action}`))
  }
  if (input.userNote?.trim()) {
    lines.push('AUTHOR NOTE (must be honored):', input.userNote.trim())
  }
  return lines.join('\n').slice(0, 4900)
}

/** True when a failed report is worth an automatic repair generation. */
export function shouldAutoRepair(compliance: GrantComplianceReport | null): boolean {
  if (!compliance || compliance.passed) return false
  return (
    compliance.unmetRequiredPoints.length > 0
    || compliance.violatedAvoidRules.length > 0
    || compliance.hardFailures.length > 0
  )
}

export interface DraftOneReadinessSummary {
  total: number
  draftable: number
  drafted: number
  passed: number
  withIssues: number
  unvalidated: number
  stale: number
  manual: number
}

export function summarizeDraftOneSections(sections: DraftOneSection[]): DraftOneReadinessSummary {
  const draftable = sections.filter((section) => section.autoDraftable)
  return {
    total: sections.length,
    draftable: draftable.length,
    drafted: draftable.filter((section) => section.content.trim()).length,
    passed: draftable.filter((section) => section.status === 'passed').length,
    withIssues: draftable.filter((section) => section.status === 'issues').length,
    unvalidated: draftable.filter((section) => section.status === 'unvalidated').length,
    stale: draftable.filter((section) => section.status === 'stale').length,
    manual: sections.filter((section) => !section.autoDraftable).length,
  }
}
