import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  docIntelligenceEnabled: { value: true },
  answerCallQuestion: vi.fn(),
  gatewayText: vi.fn(async () => ({ rawText: '' })),
}));

vi.mock('@/lib/funding/llmRouting', () => ({
  FUNDING_CHAT_NARRATIVE_STAGE_CODE: 'narrative',
  FUNDING_CHAT_ORCHESTRATOR_STAGE_CODE: 'orchestrator',
  FUNDING_CHAT_ANSWER_STAGE_CODE: 'answer',
  FUNDING_CHAT_TASK_CODE: 'funding-chat',
  runFundingGatewayText: mocks.gatewayText,
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (flag: string) =>
    flag === 'ENABLE_FUNDING_DOC_INTELLIGENCE' && mocks.docIntelligenceEnabled.value,
}));

vi.mock('@/lib/fundingDocuments/qa', () => ({
  answerCallQuestionForChat: mocks.answerCallQuestion,
}));

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

function makeConversationDetail(run?: RecommendationConversationRunRecord): RecommendationConversationDetail {
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
    lastRunId: run?.id || null,
    messages: [],
    runs: run ? [run] : [],
  };
}

function makeState() {
  return {
    inputMode: 'research_area' as const,
    query: { researchArea: 'artificial intelligence' },
    filters: createDefaultFilters(),
    filterMode: 'manual' as const,
    pendingPatch: null,
    lastRunId: 'run-1',
    lastTurnIndex: 1,
  };
}

function baseParams(service: RecommendationConversationService, message: string, run?: RecommendationConversationRunRecord) {
  return {
    input: { message },
    state: makeState(),
    latestRun: run,
    turnIndex: 2,
    conversationDetail: makeConversationDetail(run),
    profileSnapshot: null,
    preferences: { useEligibilityProfile: false, usePublicationContext: false },
  };
}

describe('RecommendationConversationService conversational intents', () => {
  beforeEach(() => {
    mocks.docIntelligenceEnabled.value = true;
    mocks.answerCallQuestion.mockReset();
    mocks.gatewayText.mockClear();
    mocks.gatewayText.mockImplementation(async () => ({ rawText: '' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('greets via the fast path even when the LLM parser is down, without searching', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = vi.spyOn(service as any, 'parseTurnWithLLM').mockRejectedValue(new Error('llm down'));
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(null);

    const outcome = await (service as any).createTurnOutcome(baseParams(service, 'hello!'));

    expect(outcome.intent).toBe('small_talk');
    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.assistantContent).toContain('funding');
    expect(outcome.suggestedReplies).toContain('What can you help me with?');
    expect(llmSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('answers a call question through the document RAG path with citations', async () => {
    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue({
      intent: 'call_question',
      confidence: 0.9,
      requiresConfirmation: false,
      referencedOrdinals: [2],
    });
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(null);
    mocks.answerCallQuestion.mockResolvedValue({
      answer: 'The call requires a **consortium of three partners** [eligibility, p. 3, v1].',
      citations: [{ sectionTitle: 'Eligibility', sectionType: 'eligibility', pageStart: 3, pageEnd: 3, documentVersion: 1 }],
      category: 'eligibility',
      answeredFrom: 'document',
      streamed: false,
    });

    const run = makeRun([makeResult('call-1'), makeResult('call-2')]);
    const outcome = await (service as any).createTurnOutcome(
      baseParams(service, 'what is the eligibility for result 2?', run)
    );

    expect(outcome.intent).toBe('call_question');
    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.assistantContent).toContain('consortium');
    expect(outcome.citations.resultIds).toEqual(['call-2']);
    expect(outcome.citations.documentCitations).toHaveLength(1);
    expect(mocks.answerCallQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call-2', ordinal: 2 })
    );
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('degrades a call question to the explain path when doc intelligence is disabled', async () => {
    mocks.docIntelligenceEnabled.value = false;
    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue({
      intent: 'call_question',
      confidence: 0.9,
      requiresConfirmation: false,
      referencedOrdinals: [1],
    });

    const run = makeRun([makeResult('call-1')]);
    const outcome = await (service as any).createTurnOutcome(
      baseParams(service, 'what documents are required for result 1?', run)
    );

    expect(outcome.intent).toBe('call_question');
    expect(outcome.assistantContent).toContain('Show Details');
    expect(outcome.citations.resultIds).toEqual(['call-1']);
    expect(mocks.answerCallQuestion).not.toHaveBeenCalled();
  });

  it('asks which result the user means when no run exists', async () => {
    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue({
      intent: 'call_question',
      confidence: 0.9,
      requiresConfirmation: false,
      referencedOrdinals: [],
    });

    const outcome = await (service as any).createTurnOutcome(
      baseParams(service, 'what is the eligibility for this call?')
    );

    expect(outcome.intent).toBe('call_question');
    expect(outcome.messageType).toBe('assistant_notice');
    expect(mocks.answerCallQuestion).not.toHaveBeenCalled();
  });

  it('falls back to the explain path when the document answer throws', async () => {
    const service = new RecommendationConversationService();
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue({
      intent: 'call_question',
      confidence: 0.9,
      requiresConfirmation: false,
      referencedOrdinals: [1],
    });
    mocks.answerCallQuestion.mockRejectedValue(new Error('retrieval exploded'));

    const run = makeRun([makeResult('call-1')]);
    const outcome = await (service as any).createTurnOutcome(
      baseParams(service, 'what is the budget cap for result 1?', run)
    );

    expect(outcome.intent).toBe('call_question');
    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.assistantContent).toContain('Show Details');
    expect(outcome.citations.resultIds).toEqual(['call-1']);
  });

  it('redirects grant-strategy coaching as out of scope without any model call or search', async () => {
    const service = new RecommendationConversationService();
    // The orchestrator itself classifies this one (fast path does not catch "what do reviewers…").
    const llmSpy = vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue({
      intent: 'out_of_scope',
      confidence: 0.9,
      requiresConfirmation: false,
    });
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(null);

    const run = makeRun([makeResult('call-1')]);
    const outcome = await (service as any).createTurnOutcome(
      baseParams(service, 'what do reviewers look for in a fellowship application?', run)
    );

    expect(llmSpy).toHaveBeenCalledTimes(1);
    expect(outcome.intent).toBe('out_of_scope');
    expect(outcome.messageType).toBe('assistant_response');
    expect(outcome.assistantContent).toContain('outside what I can help with');
    expect(outcome.assistantContent).toContain('results above');
    expect(outcome.suggestedReplies).toContain('What does result 1 fund?');
    // No narrative/answer generation: the redirect is deterministic.
    expect(mocks.gatewayText).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('short-circuits explicit topic/problem ideation requests before the orchestrator runs', async () => {
    const service = new RecommendationConversationService();
    const llmSpy = vi.spyOn(service as any, 'parseTurnWithLLM').mockRejectedValue(new Error('should not be called'));
    const searchSpy = vi.spyOn(service as any, 'runGroundedSearch').mockResolvedValue(null);
    const run = makeRun([makeResult('call-1')]);

    for (const message of [
      'suggest some research topics for result 1',
      'Recommend 5 problems I could propose for this call',
      'brainstorm project ideas that fit call 2',
      'what problem should I propose for the first one?',
      'can you help me write my proposal for result 1',
      'tips for writing a strong grant application',
    ]) {
      const outcome = await (service as any).createTurnOutcome(baseParams(service, message, run));
      expect(outcome.intent, message).toBe('out_of_scope');
      expect(outcome.assistantContent, message).toContain('outside what I can help with');
    }

    expect(llmSpy).not.toHaveBeenCalled();
    expect(mocks.gatewayText).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(mocks.answerCallQuestion).not.toHaveBeenCalled();
  });

  it('does not mistake funding searches or call questions for out-of-scope requests', async () => {
    const service = new RecommendationConversationService();
    const run = makeRun([makeResult('call-1')]);

    // Searches phrased with "suggest/recommend/list … topic" must NOT hit the out-of-scope fast path.
    for (const message of [
      'suggest funding opportunities on the topic of battery recycling',
      'recommend grants for research on battery recycling',
      'list fellowships for early-career researchers in India',
      'give me ideas of funding for AI safety',
      'what does result 1 fund?',
      'what research themes does result 1 fund?',
    ]) {
      const fast = (service as any).parseFastPathTurn({ message, state: makeState(), latestRun: run });
      expect(fast?.intent ?? 'none', message).not.toBe('out_of_scope');
    }

    // "What does this call fund?" is a call question, in scope.
    vi.spyOn(service as any, 'parseTurnWithLLM').mockResolvedValue({
      intent: 'call_question',
      confidence: 0.9,
      requiresConfirmation: false,
      referencedOrdinals: [1],
    });
    mocks.answerCallQuestion.mockResolvedValue({
      answer: 'It funds **applied AI** projects [eligibility, p. 2, v1].',
      citations: [],
      category: 'thematic',
      answeredFrom: 'document',
      streamed: false,
    });
    const questionOutcome = await (service as any).createTurnOutcome(
      baseParams(service, 'what research themes does result 1 fund?', run)
    );
    expect(questionOutcome.intent).toBe('call_question');
    expect(mocks.answerCallQuestion).toHaveBeenCalledTimes(1);
  });

  it('maps the legacy funding_strategy intent from the orchestrator to out_of_scope', () => {
    const service = new RecommendationConversationService();
    const parsed = (service as any).processOrchestratorOutput(
      { intent: 'funding_strategy', assistantSuggestion: 'Here are three aims you could propose…' },
      { message: 'what should I propose?', state: makeState() }
    );
    expect(parsed.intent).toBe('out_of_scope');
  });
});
