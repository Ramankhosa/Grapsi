import { isGrantSectionAutoDraftable } from '@/lib/grants/workflowMode'
import { sanitizeGrantRuleText, summarizeGrantRuleText } from '@/lib/grants/ruleText'
import type { GrantAiReviewReport } from '@/types/grant'

/**
 * Draft One: client-side orchestration logic over the EXISTING drafting
 * engine. Drafting is never blocked by deterministic rule checks — agency
 * rules are enforced by the LLM review stage. These helpers normalize the
 * sections GET payload, order the drafting/review queues, derive per-section
 * status from the AI review verdict, and compose the fix instructions fed
 * back to the engine when the reviewer flags issues.
 */

export type DraftOneSectionStatus =
  | 'manual' // team_manual / app_support — not AI-drafted here
  | 'pending' // draftable, no content yet
  | 'unreviewed' // has content but no (current) AI review verdict
  | 'issues' // AI reviewer flagged revisions
  | 'ready' // AI reviewer verdict: ready
  | 'stale' // blueprint/prep changed after drafting

export type DraftOneRunState =
  | 'queued'
  | 'writing'
  | 'reviewing'
  | 'fixing'
  | 'done'
  | 'failed'

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
  aiReview: GrantAiReviewReport | null
  /** True when content changed after the last AI review (computed server-side). */
  aiReviewStale: boolean
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

function asCleanRuleArray(value: unknown): string[] {
  return asStringArray(value).map((entry) => sanitizeGrantRuleText(entry)).filter(Boolean)
}

function asAiReviewReport(value: unknown): GrantAiReviewReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<GrantAiReviewReport>
  return typeof record.verdict === 'string' && Array.isArray(record.findings)
    ? (record as GrantAiReviewReport)
    : null
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
  const aiReview = asAiReviewReport(raw.grantAiReviewReport)
  const aiReviewStale = Boolean(raw.grantAiReviewStale)
  const autoDraftable = isGrantSectionAutoDraftable({ sectionKey, sectionType, workflowMode })

  let status: DraftOneSectionStatus
  if (!autoDraftable) status = 'manual'
  else if (isStale) status = 'stale'
  else if (!content.trim()) status = 'pending'
  else if (!aiReview || aiReviewStale) status = 'unreviewed'
  else status = aiReview.verdict === 'ready' ? 'ready' : 'issues'

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
    aiReview,
    aiReviewStale,
    ruleProfile: profile
      ? {
          requiredPoints: asCleanRuleArray(profile.requiredPoints),
          evaluationFocus: asCleanRuleArray(profile.evaluationFocus),
          reviewerSignals: asCleanRuleArray(profile.reviewerSignals),
          avoidRules: asCleanRuleArray(profile.avoidRules),
          formatConstraints: asCleanRuleArray(profile.formatConstraints),
        }
      : null,
  }
}

/** Sections the writing run drafts, in agency template order. */
export function buildDraftOneQueue(sections: DraftOneSection[], options?: { includeDrafted?: boolean }): DraftOneSection[] {
  return sections
    .filter((section) => section.autoDraftable)
    .filter((section) => (options?.includeDrafted ? true : !section.content.trim() || section.isStale))
    .sort((a, b) => a.sectionOrder - b.sectionOrder)
}

/** Sections the AI review run covers: drafted, but without a current verdict. */
export function buildAiReviewQueue(sections: DraftOneSection[], options?: { includeReviewed?: boolean }): DraftOneSection[] {
  return sections
    .filter((section) => section.autoDraftable && section.content.trim() && !section.isStale)
    .filter((section) => (options?.includeReviewed ? true : !section.aiReview || section.aiReviewStale))
    .sort((a, b) => a.sectionOrder - b.sectionOrder)
}

/**
 * Compose the revision instructions (papers engine `instructions` field, max
 * 5000 chars) from the AI reviewer's findings — the LLM-driven repair loop
 * that replaced the deterministic keyword one.
 */
export interface ReviewerRemarkForFix {
  priority?: 'high' | 'medium' | 'low'
  issue?: string
  recommendation?: string
  suggestedRemark?: string
  reviewerSectionTitle?: string
}

export function buildAiFixInstructions(input: {
  section: Pick<DraftOneSection, 'label' | 'wordBudget' | 'characterLimit' | 'content'>
  report?: GrantAiReviewReport | null
  /**
   * Remarks from the standalone grant reviewer, mapped onto this grant section
   * by `ReviewerSectionGrantLink`. They are a second, independent source of
   * findings — the reviewer scores against the funder's published criteria,
   * where the drafting review checks the section against its own brief — so
   * both are passed through when both exist.
   */
  reviewerRecommendations?: ReviewerRemarkForFix[] | null
  userNote?: string | null
}): string {
  const { report, section } = input
  const reviewerRemarks = (input.reviewerRecommendations || []).filter(
    (remark) => String(remark?.recommendation || remark?.suggestedRemark || remark?.issue || '').trim()
  )

  if (!report && reviewerRemarks.length === 0) return ''

  const bySeverity = (severity: string) =>
    (report?.findings || []).filter((finding) => finding.severity === severity)
  const lines: string[] = [
    'REVISION PASS — the previous draft of this section was assessed.',
    'Rewrite the section resolving EVERY point below while preserving all accurate facts, valid markdown tables, and any [CITE:key] anchors.',
  ]
  if (report?.summary) {
    lines.push(`Reviewer summary: ${report.summary}`)
  }
  const addFindings = (title: string, severity: string) => {
    const findings = bySeverity(severity)
    if (!findings.length) return
    lines.push(
      title,
      ...findings.slice(0, 8).map((finding) => {
        const rule = finding.rule ? ` [rule: ${summarizeGrantRuleText(finding.rule, 140) || finding.rule}]` : ''
        return `- ${finding.issue}${rule} → FIX: ${finding.fix}`
      })
    )
  }
  addFindings('CRITICAL FINDINGS (must be fully resolved):', 'critical')
  addFindings('IMPORTANT FINDINGS (resolve unless factually impossible):', 'important')
  addFindings('POLISH (apply where it does not conflict with the above):', 'polish')

  if (reviewerRemarks.length > 0) {
    const rank = { high: 0, medium: 1, low: 2 }
    const ordered = [...reviewerRemarks].sort(
      (a, b) => (rank[a.priority || 'medium'] ?? 1) - (rank[b.priority || 'medium'] ?? 1)
    )
    lines.push(
      'GRANT REVIEWER REMARKS (scored against the funding call\'s own criteria — treat high priority as mandatory):',
      ...ordered.slice(0, 10).map((remark) => {
        const priority = (remark.priority || 'medium').toUpperCase()
        const issue = String(remark.issue || '').trim()
        const fix = String(remark.recommendation || remark.suggestedRemark || '').trim()
        const source = remark.reviewerSectionTitle ? ` [from: ${remark.reviewerSectionTitle}]` : ''
        return issue && fix && issue !== fix
          ? `- (${priority}) ${issue}${source} → FIX: ${fix}`
          : `- (${priority}) ${fix || issue}${source}`
      })
    )
  }

  const words = countWords(section.content)
  if (section.wordBudget && words > section.wordBudget) {
    lines.push(
      `WORD BUDGET: the draft is ${words} words; the agency limit is ${section.wordBudget}. Cut at least ${words - section.wordBudget} words without dropping required content.`
    )
  }
  if (section.characterLimit && section.content.length > section.characterLimit) {
    lines.push(`CHARACTER LIMIT: stay under ${section.characterLimit} characters.`)
  }
  if (input.userNote?.trim()) {
    lines.push('AUTHOR NOTE (must be honored):', input.userNote.trim())
  }
  return lines.join('\n').slice(0, 4900)
}

export interface DraftOneReadinessSummary {
  total: number
  draftable: number
  drafted: number
  ready: number
  withIssues: number
  unreviewed: number
  stale: number
  manual: number
}

export function summarizeDraftOneSections(sections: DraftOneSection[]): DraftOneReadinessSummary {
  const draftable = sections.filter((section) => section.autoDraftable)
  return {
    total: sections.length,
    draftable: draftable.length,
    drafted: draftable.filter((section) => section.content.trim()).length,
    ready: draftable.filter((section) => section.status === 'ready').length,
    withIssues: draftable.filter((section) => section.status === 'issues').length,
    unreviewed: draftable.filter((section) => section.status === 'unreviewed').length,
    stale: draftable.filter((section) => section.status === 'stale').length,
    manual: sections.filter((section) => !section.autoDraftable).length,
  }
}
