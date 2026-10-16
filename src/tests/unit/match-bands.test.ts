import { describe, expect, it } from 'vitest'

import {
  COUNTED_BANDS, DEFAULT_MATCH_WIDTH, MATCH_WIDTHS, MATCH_WIDTH_CUTOFFS,
  bandForScore, cutoffsFor, isCountedBand, isMatchWidth,
} from '@/lib/fundingDept/matchBands'
import { isQualifyingMatch } from '@/lib/fundingDept/reportDefinitions'

describe('match widths', () => {
  it('ships narrow as the default, so an office that never opens the screen sees no change', () => {
    expect(DEFAULT_MATCH_WIDTH).toBe('NARROW')
    expect(MATCH_WIDTH_CUTOFFS.NARROW).toEqual({ strong: 0.65, moderate: 0.5 })
  })

  it('gets wider in one direction only — each width counts everything the narrower one did', () => {
    const order = ['NARROW', 'BALANCED', 'WIDE'] as const
    for (let i = 1; i < order.length; i++) {
      expect(MATCH_WIDTH_CUTOFFS[order[i]].moderate).toBeLessThan(MATCH_WIDTH_CUTOFFS[order[i - 1]].moderate)
      expect(MATCH_WIDTH_CUTOFFS[order[i]].strong).toBeLessThan(MATCH_WIDTH_CUTOFFS[order[i - 1]].strong)
    }
    // A score counted at a narrow width must still count at a wider one.
    const score = 0.52
    expect(isCountedBand(bandForScore(score, 'NARROW'))).toBe(true)
    for (const width of MATCH_WIDTHS) expect(isCountedBand(bandForScore(score, width))).toBe(true)
  })

  it('falls back to the shipped width for anything that is not a width', () => {
    expect(isMatchWidth('SOMETHING')).toBe(false)
    expect(cutoffsFor(undefined)).toEqual(MATCH_WIDTH_CUTOFFS[DEFAULT_MATCH_WIDTH])
    expect(cutoffsFor('nonsense' as never)).toEqual(MATCH_WIDTH_CUTOFFS[DEFAULT_MATCH_WIDTH])
  })

  it('bands a score by the chosen width', () => {
    expect(bandForScore(0.7, 'NARROW')).toBe('strong')
    expect(bandForScore(0.52, 'NARROW')).toBe('moderate')
    // The case that drove this setting: 0.49 counts nowhere at narrow, and is a
    // good match once the office says a wider reading suits their corpus.
    expect(bandForScore(0.49, 'NARROW')).toBe('weak')
    expect(bandForScore(0.49, 'BALANCED')).toBe('moderate')
    expect(bandForScore(0.49, 'WIDE')).toBe('strong')
  })

  it('counts strong and good, never possible', () => {
    expect(COUNTED_BANDS).toEqual(['strong', 'moderate'])
    expect(isCountedBand('weak')).toBe(false)
  })

  it('keeps the band written on a row that was never scored', () => {
    // Reconstructed history has no score. Deriving one would silently demote it.
    expect(bandForScore(null, 'NARROW', 'strong')).toBe('strong')
    expect(bandForScore(undefined, 'WIDE', 'moderate')).toBe('moderate')
    expect(bandForScore(null, 'NARROW', null)).toBe('weak')
  })
})

describe('qualifying match honours the width', () => {
  const row = {
    inferred: false,
    source_version: 'call-people-census-v2',
    match_tier: 'weak',
    match_score: 0.46,
    first_seen_at: new Date('2026-09-01T10:00:00Z'),
  }

  it('judges a scored row on its score, not on the band stored beside it', () => {
    expect(isQualifyingMatch(row, null, 'NARROW')).toBe(false)
    expect(isQualifyingMatch(row, null, 'BALANCED')).toBe(true)
  })

  it('still refuses a retired scoring at every width', () => {
    for (const width of MATCH_WIDTHS) {
      expect(isQualifyingMatch({ ...row, source_version: 'person-call-census-v1', match_score: 0.9 }, null, width)).toBe(false)
      expect(isQualifyingMatch({ ...row, source_version: 'manual-allocation-v1', match_score: 0.9 }, null, width)).toBe(false)
    }
  })

  it('still refuses a match first seen after the deadline, however wide', () => {
    expect(isQualifyingMatch({ ...row, match_score: 0.9 }, new Date('2026-08-31T00:00:00Z'), 'WIDE')).toBe(false)
  })
})
