import Head from 'next/head'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { RULES_SOURCE_LABELS, type ReviewerRulesSource } from '@/lib/reviewer/rulesSource'
import ReviewerSectionRail from './ReviewerSectionRail'
import type { ReviewerSectionLike } from '@/lib/reviewer/sectionGrouping'

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
  const callId = call?.id
  const workspaceName = call?.project_title || 'Reviewer workspace'

  const rail = (
    <div className="space-y-5">
      <Link
        href={`/reviewer/${callId}/call-analysis`}
        className="nk-panel-quiet block px-3 py-2.5 transition-colors hover:border-cobalt-200 hover:bg-cobalt-50"
      >
        <div className="nk-eyebrow">The call</div>
        <div className="mt-1 text-[13px] font-medium text-nickel-800">Rules &amp; criteria</div>
      </Link>

      {showRail && (
        <ReviewerSectionRail callId={callId} sections={sections} activeSectionId={activeSectionId} />
      )}

      <div className="border-t border-nickel-200 pt-3">
        <Link
          href={`/reviewer/${callId}/final-review`}
          className="nk-panel-quiet block px-3 py-2.5 transition-colors hover:border-cobalt-200 hover:bg-cobalt-50"
        >
          <div className="nk-eyebrow">Outcome</div>
          <div className="mt-1 text-[13px] font-medium text-nickel-800">Panel report</div>
        </Link>
      </div>
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
