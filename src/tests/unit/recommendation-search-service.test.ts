import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecommendationCandidate } from '@/lib/recommendations/types';
import { normalizeRecommendationSearchRequest } from '@/lib/recommendations/utils';
import { RecommendationSearchService } from '@/lib/services/recommendationSearchService';

function makeCandidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    id: 'call-1',
    agencyName: 'National Science Agency',
    schemeTitle: 'AI Research Grant',
    shortDescription: 'Supports AI and healthcare research.',
    fullDescription: null,
    description: 'Supports AI and healthcare research.',
    closeDate: '2026-07-01',
    isRolling: false,
    fundingKinds: ['Research Grant'],
    disciplines: ['artificial intelligence', 'healthcare'],
    eligibleCountries: [],
    eligibleRegions: [],
    hostCountries: [],
    institutionTypes: [],
    careerStages: [],
    sponsorType: null,
    officialUrls: ['https://example.com/call'],
    amountMin: null,
    amountMax: null,
    currency: null,
    eligibilityText: null,
    contactInfo: null,
    geographyScope: null,
    funderCountry: null,
    citizenshipRequirements: [],
    residencyRequirements: [],
    applicationLanguages: [],
    semanticSimilarity: 0.72,
    textRank: 0.45,
    ...overrides,
  };
}

describe('RecommendationSearchService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies filters_too_strict and returns cumulative strict filter recovery without auto-relaxing', async () => {
    const service = new RecommendationSearchService();
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'AI healthcare' },
      filters: {
        careerStages: ['Postdoctoral'],
        hostCountries: ['Germany'],
        fundingKinds: ['Research Grant'],
      },
    });

    vi.spyOn(service as any, 'executeSearch')
      .mockResolvedValueOnce({ candidates: [], degradedMode: null })
      .mockResolvedValueOnce({
        candidates: [makeCandidate({ hostCountries: ['Canada'] })],
        degradedMode: null,
      });

    const result = await (service as any).buildResponseFromExecution(normalized, {
      candidates: [],
      degradedMode: null,
    });

    expect(result.response.noResultsReason).toBe('filters_too_strict');
    expect(result.response.totalResults).toBe(0);
    expect(result.response.rawResults).toEqual([]);
    expect(result.response.appliedFilters.hostCountries).toEqual(['Germany']);
    expect(result.response.appliedFilters.careerStages).toEqual(['Postdoctoral']);
    expect(result.response.strictFilterRecovery).toEqual({
      retryFilters: expect.objectContaining({
        careerStages: [],
        hostCountries: [],
        fundingKinds: ['Research Grant'],
      }),
      relaxedFilterKeys: ['careerStages', 'hostCountries'],
    });
  });

  it('keeps no_match when the recovery ladder finds no displayable results', async () => {
    const service = new RecommendationSearchService();
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'AI healthcare diagnostics' },
      filters: {
        hostCountries: ['Germany'],
      },
    });

    vi.spyOn(service as any, 'executeSearch').mockResolvedValue({
      candidates: [],
      degradedMode: null,
    });

    const result = await (service as any).buildResponseFromExecution(normalized, {
      candidates: [],
      degradedMode: null,
    });

    expect(result.response.noResultsReason).toBe('no_match');
    expect(result.response.strictFilterRecovery).toBeNull();
  });

  it('returns query_too_weak when there are no filters and the query is weak', async () => {
    const service = new RecommendationSearchService();
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'AI' },
      filters: {},
    });
    const executeSpy = vi.spyOn(service as any, 'executeSearch');

    const result = await (service as any).buildResponseFromExecution(normalized, {
      candidates: [],
      degradedMode: null,
    });

    expect(result.response.noResultsReason).toBe('query_too_weak');
    expect(result.response.strictFilterRecovery).toBeNull();
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
