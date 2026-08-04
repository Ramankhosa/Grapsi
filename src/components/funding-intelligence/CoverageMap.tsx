'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import type { CoverageCell, CoverageRow, PriorWorkRow } from '@/lib/ideaIntelligence/priorWork'

const CELL_STYLES: Record<string, string> = {
  PRESENT: 'bg-rose-50 text-rose-700 border-rose-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
  ABSENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UNASSESSED: 'bg-slate-50 text-slate-500 border-slate-200',
}

function cellLabel(cell: CoverageCell, unit: string) {
  if (cell.status === 'UNASSESSED') return 'not assessable'
  if (!cell.rowKeys.length) return '—'
  return `${cell.rowKeys.length} ${unit}${cell.rowKeys.length === 1 ? '' : 's'}`
}

function Cell({
  cell,
  unit,
  rowsByKey,
  expanded,
  onToggle,
}: {
  cell: CoverageCell
  unit: string
  rowsByKey: Map<string, PriorWorkRow>
  expanded: boolean
  onToggle: () => void
}) {
  const label = cellLabel(cell, unit)
  const clickable = cell.rowKeys.length > 0
  return (
    <div>
      <button
        type="button"
        onClick={clickable ? onToggle : undefined}
        disabled={!clickable}
        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${CELL_STYLES[cell.status] || CELL_STYLES.UNASSESSED} ${
          clickable ? 'hover:brightness-95' : 'cursor-default'
        }`}
      >
        {label}
        {clickable ? <ChevronDown className={`h-3 w-3 transition ${expanded ? 'rotate-180' : ''}`} /> : null}
      </button>
      {expanded ? (
        <ul className="mt-2 space-y-1">
          {cell.rowKeys.map((key) => {
            const row = rowsByKey.get(key)
            if (!row) return null
            return (
              <li key={key} className="text-[11px] leading-4 text-slate-500">
                {row.title}
                {row.org ? <span className="text-slate-400"> — {row.org}</span> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The analysis, as a grid rather than a paragraph: every aspect of the idea
 * against what covers it in each corpus. The openings are the empty rows, so the
 * researcher derives them instead of being told.
 */
export default function CoverageMap({
  coverage,
  rows,
  patentsSearched,
}: {
  coverage: CoverageRow[]
  rows: PriorWorkRow[]
  patentsSearched: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!coverage.length) return null
  const rowsByKey = new Map(rows.map((row) => [row.key, row]))
  const openCount = coverage.filter((entry) => entry.open).length

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">What that prior work covers</h2>
          <p className="mt-1 text-sm text-slate-500">
            Each aspect of your idea against the work above. Click a cell to see which items produced it.
          </p>
        </div>
        <span className="text-xs font-semibold text-emerald-700">
          {openCount} of {coverage.length} aspects uncovered
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="pb-2 pr-4 font-semibold">Aspect of your idea</th>
              <th className="pb-2 pr-4 font-semibold">Funded work</th>
              <th className="pb-2 font-semibold">{patentsSearched ? 'Patents' : 'Patents (not searched)'}</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((entry) => (
              <tr key={entry.facet} className={`border-b border-slate-100 last:border-0 ${entry.open ? 'bg-emerald-50/30' : ''}`}>
                <td className="py-3 pr-4 align-top font-medium text-slate-800">
                  {entry.facet}
                  {entry.open ? (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">Open</span>
                  ) : null}
                </td>
                <td className="py-3 pr-4 align-top">
                  <Cell
                    cell={entry.funded}
                    unit="award"
                    rowsByKey={rowsByKey}
                    expanded={expanded === `${entry.facet}:funded`}
                    onToggle={() => setExpanded((current) => (current === `${entry.facet}:funded` ? null : `${entry.facet}:funded`))}
                  />
                </td>
                <td className="py-3 align-top">
                  <Cell
                    cell={entry.patented}
                    unit="patent"
                    rowsByKey={rowsByKey}
                    expanded={expanded === `${entry.facet}:patented`}
                    onToggle={() => setExpanded((current) => (current === `${entry.facet}:patented` ? null : `${entry.facet}:patented`))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">
        &quot;Open&quot; means the retrieved records actively show no funded coverage — not that nothing exists anywhere.
        &quot;Not assessable&quot; means the sources were too thin to judge, which is not the same as empty.
      </p>
    </section>
  )
}
