import { describe, expect, it } from 'vitest'

import { filterValueLabel, cloneRequiredFilters } from '@/lib/recommendations/filterChips'
import { buildClearedScalarFilters } from '@/lib/recommendations/finderUi'
import { createDefaultFilters } from '@/lib/recommendations/conversationUtils'
import {
  normalizeCurrencyCode,
  normalizeRecommendationSearchRequest,
  normalizeSdgGoalList,
  validateNormalizedControlledFilters,
} from '@/lib/recommendations/utils'

describe('catalogue filters', () => {
  it('normalises SDG goals and rejects anything outside 1-17', () => {
    expect(normalizeSdgGoalList(['13', 'SDG 3', 'sdg7', '13'])).toEqual(['13', '3', '7'])
    expect(normalizeSdgGoalList(['18'])).toBeNull()
    expect(normalizeSdgGoalList(['climate'])).toBeNull()
    expect(validateNormalizedControlledFilters({ sdgGoals: ['0'] })).toMatch(/sdgGoals/)
  })

  it('accepts ISO currency codes only', () => {
    expect(normalizeCurrencyCode('eur')).toBe('EUR')
    expect(normalizeCurrencyCode('€')).toBeNull()
    expect(normalizeCurrencyCode('EURO')).toBeNull()
    expect(validateNormalizedControlledFilters({ amountCurrency: 'dollars' })).toMatch(/amountCurrency/)
  })

  it('defaults the new filters and drops malformed funder ids', () => {
    const filters = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'climate adaptation' },
      filters: { funderIds: ['cmv98eirx00glwv9hs7r3eq5t', "x' OR 1=1"], amountCurrency: 'usd' },
    }).filters
    expect(filters.funderIds).toEqual(['cmv98eirx00glwv9hs7r3eq5t'])
    expect(filters.amountCurrency).toBe('USD')
    expect(filters.sdgGoals).toEqual([])
    expect(filters.programmeFrameworks).toEqual([])
    expect(filters.includeUnknownAmount).toBe(false)
  })

  it('labels chips with funder names and SDG titles', () => {
    expect(filterValueLabel('funderIds', 'abc123', { abc123: 'Wellcome Trust' })).toBe('Wellcome Trust')
    expect(filterValueLabel('funderIds', 'unknown1')).toBe('Selected funder')
    expect(filterValueLabel('sdgGoals', '13')).toBe('SDG 13 · Climate action')
    expect(filterValueLabel('fundingKinds', 'Grant')).toBe('Grant')
  })

  it('drops the amount currency with the last amount bound', () => {
    const filters = { ...createDefaultFilters(), amountMin: 1000, amountMax: 5000, amountCurrency: 'EUR' }
    const withoutMin = buildClearedScalarFilters(filters, 'amountMin')
    expect(withoutMin.amountCurrency).toBe('EUR')
    expect(buildClearedScalarFilters(withoutMin, 'amountMax').amountCurrency).toBe('')
  })

  it('clones filters saved before the new keys existed', () => {
    const legacy = { ...createDefaultFilters() } as Record<string, unknown>
    delete legacy.funderIds
    expect(cloneRequiredFilters(legacy as never).funderIds).toEqual([])
  })
})
