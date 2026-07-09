import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/funding/llmRouting', () => ({
  FUNDING_CHAT_NARRATIVE_STAGE_CODE: 'narrative',
  FUNDING_CHAT_ORCHESTRATOR_STAGE_CODE: 'orchestrator',
  FUNDING_CHAT_TASK_CODE: 'funding-chat',
  runFundingGatewayText: vi.fn(async () => ({ rawText: '' })),
}));

import type {
  RecommendationConversationDetail,
  RecommendationConversationRunRecord,
  RecommendationFilterMode,
} from '@/lib/recommendations/chatTypes';
import type { InternalRecommendationSearchResponse, RecommendationRawResultItem } from '@/lib/recommendations/types';
import {
  createDefaultConversationState,
  createDefaultFilters,
} from '@/lib/recommendations/conversationUtils';
import { RecommendationConversationService } from '@/lib/services/recommendationConversationService';

function makeResult(id: string): RecommendationRawResultItem {
  return {
    id,
    agencyName: 'Agency',
    schemeTitle: `Scheme ${id}`,
    shortDescription: 'Summary',
    closeDate: '2026-09-01',
    isRolling: false,
    fundingKinds: ['Research Grant'],
    disciplines: ['artificial intelligence'],
    eligibleCountries: [],
    eligibleRegions: [],
    hostCountries: [],
    institutionTypes: [],
    careerStages: [],
    sponsorType: null,
    officialUrls: ['https://example.com'],
    score: 0.8,
    matchReasons: ['Matched discipline: artificial intelligence'],
    profileMatch: null,
    eligibilitySummary: 'Open to research institutions.',
    fullDescription: null,
    description: 'Summary',
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
    semanticSimilarity: 0.75,
    textRank: 0.4,
  };
}

function makeRun(results: RecommendationRawResultItem[]): RecommendationConversationRunRecord {
  return {
    id: 'run-1',
    turnIndex: 1,
    runIndex: 1,
    createdAt: new Date().toISOString(),
    degradedMode: null,
    lowConfidence: false,
    noResultsReason: null,
    searchDiagnostics: null,
    profileDiagnostics: null,
    results,
  };
}

function makeSearchResponse(results: RecommendationRawResultItem[] = [makeResult('1')]): InternalRecommendationSearchResponse {
  return {
    normalizedQuery: {
      inputMode: 'research_area',
      title: null,
      abstract: null,
      keywords: [],
      researchArea: 'artificial intelligence',
      truncated: false,
      canonicalQueryText: 'artificial intelligence',
      semanticDocument: 'artificial intelligence',
      fullTextQuery: 'artificial intelligence',
      researchTags: ['artificial intelligence'],
      queryStrength: 'normal',
    },
    appliedFilters: createDefaultFilters(),
    degradedMode: null,
    lowConfidence: false,
    noResultsReason: null,
    relaxationSuggestions: [],
    strictFilterRecovery: null,
    searchDiagnostics: null,
    results: results.map(({ fullDescription, description, amountMin, amountMax, currency, eligibilityText, contactInfo, geographyScope, funderCountry, citizenshipRequirements, residencyRequirements, applicationLanguages, semanticSimilarity, textRank, ...publicFields }) => publicFields),
    rawResults: results,
    totalResults: results.length,
  };
}

function makeConversationDetail(
  filterMode: RecommendationFilterMode,
  run?: RecommendationConversationRunRecord
): RecommendationConversationDetail {
  const defaultState = createDefaultConversationState('research_area');
  return {
    id: 'conv-1',
    title: 'Funding Chat',
    updatedAt: new Date().toISOString(),
    currentInputMode: 'research_area',
    filterMode,
    currentQuery: defaultState.query,
    currentFilters: createDefaultFilters(),
    pendingFilterPatch: null,
    lastRunId: run?.id || null,
    messages: [],
    runs: run ? [run] : [],
  };
}

function makeState(filterMode: RecommendationFilterMode, overrides: Partial<{ filters: ReturnType<typeof createDefaultFilters> }> = {}) {
  return {
    inputMode: 'research_area' as const,
    query: { researchArea: 'artificial intelligence' },
    filters: overrides.filters || createDefaultFilters(),
    filterMode,
    pendingPatch: null,
    lastRunId: 'run-1',
    lastTurnIndex: 1,
  };
}

// A parsed turn the orchestrator would produce when it wants to change filters.
function mockLlmParse(service: RecommendationConversationService, proposedFilters: ReturnType<typeof createDefaultFilters>) {
  return vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue({
    intent: 'refine_filters',
    confidence: 0.9,
    requiresConfirmation: true,
    nextState: {
      inputMode: 'research_area',
      query: { researchArea: 'artificial intelligence' },
      filters: proposedFilters,
    },
    summary: 'I narrowed the search to postdoctoral researchers in India.',
    assistantSuggestion: 'I can narrow this to postdoctoral researchers in India.',
    inferredFromProfile: [],
  });
}

// Message the fast-path heuristic cannot parse, forcing the LLM path.
const AMBIGUOUS_MESSAGE = 'could you tailor these a bit more to my situation?';

describe('RecommendationConversationService filter modes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('manual mode: locks the search to current filters and emits suggestion chips instead of applying', async () => {
    const service = new RecommendationConversationService();
    const proposed = createDefaultFilters();
    proposed.careerStages = ['Postdoctoral'];
    proposed.eligibleCountries = ['India'];
    mockLlmParse(service, proposed);
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());

    const run = makeRun([makeResult('1')]);
    const outcome = await (service as any).createTurnOutcome({
      input: { message: AMBIGUOUS_MESSAGE },
      state: makeState('manual'),
      latestRun: run,
      turnIndex: 2,
      conversationDetail: makeConversationDetail('manual', run),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.pendingPatch).toBeFalsy();
    const chipLabels = (outcome.suggestedFilterChips || []).map((chip: { label: string }) => chip.label);
    expect(chipLabels).toContain('Career stages: Postdoctoral');
    expect(chipLabels).toContain('Eligible countries: India');

    // The search must have run within the user's current (default) filters.
    const searchedFilters = (searchSpy.mock.calls[0][0] as any).filters;
    expect(searchedFilters.careerStages).toEqual([]);
    expect(searchedFilters.eligibleCountries).toEqual([]);
  });

  it('auto mode: the same parse produces a pending confirmation patch (legacy behavior)', async () => {
    const service = new RecommendationConversationService();
    const proposed = createDefaultFilters();
    proposed.careerStages = ['Postdoctoral'];
    proposed.eligibleCountries = ['India'];
    mockLlmParse(service, proposed);
    vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());

    const run = makeRun([makeResult('1')]);
    const outcome = await (service as any).createTurnOutcome({
      input: { message: AMBIGUOUS_MESSAGE },
      state: makeState('auto'),
      latestRun: run,
      turnIndex: 2,
      conversationDetail: makeConversationDetail('auto', run),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_confirmation');
    expect(outcome.pendingPatch).toBeTruthy();
    expect(outcome.pendingPatch.nextFilters.careerStages).toEqual(['Postdoctoral']);
    expect(outcome.suggestedFilterChips).toBeFalsy();
  });

  it('manual mode: clear-filters requests leave filters untouched and offer a clear-all chip', async () => {
    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue(null);
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());

    const activeFilters = createDefaultFilters();
    activeFilters.careerStages = ['PhD Student'];

    const run = makeRun([makeResult('1')]);
    const outcome = await (service as any).createTurnOutcome({
      input: { message: 'clear all filters' },
      state: makeState('manual', { filters: activeFilters }),
      latestRun: run,
      turnIndex: 2,
      conversationDetail: makeConversationDetail('manual', run),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_notice');
    expect(outcome.nextState).toBeFalsy();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(outcome.suggestedFilterChips).toHaveLength(1);
    expect(outcome.suggestedFilterChips[0].label).toBe('Clear all filters');
    expect(outcome.suggestedFilterChips[0].clearKeys).toContain('careerStages');
  });

  it('manual mode: explicit manualFilterPatch from the user still applies', async () => {
    const service = new RecommendationConversationService();
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());

    const outcome = await (service as any).createTurnOutcome({
      input: {
        message: 'Apply suggested filter: Career stages: Postdoctoral.',
        manualFilterPatch: { ...createDefaultFilters(), careerStages: ['Postdoctoral'] },
        replaceManualFilters: true,
      },
      state: makeState('manual'),
      latestRun: undefined,
      turnIndex: 2,
      conversationDetail: makeConversationDetail('manual'),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_response');
    expect((searchSpy.mock.calls[0][0] as any).filters.careerStages).toEqual(['Postdoctoral']);
  });

  it('manual mode: keeps chat control of limit and sort (show more still works)', async () => {
    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue(null);
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());

    const run = makeRun([makeResult('1')]);
    const outcome = await (service as any).createTurnOutcome({
      input: { message: 'show more results' },
      state: makeState('manual'),
      latestRun: run,
      turnIndex: 2,
      conversationDetail: makeConversationDetail('manual', run),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_response');
    expect((searchSpy.mock.calls[0][0] as any).filters.limit).toBeGreaterThan(createDefaultFilters().limit);
  });

  it('manual mode: heuristic fallback filter extraction is also downgraded to chips', async () => {
    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue(null);
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());

    const run = makeRun([makeResult('1')]);
    const outcome = await (service as any).createTurnOutcome({
      input: { message: 'Only grants open to researchers in Germany' },
      state: makeState('manual'),
      latestRun: run,
      turnIndex: 2,
      conversationDetail: makeConversationDetail('manual', run),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_response');
    const searchedFilters = (searchSpy.mock.calls[0][0] as any).filters;
    expect(searchedFilters.eligibleCountries).toEqual([]);
    expect(searchedFilters.hostCountries).toEqual([]);
    const chipLabels = (outcome.suggestedFilterChips || []).map((chip: { label: string }) => chip.label);
    expect(chipLabels.some((label: string) => label.includes('Germany'))).toBe(true);
  });
});
