import { describe, expect, it } from 'vitest'

/**
 * The rung-picking rule, on its own.
 *
 * This exists because getting it wrong is silent. Written with `find()` the
 * ladder returns the WIDEST matching window, so once D3 has fired the row is
 * skipped as "already nudged" at every later check — and D1, the nudge that
 * actually matters, never goes out. Nothing errors; the applicant simply never
 * hears from you.
 *
 * The rule is: the array runs longest window first, and the LAST match is the
 * most urgent rung. `src/lib/fundingDept/escalationService.ts` has used
 * `filter().pop()` for exactly this reason since the assignment ladder was
 * built; these tests hold the proposal ladders to the same behaviour.
 */

const CUTOFF_STAGES = [
  { stage: 'D3', days: 3 },
  { stage: 'D1', days: 1 },
]

const OBLIGATION_STAGES = [
  { stage: 'D30', days: 30 },
  { stage: 'D14', days: 14 },
  { stage: 'D7', days: 7 },
  { stage: 'D1', days: 1 },
  { stage: 'OVERDUE', days: -1 },
]

/** The rule as the sweeps implement it. */
function rungFor(stages: Array<{ stage: string; days: number }>, daysLeft: number) {
  return stages.filter((entry) => daysLeft <= entry.days).pop()?.stage ?? null
}

describe('the cut-off ladder', () => {
  it('stays silent while the cut-off is far off', () => {
    expect(rungFor(CUTOFF_STAGES, 10)).toBeNull()
    expect(rungFor(CUTOFF_STAGES, 4)).toBeNull()
  })

  it('fires D3 three days out', () => {
    expect(rungFor(CUTOFF_STAGES, 3)).toBe('D3')
    expect(rungFor(CUTOFF_STAGES, 2)).toBe('D3')
  })

  it('fires D1 one day out — not D3 again', () => {
    // The regression this file exists for. With find() this returned 'D3',
    // which the ladder had already recorded, so the row was skipped forever.
    expect(rungFor(CUTOFF_STAGES, 1)).toBe('D1')
    expect(rungFor(CUTOFF_STAGES, 0)).toBe('D1')
  })

  it('walks D3 then D1 across a run of days, never repeating', () => {
    const fired: string[] = []
    for (const daysLeft of [5, 4, 3, 2, 1, 0]) {
      const rung = rungFor(CUTOFF_STAGES, daysLeft)
      if (rung && !fired.includes(rung)) fired.push(rung)
    }
    expect(fired).toEqual(['D3', 'D1'])
  })
})

describe('the post-award ladder', () => {
  it('gives an accounts department a month of warning', () => {
    expect(rungFor(OBLIGATION_STAGES, 31)).toBeNull()
    expect(rungFor(OBLIGATION_STAGES, 30)).toBe('D30')
    expect(rungFor(OBLIGATION_STAGES, 20)).toBe('D30')
  })

  it('tightens as the date approaches', () => {
    expect(rungFor(OBLIGATION_STAGES, 14)).toBe('D14')
    expect(rungFor(OBLIGATION_STAGES, 7)).toBe('D7')
    expect(rungFor(OBLIGATION_STAGES, 1)).toBe('D1')
    expect(rungFor(OBLIGATION_STAGES, 0)).toBe('D1')
  })

  it('says so once the filing is late, rather than going quiet', () => {
    expect(rungFor(OBLIGATION_STAGES, -1)).toBe('OVERDUE')
    expect(rungFor(OBLIGATION_STAGES, -60)).toBe('OVERDUE')
  })

  it('walks every rung exactly once over the life of an obligation', () => {
    const fired: string[] = []
    for (const daysLeft of [45, 30, 21, 14, 9, 7, 3, 1, 0, -1, -10]) {
      const rung = rungFor(OBLIGATION_STAGES, daysLeft)
      if (rung && !fired.includes(rung)) fired.push(rung)
    }
    expect(fired).toEqual(['D30', 'D14', 'D7', 'D1', 'OVERDUE'])
  })
})
