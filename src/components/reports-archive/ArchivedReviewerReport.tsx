'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Printer } from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import { ReviewerText } from '@/components/reviewer/ReviewerText'
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
} from '@/components/reviewer/report/ReportBlocks'
import { compareSections, reportFreshness } from '@/lib/reviewer/sectionGrouping'

interface ArchivedSection {
  id: string
  section_title: string
  user_input: string
  ai_review_json: Record<string, any>
  status: string
  version: number
  is_revision: boolean
  mappingJson: any
  last_reviewed_at: string
}

interface ArchivedCall {
  id: string
  projectTitle: string | null
  agencyName: string | null
  reviewStatus: string
  finalReviewStatus: string
  parsedJson: Record<string, any> | null
  overallReviewJson: Record<string, any> | null
  modelUsed: string | null
  createdAt: string
  updatedAt: string
  runBy: {
    userId: string
    name: string | null
    email: string | null
    employeeId: string | null
    designation: string | null
    department: string | null
    school: string | null
    tenantName: string | null
  }
}

/**
 * The same panel report the researcher sees, rendered read-only for an
 * administrator.
 *
 * It reuses the researcher report's own blocks rather than reformatting the
 * data: an oversight view that renders a different-looking report invites
 * arguments about which one is real. What it drops is every action that writes
 * — regenerate, share, version pinning — because oversight must not alter, or
 * bill for, the report it is reading.
 */
export default function ArchivedReviewerReport({
  callId,
  basePath,
}: {
  callId: string
  basePath: string
}) {
  const { authFetch } = useAuth()

  const [call, setCall] = useState<ArchivedCall | null>(null)
  const [sections, setSections] = useState<ArchivedSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await authFetch(`/api/reports-archive/reviewer/${callId}`)
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${response.status})`)
        }
        const data = await response.json()
        if (cancelled) return
        setCall(data.call)
        setSections(data.sections || [])
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this report.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [authFetch, callId])

  const overall = call?.overallReviewJson || null
  const scoreBasis = (overall?.score_basis || {}) as Record<string, any>
  const scoredVersions: Record<string, number> = scoreBasis.scoredVersions || {}
  const pendingDrafts: Record<string, number> = scoreBasis.pendingDrafts || {}

  /**
   * One row per section title: the version the stored report scored when it
   * pinned one, otherwise the newest reviewed draft. Showing every version
   * would print a revised section twice with two different scores.
   */
  const effectiveSections = useMemo(() => {
    const reviewed = sections.filter((section) => section.status === 'reviewed')
    const byTitle = new Map<string, ArchivedSection>()
    for (const section of reviewed) {
      const pinned = Number(scoredVersions[section.section_title])
      const current = byTitle.get(section.section_title)
      if (Number.isFinite(pinned)) {
        if (section.version === pinned) byTitle.set(section.section_title, section)
        else if (!current) byTitle.set(section.section_title, section)
      } else if (!current || section.version > current.version) {
        byTitle.set(section.section_title, section)
      }
    }
    return Array.from(byTitle.values()).sort(compareSections as any)
  }, [sections, scoredVersions])

  const scoreRows = useMemo(() => {
    const panelBySection = new Map<string, any>(
      (Array.isArray(overall?.section_scorecard) ? overall!.section_scorecard : []).map((entry: any) => [
        String(entry?.section || '').toLowerCase(),
        entry,
      ])
    )
    return effectiveSections.map((section) => {
      const review = section.ai_review_json || {}
      return {
        title: section.section_title,
        version: section.version,
        score: typeof review.score === 'number' ? review.score : null,
        delta: typeof review.score_delta === 'number' ? review.score_delta : null,
        previousScore: typeof review.previous_score === 'number' ? review.previous_score : null,
        improvement:
          typeof review.improvement_over_previous === 'boolean' ? review.improvement_over_previous : null,
        pendingDraft: pendingDrafts[section.section_title] || null,
        inReport: Number(scoredVersions[section.section_title]) === Number(section.version),
        headline: panelBySection.get(section.section_title.toLowerCase())?.headline || null,
      }
    })
  }, [effectiveSections, overall, pendingDrafts, scoredVersions])

  const freshness = useMemo(() => reportFreshness(overall as any, sections as any), [overall, sections])

  const jumpItems = useMemo(
    () =>
      [
        { id: 'overview', label: 'Overview' },
        ...(overall?.novelty_assessment ? [{ id: 'novelty', label: 'Novelty' }] : []),
        { id: 'scores', label: 'Scores' },
        { id: 'fix-first', label: 'Fix first' },
        { id: 'consistency', label: 'Consistency & compliance' },
        { id: 'assessment', label: 'Strengths & weaknesses' },
        { id: 'sections', label: 'Sections' },
      ] as Array<{ id: string; label: string }>,
    [overall]
  )

  // Auth is Bearer-only, so a plain anchor would download an HTML 401 page.
  const downloadAtr = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    try {
      const response = await authFetch(`/api/reports-archive/reviewer/${callId}/export`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Export failed (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `ATR-${callId}.docx`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (downloadError) {
      setExportError(downloadError instanceof Error ? downloadError.message : 'Could not build the Word export.')
    } finally {
      setExporting(false)
    }
  }, [authFetch, callId])

  if (loading) {
    return (
      <div className="nk-ground flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-cobalt-600" />
      </div>
    )
  }

  if (error || !call) {
    return (
      <div className="nk-ground min-h-screen px-4 py-12">
        <div className="mx-auto max-w-lg nk-panel p-6 text-center">
          <h1 className="nk-title text-xl">Report unavailable</h1>
          <p className="nk-sub mt-2">{error || 'This report could not be loaded.'}</p>
          <Link href={basePath} className="nk-btn-secondary nk-btn-sm mt-4 inline-flex">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to the archive
          </Link>
        </div>
      </div>
    )
  }

  if (!overall || Object.keys(overall).length === 0) {
    return (
      <div className="nk-ground min-h-screen px-4 py-12">
        <div className="mx-auto max-w-lg nk-panel p-6 text-center">
          <h1 className="nk-title text-xl">No panel report yet</h1>
          <p className="nk-sub mt-2">
            {call.projectTitle || 'This proposal'} has been set up for review, but no final report has been generated.
            The archive does not generate one — that stays with the owner.
          </p>
          <Link href={basePath} className="nk-btn-secondary nk-btn-sm mt-4 inline-flex">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to the archive
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="nk-ground min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
          <div>
            <Link href={basePath} className="nk-btn-ghost nk-btn-sm inline-flex">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Report archive
            </Link>
            <p className="nk-sub mt-2 text-xs">
              {/* Attribution first: who ran this review, and where they sit. */}
              {[
                call.runBy?.name || call.runBy?.email || 'Run by an unnamed account',
                call.runBy?.school,
                call.runBy?.department,
                call.runBy?.tenantName,
                `Started ${new Date(call.createdAt).toLocaleDateString()}`,
                call.modelUsed ? `Model ${call.modelUsed}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="nk-btn-ghost nk-btn-sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
            </button>
            <button type="button" className="nk-btn-secondary nk-btn-sm" onClick={() => void downloadAtr()} disabled={exporting}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> {exporting ? 'Building…' : 'Word (ATR)'}
            </button>
          </div>
        </div>

        {exportError ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
            {exportError}
          </div>
        ) : null}

        <div className="mb-4 rounded-md border border-nickel-200 bg-white px-4 py-3 text-xs text-nickel-600 print:hidden">
          Read-only oversight view. Nothing here regenerates the report or spends the owner&apos;s quota.
        </div>

        {freshness === 'stale' ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            <strong>Out of date.</strong> A section was reviewed after this report was written, so it does not describe the
            current drafts. Only the owner can regenerate it.
          </div>
        ) : null}

        <div id="top" className="space-y-6">
          <ReportJumpBar items={jumpItems} />

          <Panel id="overview" title="Overall assessment" note="Panel verdict, score and executive summary">
            <ReportCover
              overall={overall}
              projectTitle={call.projectTitle || 'Untitled proposal'}
              agencyName={call.agencyName || call.parsedJson?.agency_name || null}
              generatedAt={overall.generated_at}
              reviewedCount={Object.keys(scoredVersions).length || effectiveSections.length}
              pendingDrafts={pendingDrafts}
              scoredVersions={scoredVersions}
            />
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Executive summary</h3>
              <div className="rounded-md bg-nickel-50 p-4">
                <ReviewerText value={overall.executive_summary} fallback="No executive summary provided." />
              </div>
            </div>
          </Panel>

          {overall.novelty_assessment ? (
            <Panel
              id="novelty"
              title="Novelty & positioning"
              note="Where this idea sits against already-funded work and patents — reference only, not part of the score"
            >
              <NoveltyBlock novelty={overall.novelty_assessment} />
            </Panel>
          ) : null}

          <Panel id="scores" title="Scores" note="Section scores, and the call's criteria">
            <SectionScoreBars rows={scoreRows} />
            {overall.criterion_scorecard?.length ? (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">
                  Against the call&apos;s criteria
                </h3>
                <CriterionBars rows={overall.criterion_scorecard} />
              </div>
            ) : null}
          </Panel>

          <Panel id="fix-first" title="What to fix first" note="Ranked by how much the fix moves the funding decision">
            <PriorityActions actions={overall.priority_actions || []} />
          </Panel>

          <Panel
            id="consistency"
            title="Consistency & compliance"
            note="Contradictions between sections, and the counted compliance facts"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">
                  Cross-section consistency
                </h3>
                <ConsistencyFlags flags={overall.consistency_flags || []} />
              </div>
              <div id="compliance" className="scroll-mt-24">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Compliance check</h3>
                <ComplianceBars compliance={overall.compliance} />
              </div>
            </div>
          </Panel>

          <Panel
            id="assessment"
            title="Strengths, weaknesses & recommendations"
            note="What to keep, what costs marks, and what applies across the whole proposal"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md bg-green-50 p-4">
                <h3 className="mb-2 text-sm font-semibold text-green-800">Major strengths</h3>
                <ul className="space-y-2 text-sm text-nickel-800">
                  {(overall.major_strengths || []).map((item: string, index: number) => (
                    <li key={`str-${index}`} className="flex gap-2">
                      <span className="text-green-600">•</span>
                      <span>
                        <ReviewerText value={item} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-md bg-red-50 p-4">
                <h3 className="mb-2 text-sm font-semibold text-red-800">Major weaknesses</h3>
                <ul className="space-y-2 text-sm text-nickel-800">
                  {(overall.major_weaknesses || []).map((item: string, index: number) => (
                    <li key={`wk-${index}`} className="flex gap-2">
                      <span className="text-red-600">•</span>
                      <span>
                        <ReviewerText value={item} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-md bg-amber-50 p-4 lg:col-span-2">
                <h3 className="mb-2 text-sm font-semibold text-amber-800">Cross-sectional recommendations</h3>
                <ol className="space-y-2 text-sm text-nickel-800">
                  {(overall.cross_sectional_recommendations || []).map((item: string, index: number) => (
                    <li key={`rec-${index}`} className="flex gap-2">
                      <span className="font-semibold text-amber-700">{index + 1}.</span>
                      <span>
                        <ReviewerText value={item} />
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </Panel>

          <Panel id="sections" title="Section by section" note="Each section in proposal order, at the version the report scored">
            {effectiveSections.length ? (
              <div className="space-y-6">
                {effectiveSections.map((section) => (
                  <div key={section.id} id={anchorFor(section.section_title)} className="scroll-mt-24">
                    <SectionReviewCard
                      section={section as any}
                      inReportVersion={
                        typeof scoredVersions[section.section_title] === 'number'
                          ? scoredVersions[section.section_title]
                          : null
                      }
                      pendingDraft={pendingDrafts[section.section_title] || null}
                      expanded={Boolean(expanded[section.id])}
                      onToggleExpand={() =>
                        setExpanded((current) => ({ ...current, [section.id]: !current[section.id] }))
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-nickel-600">No reviewed sections are stored against this report.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
