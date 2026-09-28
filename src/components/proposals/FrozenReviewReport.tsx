'use client'

import { useMemo } from 'react'

import ReadOnlyReviewerReport from '@/components/reviewer/report/ReadOnlyReviewerReport'
import { patentSearchHref } from '@/components/reviewer/report/ReportPriorWork'

/**
 * A review report, rendered from a payload the caller already has.
 *
 * Purely presentational — it fetches nothing. That is the difference from the
 * archive's version of this view, which fetches through an endpoint only
 * platform and tenant admins may call; an applicant reading their own review
 * must not need those rights.
 *
 * The payload is the frozen snapshot taken when the officer shared the review,
 * so this renders what was sent rather than what the workspace says today. It
 * renders through the same read-only report as the archive and the share link,
 * so the applicant sees the whole report — including the strengths, the
 * weaknesses and the research & patent landscape this view used to leave out.
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
  const overall = report?.overall || {}

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

  return (
    <div className="space-y-6">
      {officerNote && (
        <div className="nk-panel-quiet p-4">
          <p className="nk-label mb-1">From your funding officer</p>
          <p className="text-sm text-nickel-800 whitespace-pre-wrap">{officerNote}</p>
        </div>
      )}

      {onDownloadDocx && (
        <div className="flex justify-end">
          <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={onDownloadDocx}>
            Download as Word
          </button>
        </div>
      )}

      <ReadOnlyReviewerReport
        overall={overall}
        projectTitle={report.projectTitle || 'This proposal'}
        agencyName={report.agencyName}
        generatedAt={overall?.generated_at || report.generatedAt || sharedAt || null}
        sections={sections}
        patentHref={patentSearchHref}
        sectionsNote="Each section in proposal order, as reviewed for this version"
      />
    </div>
  )
}
