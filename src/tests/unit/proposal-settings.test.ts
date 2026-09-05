import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROPOSAL_SETTINGS,
  normalizeProposalSettings,
  PROPOSAL_TOGGLES,
  ProposalFeatureDisabled,
  requireProposalFeature,
  TOGGLE_COPY,
} from '@/lib/proposals/settings'
import { nextActionFor, validateProposalTransition, validateVersionUpload } from '@/lib/proposals/statusMachine'

/**
 * A settings column that half-parses is worse than one that fails: a route
 * would carry on with `budgetHeads` undefined and fall over three layers down.
 * These pin the normalizer's contract — always complete, always valid.
 */
describe('normalizeProposalSettings', () => {
  it('gives a tenant that has never configured anything the full process', () => {
    expect(normalizeProposalSettings(null)).toEqual(DEFAULT_PROPOSAL_SETTINGS)
    expect(normalizeProposalSettings(undefined)).toEqual(DEFAULT_PROPOSAL_SETTINGS)
    expect(normalizeProposalSettings({})).toEqual(DEFAULT_PROPOSAL_SETTINGS)
  })

  it('survives a malformed column rather than propagating it', () => {
    const settings = normalizeProposalSettings('not an object')
    expect(settings).toEqual(DEFAULT_PROPOSAL_SETTINGS)
    expect(settings.budgetHeads.length).toBeGreaterThan(0)
  })

  it('keeps the toggles a tenant actually set', () => {
    const settings = normalizeProposalSettings({
      aiReviewEnabled: false,
      budgetEnabled: false,
      cutoffEnabled: false,
    })
    expect(settings.aiReviewEnabled).toBe(false)
    expect(settings.budgetEnabled).toBe(false)
    expect(settings.cutoffEnabled).toBe(false)
    // Untouched ones stay on.
    expect(settings.teamEnabled).toBe(true)
    expect(settings.agencyTrackingEnabled).toBe(true)
  })

  it('ignores a non-boolean where a boolean belongs', () => {
    const settings = normalizeProposalSettings({ aiReviewEnabled: 'yes', budgetEnabled: 1 })
    expect(settings.aiReviewEnabled).toBe(true)
    expect(settings.budgetEnabled).toBe(true)
  })

  it('clamps the numbers instead of trusting them', () => {
    const wild = normalizeProposalSettings({
      cutoffOffsetDays: 9999,
      reviewSlaDays: -4,
      agencyStaleDays: 100000,
    })
    expect(wild.cutoffOffsetDays).toBe(90)
    expect(wild.reviewSlaDays).toBe(1)
    expect(wild.agencyStaleDays).toBe(730)

    const nonsense = normalizeProposalSettings({ cutoffOffsetDays: 'soon' })
    expect(nonsense.cutoffOffsetDays).toBe(DEFAULT_PROPOSAL_SETTINGS.cutoffOffsetDays)
  })

  it('drops budget heads it does not recognise', () => {
    const settings = normalizeProposalSettings({
      budgetHeads: ['MANPOWER', 'UNICORNS', 'travel'],
    })
    expect(settings.budgetHeads).toEqual(['MANPOWER', 'TRAVEL'])
  })

  it('falls back to every head rather than leaving the grid with no rows', () => {
    expect(normalizeProposalSettings({ budgetHeads: [] }).budgetHeads).toEqual(
      DEFAULT_PROPOSAL_SETTINGS.budgetHeads
    )
    expect(normalizeProposalSettings({ budgetHeads: ['NONSENSE'] }).budgetHeads).toEqual(
      DEFAULT_PROPOSAL_SETTINGS.budgetHeads
    )
  })

  it('round-trips its own output unchanged', () => {
    const once = normalizeProposalSettings({ aiReviewEnabled: false, reviewSlaDays: 10 })
    expect(normalizeProposalSettings(once)).toEqual(once)
  })
})

describe('every toggle is explained to the administrator', () => {
  it('has copy for each one', () => {
    for (const toggle of PROPOSAL_TOGGLES) {
      expect(TOGGLE_COPY[toggle]?.label?.length).toBeGreaterThan(0)
      // The help text has to say what happens when it is off, which needs more
      // than a restated label.
      expect(TOGGLE_COPY[toggle]?.help?.length).toBeGreaterThan(30)
    }
  })
})

describe('requireProposalFeature', () => {
  it('passes when the stage is on', () => {
    expect(() => requireProposalFeature(DEFAULT_PROPOSAL_SETTINGS, 'budgetEnabled')).not.toThrow()
  })

  it('throws a 403 naming the feature when it is off', () => {
    const settings = normalizeProposalSettings({ budgetEnabled: false })
    try {
      requireProposalFeature(settings, 'budgetEnabled')
      throw new Error('should have thrown')
    } catch (error: any) {
      expect(error).toBeInstanceOf(ProposalFeatureDisabled)
      expect(error.status).toBe(403)
      expect(error.code).toBe('FEATURE_DISABLED')
      expect(error.feature).toBe('budgetEnabled')
    }
  })
})

describe('the rules honour the tenant policy', () => {
  const now = new Date('2026-09-20T10:00:00Z')

  it('lets a cut-off pass unenforced when the office does not run one', () => {
    const enforced = validateVersionUpload({
      status: 'IN_REVIEW',
      lens: 'faculty',
      reviewCutoffAt: '2026-09-01T00:00:00Z',
      cutoffEnabled: true,
      now,
    })
    expect(enforced.ok).toBe(false)

    const relaxed = validateVersionUpload({
      status: 'IN_REVIEW',
      lens: 'faculty',
      reviewCutoffAt: '2026-09-01T00:00:00Z',
      cutoffEnabled: false,
      now,
    })
    expect(relaxed.ok).toBe(true)
  })

  it('clears without a reason when the office does not require a review first', () => {
    const strict = validateProposalTransition({
      from: 'IN_REVIEW',
      to: 'CLEARED',
      lens: 'officer',
      hasSharedReview: false,
      requireReviewBeforeClearing: true,
    })
    expect(strict.ok).toBe(false)

    const relaxed = validateProposalTransition({
      from: 'IN_REVIEW',
      to: 'CLEARED',
      lens: 'officer',
      hasSharedReview: false,
      requireReviewBeforeClearing: false,
    })
    expect(relaxed.ok).toBe(true)
  })

  it('refuses agency states to an office that does not track them', () => {
    const result = validateProposalTransition({
      from: 'SUBMITTED',
      to: 'SANCTIONED',
      lens: 'officer',
      agencyTrackingEnabled: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('does not track agency outcomes')

    // Withdrawing is still possible — that is the applicant's, not the agency's.
    expect(
      validateProposalTransition({
        from: 'SUBMITTED',
        to: 'WITHDRAWN',
        lens: 'officer',
        agencyTrackingEnabled: false,
      }).ok
    ).toBe(true)
  })

  it('never names a review stage the office does not run', () => {
    const withReview = nextActionFor({
      status: 'IN_REVIEW',
      currentVersionNo: 1,
      latestVersionReviewStatus: 'NONE',
      aiReviewEnabled: true,
      now,
    })
    expect(withReview.text).toContain('review')

    const without = nextActionFor({
      status: 'IN_REVIEW',
      currentVersionNo: 1,
      latestVersionReviewStatus: 'NONE',
      aiReviewEnabled: false,
      now,
    })
    expect(without.actor).toBe('officer')
    expect(without.text.toLowerCase()).not.toContain('review')
  })

  it('does not put a sanctioned grant in anybody’s queue', () => {
    const action = nextActionFor({ status: 'SANCTIONED', currentVersionNo: 2, now })
    expect(action.actor).toBe('none')
    expect(action.text).toBe('')
  })
})
