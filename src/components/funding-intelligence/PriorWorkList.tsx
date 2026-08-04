'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ExternalLink, FileText, Landmark, Layers } from 'lucide-react'

import type { PriorWorkRow, PriorWorkSummary } from '@/lib/ideaIntelligence/priorWork'
import { formatDuration, formatMoney } from './format'

const DEFAULT_VISIBLE = 12

type Filter = 'all' | 'funded' | 'patented'

function AwardMeta({ row }: { row: PriorWorkRow }) {
  if (!row.award) return null
  const amount = formatMoney(row.award.budgetAmount, row.award.budgetCurrency)
  const duration = formatDuration(row.award.durationMonths)
  const parts = [
    row.org,
    row.award.agencyName,
    amount,
    duration,
    row.year ? String(row.year) : null,
    row.award.schemeName,
  ].filter(Boolean)
  return <p className="mt-1 text-xs leading-5 text-slate-500">{parts.join(' · ')}</p>
}

function PatentMeta({ row }: { row: PriorWorkRow }) {
  if (!row.patent) return null
  const parts = [
    row.org,
    row.patent.publicationNumber,
    row.patent.jurisdictions.length ? row.patent.jurisdictions.join('/') : null,
    row.patent.familySize > 1 ? `${row.patent.familySize} filings of one invention` : null,
    row.year ? String(row.year) : null,
  ].filter(Boolean)
  return <p className="mt-1 text-xs leading-5 text-slate-500">{parts.join(' · ')}</p>
}

/**
 * Awards and patents in ONE ranked list. They are two ways of saying "someone
 * already did this", and splitting them into tabs hides the fact that matters
 * most: the same organisation often appears in both.
 */
export default function PriorWorkList({
  rows,
  summary,
  highlightKeys = [],
}: {
  rows: PriorWorkRow[]
  summary: PriorWorkSummary
  highlightKeys?: string[]
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [showAll, setShowAll] = useState(false)
  const highlighted = useMemo(() => new Set(highlightKeys), [highlightKeys])

  const filtered = useMemo(() => (
    filter === 'all' ? rows : rows.filter((row) => (filter === 'funded' ? row.kind === 'funded' : row.kind === 'patented'))
  ), [filter, rows])
  const visible = showAll ? filtered : filtered.slice(0, DEFAULT_VISIBLE)

  const collapsedNote = [
    summary.duplicateAwardsCollapsed ? `${summary.duplicateAwardsCollapsed} duplicate award${summary.duplicateAwardsCollapsed === 1 ? '' : 's'} merged` : null,
    summary.patentFamiliesCollapsed ? `${summary.patentFamiliesCollapsed} family filing${summary.patentFamiliesCollapsed === 1 ? '' : 's'} merged` : null,
  ].filter(Boolean).join(' · ')

  if (!rows.length) {
    return (
      <section id="prior-work" className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <Layers className="mx-auto h-7 w-7 text-slate-300" />
        <h2 className="mt-3 font-semibold text-slate-900">No comparable prior work was retrieved</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
          Nothing in the sanctioned-award corpus or the patent corpus matched this idea closely enough to compare
          against. Add more technical detail and re-run before treating that as an open field.
        </p>
      </section>
    )
  }

  const filters: Array<[Filter, string, number]> = [
    ['all', 'All', summary.totalRows],
    ['funded', 'Funded', summary.fundedRows],
    ['patented', 'Patented', summary.patentedRows],
  ]

  return (
    <section id="prior-work" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Prior work on this idea</h2>
          <p className="mt-1 text-sm text-slate-500">
            What has already been funded or patented in this space, closest to your idea first.
            {collapsedNote ? <span className="text-slate-400"> {collapsedNote}.</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setFilter(value); setShowAll(false) }}
              disabled={count === 0}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                filter === value ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 divide-y divide-slate-100">
        {visible.map((row) => {
          const isAward = row.kind === 'funded'
          return (
            <article
              key={row.key}
              className={`flex flex-wrap items-start gap-4 py-4 ${highlighted.has(row.key) ? '-mx-3 rounded-xl bg-amber-50 px-3' : ''}`}
            >
              <span
                className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  isAward ? 'bg-teal-50 text-teal-800' : 'bg-indigo-50 text-indigo-700'
                }`}
              >
                {isAward ? <Landmark className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                {isAward ? 'Funded' : 'Patented'}
              </span>

              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-6 text-slate-900">{row.title}</h3>
                {isAward ? <AwardMeta row={row} /> : <PatentMeta row={row} />}

                {row.facetsCovered.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.facetsCovered.map((facet) => (
                      <span key={facet} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{facet}</span>
                    ))}
                  </div>
                ) : null}

                <p className="mt-2 text-xs leading-5 text-slate-500">{row.matchBasis}</p>

                {isAward && row.award?.patentCount ? (
                  <p className="mt-1.5 text-xs font-semibold text-indigo-700">
                    This award reported {row.award.patentCount} patent{row.award.patentCount === 1 ? '' : 's'} — its funder pays for work that produces IP.
                  </p>
                ) : null}
              </div>

              {isAward && row.award ? (
                <Link
                  href={`/funding/intelligence/projects/${row.award.id}`}
                  className="shrink-0 text-xs font-semibold text-teal-700 hover:underline"
                >
                  Open award
                </Link>
              ) : row.patent?.url ? (
                <a
                  href={row.patent.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"
                >
                  Read patent <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </article>
          )
        })}
      </div>

      {filtered.length > DEFAULT_VISIBLE ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          {showAll ? `Show top ${DEFAULT_VISIBLE}` : `Show all ${filtered.length}`}
        </button>
      ) : null}
    </section>
  )
}
