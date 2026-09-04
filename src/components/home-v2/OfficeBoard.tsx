'use client'

import { AlertTriangle, TrendingUp } from 'lucide-react'

import { officeAlerts, officeRows } from './data'

const TONE = {
  urgent: { icon: AlertTriangle, className: 'border-rose-200 bg-rose-50 text-rose-800' },
  watch: { icon: AlertTriangle, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  good: { icon: TrendingUp, className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
} as const

/**
 * The research office's actual working view: matched → claimed → submitted per
 * school, with the drop-off visible in one glance. The claimed bar is drawn as a
 * proportion of matched, because the gap between those two columns is the entire
 * job of the office.
 */
export default function OfficeBoard() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-4">
        <h3 className="text-[15px] font-semibold text-ink">This funding window, by school</h3>
        <span className="font-home-v2-mono text-[11px] text-muted">Jul&ndash;Dec 2026</span>
      </figcaption>

      <div className="-mx-px overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr className="border-b border-hairline">
              <th scope="col" className="px-5 py-2.5 font-home-v2-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                School
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-home-v2-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Matched
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-home-v2-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Claimed
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-home-v2-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Submitted
              </th>
              <th scope="col" className="w-[26%] px-5 py-2.5 font-home-v2-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Claim rate
              </th>
            </tr>
          </thead>
          <tbody>
            {officeRows.map((row) => {
              const rate = Math.round((row.claimed / row.matched) * 100)
              return (
                <tr key={row.school} className="border-b border-hairline last:border-b-0">
                  <th scope="row" className="max-w-[220px] truncate px-5 py-3 text-left text-[13px] font-medium text-ink">
                    {row.school}
                  </th>
                  <td className="px-3 py-3 text-right font-home-v2-mono text-[12px] tabular-nums text-muted">
                    {row.matched}
                  </td>
                  <td className="px-3 py-3 text-right font-home-v2-mono text-[12px] tabular-nums text-ink-soft">
                    {row.claimed}
                  </td>
                  <td className="px-3 py-3 text-right font-home-v2-mono text-[12px] tabular-nums text-ink-soft">
                    {row.submitted}
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2.5">
                      <span className="h-1.5 flex-1 rounded-full bg-nickel-100">
                        <span
                          className={`block h-1.5 rounded-full ${
                            row.risk === 'ok' ? 'bg-emerald-600' : 'bg-amber-500'
                          }`}
                          style={{ width: `${rate}%` }}
                        />
                      </span>
                      <span className="w-9 shrink-0 text-right font-home-v2-mono text-[11px] tabular-nums text-muted">
                        {rate}%
                      </span>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 border-t border-hairline bg-inset px-5 py-4">
        {officeAlerts.map((alert) => {
          const tone = TONE[alert.tone]
          const Icon = tone.icon
          return (
            <li
              key={alert.text}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12px] leading-5 ${tone.className}`}
            >
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{alert.text}</span>
            </li>
          )
        })}
      </ul>

      <p className="border-t border-hairline px-5 py-3 text-[12px] leading-5 text-muted">
        Sample board. Claim rate is claimed ÷ matched — the drop-off the office is there to close. Illustrative data.
      </p>
    </figure>
  )
}
