import { describe, expect, it } from 'vitest'

import {
  computeFlags,
  sumFlagInputs,
  type FlagInput,
} from '@/lib/fundingDept/accountabilityFlags'

function input(overrides: Partial<FlagInput> = {}): FlagInput {
  return {
    untouchedPending: 0,
    overdueUnchased: 0,
    goneQuiet: 0,
    dueNudges: 0,
    live: 0,
    actionsInWindow: 0,
    ...overrides,
  }
}

const codes = (result: ReturnType<typeof computeFlags>) => result.flags.map((flag) => flag.code)

describe('computeFlags', () => {
  it('says nothing about a member with nothing outstanding', () => {
    const result = computeFlags(input({ live: 3, actionsInWindow: 6 }))
    expect(result.flags).toEqual([])
    expect(result.score).toBe(0)
  })

  it('names the countable fact behind each flag', () => {
    const result = computeFlags(input({ untouchedPending: 6, live: 2, actionsInWindow: 1 }))
    expect(result.flags[0].code).toBe('UNTOUCHED_PENDING')
    expect(result.flags[0].count).toBe(6)
    expect(result.flags[0].label).toContain('6 relevant calls untouched for 7+ days')
  })

  it('collapses everything to AWAY for someone on leave', () => {
    const result = computeFlags(
      input({ untouchedPending: 9, goneQuiet: 4, overdueUnchased: 2, live: 5, isAway: true })
    )
    expect(codes(result)).toEqual(['AWAY'])
    expect(result.score).toBe(0)
    expect(result.flags[0].informational).toBe(true)
  })

  it('marks an unmapped school as context, not a criticism, and adds no weight', () => {
    const result = computeFlags(input({ isUnmapped: true, live: 1, actionsInWindow: 1 }))
    expect(codes(result)).toEqual(['UNMAPPED_SCHOOL'])
    expect(result.flags[0].informational).toBe(true)
    expect(result.score).toBe(0)
  })

  it('only calls out inactivity when there was live work to act on', () => {
    expect(codes(computeFlags(input({ live: 0, actionsInWindow: 0 })))).not.toContain('NO_ACTIVITY')
    expect(codes(computeFlags(input({ live: 2, actionsInWindow: 0 })))).toContain('NO_ACTIVITY')
  })

  it('ranks an uncovered school above every workload flag', () => {
    const uncovered = computeFlags(input({ isUncovered: true }))
    const busy = computeFlags(input({ untouchedPending: 5, goneQuiet: 3, live: 4 }))
    expect(uncovered.score).toBeGreaterThan(busy.score)
    expect(uncovered.flags[0].code).toBe('UNCOVERED')
  })

  it('orders flags by weight so the worst reads first', () => {
    const result = computeFlags(
      input({ dueNudges: 1, untouchedPending: 3, overdueUnchased: 3, live: 2, actionsInWindow: 4 })
    )
    expect(codes(result)).toEqual(['OVERDUE_UNCHASED', 'UNTOUCHED_PENDING', 'DUE_NUDGES'])
    const weights = result.flags.map((flag) => flag.weight)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
  })

  it('honours a caller-supplied threshold in the wording', () => {
    const result = computeFlags(input({ goneQuiet: 1 }), { untouchedDays: 3, silentDays: 5 })
    expect(result.flags[0].label).toContain('5+ days')
  })
})

describe('sumFlagInputs', () => {
  it('rolls school rows into the member row', () => {
    const total = sumFlagInputs([
      input({ untouchedPending: 2, goneQuiet: 1, live: 3, actionsInWindow: 4 }),
      input({ untouchedPending: 5, overdueUnchased: 1, live: 2, actionsInWindow: 0 }),
    ])
    expect(total.untouchedPending).toBe(7)
    expect(total.goneQuiet).toBe(1)
    expect(total.overdueUnchased).toBe(1)
    expect(total.live).toBe(5)
    expect(total.actionsInWindow).toBe(4)
  })

  it('takes overrides for facts that are not sums, like leave', () => {
    const total = sumFlagInputs([input({ untouchedPending: 4, live: 1 })], { isAway: true })
    expect(computeFlags(total).flags.map((flag) => flag.code)).toEqual(['AWAY'])
  })
})

/**
 * The four codes added with the efficiency and engagement reports.
 *
 * Each carries a fairness rule that the count alone does not express, and each
 * rule below is one the first version got wrong.
 */
describe('efficiency and engagement flags', () => {
  it('stays silent on a fact the caller never supplied', () => {
    // The single most important property here. These fields default to
    // undefined, not zero, so a caller that does not count submissions must not
    // trip a flag saying nobody submitted anything.
    const quiet = computeFlags(input({ live: 8, actionsInWindow: 4 }))
    expect(codes(quiet)).not.toContain('NO_SUBMISSIONS')
    expect(codes(quiet)).not.toContain('SLOW_FIRST_TOUCH')
    expect(codes(quiet)).not.toContain('HIGH_DISMISSAL')
    expect(codes(quiet)).not.toContain('FACULTY_UNENGAGED')
  })

  it('names a slow reaction only above the target', () => {
    const thresholds = { untouchedDays: 7, silentDays: 14, firstTouchTargetDays: 3 }
    expect(codes(computeFlags(input({ medianFirstTouchDays: 2 }), thresholds))).not.toContain(
      'SLOW_FIRST_TOUCH'
    )
    const slow = computeFlags(input({ medianFirstTouchDays: 9.4 }), thresholds)
    expect(codes(slow)).toContain('SLOW_FIRST_TOUCH')
    expect(slow.flags[0].label).toContain('9.4 days')
    // Never fires on "no calls arrived, so no median".
    expect(codes(computeFlags(input({ medianFirstTouchDays: null }), thresholds))).not.toContain(
      'SLOW_FIRST_TOUCH'
    )
  })

  it('asks about a dismissal rate rather than accusing, and only on enough decisions', () => {
    const thresholds = { untouchedDays: 7, silentDays: 14, dismissalRateWarnPct: 40 }
    // Three out of four is noise, not a pattern.
    expect(
      codes(computeFlags(input({ decidedInWindow: 4, dismissedInWindow: 3 }), thresholds))
    ).not.toContain('HIGH_DISMISSAL')

    const high = computeFlags(
      input({ decidedInWindow: 20, dismissedInWindow: 15 }),
      thresholds
    )
    expect(codes(high)).toContain('HIGH_DISMISSAL')
    const flag = high.flags.find((entry) => entry.code === 'HIGH_DISMISSAL')!
    // Informational and weightless: a school really can receive mostly
    // off-discipline calls, so this must not push anyone up the ranking.
    expect(flag.informational).toBe(true)
    expect(flag.weight).toBe(0)
    expect(high.score).toBe(0)
  })

  it('reports no submissions only where there was work to convert', () => {
    expect(
      codes(computeFlags(input({ submittedInWindow: 0, live: 2 })))
    ).not.toContain('NO_SUBMISSIONS')
    expect(codes(computeFlags(input({ submittedInWindow: 0, live: 3 })))).toContain(
      'NO_SUBMISSIONS'
    )
    expect(codes(computeFlags(input({ submittedInWindow: 1, live: 9 })))).not.toContain(
      'NO_SUBMISSIONS'
    )
  })

  it('caps the weight of unengaged faculty so one large school cannot swamp the ranking', () => {
    const small = computeFlags(input({ reachableFacultyUnengaged: 2 }))
    const huge = computeFlags(input({ reachableFacultyUnengaged: 400 }))
    expect(small.score).toBe(8)
    expect(huge.score).toBe(40)
    // The real count still reaches the row, so nothing is hidden.
    expect(huge.flags[0].count).toBe(400)
  })

  it('collapses every one of them to AWAY for somebody on leave', () => {
    const away = computeFlags(
      input({
        isAway: true,
        medianFirstTouchDays: 40,
        decidedInWindow: 30,
        dismissedInWindow: 29,
        submittedInWindow: 0,
        live: 9,
        reachableFacultyUnengaged: 12,
      })
    )
    expect(codes(away)).toEqual(['AWAY'])
    expect(away.score).toBe(0)
  })
})

describe('sumFlagInputs with the new fields', () => {
  it('adds the counts and leaves submissions undefined when nobody counted them', () => {
    const total = sumFlagInputs([
      input({ decidedInWindow: 4, dismissedInWindow: 1, reachableFacultyUnengaged: 2 }),
      input({ decidedInWindow: 6, dismissedInWindow: 3, reachableFacultyUnengaged: 5 }),
    ])
    expect(total.decidedInWindow).toBe(10)
    expect(total.dismissedInWindow).toBe(4)
    expect(total.reachableFacultyUnengaged).toBe(7)
    // Left undefined so the member row does not fire NO_SUBMISSIONS on a
    // default when the school rows never carried the figure.
    expect(total.submittedInWindow).toBeUndefined()
  })

  it('sums submissions once at least one school supplied them', () => {
    const total = sumFlagInputs([
      input({ submittedInWindow: 2 }),
      input({ submittedInWindow: 0 }),
    ])
    expect(total.submittedInWindow).toBe(2)
  })

  it('does not average medians, which would not be a median', () => {
    const total = sumFlagInputs([
      input({ medianFirstTouchDays: 2 }),
      input({ medianFirstTouchDays: 40 }),
    ])
    expect(total.medianFirstTouchDays).toBeUndefined()
    // The caller passes its own member-level figure through the overrides.
    expect(sumFlagInputs([], { medianFirstTouchDays: 12 }).medianFirstTouchDays).toBe(12)
  })
})
