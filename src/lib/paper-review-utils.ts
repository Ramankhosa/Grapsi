import type {
  PaperReviewActionPlanItem,
  PaperReviewDimension,
  PaperReviewFixHistoryEntry,
  PaperReviewFixType,
  PaperReviewIssue,
  PaperReviewIssueStatus,
  PaperReviewMode,
  PaperReviewObjection,
  PaperReviewRecord,
  PaperReviewSectionTrace,
  PaperReviewSectionSummary,
  PaperReviewSeverity,
  PaperReviewSummary,
} from '@/types/paper-review'

const VALID_DIMENSIONS = new Set<PaperReviewDimension>([
  'section_quality',
  'cross_section_consistency',
  'claim_evidence_alignment',
  'figure_text_alignment',
  'methodology_rigor',
  'novelty_positioning',
  'citation_audit',
  'language_style',
  'publication_risk',
])

const VALID_SEVERITIES = new Set<PaperReviewSeverity>([
  'critical',
  'major',
  'moderate',
  'minor',
])

const VALID_FIX_TYPES = new Set<PaperReviewFixType>([
  'rewrite_fixable',
  'evidence_fixable',
  'manual_decision_required',
])

const VALID_STATUSES = new Set<PaperReviewIssueStatus>(['pending', 'fixed', 'ignored'])

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item || '').trim()).filter(Boolean)
}

function toSectionSummary(raw: any): PaperReviewSectionSummary | null {
  const sectionKey = String(raw?.sectionKey || '').trim()
  const sectionLabel = String(raw?.sectionLabel || raw?.sectionKey || '').trim()
  if (!sectionKey || !sectionLabel) return null

  const score = Number.isFinite(Number(raw?.score)) ? Number(raw.score) : 0
  const rawStatus = String(raw?.status || '').trim().toLowerCase()
  const status = rawStatus === 'strong' || rawStatus === 'critical' ? rawStatus : 'needs_work'

  return {
    sectionKey,
    sectionLabel,
    score: Math.max(0, Math.min(100, Math.round(score))),
    strengths: toStringArray(raw?.strengths),
    weaknesses: toStringArray(raw?.weaknesses),
    status,
  }
}

function toObjection(raw: any): PaperReviewObjection | null {
  const title = String(raw?.title || '').trim()
  const objection = String(raw?.objection || '').trim()
  if (!title || !objection) return null

  const severity = VALID_SEVERITIES.has(String(raw?.severity || '').trim().toLowerCase() as PaperReviewSeverity)
    ? (String(raw?.severity || '').trim().toLowerCase() as PaperReviewSeverity)
    : 'moderate'

  return {
    title,
    severity,
    objection,
    impact: String(raw?.impact || '').trim(),
  }
}

function toActionPlanItem(raw: any): PaperReviewActionPlanItem | null {
  const title = String(raw?.title || '').trim()
  if (!title) return null

  const priority = ['high', 'medium', 'low'].includes(String(raw?.priority || '').trim().toLowerCase())
    ? (String(raw?.priority || '').trim().toLowerCase() as 'high' | 'medium' | 'low')
    : 'medium'

  return {
    title,
    priority,
    summary: String(raw?.summary || '').trim(),
    issueIds: toStringArray(raw?.issueIds),
  }
}

function toSectionTrace(raw: any): PaperReviewSectionTrace | null {
  const sectionKey = String(raw?.sectionKey || '').trim()
  const sectionLabel = String(raw?.sectionLabel || raw?.sectionKey || '').trim()
  if (!sectionKey || !sectionLabel) return null

  return {
    sectionKey,
    sectionLabel,
    reviewerType: String(raw?.reviewerType || 'section_reviewer').trim(),
    promptVariant: String(raw?.promptVariant || raw?.reviewerType || 'generic').trim(),
    executiveSummary: String(raw?.executiveSummary || raw?.summary || '').trim(),
    score: Math.max(0, Math.min(100, Math.round(Number(raw?.score || 0)))),
    strengths: toStringArray(raw?.strengths),
    weaknesses: toStringArray(raw?.weaknesses),
    issueIds: toStringArray(raw?.issueIds),
  }
}

export function normalizePaperReviewIssue(raw: any, index = 0): PaperReviewIssue {
  const reviewDimension = VALID_DIMENSIONS.has(String(raw?.reviewDimension || '').trim() as PaperReviewDimension)
    ? (String(raw?.reviewDimension || '').trim() as PaperReviewDimension)
    : 'section_quality'

  const severity = VALID_SEVERITIES.has(String(raw?.severity || '').trim().toLowerCase() as PaperReviewSeverity)
    ? (String(raw?.severity || '').trim().toLowerCase() as PaperReviewSeverity)
    : 'moderate'

  const fixType = VALID_FIX_TYPES.has(String(raw?.fixType || '').trim().toLowerCase() as PaperReviewFixType)
    ? (String(raw?.fixType || '').trim().toLowerCase() as PaperReviewFixType)
    : 'rewrite_fixable'

  const status = VALID_STATUSES.has(String(raw?.status || '').trim().toLowerCase() as PaperReviewIssueStatus)
    ? (String(raw?.status || '').trim().toLowerCase() as PaperReviewIssueStatus)
    : 'pending'

  const sectionKey = String(raw?.sectionKey || raw?.sectionId || 'manuscript').trim()
  const sectionLabel = String(raw?.sectionLabel || raw?.sectionName || sectionKey || 'Manuscript').trim()

  return {
    id: String(raw?.id || raw?.issueId || `paper-review-issue-${index + 1}`).trim(),
    reviewDimension,
    severity,
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence ?? 0.7) || 0.7)),
    sectionKey,
    sectionLabel,
    subsectionReference: String(raw?.subsectionReference || '').trim() || undefined,
    relatedFigureIds: toStringArray(raw?.relatedFigureIds),
    relatedSections: toStringArray(raw?.relatedSections),
    title: String(raw?.title || 'Untitled issue').trim(),
    diagnosis: String(raw?.diagnosis || raw?.description || '').trim(),
    evidenceExcerpt: String(raw?.evidenceExcerpt || raw?.evidence || '').trim(),
    impactExplanation: String(raw?.impactExplanation || raw?.whyItMatters || '').trim(),
    recommendedAction: String(raw?.recommendedAction || raw?.suggestion || '').trim(),
    fixType,
    humanApprovalRequired: Boolean(raw?.humanApprovalRequired ?? true),
    reviewSourceModule: String(raw?.reviewSourceModule || raw?.sourceModule || reviewDimension).trim(),
    fixPrompt: String(raw?.fixPrompt || raw?.recommendedAction || raw?.suggestion || '').trim(),
    status,
    createdAt: String(raw?.createdAt || '').trim() || undefined,
  }
}

export function normalizePaperReviewSummary(raw: any, issues: PaperReviewIssue[]): PaperReviewSummary {
  const rawMode = String(raw?.reviewMode || '').trim().toLowerCase()
  const reviewMode: PaperReviewMode = rawMode === 'section_by_section' ? 'section_by_section' : 'quick'
  const severityCounts: Record<PaperReviewSeverity, number> = {
    critical: issues.filter(issue => issue.severity === 'critical').length,
    major: issues.filter(issue => issue.severity === 'major').length,
    moderate: issues.filter(issue => issue.severity === 'moderate').length,
    minor: issues.filter(issue => issue.severity === 'minor').length,
  }

  const pendingIssues = issues.filter(issue => issue.status === 'pending').length
  const fixedIssues = issues.filter(issue => issue.status === 'fixed').length
  const ignoredIssues = issues.filter(issue => issue.status === 'ignored').length

  const sectionSummaries = Array.isArray(raw?.sectionSummaries)
    ? raw.sectionSummaries.map(toSectionSummary).filter(Boolean) as PaperReviewSectionSummary[]
    : []
  const sectionReviewTraces = Array.isArray(raw?.sectionReviewTraces)
    ? raw.sectionReviewTraces.map(toSectionTrace).filter(Boolean) as PaperReviewSectionTrace[]
    : []

  return {
    reviewMode,
    reviewLabel: String(raw?.reviewLabel || (reviewMode === 'section_by_section' ? 'Section-by-Section Review' : 'Quick Review')).trim(),
    reportVersion: Number.isFinite(Number(raw?.reportVersion)) ? Number(raw.reportVersion) : 1,
    executiveSummary: String(raw?.executiveSummary || '').trim(),
    overallReadiness: String(raw?.overallReadiness || raw?.readinessCategory || 'requires_major_revision').trim(),
    readinessRationale: String(raw?.readinessRationale || raw?.recommendation || '').trim(),
    totalIssues: issues.length,
    pendingIssues,
    fixedIssues,
    ignoredIssues,
    severityCounts,
    rejectRiskDrivers: toStringArray(raw?.rejectRiskDrivers),
    revisionPriorities: toStringArray(raw?.revisionPriorities),
    sectionSummaries,
    sectionReviewTraces,
    reviewerObjections: Array.isArray(raw?.reviewerObjections)
      ? raw.reviewerObjections.map(toObjection).filter(Boolean) as PaperReviewObjection[]
      : [],
    actionPlan: Array.isArray(raw?.actionPlan)
      ? raw.actionPlan.map(toActionPlanItem).filter(Boolean) as PaperReviewActionPlanItem[]
      : [],
    aggregationSummary: String(raw?.aggregationSummary || '').trim() || undefined,
    generatedAt: String(raw?.generatedAt || '').trim() || undefined,
  }
}

function normalizeAppliedFixes(value: unknown): PaperReviewFixHistoryEntry[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry: any) => {
      const issueId = String(entry?.issueId || '').trim()
      const sectionKey = String(entry?.sectionKey || '').trim()
      if (!issueId || !sectionKey) return null

      const rawStatus = String(entry?.status || '').trim().toLowerCase()
      const status = rawStatus === 'ignored'
        ? 'ignored'
        : rawStatus === 'reverted'
          ? 'reverted'
          : 'fixed'

      return {
        issueId,
        sectionKey,
        status,
        beforeText: typeof entry?.beforeText === 'string' ? entry.beforeText : undefined,
        afterText: typeof entry?.afterText === 'string' ? entry.afterText : undefined,
        diffSummary: typeof entry?.diffSummary === 'string' ? entry.diffSummary : undefined,
        appliedAt: String(entry?.appliedAt || entry?.fixedAt || new Date().toISOString()),
        revertedAt: typeof entry?.revertedAt === 'string' ? entry.revertedAt : undefined,
      } satisfies PaperReviewFixHistoryEntry
    })
    .filter(Boolean) as PaperReviewFixHistoryEntry[]
}

export function normalizePaperReviewRecord(rawReview: any): PaperReviewRecord | null {
  if (!rawReview) return null

  const issues = Array.isArray(rawReview?.issues)
    ? rawReview.issues.map((issue: any, index: number) => normalizePaperReviewIssue(issue, index))
    : []

  const summary = normalizePaperReviewSummary(rawReview?.summary || {}, issues)

  return {
    reviewId: String(rawReview?.id || rawReview?.reviewId || '').trim(),
    reviewedAt: String(rawReview?.reviewedAt || rawReview?.createdAt || new Date().toISOString()),
    draftId: rawReview?.draftId || null,
    reviewMode: summary.reviewMode,
    issues,
    summary,
    appliedFixes: normalizeAppliedFixes(rawReview?.appliedFixes),
  }
}

export function getPaperReviews(session: any): PaperReviewRecord[] {
  const reviews = Array.isArray(session?.aiReviews) ? session.aiReviews : []
  return reviews
    .filter((review: any) => String(review?.jurisdiction || '').toUpperCase() === 'PAPER')
    .map(normalizePaperReviewRecord)
    .filter(Boolean) as PaperReviewRecord[]
}

export function getLatestPaperReview(session: any): PaperReviewRecord | null {
  const reviews = getPaperReviews(session)
  if (reviews.length === 0) return null

  return [...reviews]
    .sort((left, right) => {
      const leftTime = new Date(String(left?.reviewedAt || 0)).getTime()
      const rightTime = new Date(String(right?.reviewedAt || 0)).getTime()
      return rightTime - leftTime
    })[0] || null
}

export function getLatestPaperReviewByMode(
  session: any,
  reviewMode: PaperReviewMode
): PaperReviewRecord | null {
  const reviews = getPaperReviews(session)
    .filter(review => review.reviewMode === reviewMode)
    .sort((left, right) => {
      const leftTime = new Date(String(left?.reviewedAt || 0)).getTime()
      const rightTime = new Date(String(right?.reviewedAt || 0)).getTime()
      return rightTime - leftTime
    })

  return reviews[0] || null
}

export function getPaperDraftSectionMapFromSession(session: any): Record<string, string> {
  const drafts = Array.isArray(session?.annexureDrafts) ? session.annexureDrafts : []
  const paperDraft = drafts
    .filter((draft: any) => String(draft?.jurisdiction || '').toUpperCase() === 'PAPER')
    .sort((left: any, right: any) => (right?.version || 0) - (left?.version || 0))[0]

  if (!paperDraft?.extraSections) return {}
  if (typeof paperDraft.extraSections === 'string') {
    try {
      return JSON.parse(paperDraft.extraSections) as Record<string, string>
    } catch {
      return {}
    }
  }

  return typeof paperDraft.extraSections === 'object'
    ? paperDraft.extraSections as Record<string, string>
    : {}
}

export function countPendingRewriteIssues(review: PaperReviewRecord | null): number {
  if (!review) return 0
  return review.issues.filter(
    issue => issue.fixType === 'rewrite_fixable' && issue.status === 'pending'
  ).length
}

export function hasOutstandingReview(review: PaperReviewRecord | null): boolean {
  if (!review) return false
  return review.issues.some(issue => issue.status === 'pending')
}

function serializePaperReviewRecord(review: PaperReviewRecord) {
  return {
    id: review.reviewId,
    reviewId: review.reviewId,
    reviewedAt: review.reviewedAt,
    draftId: review.draftId || null,
    jurisdiction: 'PAPER',
    issues: review.issues,
    summary: review.summary,
    appliedFixes: review.appliedFixes,
  }
}

function buildUpdatedReview(
  review: PaperReviewRecord,
  issues: PaperReviewIssue[],
  appliedFixes: PaperReviewFixHistoryEntry[]
): PaperReviewRecord {
  const summary = normalizePaperReviewSummary(
    {
      ...review.summary,
      generatedAt: review.summary.generatedAt || new Date().toISOString(),
    },
    issues
  )

  return {
    ...review,
    issues,
    summary,
    appliedFixes,
  }
}

export function upsertPaperReviewIntoSession(session: any, review: PaperReviewRecord) {
  if (!session || !Array.isArray(session.aiReviews)) return session

  const serialized = serializePaperReviewRecord(review)
  let replaced = false
  const aiReviews = session.aiReviews.map((entry: any) => {
    const entryId = String(entry?.id || entry?.reviewId || '').trim()
    if (entryId !== review.reviewId) return entry
    replaced = true
    return {
      ...entry,
      ...serialized,
    }
  })

  return {
    ...session,
    aiReviews: replaced ? aiReviews : [serialized, ...aiReviews],
  }
}

export function updatePaperDraftSectionInSession(session: any, sectionKey: string, content: string) {
  if (!session || !Array.isArray(session.annexureDrafts)) return session

  let changed = false
  const annexureDrafts = session.annexureDrafts.map((draft: any) => {
    if (String(draft?.jurisdiction || '').toUpperCase() !== 'PAPER') return draft

    const rawSections = draft?.extraSections
    let sections: Record<string, string> = {}
    if (typeof rawSections === 'string') {
      try {
        sections = JSON.parse(rawSections) as Record<string, string>
      } catch {
        sections = {}
      }
    } else if (rawSections && typeof rawSections === 'object') {
      sections = rawSections as Record<string, string>
    }

    if (sections[sectionKey] === content) return draft

    changed = true
    const nextSections = {
      ...sections,
      [sectionKey]: content,
    }

    return {
      ...draft,
      extraSections: typeof rawSections === 'string'
        ? JSON.stringify(nextSections)
        : nextSections,
    }
  })

  if (!changed) return session

  return {
    ...session,
    annexureDrafts,
  }
}

export function resolvePaperReviewIssueOptimistically(
  review: PaperReviewRecord,
  issueId: string,
  resolution: Extract<PaperReviewFixHistoryEntry['status'], 'fixed' | 'ignored'>,
  appliedAt: string = new Date().toISOString()
): PaperReviewRecord {
  const issue = review.issues.find(entry => entry.id === issueId)
  if (!issue) return review

  const issues = review.issues.map(entry =>
    entry.id === issueId
      ? {
          ...entry,
          status: resolution,
        }
      : entry
  )
  const appliedFixes = [
    ...review.appliedFixes,
    {
      issueId,
      sectionKey: issue.sectionKey,
      status: resolution,
      appliedAt,
      diffSummary: resolution === 'ignored'
        ? 'Dismissed without changing manuscript text'
        : 'Marked resolved without an AI rewrite',
    },
  ]

  return buildUpdatedReview(review, issues, appliedFixes)
}

export function applyPaperReviewFixOptimistically(
  review: PaperReviewRecord,
  issueId: string,
  beforeText: string,
  afterText: string,
  appliedAt: string = new Date().toISOString()
): PaperReviewRecord {
  const issue = review.issues.find(entry => entry.id === issueId)
  if (!issue) return review

  const issues = review.issues.map(entry =>
    entry.id === issueId
      ? {
          ...entry,
          status: 'fixed' as const,
        }
      : entry
  )
  const appliedFixes = [
    ...review.appliedFixes,
    {
      issueId,
      sectionKey: issue.sectionKey,
      status: 'fixed' as const,
      beforeText,
      afterText,
      diffSummary: 'Applied AI rewrite preview to manuscript section',
      appliedAt,
    },
  ]

  return buildUpdatedReview(review, issues, appliedFixes)
}

export function revertPaperReviewFixOptimistically(
  review: PaperReviewRecord,
  issueId: string,
  revertedAt: string = new Date().toISOString()
): PaperReviewRecord {
  const issues = review.issues.map(entry =>
    entry.id === issueId
      ? {
          ...entry,
          status: 'pending' as const,
        }
      : entry
  )

  let reverted = false
  const appliedFixes = review.appliedFixes.map((entry, index) => {
    if (reverted || entry.issueId !== issueId || entry.status !== 'fixed') return entry

    const laterMatchingFixedEntry = review.appliedFixes.slice(index + 1).some(candidate =>
      candidate.issueId === issueId && candidate.status === 'fixed'
    )
    if (laterMatchingFixedEntry) return entry

    reverted = true
    return {
      ...entry,
      status: 'reverted' as const,
      revertedAt,
    }
  })

  return buildUpdatedReview(review, issues, appliedFixes)
}
