import { useRef, useState } from 'react';

import type { FinderPreferenceValues } from '@/components/FinderPreferencesPanel';
import { DIRECTORY_DEFAULT_FILTERS, type DirectoryFilters } from '@/lib/recommendations/directoryUrl';
import type {
  DirectoryFacetResponse,
  RecommendationDirectoryResponse,
  RecommendationRawResultItem,
} from '@/lib/recommendations/types';

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

async function apiRequest<T>(authFetch: AuthFetch, url: string, options?: RequestInit): Promise<T> {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.details || payload?.message || 'Request failed');
  }
  return payload as T;
}

export interface DirectoryRunOptions {
  query?: string;
  filters?: DirectoryFilters;
  page?: number;
  prefs?: FinderPreferenceValues;
  facets?: boolean;
  syncUrl?: boolean;
}

/**
 * The funding directory's state: one filter state drives the results, the
 * facet counts and the address bar, so facets, pickers and chips all edit it
 * and no control can drop another's filters. Shared by the Finder and
 * Research Discovery; each page decides how the address bar is written.
 */
export function useFundingDirectory({
  authFetch,
  preferences,
  onError,
  onSync,
}: {
  authFetch: AuthFetch;
  preferences: FinderPreferenceValues;
  onError: (message: string | null) => void;
  /** Write the address bar for this query, filters and page. */
  onSync?: (query: string, filters: DirectoryFilters, page: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [filters, setFilters] = useState<DirectoryFilters>(DIRECTORY_DEFAULT_FILTERS);
  const [results, setResults] = useState<RecommendationRawResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPreviousPage, setHasPreviousPage] = useState(false);
  const [facets, setFacets] = useState<DirectoryFacetResponse | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const [facetLabels, setFacetLabels] = useState<Record<string, string>>({});
  const seq = useRef(0);
  const fetched = useRef(false);

  /**
   * Loads the directory for a query, filters and page. Facets are reloaded
   * unless only the page or the order changed. A newer request wins: a
   * response that arrives after a later click is dropped.
   */
  async function run(options: DirectoryRunOptions = {}) {
    const nextQuery = options.query ?? activeQuery;
    const nextFilters = options.filters ?? filters;
    const nextPage = options.page ?? 1;
    const prefs = options.prefs ?? preferences;
    const withFacets = options.facets ?? true;
    fetched.current = true;
    const current = ++seq.current;

    setActiveQuery(nextQuery);
    setPage(nextPage);
    setFilters(nextFilters);
    setLoading(true);
    if (withFacets) setFacetsLoading(true);
    onError(null);
    if (options.syncUrl !== false) onSync?.(nextQuery, nextFilters, nextPage);

    const listing = apiRequest<RecommendationDirectoryResponse>(authFetch, '/api/recommendations/manual-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: nextQuery,
        page: nextPage,
        filters: nextFilters,
        useEligibilityProfile: prefs.useEligibilityProfile,
        usePublicationContext: prefs.usePublicationContext,
      }),
    });
    const facetRequest = withFacets
      ? apiRequest<DirectoryFacetResponse>(authFetch, '/api/recommendations/directory/facets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: nextQuery || undefined, filters: nextFilters }),
        })
      : null;

    try {
      const response = await listing;
      if (current !== seq.current) return;
      setResults(response.results);
      setPage(response.page);
      setTotalPages(response.totalPages);
      setTotalResults(response.totalResults);
      setHasNextPage(response.hasNextPage);
      setHasPreviousPage(response.hasPreviousPage);
    } catch (err) {
      if (current === seq.current) {
        setResults([]);
        setTotalResults(0);
        onError(err instanceof Error ? err.message : 'Failed to load funding directory');
      }
    } finally {
      if (current === seq.current) setLoading(false);
    }

    if (!facetRequest) return;
    try {
      const response = await facetRequest;
      if (current !== seq.current) return;
      setFacets(response);
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
      if (current === seq.current) setFacetsLoading(false);
    }
  }

  function changeFilters(next: DirectoryFilters) {
    const withoutOrder = (value: DirectoryFilters) => JSON.stringify({ ...value, sort: '' });
    run({ filters: next, facets: withoutOrder(next) !== withoutOrder(filters) }).catch(() => undefined);
  }

  function clearFilters() {
    run({ filters: { ...DIRECTORY_DEFAULT_FILTERS, sort: filters.sort } }).catch(() => undefined);
  }

  function goToPage(next: number) {
    if (next === page || next < 1 || next > totalPages) return;
    run({ page: next, facets: false }).catch(() => undefined);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function search() {
    run({ query: query.trim() }).catch(() => undefined);
  }

  function clearQuery() {
    setQuery('');
    run({ query: '' }).catch(() => undefined);
  }

  return {
    query, setQuery, activeQuery, filters, results, loading, page, totalPages, totalResults,
    hasNextPage, hasPreviousPage, facets, facetsLoading, facetLabels, fetched,
    run, changeFilters, clearFilters, goToPage, search, clearQuery,
  };
}
