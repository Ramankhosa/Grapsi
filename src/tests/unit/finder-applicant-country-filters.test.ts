import { describe, expect, it } from 'vitest'

import {
  keepCountries,
  normalizeRecommendationSearchRequest,
  validateNormalizedControlledFilters,
} from '@/lib/recommendations/utils'

const normalize = (filters: Record<string, unknown>) =>
  normalizeRecommendationSearchRequest({
    inputMode: 'research_area',
    query: { researchArea: 'clinical trials' },
    filters,
  }).filters

describe('the applicant’s citizenship and residence filters', () => {
  it('keep recognisable countries under their canonical names', () => {
    expect(keepCountries(['india', 'United Kingdom', 'IN'])).toEqual(['India', 'United Kingdom'])
  })

  it('drop free text an older chat or link may still carry, instead of failing', () => {
    expect(keepCountries(['Citizens of EU member states', 'Must reside in Canada'])).toEqual([])
    const filters = normalize({
      citizenshipRequirements: ['Citizens of EU member states', 'India'],
      residencyRequirements: ['nowhere in particular'],
    })
    expect(filters.citizenshipRequirements).toEqual(['India'])
    expect(filters.residencyRequirements).toEqual([])
    expect(validateNormalizedControlledFilters({ citizenshipRequirements: ['Citizens of EU member states'] })).toBeNull()
  })

  it('leave the language filter as chosen', () => {
    expect(normalize({ applicationLanguages: ['english'] }).applicationLanguages).toEqual(['English'])
  })
})
