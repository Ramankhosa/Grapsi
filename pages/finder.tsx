import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaArrowLeft, FaSignOutAlt, FaUpload } from 'react-icons/fa';
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
  const { user, isLoading, authFetch, logout } = useAuth();
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
          content="Ask for funding opportunities in a conversational AI chat, apply structured filters manually, and get results from the published funding catalog."
        />
      </Head>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={projectId ? `/projects/${encodeURIComponent(projectId)}` : '/dashboard'} className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 transition-colors hover:text-emerald-950">
              <FaArrowLeft />
              {projectId ? 'Back to Project' : 'Back to Dashboard'}
            </Link>
            <Link href="/profile/researcher" className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition-colors hover:border-emerald-300">
              Research Profile
            </Link>
            <Link href="/profile/research-fit" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:text-emerald-800">
              Research Fit
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
                Browse the funding directory by research area, country, and funding type — or switch to the AI advisor to describe your needs in plain English, ask about a call&apos;s documents, and talk through strategy.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
              {chat.activeRun ? `${chat.activeRun.results.length} results in the current search` : 'Start a conversation to search'}
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
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
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-900 transition-colors hover:bg-emerald-100"
          >
            <FaUpload />
            Upload New Call For Proposal
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
