'use client'

import { fieldFunders } from './data'

const MAX_PROJECTS = Math.max(...fieldFunders.map((funder) => funder.projects))

/**
 * Single-series magnitude chart: bar length is funded-project count, one hue for
 * every bar. Laid out as a table so the plot column is identical on every row —
 * bar lengths are only comparable if they share a baseline and a scale — and
 * every value is direct-labelled at the tip rather than hidden in a tooltip.
 */
export default function FundedByFunder() {
  return (
    <figure className="rounded-2xl border border-hairline bg-ground p-5 sm:p-6">
      <figcaption className="border-b border-hairline pb-4">
        <h3 className="text-[15px] font-semibold text-ink">Who funds work like yours</h3>
        <p className="mt-1.5 text-[13px] leading-5 text-muted">
          Funded projects matching &ldquo;AI for adaptive health systems&rdquo;, 2021–2025.
        </p>
      </figcaption>

      <table className="mt-4 w-full">
        <caption className="sr-only">Funded projects and total awarded, by funder, 2021 to 2025</caption>
        <tbody>
          {fieldFunders.map((funder) => (
            <tr key={funder.name}>
              <th scope="row" className="whitespace-nowrap py-2.5 pr-4 text-left text-[13px] font-normal text-ink-soft">
                {funder.name}
              </th>
              <td className="w-full py-2.5">
                <span className="flex h-2.5 items-center border-l border-hairline">
                  <span
                    className="h-2.5 rounded-r-[4px] bg-cobalt-600"
                    style={{ width: `${(funder.projects / MAX_PROJECTS) * 100}%` }}
                  />
                </span>
              </td>
              <td className="whitespace-nowrap py-2.5 pl-4 text-right font-home-v2-mono text-[11px] tabular-nums text-ink">
                {funder.projects}
                <span className="ml-2 text-muted">{funder.awarded}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-5 border-t border-hairline pt-4 text-[12px] leading-5 text-muted">
        Bar length = funded projects; the figure beside it is total awarded. Closest precedent to your idea:{' '}
        <span className="text-ink-soft">GA-101094521 · €1.2M · 2024</span>. Illustrative data.
      </p>
    </figure>
  )
}
