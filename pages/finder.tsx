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
import { useEntitlements } from '@/hooks/useEntitlements';
import { useFinderChat } from '@/hooks/useFinderChat';
import type { ResearcherFinderContext } from '@/lib/researcherProfile/types';
import type {
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
  importedAreaIds: [],
  lifecycleStatuses: ['OPEN', 'ROLLING'],
  funderIds: [],
  sdgGoals: [],
  programmeFrameworks: [],
  qualifications: [],
  projectDurations: [],
  targetGroups: [],
  indirectCostPolicies: [],
  mobility: [],
  applicationRoutes: [],
  noMembershipNeeded: false,
  deadlineFrom: '',
  deadlineTo: '',
  rollingOnly: false,
  amountMin: null,
  amountMax: null,
  amountCurrency: '',
  includeUnknownAmount: false,
  includeExpired: false,
  limit: 10,
  sort: 'best_match',
};

const manualDefaultFilters: Required<RecommendationSearchFilters> = {
  ...defaultFilters,
  limit: 12,
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

type DirectoryFilters = Required<RecommendationSearchFilters>;
const DIRECTORY_URL_KEYS = ['tab', 'q', 'f', 'page'];

/** The filters that differ from the defaults, for the address bar (null when none). */
function encodeDirectoryFilters(filters: DirectoryFilters): string | null {
  const changed = Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) => key !== 'limit' && JSON.stringify(value) !== JSON.stringify(manualDefaultFilters[key as keyof DirectoryFilters])
    )
  );
  return Object.keys(changed).length > 0 ? JSON.stringify(changed) : null;
}

/** Filters from a shared link: unknown keys and wrongly typed values are ignored. */
function decodeDirectoryFilters(raw: unknown): DirectoryFilters {
  if (typeof raw !== 'string') return manualDefaultFilters;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return manualDefaultFilters;
    const out: Record<string, unknown> = { ...manualDefaultFilters };
    for (const [key, fallback] of Object.entries(manualDefaultFilters)) {
      if (!(key in parsed) || key === 'limit') continue;
      const value = parsed[key];
      const ok = Array.isArray(fallback)
        ? Array.isArray(value) && value.every((item) => typeof item === 'string')
        : fallback === null
          ? value === null || (typeof value === 'number' && Number.isFinite(value))
          : typeof value === typeof fallback;
      if (ok) out[key] = value;
    }
    if (parsed.includeExpired === true && !('lifecycleStatuses' in parsed)) out.lifecycleStatuses = [];
    return out as DirectoryFilters;
  } catch {
    return manualDefaultFilters;
  }
}

export default function FinderPage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();
  const projectId = typeof router.query.projectId === 'string' ? router.query.projectId : null;

  const [finderTab, setFinderTab] = useState<FinderTab>('manual');
  const [preferences, setPreferences] = useState<FinderPreferenceValues>({
    useEligibilityProfile: false,
    usePublicationContext: false,
  });
  const [finderContext, setFinderContext] = useState<ResearcherFinderContext | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [manualActiveQuery, setManualActiveQuery] = useState('');
  // One filter state drives the results, the facet counts and the address
  // bar; facets, pickers and chips all edit it, so no control can drop
  // another's filters.
  const [manualFilters, setManualFilters] = useState<DirectoryFilters>(manualDefaultFilters);
  const [manualResults, setManualResults] = useState<RecommendationRawResultItem[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualPage, setManualPage] = useState(1);
  const [manualTotalPages, setManualTotalPages] = useState(1);
  const [manualTotalResults, setManualTotalResults] = useState(0);
  const [manualHasNextPage, setManualHasNextPage] = useState(false);
  const [manualHasPreviousPage, setManualHasPreviousPage] = useState(false);
  const [directoryFacets, setDirectoryFacets] = useState<DirectoryFacetResponse | null>(null);
  const [directoryFacetsLoading, setDirectoryFacetsLoading] = useState(false);
  const [facetLabels, setFacetLabels] = useState<Record<string, string>>({});
  const directorySeq = useRef(0);
  const directoryBootRef = useRef(false);
  const directoryNavigationRef = useRef<string | null>(null);
  const directoryFetchedRef = useRef(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Grant Studio is plan-gated. When the tenant's plan excludes it, the
  // "begin writing" affordances are hidden rather than 403-ing on click.
  const { hasModule } = useEntitlements();
  const canUseGrantStudio = hasModule('GRANT_STUDIO');
  // Call import mirrors the API gate (OWNER/ADMIN/CALL_ADMIN or platform
  // staff) so a plain researcher never fills the modal only to hit a 403.
  const canUploadCall =
    Boolean(user?.roles?.some((role) => role === 'OWNER' || role === 'ADMIN' || role === 'CALL_ADMIN')) ||
    user?.ati_id === 'PLATFORM';
  const uploadQueryHandledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const chat = useFinderChat({
    authFetch,
    enabled: Boolean(user) && router.isReady && router.query.tab === 'ai',
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

  function writeDirectoryUrl(query: string, filters: DirectoryFilters, page: number) {
    const kept = Object.fromEntries(Object.entries(router.query).filter(([key]) => !DIRECTORY_URL_KEYS.includes(key)));
    const encoded = encodeDirectoryFilters(filters);
    const next = {
      ...kept,
      tab: 'directory',
      ...(query ? { q: query } : {}),
      ...(encoded ? { f: encoded } : {}),
      ...(page > 1 ? { page: String(page) } : {}),
    };
    router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true, scroll: false }).catch(() => undefined);
  }

  /**
   * Loads the directory for a query, filters and page. Facets are reloaded
   * unless only the page or the order changed. A newer request wins: a
   * response that arrives after a later click is dropped.
   */
  async function runDirectory(
    options: { query?: string; filters?: DirectoryFilters; page?: number; prefs?: FinderPreferenceValues; facets?: boolean; syncUrl?: boolean } = {}
  ) {
    const query = options.query ?? manualActiveQuery;
    const filters = options.filters ?? manualFilters;
    const page = options.page ?? 1;
    const prefs = options.prefs ?? preferences;
    const withFacets = options.facets ?? true;
    directoryFetchedRef.current = true;
    const seq = ++directorySeq.current;

    setManualActiveQuery(query);
    setManualPage(page);
    setManualFilters(filters);
    setManualLoading(true);
    if (withFacets) setDirectoryFacetsLoading(true);
    setError(null);
    if (options.syncUrl !== false) writeDirectoryUrl(query, filters, page);

    const listing = apiRequest<RecommendationDirectoryResponse>(authFetch, '/api/recommendations/manual-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        page,
        filters,
        useEligibilityProfile: prefs.useEligibilityProfile,
        usePublicationContext: prefs.usePublicationContext,
      }),
    });
    const facetRequest = withFacets
      ? apiRequest<DirectoryFacetResponse>(authFetch, '/api/recommendations/directory/facets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query || undefined, filters }),
        })
      : null;

    try {
      const response = await listing;
      if (seq !== directorySeq.current) return;
      setManualResults(response.results);
      setManualPage(response.page);
      setManualTotalPages(response.totalPages);
      setManualTotalResults(response.totalResults);
      setManualHasNextPage(response.hasNextPage);
      setManualHasPreviousPage(response.hasPreviousPage);
    } catch (err) {
      if (seq === directorySeq.current) setError(err instanceof Error ? err.message : 'Failed to load funding directory');
    } finally {
      if (seq === directorySeq.current) setManualLoading(false);
    }

    if (!facetRequest) return;
    try {
      const response = await facetRequest;
      if (seq !== directorySeq.current) return;
      setDirectoryFacets(response);
      // Remember labels, so a chosen research area or funder keeps its name
      // in the chips after it drops out of the facet list.
      const learned: Record<string, string> = {};
      for (const [dimension, items] of Object.entries(response.facets)) {
        for (const item of items) {
          const label = dimension === 'taxonomyArea' ? item.level2Name || item.level1Name || item.label : item.label;
          if (label) learned[`${dimension}:${item.value}`] = label;
        }
      }
      setFacetLabels((previous) => ({ ...previous, ...learned }));
    } catch {
      // Facets are non-critical: the results are still right without counts.
    } finally {
      if (seq === directorySeq.current) setDirectoryFacetsLoading(false);
    }
  }

  // First load: the address bar may carry a shared search (?tab=directory&q=…&f=…).
  useEffect(() => {
    if (!user || !router.isReady || directoryBootRef.current) return;
    directoryBootRef.current = true;
    setFinderTab(router.query.tab === 'ai' ? 'ai' : 'manual');
    if (router.query.tab === 'ai') return;
    directoryNavigationRef.current = router.asPath;
    const query = typeof router.query.q === 'string' ? router.query.q.slice(0, 300) : '';
    const page = Number(router.query.page) > 1 ? Math.floor(Number(router.query.page)) : 1;
    setManualQuery(query);
    runDirectory({ query, filters: decodeDirectoryFilters(router.query.f), page, syncUrl: false }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, router.isReady]);

  useEffect(() => {
    if (!user || !router.isReady) return;
    const tab = router.query.tab === 'ai' ? 'ai' : 'manual';
    setFinderTab(tab);
    if (tab === 'manual' && directoryBootRef.current && directoryNavigationRef.current !== router.asPath) {
      directoryNavigationRef.current = router.asPath;
      const query = typeof router.query.q === 'string' ? router.query.q : '';
      const filters = decodeDirectoryFilters(router.query.f);
      const page = Math.max(1, Number(router.query.page) || 1);
      if (!directoryFetchedRef.current || query !== manualActiveQuery || JSON.stringify(filters) !== JSON.stringify(manualFilters) || page !== manualPage) {
        setManualQuery(query);
        runDirectory({query,filters,page,syncUrl:false}).catch(()=>undefined);
      }
    }
    // Navigation changes drive restoration, not each result state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath, router.isReady, user]);

  function handleSelectTab(tab: FinderTab) {
    setFinderTab(tab);
    if (tab === 'manual') {
      writeDirectoryUrl(manualActiveQuery, manualFilters, manualPage);
    } else {
      const kept = Object.fromEntries(Object.entries(router.query).filter(([key]) => !DIRECTORY_URL_KEYS.includes(key)));
      router.replace({ pathname: router.pathname, query: { ...kept, tab: 'ai' } }, undefined, { shallow: true, scroll: false }).catch(() => undefined);
    }
  }

  function handleDirectoryFiltersChange(next: DirectoryFilters) {
    const withoutOrder = (filters: DirectoryFilters) => JSON.stringify({ ...filters, sort: '' });
    runDirectory({ filters: next, facets: withoutOrder(next) !== withoutOrder(manualFilters) }).catch(() => undefined);
  }

  function handleDirectoryClearFilters() {
    runDirectory({ filters: { ...manualDefaultFilters, sort: manualFilters.sort } }).catch(() => undefined);
  }

  function handleManualGoToPage(page: number) {
    if (page === manualPage || page < 1 || page > manualTotalPages) return;
    runDirectory({ page, facets: false }).catch(() => undefined);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDirectorySearch() {
    runDirectory({ query: manualQuery.trim() }).catch(() => undefined);
  }

  function handleDirectoryClearQuery() {
    setManualQuery('');
    runDirectory({ query: '' }).catch(() => undefined);
  }

  async function handlePreferenceChange(value: FinderPreferenceValues) {
    setPreferences(value);
    // Preferences rank and badge the results; they never change what
    // matches, so the facet counts stay as they are.
    if (finderTab === 'manual') {
      await runDirectory({ prefs: value, page: manualPage, facets: false });
    }
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

    // Plan excludes Grant Studio: land on the call instead of starting prep.
    if (!canUseGrantStudio) {
      await router.push(callbackUrl);
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

  if (isLoading || (finderTab === 'ai' && chat.loadingList)) {
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
              onClick={() => handleSelectTab('ai')}
              className={`cb-tab flex-1 justify-center sm:flex-none ${finderTab === 'ai' ? 'cb-tab-active' : ''}`}
            >
              <MessageSquare className="h-4 w-4" />
              AI advisor
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={finderTab === 'manual'}
              onClick={() => handleSelectTab('manual')}
              className={`cb-tab flex-1 justify-center sm:flex-none ${finderTab === 'manual' ? 'cb-tab-active' : ''}`}
            >
              <LibraryBig className="h-4 w-4" />
              Directory
            </button>
          </div>

          {canUploadCall && (
            <button type="button" onClick={() => setImportModalOpen(true)} className="cb-btn-secondary cb-btn-sm justify-center">
              <Upload className="h-4 w-4" />
              Upload a call
            </button>
          )}
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
            {error}
          </div>
        ) : null}

        {finderTab === 'manual' ? (
          <FundingDirectoryPanel
            query={manualQuery}
            activeQuery={manualActiveQuery}
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
            facetLabels={facetLabels}
            profileCountry={finderContext?.profile?.countryOfResidence || null}
            onQueryChange={setManualQuery}
            onRunSearch={handleDirectorySearch}
            onClearQuery={handleDirectoryClearQuery}
            onFiltersChange={handleDirectoryFiltersChange}
            onClearFilters={handleDirectoryClearFilters}
            onGoToPage={handleManualGoToPage}
            onBeginWriting={canUseGrantStudio ? (result) => handleBeginWritingFromCall(result.id) : undefined}
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
            onBeginWriting={canUseGrantStudio ? ({ resultId }) => handleBeginWritingFromCall(resultId) : undefined}
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

      <FundingCallImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onBeginWriting={handleBeginWritingFromCall}
      />
    </div>
  );
}
