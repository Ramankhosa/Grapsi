import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { LibraryBig, MessageSquare, Upload } from 'lucide-react';
import ResearcherTopBar from '@/components/researcher/ResearcherTopBar';
import FinderAiTab from '@/components/finder/FinderAiTab';
import type { FinderPreferenceValues } from '@/components/FinderPreferencesPanel';
import FundingChatFilterDrawer from '@/components/FundingChatFilterDrawer';
import FundingCallImportModal from '@/components/FundingCallImportModal';
import FundingDirectoryPanel from '@/components/FundingDirectoryPanel';
import { useFinderChat } from '@/hooks/useFinderChat';
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
  taxonomyAreaIds: [],
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
  sort: 'best_match',
};

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

type DirectorySelection = { dimension: DirectoryFacetDimension; value: string; label?: string };

export default function FinderPage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();
  const projectId = typeof router.query.projectId === 'string' ? router.query.projectId : null;

  const [finderTab, setFinderTab] = useState<FinderTab>('ai');
  const [preferences, setPreferences] = useState<FinderPreferenceValues>({
    useEligibilityProfile: false,
    usePublicationContext: false,
  });
  const [finderContext, setFinderContext] = useState<ResearcherFinderContext | null>(null);
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
  const [directorySelections, setDirectorySelections] = useState<DirectorySelection[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const uploadQueryHandledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const chat = useFinderChat({
    authFetch,
    enabled: Boolean(user),
    preferences,
    finderContext,
    onError: setError,
  });

  useEffect(() => {
    if (!isLoading && !user) {
      const callbackUrl = router.asPath && router.asPath !== '/finder' ? router.asPath : '/finder';
      router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!router.isReady || uploadQueryHandledRef.current) return;
    if (router.query.upload === '1' || router.query.upload === 'true') {
      const resumeJobId = typeof router.query.jobId === 'string' ? router.query.jobId : null;
      if (resumeJobId && typeof window !== 'undefined') {
        window.localStorage.setItem(
          'funding-call-upload-wizard-v1',
          JSON.stringify({
            step: 'source',
            mode: 'url',
            jobId: resumeJobId,
            savedAt: new Date().toISOString(),
          })
        );
      }
      uploadQueryHandledRef.current = true;
      setImportModalOpen(true);
    }
  }, [router.isReady, router.query.jobId, router.query.upload]);

  useEffect(() => {
    if (!user) return;
    apiRequest<ResearcherFinderContext>(authFetch, '/api/researcher/context')
      .then((payload) => setFinderContext(payload))
      .catch(() => undefined);
  }, [authFetch, user]);

  async function loadManualDirectory(
    nextQuery = manualQuery,
    nextFilters = manualFilters,
    nextPage = manualPage,
    nextPreferences = preferences
  ) {
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
          useEligibilityProfile: nextPreferences.useEligibilityProfile,
          usePublicationContext: nextPreferences.usePublicationContext,
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
    selections: DirectorySelection[],
    baseFilters: Required<RecommendationSearchFilters>
  ): { query: string; filters: Required<RecommendationSearchFilters> } {
    const filters = { ...baseFilters };
    const queryParts: string[] = [];

    for (const sel of selections) {
      switch (sel.dimension) {
        case 'taxonomyArea':
          filters.taxonomyAreaIds = [...(filters.taxonomyAreaIds || []), sel.value];
          break;
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
    selections: DirectorySelection[] = directorySelections,
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
    selections: DirectorySelection[],
    searchQuery = manualQuery,
    nextPage = 1,
    nextPreferences = preferences
  ) {
    const { query: selQuery, filters } = buildFiltersFromSelections(selections, manualDefaultFilters);
    const combinedQuery = [searchQuery, selQuery].filter(Boolean).join(' ');
    await Promise.all([
      loadManualDirectory(combinedQuery, filters, nextPage, nextPreferences),
      loadDirectoryFacets(selections, searchQuery),
    ]);
  }

  useEffect(() => {
    if (user) {
      loadManualDirectory('', manualDefaultFilters, 1).catch(() => undefined);
      loadDirectoryFacets([], '').catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

  async function handleManualGoToPage(page: number) {
    if (page === manualPage) return;
    await loadManualDirectory(manualActiveQuery || manualQuery, manualFilters, page);
  }

  async function handleSelectFacet(dimension: DirectoryFacetDimension, value: string, label?: string) {
    const exists = directorySelections.some((s) => s.dimension === dimension && s.value === value);
    if (exists) return;
    const next = [...directorySelections, { dimension, value, label }];
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

  async function handlePreferenceChange(value: FinderPreferenceValues) {
    setPreferences(value);
    if (finderTab === 'manual') {
      await loadDirectoryWithSelections(directorySelections, manualQuery, 1, value);
    }
  }

  async function handleDirectoryNextPage() {
    if (!manualHasNextPage) return;
    await loadManualDirectory(manualActiveQuery || manualQuery, manualFilters, manualPage + 1);
  }

  async function handleDirectoryPreviousPage() {
    if (!manualHasPreviousPage) return;
    await loadManualDirectory(manualActiveQuery || manualQuery, manualFilters, manualPage - 1);
  }

  function buildFundingCallDetailHref(fundingCallId: string) {
    const encodedCallId = encodeURIComponent(fundingCallId);
    return projectId
      ? `/finder/calls/${encodedCallId}?projectId=${encodeURIComponent(projectId)}`
      : `/finder/calls/${encodedCallId}`;
  }

  async function handleBeginWritingFromCall(fundingCallId: string) {
    const callbackUrl = buildFundingCallDetailHref(fundingCallId);
    if (!user) {
      router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    setError(null);
    try {
      const payload = await apiRequest<{ launchUrl?: string | null; prepUrl?: string | null }>(
        authFetch,
        projectId
          ? `/api/projects/${encodeURIComponent(projectId)}/grants`
          : `/api/funding/calls/${encodeURIComponent(fundingCallId)}/start-grant-prep`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engagementMode: 'guided',
            ...(projectId ? { fundingCallId } : {}),
          }),
        }
      );
      await router.push(payload.launchUrl || payload.prepUrl || (projectId ? `/projects/${projectId}/grants` : '/projects'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start grant prep');
    }
  }

  if (isLoading || chat.loadingList) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-inset">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cobalt-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="cb-page flex min-h-screen flex-col bg-inset text-ink">
      <Head>
        <title>Funding Finder | GrantGenie</title>
        <meta
          name="description"
          content="Ask for funding opportunities in a conversational AI chat, apply structured filters manually, and get results from the published funding catalog."
        />
      </Head>

      <ResearcherTopBar />

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-4 sm:px-6 lg:px-8">
        {/* Mode switch — the two ways into the same catalog. */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Finder mode" className="flex w-full gap-1 rounded-lg border border-hairline bg-ground p-1 sm:w-auto">
            <button
              type="button"
              role="tab"
              aria-selected={finderTab === 'ai'}
              onClick={() => setFinderTab('ai')}
              className={`cb-tab flex-1 justify-center sm:flex-none ${finderTab === 'ai' ? 'cb-tab-active' : ''}`}
            >
              <MessageSquare className="h-4 w-4" />
              AI advisor
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={finderTab === 'manual'}
              onClick={() => setFinderTab('manual')}
              className={`cb-tab flex-1 justify-center sm:flex-none ${finderTab === 'manual' ? 'cb-tab-active' : ''}`}
            >
              <LibraryBig className="h-4 w-4" />
              Directory
            </button>
          </div>

          <button type="button" onClick={() => setImportModalOpen(true)} className="cb-btn-secondary cb-btn-sm justify-center">
            <Upload className="h-4 w-4" />
            Upload a call
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
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
            getCallDetailsHref={(result) => buildFundingCallDetailHref(result.id)}
            preferences={preferences}
            onChangePreferences={handlePreferenceChange}
          />
        ) : (
          <FinderAiTab
            chat={chat}
            finderContext={finderContext}
            preferences={preferences}
            onPreferencesChange={handlePreferenceChange}
            onBeginWriting={({ resultId }) => handleBeginWritingFromCall(resultId)}
            getCallDetailsHref={buildFundingCallDetailHref}
          />
        )}
      </div>

      {chat.filterDrawerOpen ? (
        <FundingChatFilterDrawer
          filters={chat.filterDraft}
          onChange={chat.setFilterDraft}
          onApply={chat.handleApplyFilters}
          onClearAll={() => chat.setFilterDraft({ ...defaultFilters })}
          onClose={() => chat.setFilterDrawerOpen(false)}
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
