'use client'

import MentorAvatar from '@/components/ui/MentorAvatar'
import { MENTOR } from '@/lib/persona'

import { chatTurns } from './data'

/**
 * A real-shaped transcript rather than a screenshot: the answer carries the
 * numbers and the follow-up, because the argument for the mentor is that she
 * answers from the funded-project record, not from a web search.
 */
export default function ChatPreview() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-hairline bg-ground">
      <figcaption className="flex items-center gap-2.5 border-b border-hairline px-5 py-3">
        <MentorAvatar size="xs" />
        <span className="text-[13px] font-semibold text-ink">
          {MENTOR.name}
          <span className="ml-1.5 font-normal text-muted">· {MENTOR.role}</span>
        </span>
        <span className="ml-auto font-home-v2-mono text-[11px] text-muted">answers from 50,000+ funded projects</span>
      </figcaption>

      <div className="space-y-4 bg-inset p-5">
        {chatTurns.map((turn, index) =>
          turn.role === 'user' ? (
            <p
              key={index}
              className="ml-auto max-w-[86%] rounded-2xl rounded-br-sm bg-cobalt-600 px-4 py-2.5 text-[13px] leading-6 text-white"
            >
              {turn.text}
            </p>
          ) : (
            <div key={index} className="flex max-w-[94%] gap-2.5">
              <MentorAvatar size="xs" className="mt-1" />

              <div className="min-w-0 flex-1 rounded-2xl rounded-bl-sm border border-hairline bg-ground px-4 py-3">
                <p className="text-[13px] leading-6 text-ink-soft">{turn.text}</p>

                {'table' in turn && turn.table ? (
                  <table className="mt-3 w-full border-separate border-spacing-y-1 text-left font-home-v2-mono text-[11px]">
                    <tbody>
                      {turn.table.map((row) => (
                        <tr key={row[0]}>
                          <th scope="row" className="rounded-l-md bg-inset py-1.5 pl-2.5 pr-3 font-medium text-ink">
                            {row[0]}
                          </th>
                          <td className="bg-inset py-1.5 pr-3 tabular-nums text-muted">{row[1]}</td>
                          <td className="rounded-r-md bg-inset py-1.5 pr-2.5 text-right tabular-nums text-ink-soft">
                            {row[2]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {'footer' in turn && turn.footer ? (
                  <p className="mt-3 border-l-2 border-cobalt-300 bg-cobalt-50/60 px-3 py-2 text-[12px] leading-5 text-ink-soft">
                    {turn.footer}
                  </p>
                ) : null}
              </div>
            </div>
          ),
        )}
      </div>

      <p className="border-t border-hairline px-5 py-3 text-[12px] leading-5 text-muted">
        Sample conversation. {MENTOR.name} answers from your institution&apos;s data and the funded-project record, and
        shows the records behind every number.
      </p>
    </figure>
  )
}
