import Link from 'next/link'
import { useState } from 'react'
import {
  groupReviewerSections,
  type ReviewerSectionGroup,
  type ReviewerSectionLike,
  type ReviewerSectionStatus,
} from '@/lib/reviewer/sectionGrouping'

/**
 * The workspace's section navigation.
 *
 * One row per section *title*, in proposal order, with the version history
 * folded behind a disclosure. The list this replaced rendered every row the API
 * returned, so a twice-revised proposal showed three identical "Objectives"
 * entries scattered through the list in review-recency order.
 */

const STATUS_DOT: Record<ReviewerSectionStatus, string> = {
  draft: 'bg-nickel-300',
  reviewed: 'bg-emerald-500',
  stale: 'bg-amber-500',
}

const STATUS_LABEL: Record<ReviewerSectionStatus, string> = {
  draft: 'Not yet reviewed',
  reviewed: 'Reviewed',
  stale: 'Edited since review',
}

function ScoreChip({ score }: { score: number | null }) {
  if (score === null) return null
  return (
    <span className="nk-mono shrink-0 rounded bg-nickel-100 px-1.5 py-0.5 text-nickel-600">
      {score.toFixed(1)}
    </span>
  )
}

function SectionRow({
  group,
  callId,
  activeSectionId,
}: {
  group: ReviewerSectionGroup<ReviewerSectionLike>
  callId: string
  activeSectionId?: string | null
}) {
  const [showHistory, setShowHistory] = useState(false)
  const isActive = group.history.some(v => v.id === activeSectionId)
  const currentIsActive = group.current.id === activeSectionId
  const hasHistory = group.versionCount > 1

  return (
    <li>
      <div
        className={`group flex items-center gap-1.5 rounded-lg pr-1 transition-colors ${
          isActive ? 'bg-cobalt-50' : 'hover:bg-nickel-50'
        }`}
      >
        <Link
          href={`/reviewer/${callId}/section/${group.current.id}`}
          aria-current={currentIsActive ? 'page' : undefined}
          className="flex min-h-[38px] min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cobalt-600"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[group.status]}`}
            title={STATUS_LABEL[group.status]}
          />
          <span
            className={`min-w-0 flex-1 truncate text-[13px] ${
              currentIsActive ? 'font-semibold text-cobalt-800' : 'font-medium text-nickel-700'
            }`}
            title={group.title}
          >
            {group.title}
          </span>
          <ScoreChip score={group.score} />
        </Link>

        {hasHistory && (
          <button
            type="button"
            onClick={() => setShowHistory(v => !v)}
            aria-expanded={showHistory}
            aria-label={`${showHistory ? 'Hide' : 'Show'} the ${group.versionCount} versions of ${group.title}`}
            className="nk-mono shrink-0 rounded px-1.5 py-1 text-nickel-500 transition-colors hover:bg-nickel-100 hover:text-nickel-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cobalt-600"
          >
            v{group.current.version ?? 1}
          </button>
        )}
      </div>

      {hasHistory && showHistory && (
        <ul className="ml-[15px] mt-0.5 space-y-0.5 border-l border-nickel-200 pl-3">
          {group.history.map(version => (
            <li key={version.id}>
              <Link
                href={`/reviewer/${callId}/section/${version.id}`}
                aria-current={version.id === activeSectionId ? 'page' : undefined}
                className={`flex min-h-[30px] items-center justify-between gap-2 rounded-md px-2 py-1 text-[12px] transition-colors ${
                  version.id === activeSectionId
                    ? 'bg-cobalt-50 font-semibold text-cobalt-800'
                    : 'text-nickel-500 hover:bg-nickel-50 hover:text-nickel-800'
                }`}
              >
                <span className="nk-mono">v{version.version ?? 1}</span>
                <span className="truncate">
                  {version.status === 'reviewed' ? 'Reviewed' : 'Draft'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function ReviewerSectionRail({
  callId,
  sections,
  activeSectionId,
}: {
  callId: string
  sections: ReviewerSectionLike[]
  activeSectionId?: string | null
}) {
  const groups = groupReviewerSections(sections)

  return (
    <nav aria-label="Proposal sections">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="nk-eyebrow">Sections</h2>
        {groups.length > 0 && (
          <span className="nk-mono text-nickel-500">{groups.length}</span>
        )}
      </div>

      {groups.length > 0 ? (
        <ul className="space-y-0.5">
          {groups.map(group => (
            <SectionRow
              key={group.title}
              group={group}
              callId={callId}
              activeSectionId={activeSectionId}
            />
          ))}
        </ul>
      ) : (
        <p className="px-2.5 py-3 text-[12.5px] leading-5 text-nickel-500">
          No sections yet. Import your proposal to fill them all at once, or add
          one at a time.
        </p>
      )}

      <div className="mt-3 space-y-1.5 border-t border-nickel-200 pt-3">
        <Link
          href={`/reviewer/${callId}/import-proposal`}
          className="nk-btn-secondary nk-btn-sm w-full"
        >
          Import full proposal
        </Link>
        <Link
          href={`/reviewer/${callId}/section/new`}
          className="nk-btn-ghost nk-btn-sm w-full"
        >
          Add a section
        </Link>
      </div>
    </nav>
  )
}
