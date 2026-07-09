import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gatewayText: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@/lib/funding/llmRouting', () => ({
  FUNDING_CHAT_NARRATIVE_STAGE_CODE: 'narrative',
  FUNDING_CHAT_ORCHESTRATOR_STAGE_CODE: 'orchestrator',
  FUNDING_CHAT_ANSWER_STAGE_CODE: 'answer',
  FUNDING_CHAT_TASK_CODE: 'funding-chat',
  runFundingGatewayText: mocks.gatewayText,
}));

vi.mock('@/lib/services/recommendationSearchService', () => ({
  recommendationSearchService: { search: mocks.search },
}));

import type {
  FinderTurnStreamEvent,
  RecommendationConversationDetail,
} from '@/lib/recommendations/chatTypes';
import type { InternalRecommendationSearchResponse, RecommendationRawResultItem } from '@/lib/recommendations/types';
import {
  createDefaultConversationState,
  createDefaultFilters,
} from '@/lib/recommendations/conversationUtils';
import { __finderStreamTestables } from '@/lib/recommendations/finderStream';
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

function makeSearchResponse(): InternalRecommendationSearchResponse {
  const results = [makeResult('1'), makeResult('2')];
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

function makeConversationDetail(): RecommendationConversationDetail {
  const defaultState = createDefaultConversationState('research_area');
  return {
    id: 'conv-1',
    title: 'Funding Chat',
    updatedAt: new Date().toISOString(),
    currentInputMode: 'research_area',
    filterMode: 'manual',
    currentQuery: defaultState.query,
    currentFilters: createDefaultFilters(),
    pendingFilterPatch: null,
    lastRunId: null,
    messages: [],
    runs: [],
  };
}

describe('finder turn stream events', () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.gatewayText.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits understanding → searching → results → composing → token* in order for a search turn', async () => {
    mocks.search.mockResolvedValue(makeSearchResponse());
    mocks.gatewayText.mockImplementation(async (options: any) => {
      if (options.stream?.onToken) {
        options.stream.onToken('Here are ', 'Here are ');
        options.stream.onToken('two matches.', 'Here are two matches.');
      }
      return { rawText: 'Here are two matches.' };
    });

    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue(null);

    const events: FinderTurnStreamEvent[] = [];
    const outcome = await (service as any).createTurnOutcome({
      input: { message: 'find grants for artificial intelligence' },
      state: {
        inputMode: 'research_area',
        query: { researchArea: '' },
        filters: createDefaultFilters(),
        filterMode: 'manual',
        pendingPatch: null,
        lastRunId: null,
        lastTurnIndex: 0,
      },
      latestRun: undefined,
      turnIndex: 1,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
      events: (event: FinderTurnStreamEvent) => events.push(event),
    });

    const kinds = events.map((event) => (event.type === 'stage' ? `stage:${event.stage}` : event.type));
    expect(kinds).toEqual([
      'stage:understanding',
      'stage:searching',
      'results',
      'stage:composing',
      'token',
      'token',
    ]);

    const resultsEvent = events.find((event) => event.type === 'results');
    expect(resultsEvent && resultsEvent.type === 'results' ? resultsEvent.results.length : 0).toBe(2);
    expect(resultsEvent && resultsEvent.type === 'results' ? resultsEvent.totalResults : 0).toBe(2);

    const tokens = events.filter((event): event is Extract<FinderTurnStreamEvent, { type: 'token' }> => event.type === 'token');
    expect(tokens.map((token) => token.delta).join('')).toBe('Here are two matches.');
    expect(outcome.assistantContent).toBe('Here are two matches.');
  });

  it('emits no search events for small talk', async () => {
    const service = new RecommendationConversationService();
    const events: FinderTurnStreamEvent[] = [];

    await (service as any).createTurnOutcome({
      input: { message: 'hello!' },
      state: {
        inputMode: 'research_area',
        query: { researchArea: '' },
        filters: createDefaultFilters(),
        filterMode: 'manual',
        pendingPatch: null,
        lastRunId: null,
        lastTurnIndex: 0,
      },
      latestRun: undefined,
      turnIndex: 1,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
      events: (event: FinderTurnStreamEvent) => events.push(event),
    });

    const kinds = events.map((event) => (event.type === 'stage' ? `stage:${event.stage}` : event.type));
    expect(kinds).toEqual(['stage:understanding']);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('round-trips server SSE frames through the client frame parser', () => {
    const { parseSSEFrame } = __finderStreamTestables;

    const payload = { type: 'stage', stage: 'searching', label: 'Searching funding calls', detail: 'AI' };
    const frame = `event: stage\ndata: ${JSON.stringify(payload)}`;
    const parsed = parseSSEFrame(frame);
    expect(parsed?.event).toBe('stage');
    expect(JSON.parse(parsed!.data)).toEqual(payload);

    // Heartbeat comments carry no data and must be ignored.
    expect(parseSSEFrame(': keepalive')).toBeNull();

    // Multi-line data segments are joined per the SSE spec.
    const multiLine = parseSSEFrame('event: token\ndata: {"type":"token",\ndata: "delta":"hi"}');
    expect(JSON.parse(multiLine!.data)).toEqual({ type: 'token', delta: 'hi' });
  });
});
