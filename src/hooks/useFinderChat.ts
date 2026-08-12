import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  FinderFilterSuggestionChip,
  FinderTurnStreamEvent,
  RecommendationConversationDetail,
  RecommendationConversationMessageRequest,
  RecommendationConversationRunRecord,
  RecommendationConversationSummary,
  RecommendationFilterMode,
} from '@/lib/recommendations/chatTypes';
import { CHAT_MESSAGE_MAX_LENGTH, MAX_SELECTED_RESEARCH_AREAS } from '@/lib/recommendations/constants';
import { applyFilterSuggestionChip } from '@/lib/recommendations/filterChips';
import { streamConversationMessage } from '@/lib/recommendations/finderStream';
import {
  buildArrayValueRemovedFilters,
  buildClearedScalarFilters,
  buildFinderConversationStarters,
  buildRetryWithoutFiltersRequest,
} from '@/lib/recommendations/finderUi';
import type { RecommendationSearchFilters } from '@/lib/recommendations/types';
import type { ResearcherFinderContext } from '@/lib/researcherProfile/types';
import type { FinderPreferenceValues } from '@/components/FinderPreferencesPanel';
import type { StreamingTurnView } from '@/components/finder/FinderStreamingMessage';

export type PendingTurnState = {
  createdAt: string;
  error: string | null;
  message: string;
  request: RecommendationConversationMessageRequest;
  status: 'pending' | 'failed';
};

type AttachedQueryContext = {
  label: string;
  queryText: string;
  sourceLabel: string;
  paper?: { title: string; abstract: string; keywords: string[] } | null;
  papers?: { title: string; abstract: string }[];
} | null;

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

async function apiRequest<T>(authFetch: AuthFetch, url: string, options?: RequestInit): Promise<T> {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.details || payload?.message || 'Request failed');
  }
  return payload as T;
}

function buildSummary(detail: RecommendationConversationDetail): RecommendationConversationSummary {
  const preview = [...detail.messages].reverse().find((message) => message.content.trim().length > 0)?.content || null;
  return {
    id: detail.id,
    title: detail.title,
    updatedAt: detail.updatedAt,
    preview,
    currentInputMode: detail.currentInputMode,
    filterMode: detail.filterMode,
    hasPendingPatch: Boolean(detail.pendingFilterPatch),
  };
}

/**
 * The text a saved area is searched with. Mirrors what the server rebuilds from the
 * stored area, so the seeded conversation query and the fan-out branch agree.
 */
export function savedAreaQueryText(area: ResearcherFinderContext['researchAreas'][number]): string {
  if (area.normalizedText?.trim()) return area.normalizedText;
  const taxonomyPath = [area.taxonomy?.level1Name, area.taxonomy?.level2Name].filter(Boolean).join(' / ');
  return [taxonomyPath, area.researchArea].filter(Boolean).join(' | ');
}

export function countActiveFilters(filters: RecommendationSearchFilters): number {
  let count = 0;
  const arrayKeys: (keyof RecommendationSearchFilters)[] = [
    'geographyScope', 'eligibleCountries', 'eligibleRegions', 'hostCountries',
    'funderCountries', 'fundingKinds', 'institutionTypes', 'careerStages',
    'citizenshipRequirements', 'residencyRequirements', 'applicationLanguages', 'sponsorTypes',
    'taxonomyAreaIds',
  ];
  for (const key of arrayKeys) {
    const val = filters[key];
    if (Array.isArray(val)) count += val.length;
  }
  if (filters.deadlineFrom) count += 1;
  if (filters.deadlineTo) count += 1;
  if (filters.rollingOnly) count += 1;
  if (filters.includeExpired) count += 1;
  if (filters.amountMin !== null && filters.amountMin !== undefined) count += 1;
  if (filters.amountMax !== null && filters.amountMax !== undefined) count += 1;
  return count;
}

interface UseFinderChatParams {
  authFetch: AuthFetch;
  enabled: boolean;
  preferences: FinderPreferenceValues;
  finderContext: ResearcherFinderContext | null;
  onError: (message: string | null) => void;
}

/**
 * All state and behavior for the AI finder chat: conversation lifecycle, the streaming
 * send pipeline (SSE with automatic classic-POST fallback), manual filter actions,
 * filter-suggestion chips, and pending-turn retry semantics.
 */
export function useFinderChat({ authFetch, enabled, preferences, finderContext, onError }: UseFinderChatParams) {
  const [conversations, setConversations] = useState<RecommendationConversationSummary[]>([]);
  const [conversation, setConversation] = useState<RecommendationConversationDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState('');
  const [filterDraft, setFilterDraft] = useState<RecommendationSearchFilters>({});
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachedContext, setAttachedContext] = useState<AttachedQueryContext>(null);
  const [lastUndoFilters, setLastUndoFilters] = useState<Required<RecommendationSearchFilters> | null>(null);
  const [pendingTurn, setPendingTurn] = useState<PendingTurnState | null>(null);
  const [streamingTurn, setStreamingTurn] = useState<StreamingTurnView | null>(null);
  // Ticked saved research areas. Re-sent on every turn (not stored in conversation state)
  // so a follow-up like "only India" still searches the same set of areas.
  const [selectedResearchAreaIds, setSelectedResearchAreaIds] = useState<string[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const selectedResearchAreaIdsRef = useRef(selectedResearchAreaIds);
  selectedResearchAreaIdsRef.current = selectedResearchAreaIds;

  const savedResearchAreas = finderContext?.researchAreas || [];
  const selectedResearchAreas = useMemo(
    () => selectedResearchAreaIds
      .map((id) => savedResearchAreas.find((area) => area.id === id))
      .filter((area): area is ResearcherFinderContext['researchAreas'][number] => Boolean(area)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedResearchAreaIds, finderContext]
  );

  useEffect(() => {
    if (!conversation) return;
    setFilterDraft(conversation.currentFilters);
  }, [conversation]);

  const activeRun = useMemo<RecommendationConversationRunRecord | null>(() => {
    if (!conversation) return null;
    if (!conversation.lastRunId) return conversation.runs[conversation.runs.length - 1] || null;
    return conversation.runs.find((run) => run.id === conversation.lastRunId) || conversation.runs[conversation.runs.length - 1] || null;
  }, [conversation]);

  const starterPrompts = useMemo(
    () => buildFinderConversationStarters(preferences.useEligibilityProfile ? finderContext : null),
    [finderContext, preferences.useEligibilityProfile]
  );

  const latestAssistantMessageId = useMemo(() => {
    if (!conversation) return null;
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      if (conversation.messages[index]?.role === 'assistant') {
        return conversation.messages[index].id;
      }
    }
    return null;
  }, [conversation]);

  function updateConversationFromResponse(detail: RecommendationConversationDetail) {
    setConversation(detail);
    setPendingTurn(null);
    setStreamingTurn(null);
    setConversations((current) => {
      const summary = buildSummary(detail);
      const rest = current.filter((item) => item.id !== summary.id);
      return [summary, ...rest].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  async function loadConversation(conversationId: string) {
    setLoadingConversation(true);
    onError(null);
    try {
      const payload = await apiRequest<{ conversation: RecommendationConversationDetail }>(
        authFetch,
        `/api/recommendations/conversations/${conversationId}`
      );
      updateConversationFromResponse(payload.conversation);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoadingConversation(false);
    }
  }

  async function handleCreateConversation() {
    setCreatingConversation(true);
    onError(null);
    try {
      const payload = await apiRequest<{ conversation: RecommendationConversationDetail }>(
        authFetch,
        '/api/recommendations/conversations',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
      );
      updateConversationFromResponse(payload.conversation);
      setComposer('');
      setAttachedContext(null);
      setAttachMenuOpen(false);
      setLastUndoFilters(null);
      setFilterDraft(payload.conversation.currentFilters);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create conversation');
    } finally {
      setCreatingConversation(false);
    }
  }

  async function refreshConversations(preferredConversationId?: string) {
    setLoadingList(true);
    try {
      const payload = await apiRequest<{ conversations: RecommendationConversationSummary[] }>(
        authFetch,
        '/api/recommendations/conversations'
      );
      setConversations(payload.conversations);

      const nextConversationId = preferredConversationId || conversation?.id || payload.conversations[0]?.id || null;
      if (!nextConversationId && payload.conversations.length === 0) {
        await handleCreateConversation();
      } else if (nextConversationId) {
        await loadConversation(nextConversationId);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (enabled) {
      refreshConversations().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  function applyStreamEvent(event: FinderTurnStreamEvent) {
    if (event.type === 'stage') {
      setStreamingTurn((current) => {
        const base: StreamingTurnView = current || { stages: [], results: null, totalResults: 0, text: '' };
        return {
          ...base,
          stages: [
            ...base.stages.map((entry) => ({ ...entry, done: true })),
            { stage: event.stage, label: event.label, detail: event.detail, done: false },
          ],
        };
      });
    } else if (event.type === 'results') {
      setStreamingTurn((current) => {
        const base: StreamingTurnView = current || { stages: [], results: null, totalResults: 0, text: '' };
        return { ...base, results: event.results, totalResults: event.totalResults };
      });
    } else if (event.type === 'token') {
      setStreamingTurn((current) => {
        const base: StreamingTurnView = current || { stages: [], results: null, totalResults: 0, text: '' };
        return {
          ...base,
          stages: base.stages.map((entry) => ({ ...entry, done: true })),
          text: base.text + event.delta,
        };
      });
    }
  }

  async function postConversationMessage(
    payload: RecommendationConversationMessageRequest,
    options?: {
      clearComposerOnSuccess?: boolean;
      onSuccess?: () => void;
      optimisticMessage?: string | null;
    }
  ): Promise<boolean> {
    if (!conversation) return false;
    setSending(true);
    onError(null);
    const optimisticMessage = options?.optimisticMessage?.trim() || '';
    const optimisticTurn: PendingTurnState | null = optimisticMessage
      ? {
          createdAt: new Date().toISOString(),
          error: null,
          message: optimisticMessage,
          request: { ...payload },
          status: 'pending',
        }
      : null;

    if (optimisticTurn) {
      setPendingTurn(optimisticTurn);
    }
    setStreamingTurn(null);

    const previousFilters = conversation.currentFilters;
    const requestPayload: RecommendationConversationMessageRequest = {
      ...payload,
      useEligibilityProfile: preferencesRef.current.useEligibilityProfile,
      usePublicationContext: preferencesRef.current.usePublicationContext,
      selectedResearchAreaIds: selectedResearchAreaIdsRef.current,
      clientTurnId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };

    const finalize = (detail: RecommendationConversationDetail, stale: boolean) => {
      if (JSON.stringify(previousFilters) !== JSON.stringify(detail.currentFilters)) {
        setLastUndoFilters(previousFilters);
      }
      updateConversationFromResponse(detail);
      if (stale) {
        loadConversation(detail.id).catch(() => undefined);
        onError('This chat changed while the request was processing, so I reloaded the latest saved state.');
      }
      if (options?.clearComposerOnSuccess) {
        setComposer('');
      }
      options?.onSuccess?.();
    };

    const failPendingTurn = (message: string) => {
      setStreamingTurn(null);
      if (optimisticTurn) {
        setPendingTurn({ ...optimisticTurn, error: message, status: 'failed' });
      } else {
        onError(message);
      }
    };

    try {
      const outcome = await streamConversationMessage(authFetch, conversation.id, requestPayload, {
        onEvent: applyStreamEvent,
      });

      if (outcome.status === 'final') {
        finalize(outcome.response.conversation, outcome.response.stale);
        return true;
      }

      if (outcome.status === 'unsupported') {
        // Streaming route unavailable (proxy stripped SSE, old deploy, …) and nothing
        // was persisted — retry once through the classic JSON route.
        setStreamingTurn(null);
        const response = await apiRequest<{ conversation: RecommendationConversationDetail; stale: boolean }>(
          authFetch,
          `/api/recommendations/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
          }
        );
        finalize(response.conversation, response.stale);
        return true;
      }

      if (outcome.status === 'error') {
        const message =
          outcome.code === 'GEMINI_RATE_LIMITED'
            ? `The AI service is briefly rate limited${outcome.retryAfterMs ? ` — try again in about ${Math.ceil(outcome.retryAfterMs / 1000)}s` : ' — try again shortly'}.`
            : outcome.error;
        if (outcome.persisted) {
          setStreamingTurn(null);
          setPendingTurn(null);
          await loadConversation(conversation.id);
          onError(message);
        } else {
          failPendingTurn(message);
        }
        return false;
      }

      // connection_lost
      if (outcome.persisted) {
        setStreamingTurn(null);
        setPendingTurn(null);
        await loadConversation(conversation.id);
      } else {
        failPendingTurn('The connection dropped while processing your message. Try again.');
      }
      return false;
    } catch (err) {
      failPendingTurn(err instanceof Error ? err.message : 'Failed to send message');
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleSendMessage(message: string) {
    return postConversationMessage({ message }, { optimisticMessage: message });
  }

  async function handleSubmitComposer() {
    const trimmed = composer.trim();
    if (!trimmed) return;
    if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
      onError(`Chat messages are limited to ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString()} characters.`);
      return;
    }

    // Clear the box the moment the message leaves — the sent text already shows as
    // the optimistic bubble, and the composer stays frozen until the answer lands.
    // A failed turn can be restored into the composer from the pending-turn card.
    setComposer('');

    await postConversationMessage(
      {
        message: trimmed,
        inputMode: attachedContext ? (attachedContext.paper ? 'paper_metadata' : 'research_area') : undefined,
        manualQueryPatch: attachedContext
          ? attachedContext.paper
            ? { ...attachedContext.paper }
            : { researchArea: attachedContext.queryText }
          : undefined,
      },
      {
        optimisticMessage: trimmed,
        onSuccess: () => {
          setAttachedContext(null);
          setAttachMenuOpen(false);
        },
      }
    );
  }

  /**
   * Filters are direct manipulation: they hit the filter endpoint, which re-runs the
   * search and never posts a chat message or spends an LLM call.
   */
  async function applyFiltersSilently(nextFilters: RecommendationSearchFilters) {
    if (!conversation) return;
    setSending(true);
    onError(null);
    try {
      const previousFilters = conversation.currentFilters;
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(
        authFetch,
        `/api/recommendations/conversations/${conversation.id}/filters`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: nextFilters,
            useEligibilityProfile: preferencesRef.current.useEligibilityProfile,
            usePublicationContext: preferencesRef.current.usePublicationContext,
            selectedResearchAreaIds: selectedResearchAreaIdsRef.current,
          }),
        }
      );
      setLastUndoFilters(previousFilters);
      updateConversationFromResponse(response.conversation);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update filters');
    } finally {
      setSending(false);
    }
  }

  async function handleApplyFilters() {
    setFilterDrawerOpen(false);
    await applyFiltersSilently(filterDraft);
  }

  async function handleResetFilters() {
    if (!conversation) return;
    setSending(true);
    try {
      const previousFilters = conversation.currentFilters;
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(
        authFetch,
        `/api/recommendations/conversations/${conversation.id}/reset-filters`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            useEligibilityProfile: preferencesRef.current.useEligibilityProfile,
            usePublicationContext: preferencesRef.current.usePublicationContext,
            selectedResearchAreaIds: selectedResearchAreaIdsRef.current,
          }),
        }
      );
      setLastUndoFilters(previousFilters);
      updateConversationFromResponse(response.conversation);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to reset filters');
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmPending(confirm: boolean) {
    if (!conversation?.pendingFilterPatch) return;
    setSending(true);
    try {
      const previousFilters = conversation.currentFilters;
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(
        authFetch,
        `/api/recommendations/conversations/${conversation.id}/confirm-filters`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirm,
            useEligibilityProfile: preferencesRef.current.useEligibilityProfile,
            usePublicationContext: preferencesRef.current.usePublicationContext,
            selectedResearchAreaIds: selectedResearchAreaIdsRef.current,
          }),
        }
      );
      if (confirm) setLastUndoFilters(previousFilters);
      updateConversationFromResponse(response.conversation);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to confirm filter changes');
    } finally {
      setSending(false);
    }
  }

  async function handleUndoFilters() {
    if (!lastUndoFilters) return;
    await applyFiltersSilently(lastUndoFilters);
  }

  async function handleFilterModeChange(mode: RecommendationFilterMode) {
    if (!conversation || conversation.filterMode === mode) return;
    setSending(true);
    onError(null);
    try {
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(
        authFetch,
        `/api/recommendations/conversations/${conversation.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filterMode: mode }),
        }
      );
      updateConversationFromResponse(response.conversation);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to switch filter mode');
    } finally {
      setSending(false);
    }
  }

  async function handleApplyFilterChip(chip: FinderFilterSuggestionChip) {
    if (!conversation) return;
    await applyFiltersSilently(applyFilterSuggestionChip(conversation.currentFilters, chip));
  }

  async function handleRemoveArrayValue(key: keyof RecommendationSearchFilters, value: string) {
    if (!conversation) return;
    await applyFiltersSilently(buildArrayValueRemovedFilters(conversation.currentFilters, key, value));
  }

  async function handleClearScalar(key: keyof RecommendationSearchFilters) {
    if (!conversation) return;
    await applyFiltersSilently(buildClearedScalarFilters(conversation.currentFilters, key));
  }

  async function handleRetryWithoutStrictFilters() {
    if (!activeRun?.searchDiagnostics?.strictFilterRecovery) return;
    const retry = buildRetryWithoutFiltersRequest(activeRun.searchDiagnostics.strictFilterRecovery);
    if (retry.manualFilterPatch) {
      await applyFiltersSilently(retry.manualFilterPatch as RecommendationSearchFilters);
    }
  }

  async function handleRetryPendingTurn() {
    if (!pendingTurn || pendingTurn.status !== 'failed') return;
    await postConversationMessage(pendingTurn.request, {
      clearComposerOnSuccess: composer.trim() === pendingTurn.message.trim(),
      optimisticMessage: pendingTurn.message,
    });
  }

  function handleEditPendingTurn() {
    if (!pendingTurn) return;
    setComposer(pendingTurn.message);
    setPendingTurn(null);
    composerRef.current?.focus();
  }

  function handleDismissPendingTurn() {
    setPendingTurn(null);
  }

  function handleAttachResearchContext(label: string, queryText: string, sourceLabel: string) {
    setAttachedContext({ label, queryText, sourceLabel });
    setComposer(`funding opportunities related to - ${label}`);
    setAttachMenuOpen(false);
  }

  function handleAttachPublicationContext(publication: { title: string; abstract: string }) {
    setAttachedContext((prev) => {
      const prevPapers = prev?.papers || [];
      const alreadySelected = prevPapers.some((p) => p.title === publication.title);
      const nextPapers = alreadySelected
        ? prevPapers.filter((p) => p.title !== publication.title)
        : [...prevPapers, { title: publication.title, abstract: publication.abstract }];

      if (nextPapers.length === 0) return null;

      const combinedTitle = nextPapers.map((p) => p.title).join('; ');
      const combinedAbstract = nextPapers.map((p) => p.abstract).join('\n\n');
      const label = nextPapers.length === 1
        ? nextPapers[0].title
        : `${nextPapers.length} publications`;
      return {
        label,
        queryText: combinedTitle,
        sourceLabel: nextPapers.length === 1
          ? `Publication: ${nextPapers[0].title.slice(0, 60)}${nextPapers[0].title.length > 60 ? '…' : ''}`
          : `${nextPapers.length} publications attached`,
        paper: { title: combinedTitle, abstract: combinedAbstract, keywords: [] },
        papers: nextPapers,
      };
    });
  }

  function handleConfirmPublications() {
    if (!attachedContext?.papers?.length) return;
    const titles = attachedContext.papers.map((p) => p.title);
    setComposer(
      titles.length === 1
        ? `funding opportunities matching my publication - ${titles[0]}`
        : `funding opportunities matching my ${titles.length} publications`
    );
    setAttachMenuOpen(false);
  }

  async function handleSearchResearchArea(label: string, queryText: string) {
    const message = `Find funding opportunities for ${label}.`;
    await postConversationMessage(
      {
        message,
        inputMode: 'research_area',
        manualQueryPatch: { researchArea: queryText },
      },
      { optimisticMessage: message }
    );
  }

  function handleToggleResearchAreaSelection(areaId: string) {
    setSelectedResearchAreaIds((current) => {
      if (current.includes(areaId)) {
        return current.filter((id) => id !== areaId);
      }
      if (current.length >= MAX_SELECTED_RESEARCH_AREAS) {
        onError(`You can search up to ${MAX_SELECTED_RESEARCH_AREAS} research areas at once.`);
        return current;
      }
      onError(null);
      return [...current, areaId];
    });
  }

  function handleClearResearchAreaSelection() {
    setSelectedResearchAreaIds([]);
  }

  /**
   * Searches every ticked area at once. The first area seeds the conversation's own query
   * state so later filter-only turns stay searchable; the full set rides along on the
   * request and is what the server actually fans out over.
   */
  async function handleSearchSelectedAreas() {
    if (selectedResearchAreas.length === 0) return;
    const labels = selectedResearchAreas.map((area) => area.label || area.researchArea);
    const message =
      labels.length === 1
        ? `Find funding opportunities for ${labels[0]}.`
        : `Find funding opportunities across my research areas: ${labels.join(', ')}.`;

    await postConversationMessage(
      {
        message,
        inputMode: 'research_area',
        manualQueryPatch: { researchArea: savedAreaQueryText(selectedResearchAreas[0]) },
      },
      {
        optimisticMessage: message,
        onSuccess: () => setAttachMenuOpen(false),
      }
    );
  }

  async function handleDeleteConversation(conversationId: string) {
    if (!window.confirm('Delete this funding conversation?')) return;
    try {
      await apiRequest(authFetch, `/api/recommendations/conversations/${conversationId}`, { method: 'DELETE' });
      const nextList = conversations.filter((item) => item.id !== conversationId);
      setConversations(nextList);
      if (conversation?.id === conversationId) {
        setConversation(null);
        if (nextList[0]) {
          await loadConversation(nextList[0].id);
        } else {
          await handleCreateConversation();
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  }

  async function handleClearChat() {
    if (!conversation) return;
    if (!window.confirm('Clear all messages and results from this chat?')) return;

    setSending(true);
    onError(null);
    try {
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(
        authFetch,
        `/api/recommendations/conversations/${conversation.id}/clear`,
        { method: 'POST' }
      );
      updateConversationFromResponse(response.conversation);
      setComposer('');
      setAttachedContext(null);
      setAttachMenuOpen(false);
      setLastUndoFilters(null);
      setFilterDraft(response.conversation.currentFilters);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to clear chat');
    } finally {
      setSending(false);
    }
  }

  return {
    // state
    conversations,
    conversation,
    loadingList,
    loadingConversation,
    creatingConversation,
    sending,
    composer,
    setComposer,
    composerRef,
    filterDraft,
    setFilterDraft,
    filterDrawerOpen,
    setFilterDrawerOpen,
    attachMenuOpen,
    setAttachMenuOpen,
    attachedContext,
    setAttachedContext,
    lastUndoFilters,
    pendingTurn,
    streamingTurn,
    activeRun,
    starterPrompts,
    latestAssistantMessageId,
    selectedResearchAreaIds,
    selectedResearchAreas,
    // actions
    refreshConversations,
    loadConversation,
    handleCreateConversation,
    handleDeleteConversation,
    handleClearChat,
    postConversationMessage,
    handleSendMessage,
    handleSubmitComposer,
    handleApplyFilters,
    handleResetFilters,
    handleConfirmPending,
    handleUndoFilters,
    handleFilterModeChange,
    handleApplyFilterChip,
    handleRemoveArrayValue,
    handleClearScalar,
    handleRetryWithoutStrictFilters,
    handleRetryPendingTurn,
    handleEditPendingTurn,
    handleDismissPendingTurn,
    handleAttachResearchContext,
    handleAttachPublicationContext,
    handleConfirmPublications,
    handleSearchResearchArea,
    handleToggleResearchAreaSelection,
    handleClearResearchAreaSelection,
    handleSearchSelectedAreas,
  };
}

export type FinderChatController = ReturnType<typeof useFinderChat>;
