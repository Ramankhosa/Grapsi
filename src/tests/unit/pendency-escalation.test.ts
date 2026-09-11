import { describe, expect, it } from 'vitest'

import { stageFor, ESCALATION_STAGES } from '@/lib/fundingDept/pendencyEscalationService'
import { DEFAULT_DEPT_SETTINGS } from '@/lib/fundingDept/settings'

/**
 * The pendency ladder.
 *
 * Every case below is one the first working version got wrong, so each is a
 * regression guard rather than a restatement of the implementation.
 */

const NOW = new Date('2026-09-10T09:00:00.000Z')
const daysAgo = (count: number) => new Date(NOW.getTime() - count * 86400000)

const S = DEFAULT_DEPT_SETTINGS // untouched 7, head +7, admin +7

describe('pendency escalation ladder', () => {
  it('says nothing about a call younger than the threshold', () => {
    expect(stageFor(0, S, {}, NOW)).toBeNull()
    expect(stageFor(6, S, {}, NOW)).toBeNull()
  })

  it('tells the covering officer first, at the threshold', () => {
    expect(stageFor(7, S, {}, NOW)).toBe('OFFICER')
  })

  it('still tells the officer first on a backlog that predates the feature', () => {
    // The bug this exists for: anchored to age alone, a 48-day-old call jumped
    // straight to ADMIN on the very first sweep, under a message that said the
    // officer and the head had already been told. They had not.
    expect(stageFor(48, S, {}, NOW)).toBe('OFFICER')
    expect(stageFor(365, S, {}, NOW)).toBe('OFFICER')
  })

  it('waits the configured gap before climbing to the next rung', () => {
    // Without the brake the ladder would climb all three rungs in three
    // consecutive hourly sweeps.
    const justTold = { claimed: ['OFFICER'], lastEscalatedAt: NOW }
    expect(stageFor(48, S, justTold, NOW)).toBeNull()
    expect(stageFor(48, S, { claimed: ['OFFICER'], lastEscalatedAt: daysAgo(6) }, NOW)).toBeNull()
    expect(stageFor(48, S, { claimed: ['OFFICER'], lastEscalatedAt: daysAgo(7) }, NOW)).toBe('HEAD')
  })

  it('climbs to the administrators only after the head has been told', () => {
    expect(
      stageFor(48, S, { claimed: ['OFFICER', 'HEAD'], lastEscalatedAt: daysAgo(7) }, NOW)
    ).toBe('ADMIN')
    // Skipping a rung is impossible even when the age would allow it.
    expect(stageFor(90, S, { claimed: [], lastEscalatedAt: null }, NOW)).toBe('OFFICER')
  })

  it('stops once every rung has fired', () => {
    expect(
      stageFor(365, S, { claimed: [...ESCALATION_STAGES], lastEscalatedAt: daysAgo(90) }, NOW)
    ).toBeNull()
  })

  it('stops at the head when the tenant has switched off admin escalation', () => {
    const settings = { ...S, escalateToAdmin: false }
    expect(
      stageFor(90, settings, { claimed: ['OFFICER', 'HEAD'], lastEscalatedAt: daysAgo(90) }, NOW)
    ).toBeNull()
    // The rungs below it still work.
    expect(stageFor(90, settings, {}, NOW)).toBe('OFFICER')
  })

  it('honours a tenant that counts pendency differently', () => {
    const patient = { ...S, untouchedDays: 30, escalateToHeadAfterDays: 30 }
    expect(stageFor(20, patient, {}, NOW)).toBeNull()
    expect(stageFor(30, patient, {}, NOW)).toBe('OFFICER')
    expect(
      stageFor(70, patient, { claimed: ['OFFICER'], lastEscalatedAt: daysAgo(29) }, NOW)
    ).toBeNull()
    expect(
      stageFor(70, patient, { claimed: ['OFFICER'], lastEscalatedAt: daysAgo(30) }, NOW)
    ).toBe('HEAD')
  })

  it('does not stall forever on a row written before the timestamp existed', () => {
    // Backfilled rows have stages but no date. Treating the gap as unsatisfied
    // would freeze those ladders permanently.
    expect(stageFor(48, S, { claimed: ['OFFICER'], lastEscalatedAt: null }, NOW)).toBe('HEAD')
  })
})
