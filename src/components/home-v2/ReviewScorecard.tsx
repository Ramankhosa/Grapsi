'use client'

import { ArrowRight } from 'lucide-react'

import { reviewCriteria, reviewFindings } from './data'

/** Weighted mean over the call's own criteria, so the headline score is derived, not asserted. */
function weighted(key: 'before' | 'after') {
  const total = reviewCriteria.reduce((sum, row) => sum + (parseFloat(row.weight) / 100) * row[key], 0)
  return total.toFixed(1)
}

const SEVERITY = {
  critical: { label: 'Will cost you points', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  major: { label: 'Weakens the case', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
} as const

/**
 * The before/after is the whole argument for the reviewer, so both runs share
 * one baseline and one 0–5 scale and sit on the same row. The findings below are
 * the mechanism: a score with no instruction is just discouraging.
 */
export default function ReviewScorecard() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
      <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">Scored against the call&apos;s own rubric</h3>
          <p className="mt-1 font-home-v2-mono text-[11px] text-muted">ANRF PM Early Career · 4 criteria, weighted</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-nickel-100 px-2.5 py-1.5 font-home-v2-mono text-[13px] font-semibold tabular-nums text-nickel-600">
            {weighted('before')}
          </span>
          <ArrowRight className="h-4 w-4 text-nickel-400" aria-hidden />
          <span className="rounded-lg bg-cobalt-600 px-2.5 py-1.5 font-home-v2-mono text-[13px] font-semibold tabular-nums text-white">
            {weighted('after')}
          </span>
        </div>
      </figcaption>

      <div className="space-y-4 px-5 py-5">
        {reviewCriteria.map((row) => (
          <div key={row.criterion}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-ink-soft">
                {row.criterion} <span className="text-muted">· {row.weight}</span>
              </span>
              <span className="shrink-0 font-home-v2-mono text-[11px] tabular-nums text-muted">
                {row.before.toFixed(1)} <span className="text-nickel-400">→</span>{' '}
                <span className="font-semibold text-cobalt-700">{row.after.toFixed(1)}</span>
              </span>
            </div>
            <div className="mt-2 space-y-1">
              <div className="h-1.5 rounded-full bg-nickel-100">
                <div className="h-1.5 rounded-full bg-nickel-400" style={{ width: `${(row.before / 5) * 100}%` }} />
              </div>
              <div className="h-1.5 rounded-full bg-nickel-100">
                <div className="h-1.5 rounded-full bg-cobalt-600" style={{ width: `${(row.after / 5) * 100}%` }} />
              </div>
            </div>
          </div>
        ))}

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline pt-3.5 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-5 rounded-full bg-nickel-400" /> first draft
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-5 rounded-full bg-cobalt-600" /> after the fixes below
          </span>
          <span className="ml-auto">scale 0&ndash;5</span>
        </p>
      </div>

      <div className="border-t border-hairline bg-inset px-5 py-5">
        <p className="font-home-v2-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          What it told her to fix
        </p>
        <ul className="mt-3.5 space-y-3">
          {reviewFindings.map((item) => (
            <li key={item.finding} className="rounded-xl border border-hairline bg-ground p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 font-home-v2-mono text-[10px] font-semibold uppercase tracking-[0.1em] ring-1 ${
                    SEVERITY[item.severity].className
                  }`}
                >
                  {SEVERITY[item.severity].label}
                </span>
                <span className="font-home-v2-mono text-[11px] text-muted">{item.criterion}</span>
              </div>
              <p className="mt-2.5 text-[13px] leading-6 text-ink">{item.finding}</p>
              <p className="mt-1.5 text-[13px] leading-6 text-cobalt-700">
                <span className="font-medium">Fix:</span> {item.fix}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-5 text-muted">
          Sample review. Every finding names the criterion it costs you points under, so you can decide what is worth
          the time before the deadline.
        </p>
      </div>
    </figure>
  )
}
