import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState, type ReactNode } from 'react'
import { RULES_SOURCE_LABELS, type ReviewerRulesSource } from '@/lib/reviewer/rulesSource'
import ReviewerSectionRail from './ReviewerSectionRail'
import {
  countReviewerSections,
  reportFreshness,
  type ReviewerSectionLike,
} from '@/lib/reviewer/sectionGrouping'

/**
 * The one chrome every reviewer page wears.
 *
 * Before this, each of the thirteen pages carried its own full-bleed gradient
 * header in whatever colour it was written in — green, blue, purple, teal —
 * with no persistent navigation between them, so the workspace read as a set of
 * unrelated screens rather than one place.
 */

export interface ReviewerShellCall {
  id: string
  project_title?: string | null
  agency_name?: string | null
  parsed_json?: any
  overall_review_json?: any
}

/**
 * A numbered stage in the rail.
 *
 * The rail used to be three unlabelled links with the section list wedged
 * between them, which gave no sense of sequence or of where the workspace had
 * got to. Numbering the stages and stating each one's real status turns the
 * same navigation into a map of the process.
 */
function RailStage({
  index,
  label,
  status,
  href,
  active,
  tone = 'idle',
  children,
}: {
  index: number
  label: string
  status: string
  href?: string
  active?: boolean
  tone?: 'done' | 'active' | 'warn' | 'idle'
  children?: ReactNode
}) {
  const dot = {
    done: 'bg-emerald-500',
    active: 'bg-cobalt-600',
    warn: 'bg-amber-500',
    idle: 'bg-nickel-300',
  }[tone]

  const head = (
    <div className="flex items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="nk-eyebrow">
          {index}. {label}
        </div>
        <div
          className={`mt-0.5 text-[12.5px] ${
            tone === 'warn' ? 'text-amber-700' : active ? 'text-cobalt-800' : 'text-nickel-600'
          }`}
        >
          {status}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      {href ? (
        <Link
          href={href}
          aria-current={active ? 'page' : undefined}
          className={`nk-panel-quiet block px-3 py-2.5 transition-colors hover:border-cobalt-200 hover:bg-cobalt-50 ${
            active ? 'border-cobalt-300 bg-cobalt-50' : ''
          }`}
        >
          {head}
        </Link>
      ) : (
        <div className="px-3 py-2.5">{head}</div>
      )}
      {children}
    </div>
  )
}

function RulesSourceBadge({ call }: { call: ReviewerShellCall }) {
  const source = call?.parsed_json?.rules_source as ReviewerRulesSource | undefined
  if (!source || !RULES_SOURCE_LABELS[source]) return null
  return (
    <span className="nk-badge" title={`Reviewer rules come from: ${RULES_SOURCE_LABELS[source]}`}>
      {RULES_SOURCE_LABELS[source]}
    </span>
  )
}

export default function ReviewerShell({
  call,
  sections = [],
  activeSectionId,
  title,
  eyebrow,
  actions,
  children,
  showRail = true,
}: {
  call: ReviewerShellCall
  sections?: ReviewerSectionLike[]
  activeSectionId?: string | null
  /** Page title — the workspace name is added for the browser tab. */
  title: string
  eyebrow?: string
  actions?: ReactNode
  children: ReactNode
  showRail?: boolean
}) {
  const [railOpen, setRailOpen] = useState(false)
  const router = useRouter()
  const callId = call?.id
  const workspaceName = call?.project_title || 'Reviewer workspace'

  const counts = countReviewerSections(sections)
  const freshness = reportFreshness(call?.overall_review_json, sections)
  const path = router?.asPath || ''

  const sectionsStatus =
    counts.total === 0
      ? 'Nothing added yet'
      : counts.stale > 0
        ? `${counts.reviewed} of ${counts.total} reviewed · ${counts.stale} edited`
        : `${counts.reviewed} of ${counts.total} reviewed`

  const reportStatus =
    counts.reviewed === 0
      ? 'Review a section first'
      : freshness === 'missing'
        ? 'Not generated yet'
        : freshness === 'stale'
          ? 'Out of date'
          : 'Ready to read'

  const rail = (
    <div className="space-y-4">
      <RailStage
        index={1}
        label="The call"
        status="Rules and criteria this is judged against"
        href={`/reviewer/${callId}/call-analysis`}
        active={path.includes('/call-analysis')}
        tone="done"
      />

      <RailStage
        index={2}
        label="Your proposal"
        status={sectionsStatus}
        href={counts.total === 0 ? `/reviewer/${callId}/import-proposal` : undefined}
        tone={
          counts.total === 0
            ? 'idle'
            : counts.stale > 0
              ? 'warn'
              : counts.reviewed === counts.total
                ? 'done'
                : 'active'
        }
      >
        {showRail && counts.total > 0 && (
          <div className="mt-2">
            <ReviewerSectionRail callId={callId} sections={sections} activeSectionId={activeSectionId} />
          </div>
        )}
      </RailStage>

      <RailStage
        index={3}
        label="Panel report"
        status={reportStatus}
        href={`/reviewer/${callId}/final-review`}
        active={path.includes('/final-review')}
        tone={
          counts.reviewed === 0
            ? 'idle'
            : freshness === 'stale'
              ? 'warn'
              : freshness === 'missing'
                ? 'active'
                : 'done'
        }
      />
    </div>
  )

  return (
    <div className="nk-ground">
      <Head>
        <title>{`${title} · ${workspaceName} — AI Grant Reviewer`}</title>
      </Head>

      <header className="sticky top-0 z-30 border-b border-nickel-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          {showRail && (
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              className="nk-btn-ghost nk-btn-sm lg:hidden"
              aria-label="Open section navigation"
            >
              Sections
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                href="/reviewer"
                className="nk-eyebrow shrink-0 transition-colors hover:text-cobalt-700"
              >
                Reviewer
              </Link>
              <span className="nk-eyebrow text-nickel-400" aria-hidden="true">
                /
              </span>
              <Link
                href={`/reviewer/${callId}`}
                className="nk-eyebrow min-w-0 truncate transition-colors hover:text-cobalt-700"
              >
                {workspaceName}
              </Link>
            </div>
            <h1 className="mt-0.5 truncate text-[17px] font-semibold tracking-[-0.01em] text-nickel-900">
              {eyebrow ? `${eyebrow} · ${title}` : title}
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden md:inline-flex">
              <RulesSourceBadge call={call} />
            </span>
            {actions}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="lg:grid lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-7">
          <aside className="hidden lg:block">
            <div className="sticky top-[84px]">{rail}</div>
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>

      {/* Mobile rail. The workspace is section-navigation-heavy, so the rail has
          to be reachable on a phone rather than dropped below the fold. */}
      {railOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close section navigation"
            onClick={() => setRailOpen(false)}
            className="absolute inset-0 bg-nickel-950/40"
          />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] overflow-y-auto border-r border-nickel-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="nk-title">Navigate</span>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                className="nk-btn-ghost nk-btn-xs"
              >
                Close
              </button>
            </div>
            <div onClick={() => setRailOpen(false)}>{rail}</div>
          </div>
        </div>
      )}
    </div>
  )
}
