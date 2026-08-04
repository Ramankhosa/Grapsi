'use client'

import { Compass, Lightbulb, Loader2, ShieldAlert, Sparkles, TrendingDown } from 'lucide-react'

import type { PriorWorkGap, PriorWorkRow } from '@/lib/ideaIntelligence/priorWork'
import { formatDuration, formatMoney } from './format'

export type GapDirection = {
  id: string
  title: string
  stillMissing: string
  example: { projectIdea: string; whatYouWouldBuild: string; firstProof: string }
  relatedFacets: string[]
  confidence: 'strong' | 'moderate' | 'thin'
  bestFitAgency: string | null
  gap?: PriorWorkGap | null
}

const READING_LABELS: Record<PriorWorkGap['reading'], { label: string; style: string; icon: typeof Lightbulb }> = {
  unexplored: { label: 'Unexplored', style: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: Lightbulb },
  attempted_no_output: { label: 'Tried, no output recorded', style: 'border-amber-200 bg-amber-50 text-amber-800', icon: TrendingDown },
  blocked: { label: 'Patent-blocked', style: 'border-rose-200 bg-rose-50 text-rose-800', icon: ShieldAlert },
}

const CONFIDENCE_LABELS: Record<string, string> = {
  strong: 'Well evidenced',
  moderate: 'Some evidence',
  thin: 'Thin evidence',
}

function EffortBand({ gap }: { gap: PriorWorkGap }) {
  const budget = formatMoney(gap.effort?.medianBudget ?? null, gap.effort?.budgetCurrency ?? 'INR')
  const duration = formatDuration(gap.effort?.medianDurationMonths ?? null)
  const chips = [
    budget && duration ? `Work next to this ran ${budget} over ${duration}` : budget ? `Work next to this ran ${budget}` : null,
    gap.latestActivityYear ? `Newest neighbouring award ${gap.latestActivityYear}` : null,
  ].filter(Boolean)
  if (!chips.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
      {chips.map((chip) => <span key={chip} className="rounded-lg bg-slate-50 px-2.5 py-1.5">{chip}</span>)}
      {gap.stale ? (
        <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-800">
          Nothing funded here for {gap.yearsSinceActivity} years — may be a closed field, not an opening
        </span>
      ) : null}
    </div>
  )
}

/**
 * The openings — but each one carries why it is open, which is the part that
 * decides what the researcher does next: pursue it, expect it to be hard, or
 * design around somebody's patent.
 */
export default function GapList({
  directions,
  rows,
  onFindFunders,
  onStrengthen,
  busyId,
}: {
  directions: GapDirection[]
  rows: PriorWorkRow[]
  onFindFunders: (direction: GapDirection) => void
  onStrengthen: (direction: GapDirection) => void
  busyId: string | null
}) {
  const rowsByKey = new Map(rows.map((row) => [row.key, row]))

  if (!directions.length) {
    return (
      <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <Lightbulb className="mx-auto h-7 w-7 text-slate-300" />
        <h2 className="mt-3 font-semibold text-slate-900">No opening could be evidenced</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
          The retrieved records did not give enough assessable text to separate covered ground from open ground. Add
          more technical detail to the idea and re-run.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">What nobody has done yet</h2>
          <p className="mt-1 text-sm text-slate-500">Derived from the empty cells above. Pick one to find who funds it.</p>
        </div>
        <span className="text-xs text-slate-500">{directions.length} direction{directions.length === 1 ? '' : 's'}</span>
      </div>

      <div className="mt-4 space-y-4">
        {directions.map((direction, index) => {
          const reading = direction.gap ? READING_LABELS[direction.gap.reading] : null
          const ReadingIcon = reading?.icon
          const blocking = (direction.gap?.blockingRowKeys || [])
            .map((key) => rowsByKey.get(key))
            .filter((row): row is PriorWorkRow => Boolean(row))

          return (
            <article key={direction.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-800 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold leading-7 text-slate-900">{direction.title}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {reading && ReadingIcon ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${reading.style}`}>
                          <ReadingIcon className="h-3 w-3" /> {reading.label}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-500">
                        {CONFIDENCE_LABELS[direction.confidence] || direction.confidence}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {direction.gap ? (
                <p className="mt-3 text-sm leading-6 text-slate-700">
                  <span className="font-semibold text-slate-900">Why it is open:</span> {direction.gap.readingBasis}
                </p>
              ) : null}

              {direction.stillMissing ? (
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  <span className="font-semibold text-slate-800">Still missing:</span> {direction.stillMissing}
                </p>
              ) : null}

              {blocking.length ? (
                <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/60 p-3">
                  <p className="text-xs font-semibold text-rose-800">Already claimed by</p>
                  <ul className="mt-1.5 space-y-1">
                    {blocking.slice(0, 3).map((row) => (
                      <li key={row.key} className="text-xs leading-5 text-rose-900">
                        {row.patent?.publicationNumber ? <span className="font-semibold">{row.patent.publicationNumber}</span> : null}
                        {row.patent?.publicationNumber ? ' — ' : null}
                        {row.title}
                        {row.org ? <span className="text-rose-700"> ({row.org})</span> : null}
                        {row.patent?.url ? (
                          <a href={row.patent.url} target="_blank" rel="noreferrer" className="ml-1.5 font-semibold underline">read</a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs leading-5 text-rose-800">
                    A proposal here needs a design-around, not just a stronger case.
                  </p>
                </div>
              ) : null}

              {direction.example.firstProof || direction.example.projectIdea ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {direction.example.projectIdea ? (
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-500">What a project here looks like</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{direction.example.projectIdea}</p>
                    </div>
                  ) : null}
                  {direction.example.firstProof ? (
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-500">First proof (6-12 months)</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{direction.example.firstProof}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {direction.gap ? <EffortBand gap={direction.gap} /> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onFindFunders(direction)}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-900"
                >
                  <Compass className="h-4 w-4" /> Who funds this?
                </button>
                <button
                  type="button"
                  onClick={() => onStrengthen(direction)}
                  disabled={Boolean(busyId)}
                  className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyId === direction.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Take my idea here
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
