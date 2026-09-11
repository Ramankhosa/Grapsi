import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DEPT_SETTINGS,
  DEPT_NUMBERS,
  DEPT_SETTING_COPY,
  DEPT_TOGGLES,
  normalizeDeptSettings,
} from '@/lib/fundingDept/settings'

/**
 * Department thresholds.
 *
 * These numbers end up interpolated into raw SQL interval literals and drive who
 * gets interrupted, so the normalizer has to be total: never throw, never return
 * a partial, and never pass through a value it cannot vouch for.
 */

describe('normalizeDeptSettings', () => {
  it('returns the defaults for a tenant that has never opened the screen', () => {
    expect(normalizeDeptSettings(null)).toEqual(DEFAULT_DEPT_SETTINGS)
    expect(normalizeDeptSettings(undefined)).toEqual(DEFAULT_DEPT_SETTINGS)
    expect(normalizeDeptSettings({})).toEqual(DEFAULT_DEPT_SETTINGS)
  })

  it('degrades rather than throwing on a malformed column', () => {
    // A half-written JSON column must not leave a sweep to discover mid-run
    // that untouchedDays is undefined.
    for (const junk of ['not json', 42, [], true, { untouchedDays: 'soon' }]) {
      expect(normalizeDeptSettings(junk)).toEqual(
        expect.objectContaining({ untouchedDays: DEFAULT_DEPT_SETTINGS.untouchedDays })
      )
    }
  })

  it('clamps every number into its bounds', () => {
    const wild = normalizeDeptSettings({
      untouchedDays: 100000,
      silentDays: -4,
      unansweredDays: 0,
      facultyDormantDays: 1,
      dismissalRateWarnPct: 500,
      firstTouchTargetDays: 2.6,
    })
    expect(wild.untouchedDays).toBe(90)
    expect(wild.silentDays).toBe(1)
    expect(wild.unansweredDays).toBe(1)
    expect(wild.facultyDormantDays).toBe(7)
    expect(wild.dismissalRateWarnPct).toBe(100)
    expect(wild.firstTouchTargetDays).toBe(3)
  })

  it('keeps a real choice a tenant made', () => {
    const chosen = normalizeDeptSettings({
      untouchedDays: 21,
      escalateToAdmin: false,
      weeklySnapshotsEnabled: false,
    })
    expect(chosen.untouchedDays).toBe(21)
    expect(chosen.escalateToAdmin).toBe(false)
    expect(chosen.weeklySnapshotsEnabled).toBe(false)
    // Everything untouched keeps its default.
    expect(chosen.silentDays).toBe(DEFAULT_DEPT_SETTINGS.silentDays)
  })

  it('ignores a non-boolean where a toggle belongs', () => {
    const settings = normalizeDeptSettings({ pendencyEscalationEnabled: 'yes' })
    expect(settings.pendencyEscalationEnabled).toBe(true)
  })
})

describe('the settings screen vocabulary', () => {
  it('has copy for every field it offers', () => {
    // The API builds the screen from these lists. A field listed without copy
    // renders a blank label; copy without a field is a control nobody can reach.
    for (const key of [...DEPT_TOGGLES, ...DEPT_NUMBERS]) {
      expect(DEPT_SETTING_COPY[key]?.label, key).toBeTruthy()
      expect(DEPT_SETTING_COPY[key]?.help, key).toBeTruthy()
    }
    expect(Object.keys(DEPT_SETTING_COPY).sort()).toEqual(
      [...DEPT_TOGGLES, ...DEPT_NUMBERS].sort()
    )
  })
})
