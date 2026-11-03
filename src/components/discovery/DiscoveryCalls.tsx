'use client'

import { useEffect, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import FundingDirectoryPanel from '@/components/FundingDirectoryPanel'
import { useFundingDirectory } from '@/hooks/useFundingDirectory'
import { useAuth } from '@/lib/auth-context'
import { decodeDirectoryFilters, encodeDirectoryFilters } from '@/lib/recommendations/directoryUrl'
import type { RecommendationRawResultItem } from '@/lib/recommendations/types'
import { discoverySearchLink, type DiscoveryQuery } from '@/lib/discovery/types'

export default function DiscoveryCalls({ state, onChange, onOpenCall, onFindPeople }: {
  state: DiscoveryQuery; onChange: (patch: Partial<DiscoveryQuery>) => void
  onOpenCall: (call: { id: string; title: string }) => void
  onFindPeople?: (call: { id: string; title: string }) => void
}) {
  const { authFetch } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [preferences, setPreferences] = useState({ useEligibilityProfile: false, usePublicationContext: false })
  const semantic = state.callMode === 'semantic'
  const requests = useRef(0)
  const directory = useFundingDirectory({ authFetch, preferences, onError: setError,
    onSync: (query, filters, page) => {
      const patch = { callQuery: query, callFilters: encodeDirectoryFilters(filters), callPage: page }
      onChange(patch)
      window.history.pushState({}, '', discoverySearchLink({ ...state, ...patch }))
    },
    facetQuery: semantic ? () => '' : undefined,
    loadListing: semantic ? async ({ query, filters }) => {
      const sequence = ++requests.current
      setWarning(null)
      if (!query.trim()) { setSearched(false); return { query, appliedFilters: filters, pageSize: 50, results: [], totalResults: 0, page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false } }
      setSearched(true)
      if (query.trim().length < 3) throw new Error('Describe your research in at least 3 characters.')
      const response = await authFetch('/api/discovery/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'semantic', query: query.trim(), filters }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Suggestions could not be loaded.')
      if (sequence === requests.current) setWarning(payload.warning || null)
      return { query, appliedFilters: filters, pageSize: 50, results: payload.calls || [], totalResults: payload.total, page: 1, totalPages: 1,
        hasNextPage: false, hasPreviousPage: false }
    } : undefined,
  })
  useEffect(() => {
    directory.setQuery(state.callQuery)
    void directory.run({ query: state.callQuery, filters: decodeDirectoryFilters(state.callFilters), page: state.callPage, syncUrl: false })
    return () => { requests.current += 1 }
    // Initialise once; subsequent searches are panel actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const select = (result: RecommendationRawResultItem) => ({ id: result.id, title: result.schemeTitle })
  return <div>
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error} <button type="button" className="underline" onClick={directory.search}>Retry</button></div>}
    {warning && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>}
    <FundingDirectoryPanel query={directory.query} activeQuery={directory.activeQuery} filters={directory.filters}
      facets={directory.facets} facetsLoading={directory.facetsLoading} loading={directory.loading} results={directory.results}
      totalResults={directory.totalResults} page={directory.page} totalPages={directory.totalPages}
      hasNextPage={directory.hasNextPage} hasPreviousPage={directory.hasPreviousPage} facetLabels={directory.facetLabels}
      onQueryChange={value => { directory.setQuery(value); onChange({ callQuery: value }) }} onRunSearch={directory.search}
      onClearQuery={directory.clearQuery} onFiltersChange={directory.changeFilters} onClearFilters={directory.clearFilters} onGoToPage={directory.goToPage}
      preferences={preferences} onChangePreferences={next => { setPreferences(next); void directory.run({ prefs: next, facets: false }) }}
      showPreferences={!semantic} onOpenDetails={result => onOpenCall(select(result))}
      renderResultActions={onFindPeople ? result => <button type="button" className="cb-btn-secondary cb-btn-sm" onClick={() => onFindPeople(select(result))}><Users className="h-3.5 w-3.5" aria-hidden />Find aligned people</button> : undefined}
      searchHeader={<fieldset className="mb-4"><legend className="cb-eyebrow mb-2">Find funding</legend><div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {(['directory', 'semantic'] as const).map(mode => <label key={mode} className="flex min-h-10 cursor-pointer items-center gap-2"><input type="radio" name="call-mode" checked={state.callMode === mode}
          onChange={() => onChange({ callMode: mode, callPage: 1 })} className="accent-blue-600" />{mode === 'directory' ? 'Search the directory' : 'Describe your research'}</label>)}</div></fieldset>}
      searchCopy={semantic ? { label: 'Describe your research', placeholder: 'e.g. low-cost biosensors for early cancer detection', submit: 'Find suggestions',
        help: 'Related research, ranked by meaning. Every selected directory filter still applies. Research fit does not confirm eligibility.' } : undefined}
      resultSummary={semantic ? `${directory.totalResults} research suggestions · top results, up to 50 · not an exhaustive count` : undefined}
      emptyState={semantic && !searched ? <div className="cb-card p-8"><h2 className="font-semibold">Start with your research</h2><p className="cb-hint mt-2">Describe a question, project or area of expertise to explore related funding.</p></div> : undefined}
    />
  </div>
}
