'use client'

/**
 * The countable facts behind an attention score.
 *
 * Every chip names a number and links to the work behind it, because a flag
 * somebody cannot open is an accusation rather than a task. Informational chips
 * (on leave, no disciplines mapped) are deliberately grey and weightless: they
 * explain a row rather than criticise the person in it.
 */

import Link from 'next/link'

import type { AccountabilityFlag } from '@/lib/fundingDept/accountabilityFlags'

const TONE: Record<string, string> = {
  UNCOVERED: 'border-red-300 bg-red-50 text-red-700',
  OVERDUE_UNCHASED: 'border-red-300 bg-red-50 text-red-700',
  UNTOUCHED_PENDING: 'border-amber-300 bg-amber-50 text-amber-800',
  SILENT_LIVE: 'border-amber-300 bg-amber-50 text-amber-800',
  DUE_NUDGES: 'border-amber-200 bg-amber-50/70 text-amber-700',
  NO_ACTIVITY: 'border-red-200 bg-red-50/70 text-red-700',
  UNMAPPED_SCHOOL: 'border-nickel-200 bg-nickel-50 text-nickel-600',
  AWAY: 'border-nickel-200 bg-nickel-50 text-nickel-600',
}

const SHORT: Record<string, string> = {
  UNCOVERED: 'nobody covers this',
  OVERDUE_UNCHASED: 'past deadline, not chased',
  UNTOUCHED_PENDING: 'untouched calls',
  SILENT_LIVE: 'gone quiet',
  DUE_NUDGES: 'reminders not acted on',
  NO_ACTIVITY: 'nothing recorded',
  UNMAPPED_SCHOOL: 'no disciplines mapped',
  AWAY: 'on leave',
}

export default function FlagChips({
  flags,
  hrefFor,
}: {
  flags: AccountabilityFlag[]
  hrefFor?: (flag: AccountabilityFlag) => string | null
}) {
  if (flags.length === 0) {
    return <span className="nk-sub text-[12px]">nothing outstanding</span>
  }

  return (
    <span className="flex flex-wrap gap-1.5">
      {flags.map((flag) => {
        const body = (
          <>
            {flag.count > 0 && !flag.informational ? (
              <span className="nk-mono font-semibold">{flag.count}</span>
            ) : null}
            <span>{SHORT[flag.code] || flag.code.toLowerCase()}</span>
          </>
        )
        const className = `inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] ${
          TONE[flag.code] || 'border-nickel-200 bg-nickel-50 text-nickel-600'
        }`
        const href = hrefFor?.(flag) ?? null
        return href ? (
          <Link key={flag.code} href={href} className={`${className} hover:underline`} title={flag.label}>
            {body}
          </Link>
        ) : (
          <span key={flag.code} className={className} title={flag.label}>
            {body}
          </span>
        )
      })}
    </span>
  )
}
