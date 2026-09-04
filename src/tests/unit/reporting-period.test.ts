import { describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/lib/tenant/reportingPeriod'

/**
 * The window is entered once and then has to stay right for years. These pin
 * the roll-forward rule, which is the part that fails silently: a stale window
 * makes every workload count on the dossier quietly wrong.
 */
describe('resolvePeriod', () => {
  it('leaves a window that contains today alone', () => {
    const period = resolvePeriod(
      new Date(2026, 6, 1),
      new Date(2027, 5, 30),
      null,
      new Date(2026, 8, 3)
    )
    expect(period.start.getFullYear()).toBe(2026)
    expect(period.end.getFullYear()).toBe(2027)
    expect(period.label).toBe('2026-27')
  })

  it('rolls a closed window forward by whole years', () => {
    const period = resolvePeriod(
      new Date(2024, 6, 1),
      new Date(2025, 5, 30),
      null,
      new Date(2026, 8, 3)
    )
    expect(period.start.getMonth()).toBe(6)
    expect(period.start.getDate()).toBe(1)
    expect(period.start.getFullYear()).toBe(2026)
    expect(period.end.getFullYear()).toBe(2027)
  })

  it('does not touch a window that has not opened yet', () => {
    const period = resolvePeriod(
      new Date(2027, 0, 1),
      new Date(2027, 11, 31),
      null,
      new Date(2026, 8, 3)
    )
    expect(period.start.getFullYear()).toBe(2027)
  })

  it('labels a single-year window with that year, and keeps a given name', () => {
    expect(
      resolvePeriod(new Date(2026, 0, 1), new Date(2026, 11, 31), null, new Date(2026, 8, 3)).label
    ).toBe('2026')
    expect(
      resolvePeriod(new Date(2026, 0, 1), new Date(2026, 11, 31), 'FY26', new Date(2026, 8, 3))
        .label
    ).toBe('FY26')
  })

  it('spans whole days, so activity on the last day still counts', () => {
    const period = resolvePeriod(
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
      null,
      new Date(2026, 8, 3)
    )
    expect(period.start.getHours()).toBe(0)
    expect(period.end.getHours()).toBe(23)
    expect(period.end.getMinutes()).toBe(59)
  })
})
