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
} from '@/lib/recommendations/chatTypes';
import type { InternalRecommendationSearchResponse, RecommendationRawResultItem } from '@/lib/recommendations/types';
import {
  buildConversationStateHash,
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
    closeDate: '2026-07-01',
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
      researchArea: 'general research funding',
      truncated: false,
      canonicalQueryText: 'general research funding',
      semanticDocument: 'general research funding',
      fullTextQuery: 'general research funding',
      researchTags: ['general research funding'],
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

function stubLlmFallback(service: RecommendationConversationService) {
  return vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue(null);
}

function makeConversationDetail(run?: RecommendationConversationRunRecord): RecommendationConversationDetail {
  const defaultState = createDefaultConversationState('research_area');
  return {
    id: 'conv-1',
    title: 'Funding Chat',
    updatedAt: new Date().toISOString(),
    currentInputMode: 'research_area',
    currentQuery: defaultState.query,
    currentFilters: createDefaultFilters(),
    pendingFilterPatch: null,
    lastRunId: run?.id || null,
    messages: [],
    runs: run ? [run] : [],
  };
}

describe('RecommendationConversationService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forces confirmation for inferred filters on new searches', () => {
    const service = new RecommendationConversationService();
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = (service as any).processOrchestratorOutput(
      {
        intent: 'new_search',
        requiresConfirmation: false,
        filterSuggestions: {
          hostCountries: ['Germany'],
          fundingKinds: ['Travel Grant', 'Conference Grant'],
          deadlineFrom: '2026-05-01',
          deadlineTo: '2026-05-31',
        },
        queryRewrite: 'conference presentation support',
      },
      {
        message: "I'm presenting at a conference in Berlin next month",
        state,
      }
    );

    const guarded = (service as any).applyParsedTurnGuard(parsed, {
      message: "I'm presenting at a conference in Berlin next month",
    });

    expect(guarded.requiresConfirmation).toBe(true);
    expect(guarded.assistantSuggestion).toContain('Host countries: Germany');
    expect(guarded.assistantSuggestion).toContain('Funding types: Travel Grant, Conference Grant');
  });

  it('does not force confirmation for explicit verbatim filters on new searches', () => {
    const service = new RecommendationConversationService();
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = (service as any).processOrchestratorOutput(
      {
        intent: 'new_search',
        requiresConfirmation: false,
        filterSuggestions: {
          hostCountries: ['Germany'],
          fundingKinds: ['Research Grant'],
          careerStages: ['Postdoctoral'],
        },
        queryRewrite: 'artificial intelligence',
      },
      {
        message: 'Find research grants in Germany for postdoctoral researchers.',
        state,
      }
    );

    const guarded = (service as any).applyParsedTurnGuard(parsed, {
      message: 'Find research grants in Germany for postdoctoral researchers.',
    });

    expect(guarded.requiresConfirmation).toBe(false);
  });

  it('forces confirmation for profile-driven inference on new searches', () => {
    const service = new RecommendationConversationService();
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = (service as any).processOrchestratorOutput(
      {
        intent: 'new_search',
        requiresConfirmation: false,
        filterSuggestions: {
          careerStages: ['Postdoctoral'],
        },
        queryRewrite: 'general research funding',
        inferredFromProfile: ['career stage: Postdoctoral'],
      },
      {
        message: 'Find grants for me.',
        state,
      }
    );

    const guarded = (service as any).applyParsedTurnGuard(parsed, {
      message: 'Find grants for me.',
    });

    expect(guarded.requiresConfirmation).toBe(true);
    expect(guarded.assistantSuggestion).toContain('selected preference context');
  });

  it('runs a generic search and nudges eligibility preferences when profile context is off', async () => {
    const service = new RecommendationConversationService();
    stubLlmFallback(service);
    vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const outcome = await (service as any).createTurnOutcome({
      input: { message: 'Find grants eligible for me.' },
      state,
      latestRun: undefined,
      turnIndex: 1,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.assistantContent).toContain('Tip: turn on Use eligibility profile');
    expect(outcome.run).toBeTruthy();
  });

  it('runs a generic search and nudges publication preferences when publication context is off', async () => {
    const service = new RecommendationConversationService();
    stubLlmFallback(service);
    vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(makeSearchResponse());
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const outcome = await (service as any).createTurnOutcome({
      input: { message: 'Find funding aligned with my publications.' },
      state,
      latestRun: undefined,
      turnIndex: 1,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.assistantContent).toContain('Tip: turn on Use my publications');
    expect(outcome.assistantContent).toContain('my-publication');
    expect(outcome.run).toBeTruthy();
  });

  it('promotes topic pivots to new_search and resets prior filters', () => {
    const service = new RecommendationConversationService();
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: {
        ...createDefaultFilters(),
        hostCountries: ['Germany'],
      },
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = (service as any).processOrchestratorOutput(
      {
        intent: 'refine_filters',
        requiresConfirmation: false,
        queryRewrite: 'climate adaptation',
        filterSuggestions: {
          fundingKinds: ['Research Grant'],
        },
      },
      {
        message: 'What about climate adaptation instead?',
        state,
      }
    );

    expect(parsed.intent).toBe('new_search');
    expect(parsed.nextState?.filters.hostCountries).toEqual([]);
    expect(parsed.nextState?.filters.fundingKinds).toEqual(['Research Grant']);
    expect((parsed.nextState?.query as { researchArea?: string }).researchArea).toBe('climate adaptation');
  });

  it('keeps true refinements on the existing filter state', () => {
    const service = new RecommendationConversationService();
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: {
        ...createDefaultFilters(),
        hostCountries: ['Germany'],
      },
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = (service as any).processOrchestratorOutput(
      {
        intent: 'refine_filters',
        requiresConfirmation: false,
        filterSuggestions: {
          fundingKinds: ['Research Grant'],
        },
      },
      {
        message: 'Only show research grants.',
        state,
      }
    );

    expect(parsed.intent).toBe('refine_filters');
    expect(parsed.nextState?.filters.hostCountries).toEqual(['Germany']);
    expect(parsed.nextState?.filters.fundingKinds).toEqual(['Research Grant']);
  });

  it('uses the fast path for compare, explain, show more, clear filters, and exact filter-only refinements without invoking the LLM', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = vi.spyOn(service as any, 'parseTurnWithLLM');
    const latestRun = makeRun([makeResult('1'), makeResult('2')]);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: latestRun.id,
      lastTurnIndex: 1,
    };
    const conversation = makeConversationDetail(latestRun);

    const scenarios = [
      { message: 'compare 1 and 2', intent: 'compare_results' },
      { message: 'explain result 1', intent: 'explain_result' },
      { message: 'show more', intent: 'browse_more' },
      { message: 'reset filters', intent: 'clear_filters' },
      { message: 'only rolling', intent: 'refine_filters' },
    ];

    for (const scenario of scenarios) {
      llmSpy.mockClear();
      const parsed = await (service as any).parseTurn({
        message: scenario.message,
        state,
        latestRun,
        conversationDetail: conversation,
        researcherContext: null,
      });

      expect(parsed.intent).toBe(scenario.intent);
      expect(llmSpy).not.toHaveBeenCalled();
    }
  });

  it('falls back to heuristic country-role mapping when the LLM parser returns no result', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = stubLlmFallback(service);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };
    const conversation = makeConversationDetail();

    const scenarios = [
      {
        message: 'Find AI healthcare grants open to researchers in India at universities.',
        expectedKey: 'eligibleCountries',
      },
      {
        message: 'Find travel funding for a conference in Germany.',
        expectedKey: 'hostCountries',
      },
      {
        message: 'Find climate grants with funding from Germany.',
        expectedKey: 'funderCountries',
      },
    ] as const;

    for (const scenario of scenarios) {
      llmSpy.mockClear();
      const parsed = await (service as any).parseTurn({
        message: scenario.message,
        state,
        latestRun: undefined,
        conversationDetail: conversation,
        profileSnapshot: null,
      });

      expect(parsed.intent).toBe('new_search');
      expect(llmSpy).toHaveBeenCalled();
      expect(parsed.nextState?.filters[scenario.expectedKey]).toEqual(
        scenario.expectedKey === 'eligibleCountries' ? ['India'] : ['Germany']
      );
    }
  });

  it('uses pasted paper title and abstract as paper metadata without invoking the LLM', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = vi.spyOn(service as any, 'parseTurnWithLLM');
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = await (service as any).parseTurn({
      message: [
        'Find funding for this paper:',
        'Title: Federated learning for medical imaging diagnosis',
        'Abstract: This study develops privacy-preserving federated learning methods for radiology diagnosis across hospitals. The work focuses on medical imaging, diagnostic accuracy, clinical deployment, and privacy-preserving machine learning for healthcare systems.',
        'Keywords: medical imaging, federated learning, diagnostics',
      ].join('\n'),
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    expect(llmSpy).not.toHaveBeenCalled();
    expect(parsed.intent).toBe('new_search');
    expect(parsed.nextState?.inputMode).toBe('paper_metadata');
    expect((parsed.nextState?.query as { title?: string }).title).toBe('Federated learning for medical imaging diagnosis');
    expect((parsed.nextState?.query as { abstract?: string }).abstract).toContain('privacy-preserving federated learning');
    expect((parsed.nextState?.query as { keywords?: string[] }).keywords).toEqual([
      'medical imaging',
      'federated learning',
      'diagnostics',
    ]);
  });

  it('uses a quoted long paper title as paper metadata without invoking the LLM', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = vi.spyOn(service as any, 'parseTurnWithLLM');
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = await (service as any).parseTurn({
      message: 'give funding option for research related to "An intelligent monitoring system for indoor safety of individuals suffering from Autism Spectrum Disorder (ASD)"',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    expect(llmSpy).not.toHaveBeenCalled();
    expect(parsed.intent).toBe('new_search');
    expect(parsed.nextState?.inputMode).toBe('paper_metadata');
    expect((parsed.nextState?.query as { title?: string }).title).toBe(
      'An intelligent monitoring system for indoor safety of individuals suffering from Autism Spectrum Disorder (ASD)'
    );
  });

  it('keeps a clean research area when search terms also include filters', async () => {
    const service = new RecommendationConversationService();
    stubLlmFallback(service);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = await (service as any).parseTurn({
      message: 'Find AI healthcare grants open to researchers in India at universities.',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    expect((parsed.nextState?.query as { researchArea?: string }).researchArea).toBe('AI healthcare');
    expect(parsed.nextState?.filters.fundingKinds).toEqual([]);
    expect(parsed.nextState?.filters.institutionTypes).toEqual(['University']);
  });

  it('does not convert women-centric research funding into a Research Grant filter', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = stubLlmFallback(service);
    const latestRun = makeRun([makeResult('1')]);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: {
        ...createDefaultFilters(),
        fundingKinds: ['Research Grant'],
      },
      pendingPatch: null,
      lastRunId: latestRun.id,
      lastTurnIndex: 1,
    };

    const parsed = await (service as any).parseTurn({
      message: 'any women centric research funding',
      state,
      latestRun,
      conversationDetail: makeConversationDetail(latestRun),
      profileSnapshot: null,
    });

    expect(llmSpy).toHaveBeenCalledTimes(1);
    expect(parsed.intent).toBe('new_search');
    expect((parsed.nextState?.query as { researchArea?: string }).researchArea).toBe('women centric');
    expect(parsed.nextState?.filters.fundingKinds).toEqual([]);
  });

  it('treats funding for women researchers as a fresh broad search after earlier results', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = stubLlmFallback(service);
    const latestRun = makeRun([makeResult('1')]);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: {
        ...createDefaultFilters(),
        fundingKinds: ['Research Grant'],
      },
      pendingPatch: null,
      lastRunId: latestRun.id,
      lastTurnIndex: 1,
    };

    const parsed = await (service as any).parseTurn({
      message: 'any funding for women researchers',
      state,
      latestRun,
      conversationDetail: makeConversationDetail(latestRun),
      profileSnapshot: null,
    });

    expect(llmSpy).toHaveBeenCalledTimes(1);
    expect(parsed.intent).toBe('new_search');
    expect((parsed.nextState?.query as { researchArea?: string }).researchArea).toBe('women');
    expect(parsed.nextState?.filters.fundingKinds).toEqual([]);
  });

  it('does not add Research Grant when the user asks for a specific grant type', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = stubLlmFallback(service);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const travelParsed = await (service as any).parseTurn({
      message: 'Find travel grants for presenting research in Europe.',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    const conferenceParsed = await (service as any).parseTurn({
      message: 'Find conference grants for presenting research.',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    expect(llmSpy).toHaveBeenCalledTimes(2);
    expect(travelParsed.nextState?.filters.fundingKinds).toEqual(['Travel Grant']);
    expect(conferenceParsed.nextState?.filters.fundingKinds).toEqual(['Conference Grant']);
  });

  it('removes generic Research Grant from LLM patches when a specific grant type was explicit', () => {
    const service = new RecommendationConversationService();
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = (service as any).processOrchestratorOutput(
      {
        intent: 'new_search',
        requiresConfirmation: false,
        filterSuggestions: {
          fundingKinds: ['Travel Grant', 'Research Grant'],
        },
        queryRewrite: 'presenting research in Europe',
      },
      {
        message: 'Find travel grants for presenting research in Europe.',
        state,
      }
    );

    expect(parsed.nextState?.filters.fundingKinds).toEqual(['Travel Grant']);
  });

  it('preserves topic words that also appear in filter vocabularies', async () => {
    const service = new RecommendationConversationService();
    stubLlmFallback(service);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = await (service as any).parseTurn({
      message: 'Find foundation models grants',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    // "foundation" doubles as a sponsor-type alias but here it is part of the research topic.
    expect((parsed.nextState?.query as { researchArea?: string }).researchArea).toBe('foundation models');
    expect(parsed.nextState?.filters.fundingKinds).toEqual([]);
  });

  it('applies Research Grant only for explicit research-grant language', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = stubLlmFallback(service);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const explicit = await (service as any).parseTurn({
      message: 'research grant for infectious diseases',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    const broad = await (service as any).parseTurn({
      message: 'grant funding for infectious diseases',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    expect(llmSpy).toHaveBeenCalledTimes(2);
    expect(explicit.nextState?.filters.fundingKinds).toEqual(['Research Grant']);
    expect((explicit.nextState?.query as { researchArea?: string }).researchArea).toBe('infectious diseases');
    expect(broad.nextState?.filters.fundingKinds).toEqual([]);
    expect((broad.nextState?.query as { researchArea?: string }).researchArea).toBe('infectious diseases');
  });

  it('maps research-community phrases to the intended filter roles', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = stubLlmFallback(service);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const travel = await (service as any).parseTurn({
      message: 'travel grant for conference in Germany',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    const funder = await (service as any).parseTurn({
      message: 'funding from Germany for AI',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    const eligibility = await (service as any).parseTurn({
      message: 'open to Indian postdocs in biomedical research',
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    expect(llmSpy).toHaveBeenCalledTimes(3);
    expect(travel.nextState?.filters.fundingKinds).toEqual(['Travel Grant', 'Conference Grant']);
    expect(travel.nextState?.filters.hostCountries).toEqual(['Germany']);
    expect(funder.nextState?.filters.funderCountries).toEqual(['Germany']);
    expect((funder.nextState?.query as { researchArea?: string }).researchArea).toBe('AI');
    expect(eligibility.nextState?.filters.eligibleCountries).toEqual(['India']);
    expect(eligibility.nextState?.filters.careerStages).toEqual(['Postdoctoral']);
    expect((eligibility.nextState?.query as { researchArea?: string }).researchArea).toBe('biomedical');
  });

  it('does not treat Berlin next month as an explicit deadline filter in the heuristic fallback', async () => {
    const service = new RecommendationConversationService();
    stubLlmFallback(service);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: '' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: null,
      lastTurnIndex: 0,
    };

    const parsed = await (service as any).parseTurn({
      message: "I'm presenting at a conference in Berlin next month",
      state,
      latestRun: undefined,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
    });

    expect(parsed.nextState?.filters.deadlineFrom).toBe('');
    expect(parsed.nextState?.filters.deadlineTo).toBe('');
  });

  it('only treats vs as a compare cue when it is a standalone word', () => {
    const service = new RecommendationConversationService();
    const latestRun = makeRun([makeResult('1'), makeResult('2')]);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: latestRun.id,
      lastTurnIndex: 1,
    };

    const parsed = (service as any).parseTurnHeuristically({
      message: 'canvas 1 and 2',
      state,
      latestRun,
    });

    expect(parsed?.intent).not.toBe('compare_results');
  });

  it('preserves paper metadata when refining a paper search with filter-only text', async () => {
    const service = new RecommendationConversationService();
    const latestRun = makeRun([makeResult('1')]);
    const state = {
      inputMode: 'paper_metadata' as const,
      query: {
        title: 'Federated learning for medical imaging diagnosis',
        abstract: 'Privacy-preserving learning across hospitals.',
        keywords: ['medical imaging'],
      },
      filters: createDefaultFilters(),
      pendingPatch: null,
      lastRunId: latestRun.id,
      lastTurnIndex: 1,
    };

    const parsed = await (service as any).parseTurn({
      message: 'only rolling ones',
      state,
      latestRun,
      conversationDetail: makeConversationDetail(latestRun),
      profileSnapshot: null,
    });

    expect(parsed.intent).toBe('refine_filters');
    expect(parsed.nextState?.inputMode).toBe('paper_metadata');
    expect((parsed.nextState?.query as { title?: string }).title).toBe('Federated learning for medical imaging diagnosis');
    expect(parsed.nextState?.filters.rollingOnly).toBe(true);
  });

  it('applies a pending filter patch when the user types yes', async () => {
    const service = new RecommendationConversationService();
    const baseFilters = createDefaultFilters();
    vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue({
      ...makeSearchResponse(),
      appliedFilters: { ...baseFilters, rollingOnly: true },
    });
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: baseFilters,
      pendingPatch: {
        baseStateHash: buildConversationStateHash('research_area', { researchArea: 'artificial intelligence' }, baseFilters),
        turnIndex: 1,
        requiresConfirmation: true,
        summary: 'Confirm rolling opportunities.',
        reason: 'Inferred from prior turn.',
        nextInputMode: 'research_area' as const,
        nextQuery: { researchArea: 'artificial intelligence' },
        nextFilters: { ...baseFilters, rollingOnly: true },
      },
      lastRunId: null,
      lastTurnIndex: 1,
    };

    const outcome = await (service as any).createTurnOutcome({
      input: { message: 'yes' },
      state,
      latestRun: undefined,
      turnIndex: 2,
      conversationDetail: makeConversationDetail(),
      profileSnapshot: null,
      preferences: { useEligibilityProfile: false, usePublicationContext: false },
    });

    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.pendingPatch).toBeNull();
    expect(outcome.nextState.filters.rollingOnly).toBe(true);
  });

  it('removes ambiguous country mentions from every country-like filter', async () => {
    const service = new RecommendationConversationService();
    const latestRun = makeRun([makeResult('1')]);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: {
        ...createDefaultFilters(),
        eligibleCountries: ['Germany'],
        hostCountries: ['Germany'],
        funderCountries: ['Germany'],
        citizenshipRequirements: ['Germany'],
        residencyRequirements: ['Germany'],
      },
      pendingPatch: null,
      lastRunId: latestRun.id,
      lastTurnIndex: 1,
    };

    const parsed = await (service as any).parseTurn({
      message: 'remove Germany',
      state,
      latestRun,
      conversationDetail: makeConversationDetail(latestRun),
      profileSnapshot: null,
    });

    expect(parsed.intent).toBe('refine_filters');
    expect(parsed.nextState?.filters.eligibleCountries).toEqual([]);
    expect(parsed.nextState?.filters.hostCountries).toEqual([]);
    expect(parsed.nextState?.filters.funderCountries).toEqual([]);
    expect(parsed.nextState?.filters.citizenshipRequirements).toEqual([]);
    expect(parsed.nextState?.filters.residencyRequirements).toEqual([]);
  });

  it('clears stale filters and starts a new topic search in one command', async () => {
    const service = new RecommendationConversationService();
    const latestRun = makeRun([makeResult('1')]);
    const state = {
      inputMode: 'research_area' as const,
      query: { researchArea: 'artificial intelligence' },
      filters: {
        ...createDefaultFilters(),
        fundingKinds: ['Research Grant'],
        hostCountries: ['Germany'],
      },
      pendingPatch: null,
      lastRunId: latestRun.id,
      lastTurnIndex: 1,
    };

    const parsed = await (service as any).parseTurn({
      message: 'clear all filters and search autism safety monitoring',
      state,
      latestRun,
      conversationDetail: makeConversationDetail(latestRun),
      profileSnapshot: null,
    });

    expect(parsed.intent).toBe('new_search');
    expect((parsed.nextState?.query as { researchArea?: string }).researchArea).toBe('autism safety monitoring');
    expect(parsed.nextState?.filters.fundingKinds).toEqual([]);
    expect(parsed.nextState?.filters.hostCountries).toEqual([]);
  });
});
