import { describe, expect, it } from 'vitest'

import { filterValueLabel, formatFilterDescription } from '@/lib/recommendations/filterChips'
import { createDefaultFilters } from '@/lib/recommendations/conversationUtils'
import { FACET_DIMENSION_FIELD, toggleFacetValue } from '@/lib/recommendations/directorySelections'
import {
  normalizeApplicationRouteList,
  normalizeProjectDurationList,
  normalizeQualificationList,
  normalizeRecommendationSearchRequest,
  validateNormalizedControlledFilters,
} from '@/lib/recommendations/utils'

describe('filters on facts the catalogue states', () => {
  it('match vocabulary values without regard to case or punctuation', () => {
    expect(normalizeQualificationList(['phd', 'md/phd', "MASTER'S DEGREE"])).toEqual(['PhD', 'MD/PhD', "Master's degree"])
    // Coded buckets also accept their label, which the chat may send.
    expect(normalizeProjectDurationList(['1 to 3 years', 'up_to_1_year'])).toEqual(['1_to_3_years', 'up_to_1_year'])
    expect(normalizeApplicationRouteList(['Self nomination'])).toEqual(['self_nomination'])
  })

  it('refuse values outside the vocabulary at the API, and drop them in a stored search', () => {
    expect(validateNormalizedControlledFilters({ qualifications: ['Postdoc'] })).toMatch(/qualifications/)
    expect(validateNormalizedControlledFilters({ mobility: ['sideways'] })).toMatch(/mobility/)
    const filters = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'neuroscience' },
      filters: { qualifications: ['Postdoc'], noMembershipNeeded: true },
    }).filters
    expect(filters.qualifications).toEqual([])
    expect(filters.noMembershipNeeded).toBe(true)
  })

  it('default to off', () => {
    const defaults = createDefaultFilters()
    expect(defaults.projectDurations).toEqual([])
    expect(defaults.applicationRoutes).toEqual([])
    expect(defaults.noMembershipNeeded).toBe(false)
  })

  it('read as labels on chips', () => {
    expect(filterValueLabel('projectDurations', 'over_3_years')).toBe('Over 3 years')
    expect(filterValueLabel('indirectCostPolicies', 'DIRECT_ONLY')).toBe('Direct costs only')
    expect(filterValueLabel('applicationRoutes', 'limited_submissions')).toBe('Limited submissions per institution')
    const filters = { ...createDefaultFilters(), mobility: ['inbound'], noMembershipNeeded: true }
    expect(formatFilterDescription(filters, 'mobility')).toBe('Mobility: Coming from abroad')
    expect(formatFilterDescription(filters, 'noMembershipNeeded')).toBe('No society membership needed')
  })

  it('are directory facets whose values are alternatives', () => {
    expect(FACET_DIMENSION_FIELD.applicationRoute).toBe('applicationRoutes')
    const once = toggleFacetValue({}, 'applicationRoute', 'not_stated')
    const twice = toggleFacetValue(once, 'applicationRoute', 'self_nomination')
    expect(twice.applicationRoutes).toEqual(['not_stated', 'self_nomination'])
    expect(toggleFacetValue(twice, 'applicationRoute', 'not_stated').applicationRoutes).toEqual(['self_nomination'])
  })
})
