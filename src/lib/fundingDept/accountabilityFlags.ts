/**
 * Why a member's schools need attention, and how badly.
 *
 * The point of this module is to be arguable in a meeting. Every flag names a
 * countable fact ("6 relevant calls untouched for a week") rather than a
 * judgement, so the officer can answer it with work rather than with a defence.
 * Two rules keep it fair:
 *
 *   - Someone on leave is not neglecting anything. Their flags collapse to a
 *     single AWAY, weight zero, and the school still shows its numbers so the
 *     head can see cover is needed.
 *   - A school with no disciplines mapped receives no calls, so its zero
 *     pendency is meaningless rather than excellent. That says UNMAPPED, and
 *     the fix belongs to the admin, not the officer.
 *
 * Pure and unit-tested; the service supplies the counts.
 */

import { SILENT_DAYS, UNTOUCHED_DAYS } from './accountabilityProgress'

export const FLAG_CODES = [
  'UNTOUCHED_PENDING',
  'OVERDUE_UNCHASED',
  'SILENT_LIVE',
  'DUE_NUDGES',
  'NO_ACTIVITY',
  'UNCOVERED',
  'UNMAPPED_SCHOOL',
  'AWAY',
] as const
export type FlagCode = (typeof FLAG_CODES)[number]

export interface AccountabilityFlag {
  code: FlagCode
  count: number
  weight: number
  label: string
  /** True when this is context rather than a criticism of the member. */
  informational: boolean
}

export interface FlagThresholds {
  untouchedDays: number
  silentDays: number
}

export const DEFAULT_THRESHOLDS: FlagThresholds = {
  untouchedDays: UNTOUCHED_DAYS,
  silentDays: SILENT_DAYS,
}

/** The facts a flag set is computed from. One member, or one school row. */
export interface FlagInput {
  /** Relevant open calls with nobody on them, sitting longer than the threshold. */
  untouchedPending: number
  /** Past the internal deadline with no contact since it passed. */
  overdueUnchased: number
  /** Live allocations with no contact for `silentDays`. */
  goneQuiet: number
  /** Reminders this member set that fell due and were never sent. */
  dueNudges: number
  /** Live allocations in these schools, whoever delegated them. */
  live: number
  /** Anything this member did in the window: notes, assignments, triage. */
  actionsInWindow: number
  /** No discipline mapping, so no calls route here. */
  isUnmapped?: boolean
  /** No member covers this school at all. */
  isUncovered?: boolean
  /** On leave right now. */
  isAway?: boolean
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many
}

/**
 * Weights are ordered by how much the department loses if the item is ignored:
 * a call that closes with nobody on it is a missed opportunity that cannot be
 * recovered, an overdue application still might be, and a quiet one is a
 * warning. Nothing here is a score of a person — it ranks work.
 */
export function computeFlags(
  input: FlagInput,
  thresholds: FlagThresholds = DEFAULT_THRESHOLDS
): { flags: AccountabilityFlag[]; score: number } {
  if (input.isAway) {
    return {
      flags: [
        {
          code: 'AWAY',
          count: 0,
          weight: 0,
          label: 'On leave — cover applies',
          informational: true,
        },
      ],
      score: 0,
    }
  }

  const flags: AccountabilityFlag[] = []

  if (input.isUncovered) {
    flags.push({
      code: 'UNCOVERED',
      count: 1,
      weight: 120,
      label: 'Nobody covers this school',
      informational: false,
    })
  }

  if (input.untouchedPending > 0) {
    flags.push({
      code: 'UNTOUCHED_PENDING',
      count: input.untouchedPending,
      weight: 12 * input.untouchedPending,
      label: `${input.untouchedPending} relevant ${plural(input.untouchedPending, 'call', 'calls')} untouched for ${thresholds.untouchedDays}+ days`,
      informational: false,
    })
  }

  if (input.overdueUnchased > 0) {
    flags.push({
      code: 'OVERDUE_UNCHASED',
      count: input.overdueUnchased,
      weight: 15 * input.overdueUnchased,
      label: `${input.overdueUnchased} past the deadline with no contact since`,
      informational: false,
    })
  }

  if (input.goneQuiet > 0) {
    flags.push({
      code: 'SILENT_LIVE',
      count: input.goneQuiet,
      weight: 8 * input.goneQuiet,
      label: `${input.goneQuiet} live ${plural(input.goneQuiet, 'allocation', 'allocations')} with no contact for ${thresholds.silentDays}+ days`,
      informational: false,
    })
  }

  if (input.dueNudges > 0) {
    flags.push({
      code: 'DUE_NUDGES',
      count: input.dueNudges,
      weight: 5 * input.dueNudges,
      label: `${input.dueNudges} ${plural(input.dueNudges, 'reminder', 'reminders')} fell due and were not acted on`,
      informational: false,
    })
  }

  // Holding live work and having done nothing at all in the window is the one
  // flag about the person rather than the queue, so it only fires when there
  // was something to do.
  if (input.actionsInWindow === 0 && input.live > 0) {
    flags.push({
      code: 'NO_ACTIVITY',
      count: input.live,
      weight: 20,
      label: `Nothing recorded this period against ${input.live} live ${plural(input.live, 'allocation', 'allocations')}`,
      informational: false,
    })
  }

  if (input.isUnmapped) {
    flags.push({
      code: 'UNMAPPED_SCHOOL',
      count: 1,
      weight: 0,
      label: 'No disciplines mapped, so no calls reach this school',
      informational: true,
    })
  }

  return {
    flags: flags.sort((left, right) => right.weight - left.weight),
    score: flags.reduce((sum, flag) => sum + flag.weight, 0),
  }
}

/** Sum school-level inputs into the member-level one. */
export function sumFlagInputs(rows: FlagInput[], overrides: Partial<FlagInput> = {}): FlagInput {
  const total: FlagInput = {
    untouchedPending: 0,
    overdueUnchased: 0,
    goneQuiet: 0,
    dueNudges: 0,
    live: 0,
    actionsInWindow: 0,
  }
  for (const row of rows) {
    total.untouchedPending += row.untouchedPending
    total.overdueUnchased += row.overdueUnchased
    total.goneQuiet += row.goneQuiet
    total.dueNudges += row.dueNudges
    total.live += row.live
    total.actionsInWindow += row.actionsInWindow
  }
  return { ...total, ...overrides }
}
