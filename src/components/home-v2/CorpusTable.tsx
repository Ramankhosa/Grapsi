'use client'

import { Search } from 'lucide-react'

import { corpusRows } from './data'

/**
 * The corpus made touchable: a query, filter chips, and the rows that come back.
 * Framed as a search result rather than a static table because the claim being
 * made is "you can interrogate this", not "we have a big number".
 */
export default function CorpusTable() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
      <figcaption className="border-b border-hairline px-5 py-4">
        <span className="flex items-center gap-2.5 rounded-lg border border-hairline bg-inset px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <span className="truncate text-[13px] text-ink-soft">energy storage and semiconductor materials</span>
        </span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          {['agency: all Indian', 'years: 2023–2025', 'award: ₹20L+'].map((chip) => (
            <span
              key={chip}
              className="rounded-md border border-hairline bg-ground px-2 py-1 font-home-v2-mono text-[10px] text-muted"
            >
              {chip}
            </span>
          ))}
        </span>
      </figcaption>

      <div className="-mx-px overflow-x-auto">
        <table className="w-full min-w-[480px] text-left font-home-v2-mono text-[11px]">
          <thead>
            <tr>
              {['Agency', 'Topic cluster', 'Median award', 'Year', 'Projects'].map((head, index) => (
                <th
                  key={head}
                  scope="col"
                  className={`border-b border-hairline px-4 py-2.5 font-medium uppercase tracking-[0.1em] text-muted ${
                    index >= 2 ? 'text-right' : ''
                  }`}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corpusRows.map((row) => (
              <tr key={row.join('-')} className="border-b border-hairline last:border-b-0">
                {row.map((cell, index) => (
                  <td
                    key={cell}
                    className={`px-4 py-3 ${index === 0 ? 'font-semibold text-ink' : 'text-ink-soft'} ${
                      index >= 2 ? 'text-right tabular-nums' : ''
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-hairline bg-inset px-5 py-3.5 text-[12px] leading-5 text-muted">
        <span className="font-home-v2-mono font-semibold text-ink">2,109</span> projects match this query, out of{' '}
        <span className="font-home-v2-mono font-semibold text-ink">50,000+</span> funded by Indian government agencies.
        Open any row to read the sanctioned title, the PI&apos;s institution and the amount. Illustrative data.
      </p>
    </figure>
  )
}
