'use client'

import { useMemo, useState } from 'react'

import {
  ComplianceBars,
  ConsistencyFlags,
  CriterionBars,
  NoveltyBlock,
  Panel,
  PriorityActions,
  ReportCover,
  ReportJumpBar,
  SectionReviewCard,
  SectionScoreBars,
  anchorFor,
  type ScoreRow,
} from '@/components/reviewer/report/ReportBlocks'

/**
 * A review report, rendered from a payload the caller already has.
 *
 * Purely presentational — it fetches nothing. That is the difference from the
 * archive's version of this view, which fetches through an endpoint only
 * platform and tenant admins may call; an applicant reading their own review
 * must not need those rights.
 *
 * The payload is the frozen snapshot taken when the officer shared the review,
 * so this renders what was sent rather than what the workspace says today.
 */

export interface FrozenReport {
  overall: any
  projectTitle?: string
  agencyName?: string | null
  generatedAt?: string | null
  versionNo?: number | null
  sections: any[]
}

export default function FrozenReviewReport({
  report,
  officerNote,
  sharedAt,
  onDownloadDocx,
}: {
  report: FrozenReport
  officerNote?: string | null
  sharedAt?: string | null
  onDownloadDocx?: () => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const overall = report?.overall || {}
  const scoreBasis = overall?.score_basis || {}
  const scoredVersions: Record<string, number> = scoreBasis?.scoredVersions || {}

  // The snapshot already holds one row per title, but a legacy snapshot may
  // not, so newest-per-title is enforced here too rather than trusting it.
  const sections = useMemo(() => {
    const byTitle = new Map<string, any>()
    for (const section of report?.sections || []) {
      const title = String(section?.section_title || '').trim()
      if (!title) continue
      const current = byTitle.get(title)
      if (!current || Number(section.version || 1) > Number(current.version || 1)) {
        byTitle.set(title, section)
      }
    }
    return Array.from(byTitle.values())
  }, [report])

  const scoreRows: ScoreRow[] = useMemo(
    () =>
      sections.map((section: any) => {
        const review = section?.ai_review_json || {}
        const version = Number(section.version || 1)
        return {
          title: section.section_title,
          version,
          score: typeof review.score === 'number' ? review.score : null,
          delta: typeof review.score_delta === 'number' ? review.score_delta : null,
          previousScore: typeof review.previous_score === 'number' ? review.previous_score : null,
          improvement: typeof section.improvement_flag === 'boolean' ? section.improvement_flag : null,
          pendingDraft: null,
          inReport: true,
        }
      }),
    [sections]
  )

  const jumpItems = [
    { id: 'summary', label: 'Summary' },
    ...(overall?.priority_actions?.length ? [{ id: 'actions', label: 'Priority actions' }] : []),
    ...(sections.length ? [{ id: 'sections', label: 'Section by section' }] : []),
  ]

  return (
    <div className="space-y-6">
      {officerNote && (
        <div className="nk-panel-quiet p-4">
          <p className="nk-label mb-1">From your funding officer</p>
          <p className="text-sm text-nickel-800 whitespace-pre-wrap">{officerNote}</p>
        </div>
      )}

      <ReportCover
        overall={overall}
        projectTitle={report.projectTitle || 'This proposal'}
        agencyName={report.agencyName}
        generatedAt={report.generatedAt || sharedAt || null}
        reviewedCount={sections.length}
        pendingDrafts={{}}
        scoredVersions={scoredVersions}
      />

      {onDownloadDocx && (
        <div className="flex justify-end">
          <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={onDownloadDocx}>
            Download as Word
          </button>
        </div>
      )}

      <ReportJumpBar items={jumpItems} />

      <Panel id="summary" title="Summary">
        {overall?.executive_summary && (
          <p className="text-sm leading-relaxed text-nickel-800 whitespace-pre-wrap">
            {overall.executive_summary}
          </p>
        )}
        {scoreRows.length > 0 && (
          <div className="mt-5">
            <SectionScoreBars rows={scoreRows} />
          </div>
        )}
        {Array.isArray(overall?.criterion_scorecard) && overall.criterion_scorecard.length > 0 && (
          <div className="mt-5">
            <CriterionBars rows={overall.criterion_scorecard} />
          </div>
        )}
      </Panel>

      {overall?.novelty_assessment && (
        <Panel title="Novelty and positioning">
          <NoveltyBlock novelty={overall.novelty_assessment} />
        </Panel>
      )}

      {Array.isArray(overall?.priority_actions) && overall.priority_actions.length > 0 && (
        <Panel id="actions" title="What to fix first">
          <PriorityActions actions={overall.priority_actions} />
        </Panel>
      )}

      {Array.isArray(overall?.consistency_flags) && overall.consistency_flags.length > 0 && (
        <Panel title="Where the proposal disagrees with itself">
          <ConsistencyFlags flags={overall.consistency_flags} />
        </Panel>
      )}

      {overall?.compliance && (
        <Panel title="Against the call's own requirements">
          <ComplianceBars compliance={overall.compliance} />
        </Panel>
      )}

      {sections.length > 0 && (
        <Panel id="sections" title="Section by section">
          <div className="space-y-4">
            {sections.map((section: any) => (
              <div key={section.id || section.section_title} id={anchorFor(section.section_title)}>
                <SectionReviewCard
                  section={section}
                  inReportVersion={Number(section.version || 1)}
                  pendingDraft={null}
                  expanded={Boolean(expanded[section.id])}
                  onToggleExpand={() =>
                    setExpanded((current) => ({ ...current, [section.id]: !current[section.id] }))
                  }
                  compact
                />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
