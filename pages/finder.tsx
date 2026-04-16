import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  FaArrowLeft,
  FaBolt,
  FaCheck,
  FaExclamationTriangle,
  FaFilter,
  FaPaperclip,
  FaPaperPlane,
  FaPlus,
  FaSignOutAlt,
  FaTimes,
  FaTrash,
} from 'react-icons/fa';
import FinderActiveFilterBar from '@/components/FinderActiveFilterBar';
import FinderChatMessage from '@/components/FinderChatMessage';
// FinderConversationSidebar removed from layout — single-conversation UX
// import FinderConversationSidebar from '@/components/FinderConversationSidebar';
import FundingChatFilterDrawer from '@/components/FundingChatFilterDrawer';
import FundingCallImportModal from '@/components/FundingCallImportModal';
import FundingDirectoryPanel from '@/components/FundingDirectoryPanel';
import type {
  RecommendationConversationDetail,
  RecommendationConversationRunRecord,
  RecommendationConversationSummary,
} from '@/lib/recommendations/chatTypes';
import type { ResearcherFinderContext } from '@/lib/researcherProfile/types';
import type {
  DirectoryFacetDimension,
  DirectoryFacetResponse,
  RecommendationDirectoryResponse,
  RecommendationRawResultItem,
  RecommendationSearchFilters,
} from '@/lib/recommendations/types';
import { useAuth } from '@/lib/auth-context';

type FinderTab = 'manual' | 'ai';

const defaultFilters: Required<RecommendationSearchFilters> = {
  geographyScope: [],
  eligibleCountries: [],
  eligibleRegions: [],
  hostCountries: [],
  funderCountries: [],
  fundingKinds: [],
  institutionTypes: [],
  careerStages: [],
  citizenshipRequirements: [],
  residencyRequirements: [],
  applicationLanguages: [],
  sponsorTypes: [],
  deadlineFrom: '',
  deadlineTo: '',
  rollingOnly: false,
  amountMin: null,
  amountMax: null,
  includeExpired: false,
  limit: 10,
  sort: 'best_match',
};

const manualDefaultFilters: Required<RecommendationSearchFilters> = {
  ...defaultFilters,
  limit: 8,
  sort: 'deadline_soonest',
};

const conversationStarters = [
  'Find international fellowships in AI for healthcare.',
  'Show climate adaptation grants open to Indian universities.',
  'I need travel grants for presenting research in Europe.',
  'Find infrastructure funding for an AI and data lab.',
];

type AttachedQueryContext = {
  label: string;
  queryText: string;
  sourceLabel: string;
} | null;

function buildSummary(detail: RecommendationConversationDetail): RecommendationConversationSummary {
  const preview = [...detail.messages].reverse().find((message) => message.content.trim().length > 0)?.content || null;
  return {
    id: detail.id,
    title: detail.title,
    updatedAt: detail.updatedAt,
    preview,
    currentInputMode: detail.currentInputMode,
    hasPendingPatch: Boolean(detail.pendingFilterPatch),
  };
}

async function apiRequest<T>(
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.details || payload?.message || 'Request failed');
  }
  return payload as T;
}

function countActiveFilters(filters: RecommendationSearchFilters): number {
  let count = 0;
  const arrayKeys: (keyof RecommendationSearchFilters)[] = [
    'geographyScope', 'eligibleCountries', 'eligibleRegions', 'hostCountries',
    'funderCountries', 'fundingKinds', 'institutionTypes', 'careerStages',
    'citizenshipRequirements', 'residencyRequirements', 'applicationLanguages', 'sponsorTypes',
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

function getActiveFilterSummary(filters: RecommendationSearchFilters): string[] {
  const parts: string[] = [];
  const f = filters as Required<RecommendationSearchFilters>;
  if (f.fundingKinds?.length > 0) parts.push(f.fundingKinds.join(', '));
  if (f.eligibleCountries?.length > 0) parts.push(f.eligibleCountries.slice(0, 2).join(', '));
  if (f.hostCountries?.length > 0) parts.push(`Host: ${f.hostCountries.slice(0, 2).join(', ')}`);
  if (f.careerStages?.length > 0) parts.push(f.careerStages.join(', '));
  if (f.deadlineFrom || f.deadlineTo) parts.push('Deadline range');
  if (f.rollingOnly) parts.push('Rolling only');
  return parts;
}

export default function FinderPage() {
  const { user, isLoading, authFetch, logout } = useAuth();
  const router = useRouter();
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const [finderTab, setFinderTab] = useState<FinderTab>('manual');
  const [conversations, setConversations] = useState<RecommendationConversationSummary[]>([]);
  const [conversation, setConversation] = useState<RecommendationConversationDetail | null>(null);
  const [finderContext, setFinderContext] = useState<ResearcherFinderContext | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState('');
  const [filterDraft, setFilterDraft] = useState<RecommendationSearchFilters>(defaultFilters);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachedContext, setAttachedContext] = useState<AttachedQueryContext>(null);
  const [lastUndoFilters, setLastUndoFilters] = useState<Required<RecommendationSearchFilters> | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [manualActiveQuery, setManualActiveQuery] = useState('');
  const [manualFilters, setManualFilters] = useState<Required<RecommendationSearchFilters>>(manualDefaultFilters);
  const [manualFilterDraft, setManualFilterDraft] = useState<RecommendationSearchFilters>(manualDefaultFilters);
  const [manualFilterDrawerOpen, setManualFilterDrawerOpen] = useState(false);
  const [manualResults, setManualResults] = useState<RecommendationRawResultItem[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualPage, setManualPage] = useState(1);
  const [manualTotalPages, setManualTotalPages] = useState(1);
  const [manualTotalResults, setManualTotalResults] = useState(0);
  const [manualHasNextPage, setManualHasNextPage] = useState(false);
  const [manualHasPreviousPage, setManualHasPreviousPage] = useState(false);
  const [manualLastUndoFilters, setManualLastUndoFilters] = useState<Required<RecommendationSearchFilters> | null>(null);
  const [directoryFacets, setDirectoryFacets] = useState<DirectoryFacetResponse | null>(null);
  const [directoryFacetsLoading, setDirectoryFacetsLoading] = useState(false);
  const [directorySelections, setDirectorySelections] = useState<Array<{ dimension: DirectoryFacetDimension; value: string }>>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      const callbackUrl = router.asPath && router.asPath !== '/finder' ? router.asPath : '/finder';
      router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!conversation) return;
    setFilterDraft(conversation.currentFilters);
  }, [conversation]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [conversation?.messages.length, conversation?.lastRunId, sending]);

  const activeRun = useMemo<RecommendationConversationRunRecord | null>(() => {
    if (!conversation) return null;
    if (!conversation.lastRunId) return conversation.runs[conversation.runs.length - 1] || null;
    return conversation.runs.find((run) => run.id === conversation.lastRunId) || conversation.runs[conversation.runs.length - 1] || null;
  }, [conversation]);

  async function loadConversation(conversationId: string) {
    setLoadingConversation(true);
    setError(null);
    try {
      const payload = await apiRequest<{ conversation: RecommendationConversationDetail }>(authFetch, `/api/recommendations/conversations/${conversationId}`);
      setConversation(payload.conversation);
      setConversations((current) => {
        const summary = buildSummary(payload.conversation);
        const rest = current.filter((item) => item.id !== summary.id);
        return [summary, ...rest].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoadingConversation(false);
    }
  }

  async function handleCreateConversation() {
    setCreatingConversation(true);
    setError(null);
    try {
      const payload = await apiRequest<{ conversation: RecommendationConversationDetail }>(authFetch, '/api/recommendations/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setConversation(payload.conversation);
      setConversations((current) => [buildSummary(payload.conversation), ...current.filter((item) => item.id !== payload.conversation.id)]);
      setComposer('');
      setAttachedContext(null);
      setAttachMenuOpen(false);
      setLastUndoFilters(null);
      setFilterDraft(payload.conversation.currentFilters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conversation');
    } finally {
      setCreatingConversation(false);
    }
  }

  async function refreshConversations(preferredConversationId?: string) {
    setLoadingList(true);
    try {
      const payload = await apiRequest<{ conversations: RecommendationConversationSummary[] }>(authFetch, '/api/recommendations/conversations');
      setConversations(payload.conversations);

      const nextConversationId = preferredConversationId || conversation?.id || payload.conversations[0]?.id || null;
      if (!nextConversationId && payload.conversations.length === 0) {
        await handleCreateConversation();
      } else if (nextConversationId) {
        await loadConversation(nextConversationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (user) {
      refreshConversations().catch(() => undefined);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    apiRequest<ResearcherFinderContext>(authFetch, '/api/researcher/context')
      .then((payload) => setFinderContext(payload))
      .catch(() => undefined);
  }, [authFetch, user]);

  async function loadManualDirectory(nextQuery = manualQuery, nextFilters = manualFilters, nextPage = manualPage) {
    setManualLoading(true);
    setError(null);
    try {
      const response = await apiRequest<RecommendationDirectoryResponse>(authFetch, '/api/recommendations/manual-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: nextQuery,
          page: nextPage,
          filters: nextFilters,
        }),
      });
      setManualResults(response.results);
      setManualFilters(response.appliedFilters);
      setManualFilterDraft(response.appliedFilters);
      setManualActiveQuery(response.query);
      setManualPage(response.page);
      setManualTotalPages(response.totalPages);
      setManualTotalResults(response.totalResults);
      setManualHasNextPage(response.hasNextPage);
      setManualHasPreviousPage(response.hasPreviousPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load funding directory');
    } finally {
      setManualLoading(false);
    }
  }

  function buildFiltersFromSelections(
    selections: Array<{ dimension: DirectoryFacetDimension; value: string }>,
    baseFilters: Required<RecommendationSearchFilters>
  ): { query: string; filters: Required<RecommendationSearchFilters> } {
    const filters = { ...baseFilters };
    const queryParts: string[] = [];

    for (const sel of selections) {
      switch (sel.dimension) {
        case 'researchArea':
        case 'discipline':
          queryParts.push(sel.value);
          break;
        case 'country':
          filters.eligibleCountries = [...(filters.eligibleCountries || []), sel.value];
          break;
        case 'fundingKind':
          filters.fundingKinds = [...(filters.fundingKinds || []), sel.value];
          break;
        case 'careerStage':
          filters.careerStages = [...(filters.careerStages || []), sel.value];
          break;
        case 'sponsorType':
          filters.sponsorTypes = [...(filters.sponsorTypes || []), sel.value];
          break;
        case 'region':
          filters.eligibleRegions = [...(filters.eligibleRegions || []), sel.value];
          break;
        case 'institutionType':
          filters.institutionTypes = [...(filters.institutionTypes || []), sel.value];
          break;
      }
    }

    return { query: queryParts.join(' '), filters };
  }

  async function loadDirectoryFacets(
    selections: Array<{ dimension: DirectoryFacetDimension; value: string }> = directorySelections,
    extraQuery = manualQuery
  ) {
    setDirectoryFacetsLoading(true);
    try {
      const { query: selQuery, filters } = buildFiltersFromSelections(selections, manualDefaultFilters);
      const combinedQuery = [extraQuery, selQuery].filter(Boolean).join(' ');
      const response = await apiRequest<DirectoryFacetResponse>(authFetch, '/api/recommendations/directory/facets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: combinedQuery || undefined, filters }),
      });
      setDirectoryFacets(response);
    } catch {
      // facets are non-critical — silently degrade
    } finally {
      setDirectoryFacetsLoading(false);
    }
  }

  async function loadDirectoryWithSelections(
    selections: Array<{ dimension: DirectoryFacetDimension; value: string }>,
    searchQuery = manualQuery,
    nextPage = 1
  ) {
    const { query: selQuery, filters } = buildFiltersFromSelections(selections, manualDefaultFilters);
    const combinedQuery = [searchQuery, selQuery].filter(Boolean).join(' ');
    await Promise.all([
      loadManualDirectory(combinedQuery, filters, nextPage),
      loadDirectoryFacets(selections, searchQuery),
    ]);
  }

  useEffect(() => {
    if (user) {
      loadManualDirectory('', manualDefaultFilters, 1).catch(() => undefined);
      loadDirectoryFacets([], '').catch(() => undefined);
    }
  }, [user]);

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
      setError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  }

  async function handleClearChat() {
    if (!conversation) return;
    if (!window.confirm('Clear all messages and results from this chat?')) return;

    setSending(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : 'Failed to clear chat');
    } finally {
      setSending(false);
    }
  }

  function updateConversationFromResponse(detail: RecommendationConversationDetail) {
    setConversation(detail);
    setConversations((current) => {
      const summary = buildSummary(detail);
      const rest = current.filter((item) => item.id !== summary.id);
      return [summary, ...rest].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  async function handleRunManualSearch() {
    await loadManualDirectory(manualQuery, manualFilters, 1);
  }

  async function handleApplyManualFilters() {
    setManualFilterDrawerOpen(false);
    const previousFilters = manualFilters;
    const advancedFilters = {
      ...manualFilterDraft,
      limit: manualFilterDraft.limit || manualDefaultFilters.limit,
      sort: manualFilterDraft.sort || manualDefaultFilters.sort,
    } as Required<RecommendationSearchFilters>;
    const { query: selQuery } = buildFiltersFromSelections(directorySelections, advancedFilters);
    const combinedQuery = [manualQuery, selQuery].filter(Boolean).join(' ');
    await loadManualDirectory(combinedQuery, advancedFilters, 1);
    if (JSON.stringify(previousFilters) !== JSON.stringify(manualFilterDraft)) {
      setManualLastUndoFilters(previousFilters);
    }
    loadDirectoryFacets(directorySelections, manualQuery).catch(() => undefined);
  }

  async function handleResetManualFilters() {
    const previousFilters = manualFilters;
    await loadManualDirectory(manualQuery, manualDefaultFilters, 1);
    setManualLastUndoFilters(previousFilters);
  }

  async function handleUndoManualFilters() {
    if (!manualLastUndoFilters) return;
    await loadManualDirectory(manualQuery, manualLastUndoFilters, 1);
    setManualLastUndoFilters(null);
  }

  async function handleRemoveManualArrayValue(key: keyof RecommendationSearchFilters, value: string) {
    const nextFilters = { ...manualFilters } as RecommendationSearchFilters;
    const current = Array.isArray(nextFilters[key]) ? ([...(nextFilters[key] as string[])] as string[]) : [];
    nextFilters[key] = current.filter((item) => item !== value) as never;
    const previousFilters = manualFilters;
    await loadManualDirectory(manualQuery, nextFilters as Required<RecommendationSearchFilters>, 1);
    setManualLastUndoFilters(previousFilters);
  }

  async function handleClearManualScalar(key: keyof RecommendationSearchFilters) {
    const nextFilters = { ...manualFilters } as RecommendationSearchFilters;
    if (key === 'rollingOnly' || key === 'includeExpired') {
      nextFilters[key] = false as never;
    } else if (key === 'amountMin' || key === 'amountMax') {
      nextFilters[key] = null as never;
    } else {
      delete nextFilters[key];
    }
    const previousFilters = manualFilters;
    await loadManualDirectory(manualQuery, nextFilters as Required<RecommendationSearchFilters>, 1);
    setManualLastUndoFilters(previousFilters);
  }

  async function handleManualNextPage() {
    if (!manualHasNextPage) return;
    await loadManualDirectory(manualQuery, manualFilters, manualPage + 1);
  }

  async function handleManualPreviousPage() {
    if (!manualHasPreviousPage) return;
    await loadManualDirectory(manualQuery, manualFilters, manualPage - 1);
  }

  async function handleManualGoToPage(page: number) {
    if (page === manualPage) return;
    await loadManualDirectory(manualActiveQuery || manualQuery, manualFilters, page);
  }

  async function handleSelectFacet(dimension: DirectoryFacetDimension, value: string) {
    const exists = directorySelections.some((s) => s.dimension === dimension && s.value === value);
    if (exists) return;
    const next = [...directorySelections, { dimension, value }];
    setDirectorySelections(next);
    await loadDirectoryWithSelections(next, manualQuery, 1);
  }

  async function handleRemoveFacet(dimension: DirectoryFacetDimension, value: string) {
    const next = directorySelections.filter((s) => !(s.dimension === dimension && s.value === value));
    setDirectorySelections(next);
    await loadDirectoryWithSelections(next, manualQuery, 1);
  }

  async function handleClearAllSelections() {
    setDirectorySelections([]);
    await loadDirectoryWithSelections([], manualQuery, 1);
  }

  async function handleDirectorySearch() {
    await loadDirectoryWithSelections(directorySelections, manualQuery, 1);
  }

  async function handleDirectoryClearQuery() {
    setManualQuery('');
    await loadDirectoryWithSelections(directorySelections, '', 1);
  }

  async function handleDirectoryNextPage() {
    if (!manualHasNextPage) return;
    await loadManualDirectory(manualActiveQuery || manualQuery, manualFilters, manualPage + 1);
  }

  async function handleDirectoryPreviousPage() {
    if (!manualHasPreviousPage) return;
    await loadManualDirectory(manualActiveQuery || manualQuery, manualFilters, manualPage - 1);
  }

  async function postConversationMessage(payload: {
    message?: string;
    manualQueryPatch?: unknown;
    manualFilterPatch?: RecommendationSearchFilters;
    inputMode?: 'research_area' | 'paper_metadata';
  }) {
    if (!conversation) return false;
    setSending(true);
    setError(null);

    try {
      const previousFilters = conversation.currentFilters;
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(authFetch, `/api/recommendations/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          clientTurnId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        }),
      });

      if (JSON.stringify(previousFilters) !== JSON.stringify(response.conversation.currentFilters)) {
        setLastUndoFilters(previousFilters);
      }

      updateConversationFromResponse(response.conversation);
      setComposer('');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleSendMessage(message: string) {
    return postConversationMessage({ message });
  }

  async function handleSubmitComposer() {
    const trimmed = composer.trim();
    if (!trimmed) return;

    const success = await postConversationMessage({
      message: trimmed,
      inputMode: attachedContext ? 'research_area' : undefined,
      manualQueryPatch: attachedContext ? { researchArea: attachedContext.queryText } : undefined,
    });

    if (success) {
      setAttachedContext(null);
      setAttachMenuOpen(false);
    }
  }

  async function handleApplyFilters() {
    setFilterDrawerOpen(false);
    await postConversationMessage({
      message: 'Apply these filter changes.',
      manualFilterPatch: filterDraft,
    });
  }

  async function handleResetFilters() {
    if (!conversation) return;
    setSending(true);
    try {
      const previousFilters = conversation.currentFilters;
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(authFetch, `/api/recommendations/conversations/${conversation.id}/reset-filters`, {
        method: 'POST',
      });
      setLastUndoFilters(previousFilters);
      updateConversationFromResponse(response.conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset filters');
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmPending(confirm: boolean) {
    if (!conversation?.pendingFilterPatch) return;
    setSending(true);
    try {
      const previousFilters = conversation.currentFilters;
      const response = await apiRequest<{ conversation: RecommendationConversationDetail }>(authFetch, `/api/recommendations/conversations/${conversation.id}/confirm-filters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      });
      if (confirm) setLastUndoFilters(previousFilters);
      updateConversationFromResponse(response.conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm filter changes');
    } finally {
      setSending(false);
    }
  }

  async function handleUndoFilters() {
    if (!lastUndoFilters) return;
    const success = await postConversationMessage({
      message: 'Undo the last filter change.',
      manualFilterPatch: lastUndoFilters,
    });
    if (success) {
      setLastUndoFilters(null);
    }
  }

  async function handleRemoveArrayValue(key: keyof RecommendationSearchFilters, value: string) {
    if (!conversation) return;
    const nextFilters = { ...conversation.currentFilters } as RecommendationSearchFilters;
    const current = Array.isArray(nextFilters[key]) ? ([...(nextFilters[key] as string[])] as string[]) : [];
    nextFilters[key] = current.filter((item) => item !== value) as never;
    await postConversationMessage({ message: `Remove ${value} from the active filters.`, manualFilterPatch: nextFilters });
  }

  async function handleClearScalar(key: keyof RecommendationSearchFilters) {
    if (!conversation) return;
    const nextFilters = { ...conversation.currentFilters } as RecommendationSearchFilters;
    if (key === 'rollingOnly' || key === 'includeExpired') {
      nextFilters[key] = false as never;
    } else if (key === 'amountMin' || key === 'amountMax') {
      nextFilters[key] = null as never;
    } else {
      delete nextFilters[key];
    }
    await postConversationMessage({ message: `Clear the ${String(key)} filter.`, manualFilterPatch: nextFilters });
  }

  function handleAttachResearchContext(label: string, queryText: string, sourceLabel: string) {
    setAttachedContext({ label, queryText, sourceLabel });
    setComposer(`funding opportunities related to - ${label}`);
    setAttachMenuOpen(false);
  }

  async function handleExplainResult(payload: { runId: string; resultId: string; ordinal: number }) {
    await handleSendMessage(`Explain result ${payload.ordinal}.`);
  }

  function handleBeginWritingFromCall(fundingCallId: string) {
    const callbackUrl = `/dashboard?createProject=1&fundingCallId=${encodeURIComponent(fundingCallId)}`;
    if (user) {
      router.push(callbackUrl);
      return;
    }
    router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const savedResearchAreas = finderContext?.researchAreas || [];
  const profileResearchAreas = finderContext?.profile.researchAreas || [];

  if (isLoading || loadingList) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] text-slate-900">
      <Head>
        <title>Funding Chat Finder | GrantGenie</title>
        <meta
          name="description"
          content="Ask for funding opportunities in a traditional chatbot interface, apply structured filters, and get grounded results from the published funding catalog."
        />
      </Head>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/app-selector" className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 transition-colors hover:text-emerald-950">
              <FaArrowLeft />
              Back to App Selector
            </Link>
            <Link href="/profile/researcher" className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition-colors hover:border-emerald-300">
              Research Profile
            </Link>
            <Link href="/profile/research-areas" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800">
              Research Areas
            </Link>
          </div>

          <button
            onClick={() => logout()}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            Sign out
            <FaSignOutAlt />
          </button>
        </div>

        <div className="mb-6 rounded-[30px] border border-white/70 bg-white/82 px-6 py-6 shadow-[0_30px_80px_rgba(15,23,42,0.14)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">Funding Finder</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Find Funding Opportunities</h1>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">
                Browse the funding directory by research area, country, and funding type — or switch to AI-assisted search to describe your needs in plain English.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
              {activeRun ? `${activeRun.results.length} results in the current grounded run` : 'Start a conversation to search'}
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setFinderTab('manual')}
            className={`rounded-full px-5 py-3 text-sm font-semibold transition-colors ${
              finderTab === 'manual'
                ? 'bg-slate-950 text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]'
                : 'border border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:text-emerald-800'
            }`}
          >
            Funding Directory
          </button>
          <button
            type="button"
            onClick={() => setFinderTab('ai')}
            className={`rounded-full px-5 py-3 text-sm font-semibold transition-colors ${
              finderTab === 'ai'
                ? 'bg-slate-950 text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]'
                : 'border border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:text-emerald-800'
            }`}
          >
            AI Assisted Search
          </button>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="rounded-full border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-900 transition-colors hover:bg-emerald-100"
          >
            Import funding call
          </button>
        </div>

        {error ? (
          <div className="mb-5 rounded-[22px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {finderTab === 'manual' ? (
          <FundingDirectoryPanel
            query={manualQuery}
            filters={manualFilters}
            facets={directoryFacets}
            facetsLoading={directoryFacetsLoading}
            loading={manualLoading}
            results={manualResults}
            totalResults={manualTotalResults}
            page={manualPage}
            totalPages={manualTotalPages}
            hasNextPage={manualHasNextPage}
            hasPreviousPage={manualHasPreviousPage}
            onQueryChange={setManualQuery}
            onRunSearch={handleDirectorySearch}
            onClearQuery={handleDirectoryClearQuery}
            onSelectFacet={handleSelectFacet}
            onRemoveFacet={handleRemoveFacet}
            onClearAllSelections={handleClearAllSelections}
            onPreviousPage={handleDirectoryPreviousPage}
            onNextPage={handleDirectoryNextPage}
            onGoToPage={handleManualGoToPage}
            activeSelections={directorySelections}
            onOpenAdvancedFilters={() => setManualFilterDrawerOpen(true)}
            onBeginWriting={(result) => handleBeginWritingFromCall(result.id)}
          />
        ) : (
          <div className="space-y-5">
              {conversation ? (
                <FinderActiveFilterBar
                  filters={conversation.currentFilters}
                  pendingPatch={conversation.pendingFilterPatch}
                  onRemoveArrayValue={handleRemoveArrayValue}
                  onClearScalar={handleClearScalar}
                  onOpenFilters={() => setFilterDrawerOpen(true)}
                  onClearAllFilters={handleResetFilters}
                  onUndo={lastUndoFilters ? handleUndoFilters : undefined}
                />
              ) : null}

              <section className="overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.12)]">
              <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white"><FaBolt className="text-xs" /></div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">AI-Powered Conversation</p>
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-950">{conversation?.title || 'Funding Conversation'}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {loadingConversation ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Loading...
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleCreateConversation}
                      disabled={creatingConversation || sending}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <FaPlus />
                      {creatingConversation ? 'Creating...' : 'New Chat'}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearChat}
                      disabled={!conversation || sending}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <FaTrash />
                      Clear Chat
                    </button>
                    {activeRun?.degradedMode === 'full_text_only' ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                        Full-text fallback
                      </span>
                    ) : null}
                    {activeRun?.lowConfidence ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                        Low confidence
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Active filter awareness strip — always visible when filters are on */}
              {conversation && countActiveFilters(conversation.currentFilters) > 0 ? (
                <div className="flex items-center gap-3 border-b border-amber-200/60 bg-amber-50/80 px-6 py-2.5">
                  <FaExclamationTriangle className="shrink-0 text-xs text-amber-600" />
                  <span className="text-xs font-semibold text-amber-800">
                    {countActiveFilters(conversation.currentFilters)} filter{countActiveFilters(conversation.currentFilters) !== 1 ? 's' : ''} active
                  </span>
                  <span className="hidden text-xs text-amber-700/80 sm:inline">
                    — {getActiveFilterSummary(conversation.currentFilters).slice(0, 3).join(' · ')}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFilterDrawerOpen(true)}
                      className="rounded-full border border-amber-300 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 transition-colors hover:bg-amber-100"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="rounded-full border border-amber-300 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 transition-colors hover:bg-amber-100"
                    >
                      Clear All
                    </button>
                  </div>
                </div>
              ) : null}

              <div ref={chatScrollRef} className="h-[60vh] overflow-y-auto bg-[linear-gradient(180deg,_rgba(248,250,252,0.7),_rgba(255,255,255,0.98))] px-6 py-6">
                {conversation?.pendingFilterPatch ? (
                  <div className="mb-5 rounded-[24px] border border-amber-300 bg-amber-50 p-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Pending Filter Confirmation</div>
                    <p className="mt-2 text-sm leading-6 text-amber-950">{conversation.pendingFilterPatch.summary}</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => handleConfirmPending(true)}
                        className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
                      >
                        <FaCheck />
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmPending(false)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-amber-300 px-4 py-3 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-100"
                      >
                        <FaTimes />
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {!conversation || conversation.messages.length === 0 ? (
                  <div className="space-y-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6">
                    <div className="text-lg font-semibold text-slate-900">Start with a plain-language funding request</div>
                    <p className="text-sm leading-6 text-slate-600">
                      Example: “Find fellowships for AI in healthcare,” “Show travel grants in Europe,” or “Find climate research grants for universities in India.”
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {conversationStarters.map((starter) => (
                        <button
                          key={starter}
                          type="button"
                          onClick={() => handleSendMessage(starter)}
                          className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-700"
                        >
                          {starter}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {conversation.messages.map((message) => (
                      <FinderChatMessage
                        key={message.id}
                        message={message}
                        runs={conversation.runs}
                        onExplainResult={handleExplainResult}
                        onBeginWriting={({ resultId }) => handleBeginWritingFromCall(resultId)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 bg-white px-6 py-5">
                {attachedContext ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-900">
                      Attached: {attachedContext.sourceLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachedContext(null);
                        setComposer('');
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition-colors hover:text-slate-900"
                    >
                      <FaTimes />
                      Remove
                    </button>
                  </div>
                ) : null}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSubmitComposer();
                  }}
                  className="relative"
                >
                  {attachMenuOpen ? (
                    <div className="absolute bottom-full left-0 mb-3 w-full max-w-xl rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Attach Research Context</div>
                          <div className="mt-2 text-sm leading-6 text-slate-600">
                            Choose a saved research area or one of your profile research areas. The selected topic will be inserted into the chat query.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAttachMenuOpen(false)}
                          className="rounded-full border border-slate-200 p-2 text-slate-500 transition-colors hover:text-slate-900"
                        >
                          <FaTimes />
                        </button>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Saved Research Areas</div>
                          {savedResearchAreas.length > 0 ? (
                            savedResearchAreas.map((area) => (
                              <button
                                key={area.id}
                                type="button"
                                onClick={() => handleAttachResearchContext(area.label, area.researchArea, 'Saved Research Area')}
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                              >
                                <div className="font-semibold text-slate-900">{area.label}</div>
                                <div className="mt-1 line-clamp-2 text-slate-600">{area.researchArea}</div>
                              </button>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                              No saved research areas yet.
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Profile Research Areas</div>
                          {profileResearchAreas.length > 0 ? (
                            profileResearchAreas.map((area) => (
                              <button
                                key={area}
                                type="button"
                                onClick={() => handleAttachResearchContext(area, area, 'Profile Research Area')}
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                              >
                                <div className="font-semibold text-slate-900">{area}</div>
                              </button>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                              Add research areas in your profile to attach them here.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-end gap-3 rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
                    <button
                      type="button"
                      onClick={() => setFilterDrawerOpen(true)}
                      className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors ${
                        conversation && countActiveFilters(conversation.currentFilters) > 0
                          ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700'
                      }`}
                      title={conversation && countActiveFilters(conversation.currentFilters) > 0 ? `${countActiveFilters(conversation.currentFilters)} filters active — click to edit` : 'Open filters'}
                    >
                      <FaFilter />
                      {conversation && countActiveFilters(conversation.currentFilters) > 0 ? (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow">
                          {countActiveFilters(conversation.currentFilters)}
                        </span>
                      ) : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => setAttachMenuOpen((current) => !current)}
                      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
                      title="Attach saved research context"
                    >
                      <FaPaperclip />
                    </button>

                    <textarea
                      rows={2}
                      value={composer}
                      onChange={(event) => setComposer(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          handleSubmitComposer();
                        }
                      }}
                      placeholder="Ask anything — e.g. &quot;Find fellowships in AI for healthcare&quot; or &quot;I'm presenting at a conference in Berlin next month&quot;"
                      className="min-h-[52px] flex-1 resize-none rounded-[22px] border-2 border-slate-200 bg-slate-50/50 px-4 py-3 text-sm leading-6 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                    />

                    <button
                      type="submit"
                      disabled={sending || !conversation || !composer.trim()}
                      className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-700 hover:shadow-[0_4px_20px_rgba(16,185,129,0.4)] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                      <FaPaperPlane />
                      {sending ? 'Thinking...' : 'Send'}
                    </button>
                  </div>
                </form>
              </div>
              </section>
          </div>
        )}
      </div>

      {filterDrawerOpen ? (
        <FundingChatFilterDrawer
          filters={filterDraft}
          onChange={setFilterDraft}
          onApply={handleApplyFilters}
          onClearAll={() => setFilterDraft({ ...defaultFilters })}
          onClose={() => setFilterDrawerOpen(false)}
        />
      ) : null}

      {manualFilterDrawerOpen ? (
        <FundingChatFilterDrawer
          filters={manualFilterDraft}
          onChange={setManualFilterDraft}
          onApply={handleApplyManualFilters}
          onClearAll={() => setManualFilterDraft({ ...manualDefaultFilters })}
          onClose={() => setManualFilterDrawerOpen(false)}
        />
      ) : null}

      <FundingCallImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onBeginWriting={handleBeginWritingFromCall}
      />
    </div>
  );
}
