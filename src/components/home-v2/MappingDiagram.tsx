'use client'

import { ArrowRight, FileText, Target } from 'lucide-react'

import { mappingProfile } from './data'

/**
 * Three-stage flow: what the researcher gives us, what it becomes, and what
 * comes back. Read left-to-right on desktop, top-to-bottom on a phone — the
 * chevrons rotate rather than disappear, so the direction of the flow never
 * gets lost.
 */
export default function MappingDiagram() {
  const { name, role, inputs, disciplines, result } = mappingProfile

  return (
    <figure className="rounded-2xl border border-hairline bg-ground p-5 sm:p-6">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-4">
        <h3 className="text-[15px] font-semibold text-ink">{name}</h3>
        <p className="font-home-v2-mono text-[11px] text-muted">{role}</p>
      </figcaption>

      <div className="mt-5 grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* Stage 1 — what you hand over */}
        <div className="rounded-xl border border-hairline bg-inset p-4">
          <p className="flex items-center gap-2 font-home-v2-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            You give us
          </p>
          <ul className="mt-3 space-y-2">
            {inputs.map((input) => (
              <li key={input.label} className="rounded-lg border border-hairline bg-ground px-3 py-2">
                <p className="text-[13px] font-medium text-ink">{input.label}</p>
                <p className="mt-0.5 text-[12px] leading-5 text-muted">{input.detail}</p>
              </li>
            ))}
          </ul>
        </div>

        <ArrowRight
          aria-hidden
          className="mx-auto h-4 w-4 rotate-90 text-nickel-400 lg:rotate-0"
        />

        {/* Stage 2 — the mapping itself */}
        <div className="rounded-xl border border-cobalt-100 bg-cobalt-50/50 p-4">
          <p className="flex items-center gap-2 font-home-v2-mono text-[10px] uppercase tracking-[0.16em] text-cobalt-700">
            <Target className="h-3.5 w-3.5" aria-hidden />
            Mapped to 4 of 49 disciplines
          </p>
          <ul className="mt-3 space-y-2.5">
            {disciplines.map((discipline) => (
              <li key={discipline.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] text-ink-soft">{discipline.name}</span>
                  <span className="font-home-v2-mono text-[11px] tabular-nums text-muted">{discipline.weight}%</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-cobalt-100">
                  <div className="h-1.5 rounded-full bg-cobalt-600" style={{ width: `${discipline.weight}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Stage 3 — what comes back */}
      <div className="mt-3 flex flex-col items-center gap-3">
        <ArrowRight aria-hidden className="h-4 w-4 rotate-90 text-nickel-400" />
        <dl className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline">
          {[
            [result.scanned, 'calls scanned'],
            [result.eligible, 'you are eligible for'],
            [result.strong, 'strong matches'],
          ].map(([value, label], index) => (
            <div key={label as string} className="bg-ground px-3 py-4 text-center">
              <dd
                className={`font-home-v2-mono text-[22px] font-semibold tabular-nums tracking-tight ${
                  index === 2 ? 'text-cobalt-600' : 'text-ink'
                }`}
              >
                {value as number}
              </dd>
              <dt className="mt-1 text-[12px] leading-4 text-muted">{label as string}</dt>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-4 border-t border-hairline pt-4 text-[12px] leading-5 text-muted">
        Sample profile. Percentages are how strongly the profile sits in each discipline — the same scale every call is
        placed on, which is what makes a fit score mean something.
      </p>
    </figure>
  )
}
