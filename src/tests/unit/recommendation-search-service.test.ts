import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecommendationCandidate, RecommendationProfileSnapshot } from '@/lib/recommendations/types';
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

  it('soft-reranks profile-relevant calls without hiding valid non-profile calls', async () => {
    const service = new RecommendationSearchService();
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'AI healthcare diagnostics' },
      filters: { limit: 5 },
    });
    const profile: RecommendationProfileSnapshot = {
      countryOfResidence: 'India',
      citizenshipCountries: ['India'],
      institutionType: 'University',
      careerStage: 'Early Career Researcher',
      applicationLanguages: ['English'],
      researchAreas: ['Medical Imaging'],
      keywords: ['radiology diagnostics'],
      savedResearchAreas: [],
      publications: [],
      sourceLabel: 'Medical Imaging AI',
    };

    const result = await (service as any).buildResponseFromExecution(
      normalized,
      {
        degradedMode: null,
        candidates: [
          makeCandidate({
            id: 'generic-ai',
            schemeTitle: 'Generic AI Research Grant',
            semanticSimilarity: 0.62,
            textRank: 0.35,
            disciplines: ['Artificial Intelligence'],
            eligibleCountries: ['Germany'],
            institutionTypes: ['Company'],
            careerStages: ['Senior Researcher'],
            applicationLanguages: ['German'],
          }),
          makeCandidate({
            id: 'profile-fit',
            schemeTitle: 'Medical Imaging Early Career Fellowship',
            semanticSimilarity: 0.58,
            textRank: 0.35,
            disciplines: ['Medical Imaging'],
            eligibleCountries: ['India'],
            institutionTypes: ['University'],
            careerStages: ['Early Career Researcher'],
            applicationLanguages: ['English'],
          }),
        ],
      },
      undefined,
      profile
    );

    expect(result.response.rawResults.map((item: any) => item.id)).toEqual(['profile-fit', 'generic-ai']);
    expect(result.response.totalResults).toBe(2);
    expect(result.response.rawResults[0].profileMatch?.reasons).toContain('Eligibility checked using career stage: Early Career Researcher');
  });

  it('keeps residence and citizenship profile signals separate', async () => {
    const service = new RecommendationSearchService();
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'public health implementation' },
      filters: { limit: 5 },
    });
    const profile: RecommendationProfileSnapshot = {
      countryOfResidence: 'India',
      citizenshipCountries: ['United States'],
      institutionType: null,
      careerStage: null,
      applicationLanguages: [],
      researchAreas: ['Public Health'],
      keywords: [],
      savedResearchAreas: [],
      publications: [],
      sourceLabel: null,
    };

    const result = await (service as any).buildResponseFromExecution(
      normalized,
      {
        degradedMode: null,
        candidates: [
          makeCandidate({
            id: 'citizenship-and-residence',
            disciplines: ['Public Health'],
            eligibleCountries: ['India'],
            citizenshipRequirements: ['United States'],
          }),
        ],
      },
      undefined,
      profile
    );

    const match = result.response.rawResults[0].profileMatch;
    expect(match?.fieldsUsed).toEqual(expect.arrayContaining(['countryOfResidence', 'citizenshipCountries']));
    expect(match?.reasons).toEqual(expect.arrayContaining([
      'Eligibility checked using residence: India',
      'Eligibility checked using citizenship: United States',
    ]));
  });

  it('uses saved research area taxonomy to expand weak profile-enabled queries', () => {
    const service = new RecommendationSearchService();
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'grants for me' },
      filters: {},
    });
    const profile: RecommendationProfileSnapshot = {
      countryOfResidence: null,
      citizenshipCountries: [],
      institutionType: null,
      careerStage: null,
      applicationLanguages: [],
      researchAreas: [],
      keywords: [],
      savedResearchAreas: [
        {
          id: 'area-1',
          label: 'Medical Imaging AI',
          researchArea: 'Explainable AI for radiology',
          keywords: ['diagnostics'],
          disciplines: ['Medical Imaging'],
          taxonomyAreaId: 'tax-1',
          taxonomyPath: 'Healthcare / Medical Imaging',
        },
      ],
      publications: [],
      sourceLabel: 'Medical Imaging AI',
    };

    const expanded = (service as any).applyProfileContextToQuery(normalized, profile);

    expect(expanded.normalizedQuery.semanticDocument).toContain('Medical Imaging AI');
    expect(expanded.normalizedQuery.semanticDocument).toContain('Healthcare / Medical Imaging');
    expect(expanded.normalizedQuery.queryStrength).toBe('normal');
  });

  it('soft-reranks publication-matched calls from tagged publication context', async () => {
    const service = new RecommendationSearchService();
    const normalized = normalizeRecommendationSearchRequest({
      inputMode: 'research_area',
      query: { researchArea: 'funding based on my publications' },
      filters: { limit: 5 },
    });
    const profile: RecommendationProfileSnapshot = {
      countryOfResidence: null,
      citizenshipCountries: [],
      institutionType: null,
      careerStage: null,
      applicationLanguages: [],
      researchAreas: [],
      keywords: [],
      savedResearchAreas: [],
      publications: [
        {
          id: 'pub-1',
          title: 'Federated learning for medical imaging diagnosis',
          year: 2024,
          venue: 'Journal of AI Health',
          doi: '10.1000/example',
          tags: ['medical imaging', 'federated learning'],
          abstractSnippet: 'Privacy preserving radiology diagnostics.',
        },
      ],
      sourceLabel: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: true },
    };

    const result = await (service as any).buildResponseFromExecution(
      normalized,
      {
        degradedMode: null,
        candidates: [
          makeCandidate({
            id: 'generic',
            schemeTitle: 'General Data Science Grant',
            shortDescription: 'Supports general data science research.',
            description: 'Supports general data science research.',
            disciplines: ['Data Science'],
            semanticSimilarity: 0.58,
          }),
          makeCandidate({
            id: 'publication-fit',
            schemeTitle: 'Medical Imaging Fellowship',
            shortDescription: 'Supports medical imaging and radiology AI.',
            description: 'Supports medical imaging and radiology AI.',
            disciplines: ['Medical Imaging'],
            semanticSimilarity: 0.54,
          }),
        ],
      },
      undefined,
      profile
    );

    expect(result.response.rawResults.map((item: any) => item.id)).toEqual(['publication-fit', 'generic']);
    expect(result.response.rawResults[0].profileMatch?.reasons).toContain('Matched your publication: Federated learning for medical imaging diagnosis');
    expect(result.response.searchDiagnostics?.profile?.preferences).toEqual({
      useEligibilityProfile: false,
      usePublicationContext: true,
    });
  });

  it('ignores provided personal snapshots unless a preference flag is enabled', async () => {
    const service = new RecommendationSearchService();
    const profile: RecommendationProfileSnapshot = {
      countryOfResidence: 'India',
      citizenshipCountries: ['India'],
      institutionType: 'University',
      careerStage: 'Early Career Researcher',
      applicationLanguages: ['English'],
      researchAreas: [],
      keywords: [],
      savedResearchAreas: [],
      publications: [],
      sourceLabel: null,
    };

    vi.spyOn(service as any, 'executeSearch').mockResolvedValue({
      degradedMode: null,
      candidates: [
        makeCandidate({
          id: 'profile-fit',
          eligibleCountries: ['India'],
          institutionTypes: ['University'],
          careerStages: ['Early Career Researcher'],
          applicationLanguages: ['English'],
        }),
      ],
    });

    const result = await service.search({
      inputMode: 'research_area',
      query: { researchArea: 'AI healthcare' },
      filters: { limit: 5 },
      profileContext: profile,
    });

    expect(result.rawResults[0].profileMatch).toBeNull();
    expect(result.searchDiagnostics?.profile?.enabled).toBe(false);
    expect(result.searchDiagnostics?.profile?.snapshot).toBeNull();
  });
});
