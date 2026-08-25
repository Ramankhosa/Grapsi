'use client'

import { Bookmark, ChevronRight } from 'lucide-react'

import type { PatentShortlistState } from './usePatentShortlist'

/** Compact aside card: how many patents are saved, the latest three, and the way into the drawer. */
export default function ShortlistRail({ shortlist, onOpen, runId }: {
  shortlist: PatentShortlistState
  onOpen: () => void
  runId?: string | null
}) {
  const linked = runId ? shortlist.items.filter((item) => item.ideaRunId === runId).length : 0
  const recent = shortlist.items.slice(0, 3)
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-teal-700" />
          <h2 className="text-sm font-semibold text-slate-900">Your shortlist</h2>
        </div>
        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold tabular-nums text-teal-800">{shortlist.items.length}</span>
      </div>
      {recent.length ? (
        <ul className="mt-3 space-y-2">
          {recent.map((item) => (
            <li key={item.id} className="truncate text-xs text-slate-600" title={item.record.title}>
              <span className="font-mono text-[10px] text-slate-400">{item.publicationNumber}</span>{' '}{item.record.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500">Save the patents worth citing; export them when you write the prior-art section.</p>
      )}
      {runId && linked ? <p className="mt-2 text-[11px] text-slate-500">{linked} linked to this analysis</p> : null}
      <button type="button" onClick={onOpen} className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        Open shortlist <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </section>
  )
}
