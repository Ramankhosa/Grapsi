import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  InternalRecommendationSearchResponse,
  RecommendationRawResultItem,
  RecommendationSearchRequest,
} from '@/lib/recommendations/types';
import { RecommendationSearchService } from '@/lib/services/recommendationSearchService';

function makeResult(overrides: Partial<RecommendationRawResultItem> = {}): RecommendationRawResultItem {
  return {
    id: 'call-1',
    agencyName: 'Agency',
    schemeTitle: 'Scheme',
    shortDescription: null,
    closeDate: null,
    isRolling: true,
    fundingKinds: [],
    disciplines: [],
    eligibleCountries: [],
    eligibleRegions: [],
    hostCountries: [],
    institutionTypes: [],
    careerStages: [],
    sponsorType: null,
    officialUrls: [],
    score: 0.5,
    matchReasons: [],
    profileMatch: null,
    eligibilitySummary: '',
    taxonomyAreaIds: [],
    fullDescription: null,
    description: '',
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
    semanticSimilarity: 0.5,
    textRank: 0,
    ...overrides,
  };
}

function makeResponse(
  rawResults: RecommendationRawResultItem[],
  overrides: Partial<InternalRecommendationSearchResponse> = {}
): InternalRecommendationSearchResponse {
  return {
    normalizedQuery: {
      inputMode: 'research_area',
      title: null,
      abstract: null,
      keywords: [],
      researchArea: 'topic',
      truncated: false,
      canonicalQueryText: 'topic',
      semanticDocument: 'topic',
      fullTextQuery: 'topic',
      researchTags: [],
      queryStrength: 'normal',
    },
    appliedFilters: { limit: 10 } as InternalRecommendationSearchResponse['appliedFilters'],
    degradedMode: null,
    lowConfidence: false,
    noResultsReason: null,
    relaxationSuggestions: [],
    strictFilterRecovery: null,
    searchDiagnostics: null,
    results: [],
    rawResults,
    totalResults: rawResults.length,
    ...overrides,
  };
}

function buildRequest(
  selected: RecommendationSearchRequest['selectedResearchAreas'],
  researchArea = ''
): RecommendationSearchRequest {
  return {
    inputMode: 'research_area',
    query: { researchArea },
    selectedResearchAreas: selected,
  };
}

/** Routes each fanned-out branch to a canned response keyed by its research area text. */
function stubBranches(service: RecommendationSearchService, byQuery: Record<string, InternalRecommendationSearchResponse>) {
  return vi.spyOn(service as any, 'searchSingleTopic').mockImplementation(async (request: any) => {
    const key = request.query.researchArea as string;
    return byQuery[key] || makeResponse([]);
  });
}

describe('multi-area funding search', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches each selected area independently and attributes every result', async () => {
    const service = new RecommendationSearchService();
    const spy = stubBranches(service, {
      quantum: makeResponse([makeResult({ id: 'q-1', score: 0.8 })]),
      climate: makeResponse([makeResult({ id: 'c-1', score: 0.6 })]),
    });

    const response = await service.search(
      buildRequest([
        { id: 'area-q', label: 'Quantum', queryText: 'quantum' },
        { id: 'area-c', label: 'Climate', queryText: 'climate' },
      ])
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(response.rawResults.map((result) => result.id)).toEqual(['q-1', 'c-1']);
    expect(response.rawResults[0].matchedAreas).toEqual([
      { areaId: 'area-q', label: 'Quantum', score: 0.8 },
    ]);
    expect(response.areaBreakdown).toEqual([
      expect.objectContaining({ areaId: 'area-q', label: 'Quantum', totalResults: 1, topScore: 0.8 }),
      expect.objectContaining({ areaId: 'area-c', label: 'Climate', totalResults: 1, topScore: 0.6 }),
    ]);
  });

  it('keeps the best single-area score and adds a bonus per additional area matched', async () => {
    const service = new RecommendationSearchService();
    stubBranches(service, {
      quantum: makeResponse([makeResult({ id: 'shared', score: 0.7 })]),
      climate: makeResponse([makeResult({ id: 'shared', score: 0.3 })]),
    });

    const response = await service.search(
      buildRequest([
        { id: 'area-q', label: 'Quantum', queryText: 'quantum' },
        { id: 'area-c', label: 'Climate', queryText: 'climate' },
      ])
    );

    expect(response.rawResults).toHaveLength(1);
    // Best branch score (0.7) — never an average — plus one multi-area bonus (0.04).
    expect(response.rawResults[0].score).toBeCloseTo(0.74, 4);
    expect(response.rawResults[0].matchedAreas?.map((area) => area.label)).toEqual(['Quantum', 'Climate']);
  });

  it('guarantees each area slots so a dominant area cannot starve the others', async () => {
    const service = new RecommendationSearchService();
    const limitedFilters = { limit: 4 } as InternalRecommendationSearchResponse['appliedFilters'];
    stubBranches(service, {
      quantum: makeResponse(
        Array.from({ length: 6 }, (_unused, index) => makeResult({ id: `q-${index}`, score: 0.9 - index * 0.01 })),
        { appliedFilters: limitedFilters }
      ),
      climate: makeResponse([makeResult({ id: 'c-1', score: 0.2 })], { appliedFilters: limitedFilters }),
    });

    const response = await service.search({
      ...buildRequest([
        { id: 'area-q', label: 'Quantum', queryText: 'quantum' },
        { id: 'area-c', label: 'Climate', queryText: 'climate' },
      ]),
      filters: { limit: 4 },
    });

    const ids = response.rawResults.map((result) => result.id);
    expect(ids).toHaveLength(4);
    expect(ids).toContain('c-1');
    // Ordering stays score-first even though membership was quota-protected.
    expect(response.rawResults[0].score).toBeGreaterThan(response.rawResults[3].score);
  });

  it('boosts calls tagged with the same two-level taxonomy area', async () => {
    const service = new RecommendationSearchService();
    stubBranches(service, {
      quantum: makeResponse([
        makeResult({ id: 'tagged', score: 0.5, taxonomyAreaIds: ['tax-1'] }),
        makeResult({ id: 'untagged', score: 0.52 }),
      ]),
      climate: makeResponse([]),
    });

    const response = await service.search(
      buildRequest([
        {
          id: 'area-q',
          label: 'Quantum',
          queryText: 'quantum',
          taxonomyAreaId: 'tax-1',
          taxonomyPath: 'Physical Sciences / Quantum',
        },
        { id: 'area-c', label: 'Climate', queryText: 'climate' },
      ])
    );

    expect(response.rawResults[0].id).toBe('tagged');
    expect(response.rawResults[0].score).toBeCloseTo(0.56, 4);
    expect(response.rawResults[0].matchReasons).toContain('Tagged Physical Sciences / Quantum');
  });

  it('keeps the typed topic as its own branch alongside the selected areas', async () => {
    const service = new RecommendationSearchService();
    const spy = stubBranches(service, {
      'quantum sensors': makeResponse([makeResult({ id: 'typed', score: 0.9 })]),
      quantum: makeResponse([makeResult({ id: 'saved', score: 0.4 })]),
    });

    const response = await service.search(
      buildRequest([{ id: 'area-q', label: 'Quantum', queryText: 'quantum' }], 'quantum sensors')
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(response.rawResults[0].matchedAreas?.[0].label).toBe('Your message');
    expect(response.areaBreakdown?.[0].label).toBe('Your message');
  });

  it('falls back to the ordinary single search when nothing needs fanning out', async () => {
    const service = new RecommendationSearchService();
    const spy = vi
      .spyOn(service as any, 'searchSingleTopic')
      .mockResolvedValue(makeResponse([makeResult({ id: 'only' })]));

    const response = await service.search(buildRequest([], 'quantum'));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(response.areaBreakdown).toBeUndefined();
    expect(response.rawResults[0].matchedAreas).toBeUndefined();
  });
});
