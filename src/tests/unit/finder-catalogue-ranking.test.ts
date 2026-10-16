import { afterEach, describe, expect, it } from 'vitest'

import { importedDimensionCountryCondition, sortCandidates } from '@/lib/services/recommendationSearchService'
import { normalizeRecommendationSearchRequest } from '@/lib/recommendations/utils'
import type { RecommendationCandidate } from '@/lib/recommendations/types'

function request(sort: 'best_match' | 'deadline_soonest' = 'best_match') {
  return normalizeRecommendationSearchRequest({
    inputMode: 'research_area',
    query: { researchArea: 'cancer research' },
    filters: { sort },
  })
}

function candidate(input: {
  id: string
  score: number
  closeDate?: string | null
  countries?: string[] | null
  excluded?: string[]
}) {
  return {
    candidate: {
      id: input.id,
      schemeTitle: input.id,
      closeDate: input.closeDate ?? null,
      isRolling: false,
      eligibilityDimensions: input.countries
        ? {
            residence_scope: 'COUNTRIES',
            residence_country_codes: input.countries,
            residence_excluded_codes: input.excluded || [],
          }
        : null,
    } as unknown as RecommendationCandidate,
    score: input.score,
  }
}

const india = { residence: ['IN'], citizenship: ['IN'] }

describe('catalogue ranking', () => {
  afterEach(() => {
    delete process.env.FINDER_DEMOTE_INELIGIBLE
    delete process.env.FINDER_RANK_CURATED_FIRST
  })

  it('puts calls the profile is ruled out of after the ones it is not', () => {
    const ordered = sortCandidates(
      [
        candidate({ id: 'us-only-top-score', score: 0.9, countries: ['US'] }),
        candidate({ id: 'open-worldwide', score: 0.6, countries: ['IN', 'US'] }),
        candidate({ id: 'no-eligibility-stated', score: 0.5 }),
      ],
      request(),
      india
    )
    expect(ordered.map((item) => item.candidate.id)).toEqual([
      'open-worldwide',
      'no-eligibility-stated',
      'us-only-top-score',
    ])
  })

  it('keeps score order when the search does not apply the profile', () => {
    const ordered = sortCandidates(
      [
        candidate({ id: 'open-worldwide', score: 0.6, countries: ['IN'] }),
        candidate({ id: 'us-only-top-score', score: 0.9, countries: ['US'] }),
      ],
      request(),
      null
    )
    expect(ordered[0].candidate.id).toBe('us-only-top-score')
  })

  it('FINDER_DEMOTE_INELIGIBLE=0 restores pure score order', () => {
    process.env.FINDER_DEMOTE_INELIGIBLE = '0'
    const ordered = sortCandidates(
      [
        candidate({ id: 'open-worldwide', score: 0.6, countries: ['IN'] }),
        candidate({ id: 'us-only-top-score', score: 0.9, countries: ['US'] }),
      ],
      request(),
      india
    )
    expect(ordered[0].candidate.id).toBe('us-only-top-score')
  })

  it('demotes before the deadline sort, so page one stays applicable', () => {
    const ordered = sortCandidates(
      [
        candidate({ id: 'us-only-closes-first', score: 0.5, closeDate: '2026-11-01', countries: ['US'] }),
        candidate({ id: 'open-closes-later', score: 0.5, closeDate: '2026-12-01', countries: ['IN'] }),
      ],
      request('deadline_soonest'),
      india
    )
    expect(ordered[0].candidate.id).toBe('open-closes-later')
  })

  it('a country filter does not match a call that rules that country out', () => {
    const sql = importedDimensionCountryCondition(['residence'], ['IN']).sql.replace(/\s+/g, ' ')
    expect(sql).toContain('residence_excluded_codes')
    expect(sql).toContain('code <> ALL(residence_excluded_codes)')
  })
})
