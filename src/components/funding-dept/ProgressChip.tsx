'use client'

/**
 * Where one allocation stands, in one chip.
 *
 * Colour carries meaning and nothing else does: red is late, amber is waiting
 * on somebody, cobalt is live work, green is done. A quiet allocation keeps its
 * own colour and gains a separate marker, because "accepted" and "nobody has
 * touched it in three weeks" are two facts and the second is the one an officer
 * acts on.
 */

import type { ProgressCode } from '@/lib/fundingDept/accountabilityProgress'

const STYLES: Record<ProgressCode, string> = {
  AWARDED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  SUBMITTED: 'border-emerald-200 bg-emerald-50/70 text-emerald-700',
  REJECTED: 'border-nickel-300 bg-nickel-100 text-nickel-600',
  DECLINED: 'border-rose-200 bg-rose-50 text-rose-700',
  CANCELLED: 'border-nickel-200 bg-nickel-50 text-nickel-500',
  OVERDUE: 'border-red-300 bg-red-50 text-red-700',
  AWAITING_REPLY: 'border-amber-300 bg-amber-50 text-amber-800',
  DRAFTING: 'border-cobalt-300 bg-cobalt-50 text-cobalt-700',
  IN_HAND: 'border-cobalt-200 bg-cobalt-50/60 text-cobalt-700',
}

export interface ProgressChipProps {
  code: ProgressCode
  label: string
  stage?: string | null
  daysSilent?: number | null
  goneQuiet?: boolean
  overdueUnchased?: boolean
}

export default function ProgressChip({
  code,
  label,
  stage,
  daysSilent,
  goneQuiet,
  overdueUnchased,
}: ProgressChipProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${STYLES[code]}`}
      >
        {label}
      </span>
      {/* The stage only adds something when it says more than the status already
          does. "Submitted · Submitted" is noise. */}
      {stage && stage !== code ? (
        <span className="inline-flex items-center rounded-md border border-nickel-200 bg-white px-1.5 py-0.5 text-[11px] text-nickel-600">
          {stage.charAt(0) + stage.slice(1).toLowerCase()}
        </span>
      ) : null}
      {goneQuiet ? (
        <span
          className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
          title="No contact recorded for a fortnight or more"
        >
          quiet {daysSilent}d
        </span>
      ) : null}
      {overdueUnchased ? (
        <span
          className="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700"
          title="The internal deadline passed and nothing has been logged since"
        >
          not chased
        </span>
      ) : null}
    </span>
  )
}
