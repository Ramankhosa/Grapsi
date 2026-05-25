import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  RecommendationConversationDetail,
  RecommendationConversationRunRecord,
} from '@/lib/recommendations/chatTypes';
import type { RecommendationRawResultItem } from '@/lib/recommendations/types';
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

  it('asks the user to enable eligibility preferences before using profile data', async () => {
    const service = new RecommendationConversationService();
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

    expect(outcome.messageType).toBe('assistant_notice');
    expect(outcome.assistantContent).toContain('Use eligibility profile');
    expect(outcome.assistantContent).toContain('currently off');
  });

  it('asks the user to enable publication preferences before using papers', async () => {
    const service = new RecommendationConversationService();
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

    expect(outcome.messageType).toBe('assistant_notice');
    expect(outcome.assistantContent).toContain('Use my publications');
    expect(outcome.assistantContent).toContain('my-publication');
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

  it('uses the fast path for compare, explain, show more, and clear filters without invoking the LLM', async () => {
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
});
