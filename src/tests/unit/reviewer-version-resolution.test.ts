import { describe, expect, it } from 'vitest'

import { normalizeVersionSelections, resolveSectionVersions } from '@/lib/reviewer/finalReport'
import {
  expectedScoredVersion,
  groupReviewerSections,
  reportFreshness,
  supersededScoredSections,
} from '@/lib/reviewer/sectionGrouping'

function row(overrides: Record<string, any>) {
  return {
    id: `${overrides.section_title}-v${overrides.version ?? 1}`,
    section_title: 'Methodology',
    version: 1,
    status: 'reviewed',
    ai_review_json: { score: 7, summary: 'ok' },
    last_reviewed_at: '2026-08-01T00:00:00Z',
    ...overrides,
  } as any
}

describe('normalizeVersionSelections', () => {
  it('accepts plain and legacy "title|version" keys, newest wins', () => {
    expect(normalizeVersionSelections({ Methodology: 2, 'Budget|1': 1, 'Budget|3': 3, Junk: 'x' }))
      .toEqual({ Methodology: 2, Budget: 3 })
  })
  it('returns an empty map for nothing', () => {
    expect(normalizeVersionSelections(null)).toEqual({})
    expect(normalizeVersionSelections('nope')).toEqual({})
  })
})

describe('resolveSectionVersions', () => {
  it('keeps the reviewed v1 when v2 is still a draft, and reports the pending draft', () => {
    const sections = [row({ version: 1 }), row({ version: 2, status: 'draft', ai_review_json: {} })]
    const result = resolveSectionVersions(sections)
    expect(result.effective.map((s) => s.version)).toEqual([1])
    expect(result.chosenVersions).toEqual({ Methodology: 1 })
    expect(result.pendingDrafts).toEqual({ Methodology: 2 })
    expect(result.superseded.map((s) => s.version)).toEqual([2])
  })

  it('moves to v2 once it is reviewed', () => {
    const sections = [row({ version: 1 }), row({ version: 2 })]
    const result = resolveSectionVersions(sections)
    expect(result.chosenVersions).toEqual({ Methodology: 2 })
    expect(result.pendingDrafts).toEqual({})
  })

  it('honours a pin to an older reviewed version', () => {
    const sections = [row({ version: 1 }), row({ version: 2 })]
    const result = resolveSectionVersions(sections, { Methodology: 1 })
    expect(result.chosenVersions).toEqual({ Methodology: 1 })
    expect(result.pendingDrafts).toEqual({})
  })

  it('falls back to the newest draft when nothing was ever reviewed', () => {
    const sections = [row({ version: 1, status: 'draft', ai_review_json: {} }), row({ version: 2, status: 'draft', ai_review_json: {} })]
    const result = resolveSectionVersions(sections)
    expect(result.chosenVersions).toEqual({ Methodology: 2 })
  })

  it('leaves excluded titles out entirely', () => {
    const sections = [row({ version: 1 }), row({ section_title: 'Budget', version: 1 })]
    const result = resolveSectionVersions(sections, null, { excludedTitles: ['budget'] })
    expect(result.effective.map((s) => s.section_title)).toEqual(['Methodology'])
    expect(result.excludedTitles).toEqual(['Budget'])
    expect(result.chosenVersions).toEqual({ Methodology: 1 })
  })
})

describe('reportFreshness with versions', () => {
  const report = (scored: Record<string, number>, extra: Record<string, any> = {}) => ({
    overall_score: 7,
    score_basis: { scoredVersions: scored, ...extra },
    generated_at: '2026-08-02T00:00:00Z',
  })

  it('stays fresh when only an unreviewed draft was added', () => {
    const sections = [row({ version: 1 }), row({ version: 2, status: 'draft', ai_review_json: {} })]
    expect(reportFreshness(report({ Methodology: 1 }), sections)).toBe('fresh')
  })

  it('goes stale once the new version is reviewed', () => {
    const sections = [row({ version: 1 }), row({ version: 2 })]
    expect(reportFreshness(report({ Methodology: 1 }), sections)).toBe('stale')
  })

  it('respects a pin to the older version', () => {
    const sections = [row({ version: 1 }), row({ version: 2 })]
    expect(reportFreshness(report({ Methodology: 1 }, { pinnedVersions: { Methodology: 1 } }), sections)).toBe('fresh')
  })

  it('ignores excluded titles', () => {
    const sections = [row({ version: 1 }), row({ section_title: 'Budget', version: 3 })]
    expect(reportFreshness(report({ Methodology: 1 }, { excludedTitles: ['Budget'] }), sections)).toBe('fresh')
  })

  it('is stale after every section was reset to draft', () => {
    const sections = [row({ version: 1, status: 'draft' })]
    expect(reportFreshness(report({ Methodology: 1 }), sections)).toBe('stale')
  })

  it('is fresh when there are no sections at all', () => {
    expect(reportFreshness(report({}), [])).toBe('fresh')
  })

  it('expectedScoredVersion prefers a reviewed pin, else newest reviewed', () => {
    const [group] = groupReviewerSections([row({ version: 1 }), row({ version: 2 }), row({ version: 3, status: 'draft', ai_review_json: {} })])
    expect(expectedScoredVersion(group, { Methodology: 1 })).toBe(1)
    expect(expectedScoredVersion(group, { Methodology: 3 })).toBe(2)
    expect(expectedScoredVersion(group, null)).toBe(2)
  })
})

describe('supersededScoredSections', () => {
  const report = (scored: Record<string, number>, extra: Record<string, any> = {}) => ({
    overall_score: 7,
    score_basis: { scoredVersions: scored, ...extra },
    generated_at: '2026-08-02T00:00:00Z',
  })

  it('names a section the report scores at an older reviewed version', () => {
    const sections = [row({ version: 1 }), row({ version: 2 })]
    expect(supersededScoredSections(report({ Methodology: 1 }, { pinnedVersions: { Methodology: 1 } }), sections))
      .toEqual([{ title: 'Methodology', scored: 1, latest: 2 }])
  })

  it('says nothing when the report already scores the newest reviewed version', () => {
    const sections = [row({ version: 1 }), row({ version: 2 })]
    expect(supersededScoredSections(report({ Methodology: 2 }), sections)).toEqual([])
  })

  it('ignores a newer version that has not been reviewed yet', () => {
    const sections = [row({ version: 1 }), row({ version: 2, status: 'draft', ai_review_json: {} })]
    expect(supersededScoredSections(report({ Methodology: 1 }), sections)).toEqual([])
  })

  it('ignores sections the report deliberately left out', () => {
    const sections = [row({ section_title: 'Budget', version: 1 }), row({ section_title: 'Budget', version: 2 })]
    const stored = report({ Budget: 1 }, { excludedTitles: ['Budget'] })
    expect(supersededScoredSections(stored, sections)).toEqual([])
  })

  it('is empty for a report with no score basis', () => {
    expect(supersededScoredSections({ overall_score: 7 }, [row({ version: 1 })])).toEqual([])
    expect(supersededScoredSections(null, [row({ version: 1 })])).toEqual([])
  })
})
