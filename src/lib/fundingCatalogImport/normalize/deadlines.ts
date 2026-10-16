/**
 * Stage deadlines → the call's derived dates and lifecycle.
 *
 * Three dates are kept apart because they answer different questions:
 *   - final_deadline_at: the last submission deadline (mirrored into the
 *     legacy close_date, which never rolls forward);
 *   - entry_closes_at: the last date a NEW applicant can still get in. A
 *     letter of intent that is due before the full application closes entry
 *     on its own date; whether such a stage is mandatory is unknown from the
 *     source, so the call is flagged lifecycle_needs_check rather than guessed;
 *   - next_deadline_at: the next date still ahead, for sorting and "closes soon".
 *
 * The source's own "closed" marker is a separate fact (source_closed_at). A
 * source page that disappeared is NOT a closure.
 */
import { dateOnly, isoDate } from './text'

export type DeadlineKind = 'OPEN' | 'LETTER_OF_INTENT' | 'PREPROPOSAL' | 'FULL_APPLICATION' | 'OTHER'
export type OpportunityStatus = 'OPEN' | 'FORTHCOMING' | 'ROLLING' | 'CLOSED' | 'UNKNOWN'

export interface DeadlineRow {
  kind: DeadlineKind
  label: string | null
  dueDate: string // YYYY-MM-DD
  dueTimezone: string | null
  dueTimezoneBasis: 'SOURCE' | 'FUNDER_COUNTRY_DEFAULT' | 'UNKNOWN'
  stageRequired: boolean | null
}

export interface DerivedLifecycle {
  deadlines: DeadlineRow[]
  openDate: string | null
  finalDeadline: string | null
  entryCloses: string | null
  nextDeadline: string | null
  isRolling: boolean
  sourceClosed: boolean
  status: OpportunityStatus
  needsCheck: boolean
  deadlineTimezone: string | null
}

const LABEL_KIND: Array<[RegExp, DeadlineKind]> = [
  [/\bopen(ing)?\s+date\b|\bopens\b|\bcall opens\b/i, 'OPEN'],
  [/\bletter of (inquiry|intent)\b|\bloi\b|\bexpression of interest\b|\beoi\b/i, 'LETTER_OF_INTENT'],
  [/\bpre-?proposal\b|\bpre-?application\b|\boutline\b|\bfirst stage\b|\bstage 1\b/i, 'PREPROPOSAL'],
  [/\bfull (application|proposal)\b|\bapplication due\b|\bdeadline\b|\bsubmission\b|\bclos(e|ing) date\b/i, 'FULL_APPLICATION'],
]

export function deadlineKindForLabel(label: string | null | undefined): DeadlineKind {
  const text = String(label || '')
  for (const [pattern, kind] of LABEL_KIND) if (pattern.test(text)) return kind
  return 'OTHER'
}

/**
 * Funder countries with a single civil timezone. Countries spanning several
 * zones (US, CA, AU, BR, RU, MX, ID…) are deliberately absent: their
 * deadlines stay timezone-unknown rather than pinned to the wrong zone.
 */
const SINGLE_TIMEZONE: Record<string, string> = {
  IN: 'Asia/Kolkata', GB: 'Europe/London', IE: 'Europe/Dublin', SE: 'Europe/Stockholm', NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', IS: 'Atlantic/Reykjavik', DE: 'Europe/Berlin',
  NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', LU: 'Europe/Luxembourg', FR: 'Europe/Paris',
  CH: 'Europe/Zurich', AT: 'Europe/Vienna', IT: 'Europe/Rome', ES: 'Europe/Madrid', PT: 'Europe/Lisbon',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', HU: 'Europe/Budapest',
  SI: 'Europe/Ljubljana', EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius', GR: 'Europe/Athens',
  CY: 'Asia/Nicosia', TR: 'Europe/Istanbul', IL: 'Asia/Jerusalem', LB: 'Asia/Beirut', SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  TW: 'Asia/Taipei', CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur',
  PH: 'Asia/Manila', VN: 'Asia/Ho_Chi_Minh', PK: 'Asia/Karachi', ZA: 'Africa/Johannesburg', KE: 'Africa/Nairobi',
  NZ: 'Pacific/Auckland', AR: 'America/Argentina/Buenos_Aires', UY: 'America/Montevideo', CO: 'America/Bogota',
  JM: 'America/Jamaica', AM: 'Asia/Yerevan', LI: 'Europe/Vaduz',
}

/** EU-level calls (Horizon Europe) are run on Brussels time. */
const REGION_TIMEZONE: Record<string, string> = { EU: 'Europe/Brussels' }

export function defaultDeadlineTimezone(funderCountryCode: string | null, funderRegionCode: string | null) {
  if (funderCountryCode && SINGLE_TIMEZONE[funderCountryCode]) {
    return { timezone: SINGLE_TIMEZONE[funderCountryCode], basis: 'FUNDER_COUNTRY_DEFAULT' as const }
  }
  if (funderRegionCode && REGION_TIMEZONE[funderRegionCode]) {
    return { timezone: REGION_TIMEZONE[funderRegionCode], basis: 'FUNDER_COUNTRY_DEFAULT' as const }
  }
  return { timezone: null, basis: 'UNKNOWN' as const }
}

export function deriveLifecycle(input: {
  deadlines: Array<{ label?: string | null; date?: string | null }>
  isRolling: boolean
  sourceClosed: boolean
  funderCountryCode: string | null
  funderRegionCode?: string | null
  today: string // YYYY-MM-DD, injected so the rule is testable
}): DerivedLifecycle {
  const tz = defaultDeadlineTimezone(input.funderCountryCode, input.funderRegionCode || null)
  const seen = new Set<string>()
  const deadlines: DeadlineRow[] = []
  for (const entry of input.deadlines || []) {
    const dueDate = isoDate(entry?.date)
    if (!dueDate) continue
    const kind = deadlineKindForLabel(entry?.label)
    const key = `${kind}:${dueDate}`
    if (seen.has(key)) continue
    seen.add(key)
    deadlines.push({
      kind,
      label: entry?.label ? String(entry.label).trim() : null,
      dueDate,
      dueTimezone: tz.timezone,
      dueTimezoneBasis: tz.basis,
      stageRequired: null,
    })
  }
  deadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const openDate = deadlines.find((d) => d.kind === 'OPEN')?.dueDate || null
  const submissions = deadlines.filter((d) => d.kind !== 'OPEN')
  const finals = submissions.filter((d) => d.kind === 'FULL_APPLICATION')
  const finalDeadline = (finals.length > 0 ? finals : submissions).map((d) => d.dueDate).sort().pop() || null
  const firstStage = submissions.find((d) => d.kind === 'LETTER_OF_INTENT' || d.kind === 'PREPROPOSAL')
  const hasEarlierStage = Boolean(firstStage && finalDeadline && firstStage.dueDate < finalDeadline)
  const entryCloses = hasEarlierStage ? firstStage!.dueDate : finalDeadline
  const nextDeadline = submissions.map((d) => d.dueDate).filter((d) => d >= input.today).sort()[0] || null

  let status: OpportunityStatus
  if (input.sourceClosed) status = 'CLOSED'
  else if (input.isRolling) status = 'ROLLING'
  else if (openDate && openDate > input.today) status = 'FORTHCOMING'
  else if (entryCloses && entryCloses >= input.today) status = 'OPEN'
  else if (entryCloses) status = 'CLOSED'
  else status = 'UNKNOWN'

  const needsCheck = hasEarlierStage || (!input.isRolling && !input.sourceClosed && submissions.length === 0)

  return {
    deadlines,
    openDate,
    finalDeadline,
    entryCloses,
    nextDeadline,
    isRolling: input.isRolling,
    sourceClosed: input.sourceClosed,
    status,
    needsCheck,
    deadlineTimezone: tz.timezone,
  }
}

export { dateOnly }
