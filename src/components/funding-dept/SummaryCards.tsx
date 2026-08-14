'use client'

/**
 * The department's four headline numbers.
 *
 * Overdue and declined get a colour because both are calls to action: one
 * needs chasing, the other needs a new home. Active and submitted stay neutral
 * — they are the state of play, not a request.
 */

export interface SummaryStat {
  label: string
  value: number
  hint?: string
  tone?: 'neutral' | 'live' | 'warn' | 'danger'
}

const TONE_BADGE: Record<NonNullable<SummaryStat['tone']>, string> = {
  neutral: 'nk-badge',
  live: 'nk-badge nk-badge-live',
  warn: 'nk-badge nk-badge-warn',
  danger: 'nk-badge nk-badge-danger',
}

export default function SummaryCards({ stats }: { stats: SummaryStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className="nk-panel nk-enter px-4 py-4"
          style={{ ['--nk-i' as string]: index }}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="nk-eyebrow">{stat.label}</span>
            {stat.value > 0 && stat.tone && stat.tone !== 'neutral' ? (
              <span className={TONE_BADGE[stat.tone]}>
                {stat.tone === 'danger' ? 'action' : stat.tone === 'warn' ? 'check' : 'live'}
              </span>
            ) : null}
          </div>
          <p className="nk-readout mt-3">{stat.value}</p>
          {stat.hint ? <p className="nk-sub mt-1.5">{stat.hint}</p> : null}
        </div>
      ))}
    </div>
  )
}
