/**
 * Open / closed / rolling computed from facts at read time.
 *
 * `opportunity_status` on a call is a cache written at import time; it goes
 * stale the day a deadline passes. Anything shown to a person (the call
 * page's badge, the review list) uses this instead. Pure module.
 */
export type LiveOpportunityStatus = 'OPEN' | 'FORTHCOMING' | 'ROLLING' | 'CLOSED' | 'UNKNOWN'

type DateLike = Date | string | null | undefined

/** YYYY-MM-DD of a date-only column (stored as UTC midnight) or an ISO string. */
function day(value: DateLike): string | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value))
  return match ? match[1] : null
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function liveOpportunityStatus(
  row: {
    source_closed_at?: DateLike
    is_rolling?: boolean | null
    open_date?: DateLike
    entry_closes_at?: DateLike
    final_deadline_at?: DateLike
    close_date?: DateLike
  },
  today: string = utcToday()
): LiveOpportunityStatus {
  if (row.source_closed_at) return 'CLOSED'
  if (row.is_rolling) return 'ROLLING'
  const opens = day(row.open_date)
  if (opens && opens > today) return 'FORTHCOMING'
  const entry = day(row.entry_closes_at) || day(row.final_deadline_at) || day(row.close_date)
  if (entry) return entry >= today ? 'OPEN' : 'CLOSED'
  return 'UNKNOWN'
}
