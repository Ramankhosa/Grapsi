'use client'

import { Search, ShieldCheck } from 'lucide-react'

import { patentQuery, patentResults, patentVerdict } from './data'

/**
 * Prior-art results ranked by closeness, each annotated with *what* overlaps —
 * a bare relevance number tells a researcher nothing. The verdict panel states
 * the gap in the words the proposal will actually use.
 */
export default function PatentSearch() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
      <figcaption className="border-b border-hairline px-5 py-4">
        <span className="flex items-center gap-2.5 rounded-lg border border-hairline bg-inset px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <span className="truncate text-[13px] text-ink-soft">{patentQuery}</span>
        </span>
        <span className="mt-2.5 block font-home-v2-mono text-[11px] text-muted">
          {patentVerdict.searched} Indian patents matched · 3 closest shown
        </span>
      </figcaption>

      <ul className="divide-y divide-hairline">
        {patentResults.map((patent) => (
          <li key={patent.number} className="px-5 py-4">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-home-v2-mono text-[11px] font-semibold text-cobalt-700">{patent.number}</p>
                <p className="mt-1 text-[13px] font-medium leading-5 text-ink">{patent.title}</p>
                <p className="mt-1 font-home-v2-mono text-[11px] text-muted">
                  {patent.assignee} · {patent.year}
                </p>
              </div>
              <div className="w-16 shrink-0">
                <p className="text-right font-home-v2-mono text-[11px] font-semibold tabular-nums text-ink">
                  {patent.relevance}%
                </p>
                <div className="mt-1.5 h-1 rounded-full bg-nickel-100">
                  <div className="h-1 rounded-full bg-nickel-400" style={{ width: `${patent.relevance}%` }} />
                </div>
              </div>
            </div>
            <p className="mt-2.5 rounded-md bg-inset px-3 py-1.5 text-[12px] leading-5 text-muted">{patent.overlap}</p>
          </li>
        ))}
      </ul>

      <div className="border-t border-hairline bg-emerald-50/70 px-5 py-4">
        <p className="flex items-center gap-2 font-home-v2-mono text-[10px] uppercase tracking-[0.16em] text-emerald-800">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Novelty gap found
        </p>
        <p className="mt-2.5 text-[13px] leading-6 text-ink-soft">{patentVerdict.claim}</p>
        <p className="mt-2 font-home-v2-mono text-[11px] text-muted">
          Closest prior art scores {patentVerdict.closest}% and does not read on the claim.
        </p>
      </div>

      <p className="border-t border-hairline px-5 py-3 text-[12px] leading-5 text-muted">
        Sample search over Indian patent records. Shortlisted patents stay attached to the idea, so the novelty
        argument is still there when you write the proposal. Illustrative data.
      </p>
    </figure>
  )
}
