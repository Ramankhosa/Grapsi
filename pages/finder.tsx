import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { LibraryBig, MessageSquare, Upload, ArrowRight } from 'lucide-react';
import FundingWorkspaceHeader, { FundingWorkspaceLink } from '@/components/funding/FundingWorkspaceHeader';
import ResearcherTopBar from '@/components/researcher/ResearcherTopBar';
import FinderAiTab from '@/components/finder/FinderAiTab';
import type { FinderPreferenceValues } from '@/components/FinderPreferencesPanel';
import FundingChatFilterDrawer from '@/components/FundingChatFilterDrawer';
import FundingCallImportModal from '@/components/FundingCallImportModal';
import FundingDirectoryPanel from '@/components/FundingDirectoryPanel';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useFinderChat } from '@/hooks/useFinderChat';
import type { ResearcherFinderContext } from '@/lib/researcherProfile/types';
import { useFundingDirectory } from '@/hooks/useFundingDirectory';
import {
  BASE_DIRECTORY_FILTERS,
  decodeDirectoryFilters,
  encodeDirectoryFilters,
  type DirectoryFilters,
} from '@/lib/recommendations/directoryUrl';
import { useAuth } from '@/lib/auth-context';

type FinderTab = 'manual' | 'ai';

const defaultFilters = BASE_DIRECTORY_FILTERS;

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

const DIRECTORY_URL_KEYS = ['tab', 'q', 'f', 'page'];

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
  const directoryBootRef = useRef(false);
  const directoryNavigationRef = useRef<string | null>(null);
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

  const directory = useFundingDirectory({ authFetch, preferences, onError: setError, onSync: writeDirectoryUrl });

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

  // First load: the address bar may carry a shared search (?tab=directory&q=…&f=…).
  useEffect(() => {
    if (!user || !router.isReady || directoryBootRef.current) return;
    directoryBootRef.current = true;
    setFinderTab(router.query.tab === 'ai' ? 'ai' : 'manual');
    if (router.query.tab === 'ai') return;
    directoryNavigationRef.current = router.asPath;
    const query = typeof router.query.q === 'string' ? router.query.q.slice(0, 300) : '';
    const page = Number(router.query.page) > 1 ? Math.floor(Number(router.query.page)) : 1;
    directory.setQuery(query);
    directory.run({ query, filters: decodeDirectoryFilters(router.query.f), page, syncUrl: false }).catch(() => undefined);
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
      if (!directory.fetched.current || query !== directory.activeQuery || JSON.stringify(filters) !== JSON.stringify(directory.filters) || page !== directory.page) {
        directory.setQuery(query);
        directory.run({ query, filters, page, syncUrl: false }).catch(() => undefined);
      }
    }
    // Navigation changes drive restoration, not each result state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath, router.isReady, user]);

  function handleSelectTab(tab: FinderTab) {
    setFinderTab(tab);
    if (tab === 'manual') {
      writeDirectoryUrl(directory.activeQuery, directory.filters, directory.page);
    } else {
      const kept = Object.fromEntries(Object.entries(router.query).filter(([key]) => !DIRECTORY_URL_KEYS.includes(key)));
      router.replace({ pathname: router.pathname, query: { ...kept, tab: 'ai' } }, undefined, { shallow: true, scroll: false }).catch(() => undefined);
    }
  }

  async function handlePreferenceChange(value: FinderPreferenceValues) {
    setPreferences(value);
    // Preferences rank and badge the results; they never change what
    // matches, so the facet counts stay as they are.
    if (finderTab === 'manual') {
      await directory.run({ prefs: value, page: directory.page, facets: false });
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
    <div className="funding-workspace cb-page flex min-h-screen flex-col">
      <Head>
        <title>Discover funding | Grapsi</title>
        <meta
          name="description"
          content="Ask for funding opportunities in a conversational AI chat, apply structured filters manually, and get results from the published funding catalog."
        />
      </Head>

      <ResearcherTopBar />

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 pb-10 sm:px-6 lg:px-8">
        <FundingWorkspaceHeader section="discovery" title="Find the right funding for your next idea."
          description="Explore open opportunities, narrow down what fits, and move from discovery to a stronger application."
          actions={<FundingWorkspaceLink href="/funding/intelligence">Explore funded research</FundingWorkspaceLink>} />
        {/* Mode switch — the two ways into the same catalog. */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Finder mode" className="flex w-full gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 sm:w-auto"
            onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'manual' : event.key === 'End' ? 'ai' : finderTab === 'manual' ? 'ai' : 'manual'; handleSelectTab(next); document.getElementById(`finder-tab-${next}`)?.focus(); } }}>
            <button type="button" id="finder-tab-manual" role="tab" tabIndex={finderTab === 'manual' ? 0 : -1}
              aria-controls="finder-panel-manual" aria-selected={finderTab === 'manual'} onClick={() => handleSelectTab('manual')}
              className={`cb-tab flex-1 justify-center sm:flex-none ${finderTab === 'manual' ? 'cb-tab-active' : ''}`}>
              <LibraryBig className="h-4 w-4" /><span className="hidden sm:inline">Browse opportunities</span><span className="sm:hidden">Browse calls</span>
            </button>
            <button
              type="button"
              role="tab"
              id="finder-tab-ai"
              tabIndex={finderTab === 'ai' ? 0 : -1}
              aria-controls="finder-panel-ai"
              aria-selected={finderTab === 'ai'}
              onClick={() => handleSelectTab('ai')}
              className={`cb-tab flex-1 justify-center sm:flex-none ${finderTab === 'ai' ? 'cb-tab-active' : ''}`}
            >
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Ask the funding advisor</span><span className="sm:hidden">AI advisor</span>
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
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{error}</span><button type="button" className="inline-flex items-center gap-2 font-semibold" onClick={() => directory.run({ page: directory.page }).catch(() => undefined)}>Try again<ArrowRight className="h-4 w-4" /></button>
          </div>
        ) : null}

        <div id={`finder-panel-${finderTab}`} role="tabpanel" aria-labelledby={`finder-tab-${finderTab}`} tabIndex={0}>
        {finderTab === 'manual' ? (
          <FundingDirectoryPanel
            query={directory.query}
            activeQuery={directory.activeQuery}
            filters={directory.filters}
            facets={directory.facets}
            facetsLoading={directory.facetsLoading}
            loading={directory.loading}
            results={directory.results}
            totalResults={directory.totalResults}
            page={directory.page}
            totalPages={directory.totalPages}
            hasNextPage={directory.hasNextPage}
            hasPreviousPage={directory.hasPreviousPage}
            facetLabels={directory.facetLabels}
            profileCountry={finderContext?.profile?.countryOfResidence || null}
            onQueryChange={directory.setQuery}
            onRunSearch={directory.search}
            onClearQuery={directory.clearQuery}
            onFiltersChange={directory.changeFilters}
            onClearFilters={directory.clearFilters}
            onGoToPage={directory.goToPage}
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
