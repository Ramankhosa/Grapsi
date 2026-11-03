'use client'

import { Database } from 'lucide-react'

import { PATENT_SEARCH_LIMITS } from '@/lib/patentIntelligence/searchCore'
import type { PatentSearchCoverage, PatentUpstreamRemaining } from '@/lib/patentIntelligence/types'
import type { PatentNestPagination, PatentNestSearchMode } from '@/lib/patentnest/types'

const LOW_DAILY_REMAINING = 100

function formatCount(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

/**
 * The transparency line under the hero: what corpus was searched, how big it
 * is, and whether this is a ranked shortlist or a structured result page.
 */
export default function PatentCoverageLine({
  coverage, resultCount, limit, capped, cached, upstreamRemaining, mode, pagination,
}: {
  coverage: PatentSearchCoverage | null
  resultCount: number
  limit: number
  capped: boolean
  cached: boolean
  upstreamRemaining: PatentUpstreamRemaining | null
  mode?: PatentNestSearchMode
  pagination?: PatentNestPagination
}) {
  const corpusLabel = coverage?.description || coverage?.corpus || 'the PatentNest patent corpus'
  const bits = [
    coverage?.jurisdictions?.length ? `offices ${coverage.jurisdictions.join(', ')}` : coverage?.jurisdiction ? `jurisdiction ${coverage.jurisdiction}` : null,
    coverage?.documents != null ? `${formatCount(coverage.documents)} documents` : null,
    coverage?.semanticCoveragePercent != null ? `${Math.round(coverage.semanticCoveragePercent)}% semantically indexed` : null,
  ].filter(Boolean)
  const lowAllowance = upstreamRemaining?.daily != null && upstreamRemaining.daily < LOW_DAILY_REMAINING

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600" aria-live="polite">
      <Database className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-slate-800">Searched PatentNest</span>
        {' — '}
        {corpusLabel}
        {bits.length ? ` (${bits.join(' · ')})` : ''}.
        {' '}
        {mode === 'structured'
          ? `${resultCount} publications on this page.${pagination?.hasMore && pagination.nextOffset === null ? ' More matches exist beyond the browse limit; narrow the filters to continue.' : pagination?.hasMore ? ' More matches are available on the next page.' : ' End of matches.'}`
          : capped
          ? (limit < PATENT_SEARCH_LIMITS.max
            ? `Showing the top ${resultCount} by relevance — raise “Results per search” (up to ${PATENT_SEARCH_LIMITS.max}) or refine the query to surface different patents.`
            : `Showing the top ${resultCount} by relevance — PatentNest returns at most ${PATENT_SEARCH_LIMITS.max} per search, so refine or rephrase the query to surface different patents.`)
          : `${resultCount} matching patent${resultCount === 1 ? '' : 's'}; refine the query to explore adjacent ground.`}
        {cached ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> cached</span> : null}
      </p>
      {coverage?.sources?.length ? <div className="w-full space-y-1">{coverage.sources.map((source, index) => <p key={`${source.corpus}-${index}`}>{source.description || source.corpus}{source.documents != null ? ` · ${formatCount(source.documents)} documents` : ''}{source.semanticCoveragePercent != null ? ` · ${Math.round(source.semanticCoveragePercent)}% indexed` : ''}{source.license ? ` · ${source.license}` : ''}{source.attribution ? ` · ${source.attribution}` : ''}</p>)}</div> : null}
      {coverage?.limitations?.length ? <ul className="w-full list-disc space-y-1 pl-4 text-amber-800">{coverage.limitations.map(text => <li key={text}>{text}</li>)}</ul> : null}
      {lowAllowance ? (
        <p className="w-full text-amber-700">Only {upstreamRemaining?.daily} searches left in today&apos;s shared PatentNest allowance.</p>
      ) : null}
    </div>
  )
}
