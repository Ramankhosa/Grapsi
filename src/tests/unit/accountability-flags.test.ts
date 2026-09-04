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
