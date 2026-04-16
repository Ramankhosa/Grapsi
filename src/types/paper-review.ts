export type PaperReviewSeverity = 'critical' | 'major' | 'moderate' | 'minor'

export type PaperReviewFixType =
  | 'rewrite_fixable'
  | 'evidence_fixable'
  | 'manual_decision_required'

export type PaperReviewIssueStatus = 'pending' | 'fixed' | 'ignored'

export type PaperReviewMode = 'quick' | 'section_by_section'

export type PaperReviewDimension =
  | 'section_quality'
  | 'cross_section_consistency'
  | 'claim_evidence_alignment'
  | 'figure_text_alignment'
  | 'methodology_rigor'
  | 'novelty_positioning'
  | 'citation_audit'
  | 'language_style'
  | 'publication_risk'

export interface PaperReviewIssue {
  id: string
  reviewDimension: PaperReviewDimension
  severity: PaperReviewSeverity
  confidence: number
  sectionKey: string
  sectionLabel: string
  subsectionReference?: string
  relatedFigureIds: string[]
  relatedSections: string[]
  title: string
  diagnosis: string
  evidenceExcerpt: string
  impactExplanation: string
  recommendedAction: string
  fixType: PaperReviewFixType
  humanApprovalRequired: boolean
  reviewSourceModule: string
  fixPrompt: string
  status: PaperReviewIssueStatus
  createdAt?: string
}

export interface PaperReviewSectionSummary {
  sectionKey: string
  sectionLabel: string
  score: number
  strengths: string[]
  weaknesses: string[]
  status: 'strong' | 'needs_work' | 'critical'
}

export interface PaperReviewSectionTrace {
  sectionKey: string
  sectionLabel: string
  reviewerType: string
  promptVariant: string
  executiveSummary: string
  score: number
  strengths: string[]
  weaknesses: string[]
  issueIds: string[]
}

export interface PaperReviewObjection {
  title: string
  severity: PaperReviewSeverity
  objection: string
  impact: string
}

export interface PaperReviewActionPlanItem {
  title: string
  priority: 'high' | 'medium' | 'low'
  summary: string
  issueIds: string[]
}

export interface PaperReviewSummary {
  reviewMode: PaperReviewMode
  reviewLabel: string
  reportVersion: number
  executiveSummary: string
  overallReadiness: string
  readinessRationale: string
  totalIssues: number
  pendingIssues: number
  fixedIssues: number
  ignoredIssues: number
  severityCounts: Record<PaperReviewSeverity, number>
  rejectRiskDrivers: string[]
  revisionPriorities: string[]
  sectionSummaries: PaperReviewSectionSummary[]
  sectionReviewTraces: PaperReviewSectionTrace[]
  reviewerObjections: PaperReviewObjection[]
  actionPlan: PaperReviewActionPlanItem[]
  aggregationSummary?: string
  generatedAt?: string
}

export interface PaperReviewFixHistoryEntry {
  issueId: string
  sectionKey: string
  status: 'fixed' | 'ignored' | 'reverted'
  beforeText?: string
  afterText?: string
  diffSummary?: string
  appliedAt: string
  revertedAt?: string
}

export interface PaperReviewRecord {
  reviewId: string
  reviewedAt: string
  draftId?: string | null
  reviewMode: PaperReviewMode
  issues: PaperReviewIssue[]
  summary: PaperReviewSummary
  appliedFixes: PaperReviewFixHistoryEntry[]
}
