'use client'

import { Check, Mail } from 'lucide-react'

import { alertMessage, digestRows } from './data'

/**
 * The two places a match actually lands: a phone and an inbox. Drawn as
 * recognisable message chrome rather than as feature bullets, because the whole
 * promise of this section is "you do not have to open the product".
 */
export default function AlertPreview() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* WhatsApp */}
      <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
        <figcaption className="flex items-center gap-2 border-b border-hairline bg-[#075e54] px-4 py-3">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-[#25d366] text-[13px] font-bold text-white">
            A
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-white">AIGrantMentor</span>
            <span className="block text-[11px] text-white/70">WhatsApp</span>
          </span>
        </figcaption>

        <div className="bg-[#ece5dd] px-4 py-5">
          <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-white px-3.5 py-3 shadow-[0_1px_1px_rgba(0,0,0,0.08)]">
            <p className="text-[13px] font-semibold leading-5 text-[#0b141a]">{alertMessage.headline}</p>
            <ul className="mt-2 space-y-1">
              {alertMessage.lines.map((line) => (
                <li key={line} className="text-[13px] leading-5 text-[#3b4a54]">
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-black/5 pt-2 text-[12px] leading-5 text-[#667781]">
              Matched on: {alertMessage.matchedOn}
            </p>
            <p className="mt-2 text-[12px] font-medium text-[#1d4ed8]">Open the call →</p>
            <p className="mt-1 text-right text-[10px] text-[#8696a0]">{alertMessage.time}</p>
          </div>
        </div>
      </figure>

      {/* Email digest */}
      <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
        <figcaption className="flex items-center gap-2 border-b border-hairline bg-inset px-4 py-3">
          <Mail className="h-4 w-4 text-muted" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-ink">Your Monday funding digest</span>
            <span className="block font-home-v2-mono text-[11px] text-muted">3 new matches · 1 closing soon</span>
          </span>
        </figcaption>

        <ul className="divide-y divide-hairline">
          {digestRows.map((row) => (
            <li key={row.title} className="flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{row.title}</p>
                <p className="mt-0.5 font-home-v2-mono text-[11px] text-muted">closes in {row.closes}</p>
              </div>
              <span
                className={`shrink-0 rounded-md px-2 py-1 font-home-v2-mono text-[11px] font-semibold tabular-nums ${
                  row.score >= 85 ? 'bg-cobalt-50 text-cobalt-700' : 'bg-nickel-100 text-nickel-700'
                }`}
              >
                {row.score}%
              </span>
            </li>
          ))}
        </ul>

        <div className="border-t border-hairline px-4 py-3">
          <p className="flex items-center gap-2 text-[12px] leading-5 text-muted">
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
            You choose: instantly, daily, or one weekly digest.
          </p>
        </div>
      </figure>
    </div>
  )
}
