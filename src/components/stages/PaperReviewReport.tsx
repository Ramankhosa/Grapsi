'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react'
import InlineTextDiff from '@/components/paper/InlineTextDiff'
import {
  formatPaperReviewDateTime,
  formatPaperReviewDimension,
  getPaperReviewFixTypeMeta,
  getPaperReviewReadinessMeta,
  getPaperReviewScoreMeta,
  getPaperReviewSeverityMeta,
} from '@/lib/paper-review-ui'
import type {
  PaperReviewFixHistoryEntry,
  PaperReviewIssue,
  PaperReviewIssueStatus,
  PaperReviewRecord,
  PaperReviewSectionSummary,
  PaperReviewSectionTrace,
} from '@/types/paper-review'

export type PaperReviewFixPreview = {
  issueId: string
  reviewId: string
  sectionKey: string
  sectionLabel: string
  title: string
  originalContent: string
  fixedContent: string
}

type PaperReviewReportProps = {
  review: PaperReviewRecord
  sectionContentByKey?: Record<string, string>
  onSectionSelect?: (sectionKey: string) => void
  onOpenImprove?: () => void
  onOpenExport?: () => void
  interactive?: boolean
  preview?: PaperReviewFixPreview | null
  previewingIssueId?: string | null
  applyingIssueId?: string | null
  resolvingIssueId?: string | null
  revertingIssueId?: string | null
  onPreviewFix?: (issue: PaperReviewIssue) => void
  onApplyPreview?: () => void
  onClosePreview?: () => void
  onResolveIssue?: (issue: PaperReviewIssue, resolution: 'fixed' | 'ignored') => void
  onRevertFix?: (issue: PaperReviewIssue) => void
}

type ReportSection = {
  key: string
  label: string
  anchorId: string
  order: number
  content: string
  score: number | null
  strengths: string[]
  weaknesses: string[]
  summary: string
  issues: PaperReviewIssue[]
}

const SEVERITY_RANK: Record<PaperReviewIssue['severity'], number> = {
  critical: 0,
  major: 1,
  moderate: 2,
  minor: 3,
}

function toAnchorId(sectionKey: string) {
  const slug = sectionKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `paper-review-section-${slug || 'section'}`
}

function titleFromKey(sectionKey: string) {
  return sectionKey
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getOverallScore(review: PaperReviewRecord) {
  if (review.summary.sectionSummaries.length === 0) return null

  const total = review.summary.sectionSummaries.reduce((sum, section) => sum + section.score, 0)
  return Math.round(total / review.summary.sectionSummaries.length)
}

function getSectionSummaryByKey(review: PaperReviewRecord) {
  return new Map(review.summary.sectionSummaries.map(section => [section.sectionKey, section]))
}

function getSectionTraceByKey(review: PaperReviewRecord) {
  return new Map(review.summary.sectionReviewTraces.map(section => [section.sectionKey, section]))
}

function getLatestAppliedFix(
  appliedFixes: PaperReviewFixHistoryEntry[],
  issueId: string
): PaperReviewFixHistoryEntry | null {
  const match = [...appliedFixes]
    .reverse()
    .find(entry => entry.issueId === issueId && entry.status === 'fixed')

  return match || null
}

function getSectionNarrative(
  sectionSummary: PaperReviewSectionSummary | undefined,
  sectionTrace: PaperReviewSectionTrace | undefined,
  issues: PaperReviewIssue[]
) {
  if (sectionTrace?.executiveSummary) return sectionTrace.executiveSummary
  if (sectionSummary?.weaknesses.length) return sectionSummary.weaknesses[0]
  if (issues[0]?.diagnosis) return issues[0].diagnosis
  return 'This section has been included in the current review report.'
}

function buildSections(
  review: PaperReviewRecord,
  sectionContentByKey: Record<string, string>
): ReportSection[] {
  const sectionSummaryByKey = getSectionSummaryByKey(review)
  const sectionTraceByKey = getSectionTraceByKey(review)
  const issueGroups = review.issues.reduce<Record<string, PaperReviewIssue[]>>((acc, issue) => {
    if (!acc[issue.sectionKey]) acc[issue.sectionKey] = []
    acc[issue.sectionKey].push(issue)
    return acc
  }, {})

  const orderedKeys = [
    ...Object.keys(sectionContentByKey),
    ...review.summary.sectionSummaries.map(section => section.sectionKey),
    ...review.summary.sectionReviewTraces.map(section => section.sectionKey),
    ...review.issues.map(issue => issue.sectionKey),
  ]

  const seen = new Set<string>()
  let order = 0

  return orderedKeys
    .filter(sectionKey => {
      if (!sectionKey || seen.has(sectionKey)) return false
      seen.add(sectionKey)
      return true
    })
    .map(sectionKey => {
      const sectionSummary = sectionSummaryByKey.get(sectionKey)
      const sectionTrace = sectionTraceByKey.get(sectionKey)
      const issues = [...(issueGroups[sectionKey] || [])].sort((left, right) => {
        return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      })
      const label = sectionSummary?.sectionLabel
        || sectionTrace?.sectionLabel
        || issues[0]?.sectionLabel
        || titleFromKey(sectionKey)

      return {
        key: sectionKey,
        label,
        anchorId: toAnchorId(sectionKey),
        order: order++,
        content: String(sectionContentByKey[sectionKey] || ''),
        score: typeof sectionSummary?.score === 'number' ? sectionSummary.score : null,
        strengths: sectionSummary?.strengths || sectionTrace?.strengths || [],
        weaknesses: sectionSummary?.weaknesses || sectionTrace?.weaknesses || [],
        summary: getSectionNarrative(sectionSummary, sectionTrace, issues),
        issues,
      } satisfies ReportSection
    })
    .filter(section => section.content || section.issues.length > 0 || section.score !== null)
}

function statusTone(status: PaperReviewIssueStatus) {
  if (status === 'fixed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'ignored') return 'border-slate-200 bg-slate-100 text-slate-600'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function strengthCount(sections: ReportSection[]) {
  return sections.reduce((sum, section) => sum + section.strengths.length, 0)
}

function weaknessCount(sections: ReportSection[]) {
  return sections.reduce((sum, section) => sum + section.weaknesses.length, 0)
}

export default function PaperReviewReport({
  review,
  sectionContentByKey = {},
  onSectionSelect,
  onOpenImprove,
  onOpenExport,
  interactive = false,
  preview = null,
  previewingIssueId = null,
  applyingIssueId = null,
  resolvingIssueId = null,
  revertingIssueId = null,
  onPreviewFix,
  onApplyPreview,
  onClosePreview,
  onResolveIssue,
  onRevertFix,
}: PaperReviewReportProps) {
  const [focusedSectionKey, setFocusedSectionKey] = useState<string | null>(null)
  const [expandedDiffIssueId, setExpandedDiffIssueId] = useState<string | null>(null)

  const sections = useMemo(
    () => buildSections(review, sectionContentByKey),
    [review, sectionContentByKey]
  )
  const overallScore = useMemo(() => getOverallScore(review), [review])
  const readinessMeta = useMemo(
    () => getPaperReviewReadinessMeta(review.summary.overallReadiness || ''),
    [review.summary.overallReadiness]
  )
  const visibleSections = focusedSectionKey
    ? sections.filter(section => section.key === focusedSectionKey)
    : sections

  useEffect(() => {
    if (!preview?.sectionKey) return
    setFocusedSectionKey(preview.sectionKey)
  }, [preview?.issueId, preview?.sectionKey])

  useEffect(() => {
    if (!preview?.issueId) return
    setExpandedDiffIssueId(preview.issueId)
  }, [preview?.issueId])

  const focusSection = (sectionKey: string) => {
    setFocusedSectionKey(sectionKey)
    window.requestAnimationFrame(() => {
      document.getElementById(toAnchorId(sectionKey))?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-[linear-gradient(135deg,#1d4ed8_0%,#2563eb_48%,#1e3a8a_100%)] px-6 py-3 text-sm font-semibold text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Overall Assessment</span>
            <span className="text-xs font-medium text-blue-100">
              Reviewed {formatPaperReviewDateTime(review.reviewedAt)}
            </span>
          </div>
        </div>
        <div className="grid gap-6 p-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex flex-wrap items-end gap-4">
              {overallScore !== null && (
                <div>
                  <div className="text-4xl font-semibold tracking-tight text-slate-950">
                    {overallScore}%
                  </div>
                  <div className="mt-1 text-sm text-slate-500">Average section score</div>
                </div>
              )}
              <div className={`rounded-full border px-3 py-1 text-sm font-semibold ${readinessMeta.tone}`}>
                {readinessMeta.label}
              </div>
            </div>
            <div className="mt-5">
              <div className="text-sm font-semibold text-slate-900">Executive Summary</div>
              <p className="mt-2 text-sm leading-7 text-slate-700">
                {review.summary.executiveSummary || review.summary.readinessRationale || 'No executive summary was returned.'}
              </p>
            </div>
            {review.summary.rejectRiskDrivers.length > 0 && (
              <div className="mt-5 rounded-[24px] border border-rose-200 bg-rose-50 p-4">
                <div className="text-sm font-semibold text-rose-800">Top reject-risk drivers</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {review.summary.rejectRiskDrivers.map(driver => (
                    <span
                      key={driver}
                      className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700"
                    >
                      {driver}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <div className="rounded-[24px] bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sections</div>
                <div className="mt-3 text-3xl font-semibold text-slate-950">{sections.length}</div>
              </div>
              <div className="rounded-[24px] bg-emerald-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Strengths</div>
                <div className="mt-3 text-3xl font-semibold text-emerald-900">{strengthCount(sections)}</div>
              </div>
              <div className="rounded-[24px] bg-rose-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Weaknesses</div>
                <div className="mt-3 text-3xl font-semibold text-rose-900">{weaknessCount(sections)}</div>
              </div>
              <div className="rounded-[24px] bg-amber-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Recommendations</div>
                <div className="mt-3 text-3xl font-semibold text-amber-900">
                  {review.issues.filter(issue => issue.status === 'pending').length}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Review flow
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Use the table of contents below to read the whole report or focus on one section at a time.
                In Improve, each recommendation can run a section rewrite preview and show the before/after diff inline.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {onOpenImprove && review.summary.pendingIssues > 0 && !interactive && (
                  <button
                    type="button"
                    onClick={onOpenImprove}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Open Improve
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
                {onOpenExport && review.summary.pendingIssues === 0 && (
                  <button
                    type="button"
                    onClick={onOpenExport}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  >
                    Open Export
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Table Of Contents
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
              Section-wise review and recommendations
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFocusedSectionKey(null)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                focusedSectionKey === null
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              Whole report
            </button>
            {focusedSectionKey !== null && (
              <button
                type="button"
                onClick={() => setFocusedSectionKey(null)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
              >
                Back to all sections
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">Jump to section</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {sections.map((section, index) => {
                const scoreMeta = section.score !== null ? getPaperReviewScoreMeta(section.score) : null
                return (
                  <a
                    key={section.key}
                    href={`#${section.anchorId}`}
                    onClick={event => {
                      event.preventDefault()
                      focusSection(section.key)
                    }}
                    className={`rounded-2xl border px-4 py-3 text-sm transition ${
                      focusedSectionKey === section.key
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="font-semibold">
                      {index + 1}. {section.label}
                    </div>
                    <div className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${
                      focusedSectionKey === section.key ? 'text-slate-200' : 'text-slate-500'
                    }`}>
                      {scoreMeta && <span className={focusedSectionKey === section.key ? 'text-slate-200' : scoreMeta.tone}>{section.score}/100</span>}
                      <span>{section.issues.length} recommendation{section.issues.length === 1 ? '' : 's'}</span>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Cross-sectional recommendations</div>
            <div className="mt-3 space-y-3">
              {review.summary.actionPlan.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No action-plan summary was returned for this report.
                </div>
              )}
              {review.summary.actionPlan.slice(0, 5).map(item => (
                <div key={`${item.priority}-${item.title}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                      {item.priority}
                    </span>
                  </div>
                  {item.summary && (
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.summary}</p>
                  )}
                </div>
              ))}
              {review.summary.aggregationSummary && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
                  {review.summary.aggregationSummary}
                </div>
              )}
              {review.summary.reviewerObjections.slice(0, 3).map(objection => {
                const objectionMeta = getPaperReviewSeverityMeta(objection.severity)
                return (
                  <div key={`${objection.severity}-${objection.title}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${objectionMeta.tone}`}>
                        {objectionMeta.label}
                      </span>
                      <div className="text-sm font-semibold text-slate-900">{objection.title}</div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{objection.objection}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {visibleSections.map(section => {
        const fixedIssues = section.issues.filter(issue => issue.status === 'fixed').length
        const pendingIssues = section.issues.filter(issue => issue.status === 'pending').length
        const scoreMeta = section.score !== null ? getPaperReviewScoreMeta(section.score) : null
        const isFocused = focusedSectionKey === section.key

        return (
          <section
            id={section.anchorId}
            key={section.key}
            className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm"
          >
            <div className="bg-[linear-gradient(135deg,#0f172a_0%,#334155_100%)] px-6 py-4 text-white">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Section {section.order + 1}
                  </div>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight">{section.label}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {scoreMeta && (
                    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-white">
                      Score: {section.score}/100
                    </span>
                  )}
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-white">
                    Pending: {pendingIssues}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-white">
                    Fixed: {fixedIssues}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-6 p-6">
              <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-[24px] border border-emerald-300 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">Section Content</div>
                    <div className="flex flex-wrap gap-2">
                      {onSectionSelect && (
                        <button
                          type="button"
                          onClick={() => onSectionSelect(section.key)}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                        >
                          Open in editor
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!isFocused && (
                        <button
                          type="button"
                          onClick={() => focusSection(section.key)}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:border-emerald-300"
                        >
                          Focus section
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 ${isFocused ? '' : 'max-h-52 overflow-hidden'}`}>
                    {section.content || 'No saved section content is available for this section yet.'}
                  </div>
                  {!isFocused && section.content.length > 900 && (
                    <button
                      type="button"
                      onClick={() => focusSection(section.key)}
                      className="mt-3 text-sm font-medium text-emerald-700 hover:text-emerald-800"
                    >
                      Show full section content
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-semibold text-slate-900">Summary</div>
                    <p className="mt-2 text-sm leading-7 text-slate-700">{section.summary}</p>
                  </div>

                  <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-sm font-semibold text-emerald-900">Strengths</div>
                    <div className="mt-3 space-y-2">
                      {section.strengths.length === 0 && (
                        <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm text-emerald-800">
                          No explicit strengths were returned for this section.
                        </div>
                      )}
                      {section.strengths.map(strength => (
                        <div key={strength} className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm leading-6 text-emerald-900">
                          {strength}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-4">
                    <div className="text-sm font-semibold text-rose-900">Weaknesses</div>
                    <div className="mt-3 space-y-2">
                      {section.weaknesses.length === 0 && (
                        <div className="rounded-2xl border border-rose-100 bg-white px-4 py-3 text-sm text-rose-800">
                          No explicit weakness summary was returned for this section.
                        </div>
                      )}
                      {section.weaknesses.map(weakness => (
                        <div key={weakness} className="rounded-2xl border border-rose-100 bg-white px-4 py-3 text-sm leading-6 text-rose-900">
                          {weakness}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Recommendations</div>
                    <div className="mt-1 text-sm text-slate-500">
                      Read straight through or follow individual section links from the table of contents.
                    </div>
                  </div>
                  {isFocused && (
                    <button
                      type="button"
                      onClick={() => setFocusedSectionKey(null)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                    >
                      Return to whole report
                    </button>
                  )}
                </div>

                <div className="mt-4 space-y-4">
                  {section.issues.length === 0 && (
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      No issue-level recommendations were returned for this section.
                    </div>
                  )}

                  {section.issues.map(issue => {
                    const severityMeta = getPaperReviewSeverityMeta(issue.severity)
                    const fixTypeMeta = getPaperReviewFixTypeMeta(issue.fixType)
                    const issuePreview = preview?.issueId === issue.id ? preview : null
                    const appliedFix = getLatestAppliedFix(review.appliedFixes, issue.id)
                    const canUndo = Boolean(
                      issue.status === 'fixed'
                      && appliedFix?.beforeText
                      && appliedFix?.afterText
                    )
                    const showStoredDiff = expandedDiffIssueId === issue.id && !issuePreview && canUndo

                    return (
                      <div key={issue.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                        <div className={`h-1.5 w-full ${severityMeta.rail}`} />
                        <div className="space-y-4 p-5">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="max-w-4xl">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${severityMeta.tone}`}>
                                  {severityMeta.label}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {formatPaperReviewDimension(issue.reviewDimension)}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
                                  {fixTypeMeta.label}
                                </span>
                                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(issue.status)}`}>
                                  {issue.status}
                                </span>
                              </div>
                              <h4 className="mt-3 text-lg font-semibold text-slate-950">{issue.title}</h4>
                              <p className="mt-2 text-sm leading-7 text-slate-700">{issue.diagnosis}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {onSectionSelect && (
                                <button
                                  type="button"
                                  onClick={() => onSectionSelect(issue.sectionKey)}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                >
                                  Open section
                                </button>
                              )}
                              {!isFocused && (
                                <button
                                  type="button"
                                  onClick={() => focusSection(issue.sectionKey)}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                >
                                  View section here
                                </button>
                              )}
                            </div>
                          </div>

                          {(issue.impactExplanation || issue.recommendedAction || issue.evidenceExcerpt) && (
                            <div className="grid gap-3 xl:grid-cols-3">
                              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  Why it matters
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-700">
                                  {issue.impactExplanation || 'This issue should be addressed before final export.'}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  Recommendation
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-700">
                                  {issue.recommendedAction || fixTypeMeta.helper}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  Evidence
                                </div>
                                <p className="mt-2 text-sm leading-6 text-slate-700">
                                  {issue.evidenceExcerpt || 'No explicit evidence excerpt was returned for this issue.'}
                                </p>
                              </div>
                            </div>
                          )}

                          {interactive && issue.status === 'pending' && (
                            <div className="flex flex-wrap justify-end gap-3">
                              <button
                                type="button"
                                onClick={() => onResolveIssue?.(issue, 'ignored')}
                                disabled={resolvingIssueId === issue.id || previewingIssueId === issue.id || applyingIssueId === issue.id}
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <XCircle className="h-4 w-4" />
                                Dismiss
                              </button>

                              {issue.fixType === 'rewrite_fixable' ? (
                                <button
                                  type="button"
                                  onClick={() => onPreviewFix?.(issue)}
                                  disabled={previewingIssueId === issue.id || applyingIssueId === issue.id || resolvingIssueId === issue.id}
                                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {previewingIssueId === issue.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-4 w-4" />
                                  )}
                                  Preview LLM fix
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onResolveIssue?.(issue, 'fixed')}
                                  disabled={resolvingIssueId === issue.id}
                                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {resolvingIssueId === issue.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-4 w-4" />
                                  )}
                                  Mark resolved
                                </button>
                              )}
                            </div>
                          )}

                          {issuePreview && (
                            <div className="rounded-[24px] border border-emerald-300 bg-emerald-50 p-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="text-sm font-semibold text-emerald-900">
                                    LLM rewrite preview
                                  </div>
                                  <div className="mt-1 text-sm text-emerald-800">
                                    Old and new section content are shown below before anything is applied.
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={onClosePreview}
                                    className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:border-emerald-300"
                                  >
                                    Close preview
                                  </button>
                                  <button
                                    type="button"
                                    onClick={onApplyPreview}
                                    disabled={applyingIssueId === issue.id}
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {applyingIssueId === issue.id && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Apply change
                                  </button>
                                </div>
                              </div>
                              <div className="mt-4 rounded-2xl border border-emerald-100 bg-white p-4">
                                <InlineTextDiff
                                  original={issuePreview.originalContent}
                                  revised={issuePreview.fixedContent}
                                />
                              </div>
                            </div>
                          )}

                          {canUndo && !issuePreview && (
                            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">Applied section change</div>
                                  <div className="mt-1 text-sm text-slate-600">
                                    {appliedFix?.diffSummary || 'An AI rewrite was applied to this section.'}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedDiffIssueId(current => current === issue.id ? null : issue.id)}
                                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                                  >
                                    {showStoredDiff ? 'Hide diff' : 'Show diff'}
                                  </button>
                                  {interactive && (
                                    <button
                                      type="button"
                                      onClick={() => onRevertFix?.(issue)}
                                      disabled={revertingIssueId === issue.id}
                                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {revertingIssueId === issue.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <RotateCcw className="h-4 w-4" />
                                      )}
                                      Undo
                                    </button>
                                  )}
                                </div>
                              </div>
                              {showStoredDiff && appliedFix?.beforeText && appliedFix?.afterText && (
                                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                                  <InlineTextDiff
                                    original={appliedFix.beforeText}
                                    revised={appliedFix.afterText}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}
