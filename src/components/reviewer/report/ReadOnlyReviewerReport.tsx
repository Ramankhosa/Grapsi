'use client'

// The panel report, read-only, in one fixed structure.
//
// Three read-only views used to compose the report on their own — the public
// share link, the proposal desk's frozen copy and the admin archive — and each
// drifted: the share link kept five fields (no verdict, no scorecards, no
// novelty, no landscape) and recomputed its own score, the frozen copy dropped
// the strengths and weaknesses, and none of the three showed a single patent.
// They all render through this now, from the same blocks as the owner's page.

import { useMemo, useState } from 'react'

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
  type ScoreRow,
} from '@/components/reviewer/report/ReportBlocks'
import {
  PriorWorkFlags,
  PriorWorkSnapshot,
  ReportLandscape,
} from '@/components/reviewer/report/ReportPriorWork'
import type { PriorWorkRow } from '@/lib/ideaIntelligence/priorWork'
import { compareSections, compareSectionTitles } from '@/lib/reviewer/sectionGrouping'

export interface ReadOnlyCompareGroup {
  title: string
  /** Newest first; at most two are shown side by side. */
  versions: any[]
}

export default function ReadOnlyReviewerReport({
  overall,
  projectTitle,
  agencyName,
  generatedAt,
  sections,
  compareGroups = null,
  linkAwards = true,
  patentHref,
  sectionsNote = 'Each section in proposal order, at the version the report scored',
}: {
  overall: any
  projectTitle: string
  agencyName?: string | null
  generatedAt?: string | null
  /** One row per title — the versions the report scored. */
  sections: any[]
  /** When set, the sections panel compares versions side by side instead. */
  compareGroups?: ReadOnlyCompareGroup[] | null
  /** False on public pages, where the award detail route needs a login. */
  linkAwards?: boolean
  patentHref?: (row: PriorWorkRow) => string | null
  sectionsNote?: string
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const report = overall && typeof overall === 'object' ? overall : {}
  const scoreBasis = (report.score_basis || {}) as Record<string, any>
  const scoredVersions: Record<string, number> = scoreBasis.scoredVersions || {}
  const pendingDrafts: Record<string, number> = scoreBasis.pendingDrafts || {}
  const landscape = report.landscape && typeof report.landscape === 'object' ? report.landscape : null
  const priorWorkFlags = Array.isArray(report.prior_work_flags) ? report.prior_work_flags : []
  const hasPriorWork = Boolean(report.novelty_assessment || landscape)

  const orderedSections = useMemo(() => [...(sections || [])].sort(compareSections as any), [sections])
  const orderedGroups = useMemo(
    () => (compareGroups ? [...compareGroups].sort((a, b) => compareSectionTitles(a.title, b.title)) : null),
    [compareGroups]
  )

  const scoreRows: ScoreRow[] = useMemo(() => {
    const panelBySection = new Map<string, any>(
      (Array.isArray(report.section_scorecard) ? report.section_scorecard : []).map((entry: any) => [
        String(entry?.section || '').toLowerCase(),
        entry,
      ])
    )
    return orderedSections.map((section: any) => {
      const review = section?.ai_review_json || {}
      const version = Number(section?.version || 1)
      return {
        title: section.section_title,
        version,
        score: typeof review.score === 'number' ? review.score : null,
        delta: typeof review.score_delta === 'number' ? review.score_delta : null,
        previousScore: typeof review.previous_score === 'number' ? review.previous_score : null,
        improvement: typeof review.improvement_over_previous === 'boolean' ? review.improvement_over_previous : null,
        pendingDraft: pendingDrafts[section.section_title] || null,
        // Reports older than score_basis have no record of what they scored;
        // everything shown is what they scored.
        inReport: typeof scoredVersions[section.section_title] === 'number'
          ? Number(scoredVersions[section.section_title]) === version
          : true,
        headline: panelBySection.get(String(section.section_title || '').toLowerCase())?.headline || null,
      }
    })
  }, [orderedSections, report.section_scorecard, pendingDrafts, scoredVersions])

  const supplementary = Array.from(new Set([
    ...(Array.isArray(report.supplementary_materials) ? report.supplementary_materials : []),
  ].map((item: unknown) => String(item || '').trim()).filter(Boolean)))

  const jumpItems = [
    { id: 'overview', label: 'Overview' },
    ...(hasPriorWork ? [{ id: 'novelty', label: 'Novelty & prior work' }] : []),
    { id: 'scores', label: 'Scores' },
    { id: 'fix-first', label: 'Fix first' },
    { id: 'consistency', label: 'Consistency & compliance' },
    { id: 'assessment', label: 'Strengths & weaknesses' },
    ...(landscape ? [{ id: 'landscape', label: 'Landscape' }] : []),
    { id: 'sections', label: 'Sections' },
  ]

  const cardFor = (section: any, compact = false) => (
    <SectionReviewCard
      key={section.id || `${section.section_title}-${section.version}`}
      section={section}
      inReportVersion={typeof scoredVersions[section.section_title] === 'number' ? scoredVersions[section.section_title] : null}
      pendingDraft={pendingDrafts[section.section_title] || null}
      expanded={Boolean(expanded[section.id])}
      onToggleExpand={() => setExpanded((current) => ({ ...current, [section.id]: !current[section.id] }))}
      compact={compact}
    />
  )

  return (
    <div id="top" className="space-y-6">
      <ReportJumpBar items={jumpItems} />

      <Panel id="overview" title="Overall assessment" note="Panel verdict, score and executive summary">
        <ReportCover
          overall={report}
          projectTitle={projectTitle || 'Untitled proposal'}
          agencyName={agencyName || null}
          generatedAt={generatedAt || report.generated_at || null}
          reviewedCount={Object.keys(scoredVersions).length || orderedSections.length}
          pendingDrafts={pendingDrafts}
          scoredVersions={scoredVersions}
        />
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Executive summary</h3>
          <div className="rounded-md bg-nickel-50 p-4">
            <ReviewerText value={report.executive_summary} fallback="No executive summary provided." />
          </div>
        </div>
      </Panel>

      {hasPriorWork ? (
        <Panel
          id="novelty"
          title="Novelty & prior work"
          note="Where this idea sits against already-funded work and patents — reference only, not part of the score"
        >
          <div className="space-y-5">
            {report.novelty_assessment ? <NoveltyBlock novelty={report.novelty_assessment} /> : null}
            <PriorWorkFlags flags={priorWorkFlags} />
            {landscape ? <PriorWorkSnapshot landscape={landscape} /> : null}
          </div>
        </Panel>
      ) : null}

      <Panel id="scores" title="Scores" note="Section scores, and the call's criteria">
        <SectionScoreBars rows={scoreRows} />
        {report.criterion_scorecard?.length ? (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Against the call&apos;s criteria</h3>
            <CriterionBars rows={report.criterion_scorecard} />
          </div>
        ) : null}
      </Panel>

      <Panel id="fix-first" title="What to fix first" note="Ranked by how much the fix moves the funding decision">
        <PriorityActions actions={report.priority_actions || []} />
      </Panel>

      <Panel id="consistency" title="Consistency & compliance" note="Contradictions between sections, and the counted compliance facts">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Cross-section consistency</h3>
            <ConsistencyFlags flags={report.consistency_flags || []} />
          </div>
          <div id="compliance" className="scroll-mt-24">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-nickel-500">Compliance check</h3>
            <ComplianceBars compliance={report.compliance} />
          </div>
        </div>
      </Panel>

      <Panel id="assessment" title="Strengths, weaknesses & recommendations" note="What to keep, what costs marks, and what applies across the whole proposal">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md bg-green-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-green-800">Major strengths — keep these</h3>
            <ul className="space-y-2 text-sm text-nickel-800">
              {(report.major_strengths || []).map((item: unknown, index: number) => (
                <li key={`str-${index}`} className="flex gap-2"><span className="text-green-600">•</span><span><ReviewerText value={item} /></span></li>
              ))}
            </ul>
          </div>
          <div className="rounded-md bg-red-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-red-800">Major weaknesses</h3>
            <ul className="space-y-2 text-sm text-nickel-800">
              {(report.major_weaknesses || []).map((item: unknown, index: number) => (
                <li key={`wk-${index}`} className="flex gap-2"><span className="text-red-600">•</span><span><ReviewerText value={item} /></span></li>
              ))}
            </ul>
          </div>
          <div className="rounded-md bg-amber-50 p-4 lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-amber-800">Cross-sectional recommendations</h3>
            <ol className="space-y-2 text-sm text-nickel-800">
              {(report.cross_sectional_recommendations || []).map((item: unknown, index: number) => (
                <li key={`rec-${index}`} className="flex gap-2"><span className="font-semibold text-amber-700">{index + 1}.</span><span><ReviewerText value={item} /></span></li>
              ))}
            </ol>
          </div>
          {supplementary.length ? (
            <div className="rounded-md bg-cobalt-50 p-4 lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold text-cobalt-800">Material to prepare separately (not scored)</h3>
              <ul className="space-y-1 text-sm text-nickel-800">
                {supplementary.map((item, index) => (
                  <li key={`sup-${index}`} className="flex gap-2"><span className="text-cobalt-600">•</span><span><ReviewerText value={item} /></span></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Panel>

      {landscape ? (
        <Panel id="landscape" title="Research & patent landscape" note="Similar funded projects and Indian patents retrieved for reference — not part of the score">
          <ReportLandscape landscape={landscape} linkAwards={linkAwards} patentHref={patentHref} />
        </Panel>
      ) : null}

      <Panel id="sections" title="Section by section" note={orderedGroups ? 'Two versions of each section side by side' : sectionsNote}>
        {orderedGroups ? (
          orderedGroups.length ? (
            <div className="space-y-8">
              {orderedGroups.map((group) => (
                <div key={group.title} id={anchorFor(group.title)} className="scroll-mt-24">
                  <h3 className="mb-3 text-lg font-semibold text-nickel-900"><ReviewerText value={group.title} fallback="Untitled section" /></h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {group.versions.slice(0, 2).map((section) => cardFor(section, true))}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-nickel-600">No reviewed sections are stored against this report.</p>
        ) : orderedSections.length ? (
          <div className="space-y-6">
            {orderedSections.map((section: any) => (
              <div key={section.id || section.section_title} id={anchorFor(section.section_title)} className="scroll-mt-24">
                {cardFor(section)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-nickel-600">No reviewed sections are stored against this report.</p>
        )}
      </Panel>
    </div>
  )
}
