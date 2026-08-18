/**
 * Pure helpers behind the reviewer's stored-funding-call picker.
 *
 * Kept out of the component so the list maths — which decides what the user can
 * actually click — can be tested without a DOM.
 */

export type FundingCallReadiness = 'template_manual' | 'guideline_manual' | 'call_fields'

export type FundingCallOption = {
  id: string
  title: string
  agencyName?: string | null
  summary?: string | null
  deadlineAt?: string | null
  sourceUrl?: string | null
  readiness?: FundingCallReadiness
  readinessLabel?: string
}

export const READINESS_BADGE_CLASS: Record<string, string> = {
  template_manual: 'nk-badge nk-badge-ok',
  guideline_manual: 'nk-badge nk-badge-live',
  call_fields: 'nk-badge nk-badge-warn',
}

export const READINESS_HELP: Record<string, string> = {
  template_manual:
    'This call has an approved application template. The reviewer will score against its exact sections, limits, and rubric.',
  guideline_manual:
    'This call has an extracted guideline pack. The reviewer will score against those rules mapped onto the standard proposal sections.',
  call_fields:
    'This call has no template or guideline pack yet. The reviewer will set up the standard proposal sections and score against the stored call record (scope, budget, duration, eligibility) plus anything you add in the manual rubric.',
}

/** Duplicate ids would collide as React keys and make two rows act as one. */
export function dedupeById(calls: Array<FundingCallOption | null | undefined>): FundingCallOption[] {
  const seen = new Set<string>()
  const unique: FundingCallOption[] = []
  for (const call of calls) {
    if (!call?.id || seen.has(call.id)) continue
    seen.add(call.id)
    unique.push(call)
  }
  return unique
}

export function filterCallsLocally(calls: FundingCallOption[], query: string): FundingCallOption[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return calls
  return calls.filter((call) =>
    `${call.title} ${call.agencyName || ''} ${call.summary || ''}`.toLowerCase().includes(needle)
  )
}

/**
 * What the list shows for the current query.
 *
 * The loaded library is only the most recently updated page of calls, so the
 * server's answer for a query leads; anything the local filter also matched
 * (it looks at the summary too, which the server does not) is appended rather
 * than dropped. Server results for a stale query are ignored so the list never
 * disagrees with what has been typed.
 */
export function resolveVisibleCalls({
  library,
  query,
  remote,
}: {
  library: FundingCallOption[]
  query: string
  remote: { query: string; calls: FundingCallOption[] } | null
}): FundingCallOption[] {
  const trimmed = query.trim()
  if (!trimmed) return library
  const localMatches = filterCallsLocally(library, trimmed)
  if (remote && remote.query === trimmed) {
    return dedupeById([...remote.calls, ...localMatches])
  }
  return localMatches
}

export function formatCallDeadline(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Splits text into matched / unmatched runs for search highlighting. The query
 * is escaped: people type `C++ (phase 2)` into search boxes.
 */
export function splitOnQuery(text: string, query: string): Array<{ text: string; match: boolean }> {
  const needle = query.trim()
  if (!needle) return [{ text, match: false }]
  const parts = text.split(new RegExp(`(${escapeRegExp(needle)})`, 'ig'))
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: part.toLowerCase() === needle.toLowerCase() }))
}
