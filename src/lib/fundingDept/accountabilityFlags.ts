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
  'SLOW_FIRST_TOUCH',
  'HIGH_DISMISSAL',
  'NO_SUBMISSIONS',
  'FACULTY_UNENGAGED',
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
  /** Days from a call arriving that a first look is expected inside. */
  firstTouchTargetDays?: number
  /** Share of decided calls dismissed as not relevant, above which it is flagged. */
  dismissalRateWarnPct?: number
}

export const DEFAULT_THRESHOLDS: FlagThresholds = {
  untouchedDays: UNTOUCHED_DAYS,
  silentDays: SILENT_DAYS,
  firstTouchTargetDays: 3,
  dismissalRateWarnPct: 40,
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

  /* ---- Optional, supplied by the efficiency and engagement reports --------
   * All default to zero or null so every existing caller and sumFlagInputs keep
   * working unchanged, and a flag whose fact nobody supplied stays silent rather
   * than firing on a default.
   */
  /** Median days from a call arriving to anyone looking at it. */
  medianFirstTouchDays?: number | null
  /** Calls this member decided on in the window. The denominator below. */
  decidedInWindow?: number
  /** Of those, how many were dismissed as not relevant. */
  dismissedInWindow?: number
  /** Applications that went in from these schools during the window. */
  submittedInWindow?: number
  /**
   * Faculty in these schools who could have been sent something and were not.
   * Excludes anyone unmatchable — see the UNREACHABLE rule in the engagement
   * report — because an unmatchable person is a data gap for the administrator
   * to close, not neglect by this officer.
   */
  reachableFacultyUnengaged?: number

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

  // Slow to look at a call that arrives. Separate from UNTOUCHED_PENDING, which
  // counts what is still sitting there: someone can have cleared the backlog and
  // still take three weeks to react to each new call.
  const firstTouchTarget =
    thresholds.firstTouchTargetDays ?? DEFAULT_THRESHOLDS.firstTouchTargetDays!
  if (
    input.medianFirstTouchDays !== null &&
    input.medianFirstTouchDays !== undefined &&
    input.medianFirstTouchDays > firstTouchTarget
  ) {
    const days = Math.round(input.medianFirstTouchDays * 10) / 10
    flags.push({
      code: 'SLOW_FIRST_TOUCH',
      count: Math.round(input.medianFirstTouchDays),
      weight: 6,
      label: `Takes ${days} days on average to look at a new call, against a target of ${firstTouchTarget}`,
      informational: false,
    })
  }

  // The cheapest way to empty a queue is to call everything irrelevant, and
  // nothing else in the system would notice. Informational and weightless on
  // purpose: a school really can receive mostly off-discipline calls, so this
  // asks a question rather than making an accusation.
  const decided = input.decidedInWindow ?? 0
  const dismissed = input.dismissedInWindow ?? 0
  const dismissalWarn = thresholds.dismissalRateWarnPct ?? DEFAULT_THRESHOLDS.dismissalRateWarnPct!
  // A handful of decisions cannot establish a rate: three dismissals out of four
  // is noise, not a pattern.
  if (decided >= 10 && (dismissed / decided) * 100 > dismissalWarn) {
    const pct = Math.round((dismissed / decided) * 100)
    flags.push({
      code: 'HIGH_DISMISSAL',
      count: dismissed,
      weight: 0,
      label: `${pct}% of decisions were "not relevant" — ${dismissed} of ${decided}`,
      informational: true,
    })
  }

  // Nothing reached an agency all period. Three guards, each load-bearing:
  // the caller must actually have supplied the figure (absent is not zero — a
  // flag that fires on a default is a flag nobody can trust), there must have
  // been work to convert, and it is weighted below the pendency flags because
  // submitting is the faculty member's act, not the officer's.
  if (input.submittedInWindow !== undefined && input.submittedInWindow === 0 && input.live >= 3) {
    flags.push({
      code: 'NO_SUBMISSIONS',
      count: input.live,
      weight: 10,
      label: `No application went in this period, from ${input.live} live ${plural(input.live, 'allocation', 'allocations')}`,
      informational: false,
    })
  }

  if ((input.reachableFacultyUnengaged ?? 0) > 0) {
    const count = input.reachableFacultyUnengaged!
    flags.push({
      code: 'FACULTY_UNENGAGED',
      // Capped, so one large school cannot outweigh every real pendency in the
      // ranking. The exact count is still on the row.
      weight: 4 * Math.min(count, 10),
      count,
      label: `${count} ${plural(count, 'faculty member', 'faculty')} in these schools have been sent nothing at all`,
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
    decidedInWindow: 0,
    dismissedInWindow: 0,
    reachableFacultyUnengaged: 0,
  }
  for (const row of rows) {
    total.untouchedPending += row.untouchedPending
    total.overdueUnchased += row.overdueUnchased
    total.goneQuiet += row.goneQuiet
    total.dueNudges += row.dueNudges
    total.live += row.live
    total.actionsInWindow += row.actionsInWindow
    total.decidedInWindow = (total.decidedInWindow ?? 0) + (row.decidedInWindow ?? 0)
    total.dismissedInWindow = (total.dismissedInWindow ?? 0) + (row.dismissedInWindow ?? 0)
    // Left undefined unless at least one school supplied it, so NO_SUBMISSIONS
    // stays silent for a caller that does not count submissions at all.
    if (row.submittedInWindow !== undefined) {
      total.submittedInWindow = (total.submittedInWindow ?? 0) + row.submittedInWindow
    }
    total.reachableFacultyUnengaged =
      (total.reachableFacultyUnengaged ?? 0) + (row.reachableFacultyUnengaged ?? 0)
  }
  // medianFirstTouchDays is deliberately absent: a median of medians is not a
  // median. The caller passes the member-level figure through `overrides` when
  // it has computed one.
  return { ...total, ...overrides }
}
