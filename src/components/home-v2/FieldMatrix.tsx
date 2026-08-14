'use client'

import { fieldMatrixRows, fieldMatrixYears } from './data'

/**
 * Sequential one-hue heatmap: sub-topic × year, shaded by funded-project count.
 * The point of the graphic is the pale row — the pocket the funder has barely
 * paid for. Counts are printed in the cells, so the chart is its own table view.
 */
const SCALE = [
  { min: 35, bg: '#1d4ed8', text: 'text-white' },
  { min: 25, bg: '#608df9', text: 'text-ink' },
  { min: 15, bg: '#94b4fc', text: 'text-ink' },
  { min: 7, bg: '#c0d3fd', text: 'text-ink' },
  { min: 1, bg: '#dce7fe', text: 'text-ink-soft' },
]

function cellTone(count: number) {
  const step = SCALE.find((entry) => count >= entry.min)
  if (!step) return { style: { backgroundColor: '#ffffff', boxShadow: 'inset 0 0 0 1px #e4e7ec' }, text: 'text-muted' }
  return { style: { backgroundColor: step.bg }, text: step.text }
}

export default function FieldMatrix() {
  return (
    <figure className="rounded-2xl border border-hairline bg-ground p-5 sm:p-6">
      <figcaption className="border-b border-hairline pb-4">
        <h3 className="text-[15px] font-semibold text-ink">Where the funding has already gone</h3>
        <p className="mt-1.5 text-[13px] leading-5 text-muted">
          Funded projects by sub-topic and year. The pale row is the white space.
        </p>
      </figcaption>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full border-separate border-spacing-[2px] text-center">
          <thead>
            <tr>
              <th scope="col" className="w-[38%] min-w-[112px]">
                <span className="sr-only">Sub-topic</span>
              </th>
              {fieldMatrixYears.map((year) => (
                <th
                  key={year}
                  scope="col"
                  className="min-w-[30px] pb-1 font-home-v2-mono text-[10px] font-medium tabular-nums text-muted"
                >
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fieldMatrixRows.map((row) => (
              <tr key={row.topic}>
                <th
                  scope="row"
                  className={`py-1 pr-3 text-left text-[12px] font-normal leading-4 ${
                    row.open ? 'text-ink' : 'text-ink-soft'
                  }`}
                >
                  <span className="flex items-start gap-1.5">
                    {row.open && <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt-600" />}
                    {row.topic}
                  </span>
                </th>
                {row.counts.map((count, index) => {
                  const tone = cellTone(count)
                  return (
                    <td
                      key={fieldMatrixYears[index]}
                      style={tone.style}
                      className={`h-9 rounded-md px-1 font-home-v2-mono text-[11px] tabular-nums ${tone.text}`}
                    >
                      {count}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-hairline pt-4">
        <span className="text-[11px] text-muted">Funded projects</span>
        <span className="font-home-v2-mono text-[11px] text-muted">0</span>
        {['#ffffff', '#dce7fe', '#c0d3fd', '#94b4fc', '#608df9', '#1d4ed8'].map((swatch) => (
          <span
            key={swatch}
            aria-hidden
            className="h-3 w-5 rounded-sm"
            style={{
              backgroundColor: swatch,
              boxShadow: swatch === '#ffffff' ? 'inset 0 0 0 1px #e4e7ec' : undefined,
            }}
          />
        ))}
        <span className="font-home-v2-mono text-[11px] text-muted">40+</span>
      </div>

      <p className="mt-4 text-[12px] leading-5 text-muted">
        <span className="text-ink-soft">Explainable triage for low-resource networks</span> — 6 funded projects in five
        years, the least crowded pocket that still clears the call&apos;s scope. Illustrative data.
      </p>
    </figure>
  )
}
