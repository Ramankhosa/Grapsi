import { dayKey, deadlineDayKey, DEFAULT_TIMEZONE } from '@/lib/i18n/format'

export const CALL_ENTRY_DEADLINE_SELECT = {
  close_date: true, deadlineAt: true, import_run_id: true, entry_closes_at: true,
  final_deadline_at: true, source_closed_at: true, deadline_timezone: true,
} as const

export type CallEntryDates = {
  close_date?: Date | null; deadlineAt?: Date | null; import_run_id?: string | null
  entry_closes_at?: Date | null; final_deadline_at?: Date | null
  source_closed_at?: Date | null; deadline_timezone?: string | null
}

export function callEntryDeadline(call: CallEntryDates): Date | null {
  const deadline = call.import_run_id ? call.entry_closes_at || call.final_deadline_at || call.close_date || call.deadlineAt : call.close_date || call.deadlineAt
  const closed = call.import_run_id ? call.source_closed_at : null
  return closed && (!deadline || closed < deadline) ? closed : deadline || null
}

export function callEntryClosed(call: CallEntryDates, asOf = new Date(), tenantZone = DEFAULT_TIMEZONE): boolean {
  if (call.import_run_id && call.source_closed_at && call.source_closed_at <= asOf) return true
  const deadline = callEntryDeadline(call)
  const zone = call.import_run_id && call.deadline_timezone ? call.deadline_timezone : tenantZone
  return Boolean(deadline && deadlineDayKey(deadline,zone) < dayKey(asOf,zone))
}
