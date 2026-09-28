'use client'

// Prior work in the panel report: the research & patent landscape, the flags
// that reconcile it with the panel's own words, and the compact snapshot that
// puts it next to the novelty verdict at the top of the report.
//
// Shared by every rendering of the report — the owner's page, the public share
// link, the proposal desk's frozen copy and the admin archive — so none of them
// can drop it again. Deterministic rendering of stored JSON; no fetching.

import PriorWorkList from '@/components/funding-intelligence/PriorWorkList'
import CoverageMap from '@/components/funding-intelligence/CoverageMap'
import type { PriorWorkRow } from '@/lib/ideaIntelligence/priorWork'
import { describeLandscapeRun, summarizeLandscape, type LandscapeNotice } from '@/lib/reviewer/landscapeCore'

const NOTICE_STYLES: Record<LandscapeNotice['tone'], string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  info: 'border-nickel-200 bg-nickel-50 text-nickel-700',
}

/**
 * The patent detail page inside Patent Search. PatentNest records carry no
 * public URL, so without this a patent row in the report was never a link.
 * Only for signed-in surfaces; that page sits behind Funding Intelligence.
 */
export function patentSearchHref(row: PriorWorkRow): string | null {
  const number = row.patent?.publicationNumber?.trim()
  return number ? `/funding/intelligence/patents/${encodeURIComponent(number)}` : null
}

export function LandscapeNotices({ landscape }: { landscape: any }) {
  const notices = describeLandscapeRun(landscape)
  if (!notices.length) return null
  return (
    <div className="space-y-2">
      {notices.map((notice, index) => (
        <p key={`notice-${index}`} className={`rounded-md border px-3 py-2 text-sm ${NOTICE_STYLES[notice.tone]}`}>
          {notice.text}
        </p>
      ))}
    </div>
  )
}

const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-red-50 text-red-800 border-red-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  low: 'bg-nickel-50 text-nickel-600 border-nickel-200',
}

export function PriorWorkFlags({ flags }: { flags: any[] }) {
  if (!Array.isArray(flags) || !flags.length) return null
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-nickel-700">What the prior-work check flags</h3>
      <ul className="space-y-2">
        {flags.map((flag: any, index: number) => (
          <li key={`pwf-${index}`} className="rounded-md border border-nickel-200 p-3 text-sm">
            <div className="flex flex-wrap items-start gap-2">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[flag?.severity] || SEVERITY_STYLES.medium}`}>
                {flag?.severity || 'medium'}
              </span>
              <span className="flex-1 text-nickel-900">{flag?.issue}</span>
            </div>
            {flag?.action ? <p className="mt-1.5 text-nickel-600">{flag.action}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The prior-work headline for the top of the report: what was found, which
 * aspects are already patented, and a way down to the full list. Patents used
 * to appear only in the last panel on the page, below every section card.
 */
export function PriorWorkSnapshot({ landscape }: { landscape: any }) {
  const summary = summarizeLandscape(landscape)
  if (!summary) return null
  const nothingRetrieved = summary.fundedCount + summary.patentCount === 0
  return (
    <div className="rounded-md border border-nickel-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-nickel-800">Prior work at a glance</h3>
        <a href="#landscape" className="text-xs text-cobalt-700 hover:underline print:hidden">Full landscape ↓</a>
      </div>
      {summary.searchFailed && nothingRetrieved ? (
        <p className="mt-2 text-sm text-red-700">
          The prior-work search did not complete for this report, so nothing below means the field is open.
        </p>
      ) : (
        <p className="mt-2 text-sm text-nickel-700">
          <strong className="text-nickel-900">{summary.patentCount}</strong> comparable Indian patent{summary.patentCount === 1 ? '' : 's'} and{' '}
          <strong className="text-nickel-900">{summary.fundedCount}</strong> already-funded project{summary.fundedCount === 1 ? '' : 's'} retrieved
          {summary.searchFailed ? <span className="text-amber-700"> — one search failed for this run</span> : null}.
        </p>
      )}
      {summary.patentedAspects.length ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-nickel-500">Aspects already patented</p>
          <ul className="mt-1 space-y-1 text-sm">
            {summary.patentedAspects.slice(0, 4).map((aspect) => (
              <li key={aspect.facet} className="flex flex-wrap gap-x-2">
                <span className="text-nickel-900">{aspect.facet}</span>
                <span className="text-nickel-500">— {aspect.numbers.join(', ') || 'retrieved patent'}</span>
                {aspect.unfunded ? <span className="text-xs font-medium text-red-700">no funded work found · design around</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary.openAspects.length ? (
        <p className="mt-3 text-sm text-nickel-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-nickel-500">No retrieved award or patent covers: </span>
          {summary.openAspects.slice(0, 4).join('; ')}
        </p>
      ) : null}
    </div>
  )
}

/** The full landscape panel body. */
export function ReportLandscape({
  landscape,
  linkAwards = true,
  patentHref,
}: {
  landscape: any
  linkAwards?: boolean
  patentHref?: (row: PriorWorkRow) => string | null
}) {
  if (!landscape) return null
  const rows: PriorWorkRow[] = Array.isArray(landscape.priorWork?.rows) ? landscape.priorWork.rows : []
  const summary = summarizeLandscape(landscape)
  return (
    <div className="space-y-4">
      <LandscapeNotices landscape={landscape} />
      {summary && (summary.openAspects.length || summary.hardAspects.length) ? (
        <div className="grid gap-3 md:grid-cols-2">
          {summary.openAspects.length ? (
            <div className="rounded-md bg-green-50 p-3 text-sm">
              <p className="font-semibold text-green-800">Looks open</p>
              <p className="mt-1 text-nickel-700">No retrieved award or patent covers: {summary.openAspects.join('; ')}.</p>
            </div>
          ) : null}
          {summary.hardAspects.length ? (
            <div className="rounded-md bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-800">Tried before, no output</p>
              <p className="mt-1 text-nickel-700">Completed awards worked on these and reported nothing: {summary.hardAspects.join('; ')}. Treat as hard, not empty.</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <>
          <PriorWorkList
            rows={rows}
            summary={landscape.priorWork.summary}
            linkAwards={linkAwards}
            patentHref={patentHref}
          />
          {landscape.priorWork.coverage?.length > 0 ? (
            <CoverageMap
              coverage={landscape.priorWork.coverage}
              rows={rows}
              patentsSearched={landscape.sources?.patents?.status === 'ok'}
            />
          ) : null}
        </>
      ) : null}
      <p className="text-xs text-nickel-500">
        {`Similar funded projects: ${landscape.sources?.projects?.count ?? 0} retrieved from the sanctioned-project corpus. `}
        {landscape.sources?.patents?.status === 'ok'
          ? `Indian patents searched via PatentNest (${landscape.sources.patents.count} retrieved).`
          : landscape.sources?.patents?.status === 'not_configured'
            ? 'Indian patents not searched — patent search is not configured on this server.'
            : 'Indian patent search failed for this run.'}
        {' '}Reference only — none of this affects the score.
      </p>
    </div>
  )
}
