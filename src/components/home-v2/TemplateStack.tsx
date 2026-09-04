'use client'

import { Check, FileText } from 'lucide-react'

import { templates } from './data'

/** One agency's outline, opened. The notes are the part you cannot get from a blank form. */
const OUTLINE = [
  { section: '1. Title and abstract', note: 'The phrasing DST indexes on' },
  { section: '2. Objectives', note: 'Three to five, each with a deliverable' },
  { section: '3. Work packages and timeline', note: 'Gantt with named responsibilities' },
  { section: '4. TRL statement', note: 'Start TRL and target TRL, stated plainly' },
  { section: '5. Industry partner letter', note: 'Present in 19 of 24 funded awards' },
  { section: '6. Budget by head', note: 'Every line tied to a work package' },
]

export default function TemplateStack() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
      <ul className="space-y-2.5">
        {templates.map((template, index) => (
          <li
            key={template.agency}
            className={`rounded-xl border p-4 ${
              index === 1 ? 'border-cobalt-200 bg-cobalt-50/60' : 'border-hairline bg-ground'
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-semibold text-ink">{template.agency}</p>
              <p className="shrink-0 font-home-v2-mono text-[10px] text-muted">{template.sections} sections</p>
            </div>
            <p className="mt-0.5 font-home-v2-mono text-[11px] text-cobalt-700">{template.kind}</p>
            <p className="mt-2 text-[12px] leading-5 text-muted">{template.note}</p>
          </li>
        ))}
      </ul>

      <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
        <figcaption className="flex items-center gap-2 border-b border-hairline px-5 py-3.5">
          <FileText className="h-4 w-4 text-cobalt-600" aria-hidden />
          <span className="text-[13px] font-semibold text-ink">DST Technology Mission — outline</span>
        </figcaption>

        <ol className="divide-y divide-hairline">
          {OUTLINE.map((row) => (
            <li key={row.section} className="flex items-start gap-3 px-5 py-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-5 text-ink">{row.section}</span>
                <span className="block text-[12px] leading-5 text-muted">{row.note}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="border-t border-hairline bg-inset px-5 py-3.5 text-[12px] leading-5 text-muted">
          Structure drawn from proposals this agency has funded. You still write the science — the template stops you
          losing points on the parts that are not science. Illustrative data.
        </p>
      </figure>
    </div>
  )
}
