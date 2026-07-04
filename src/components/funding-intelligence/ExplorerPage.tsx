'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Building2, ChevronDown, Filter, Landmark, Loader2, MapPin,
  Search, SlidersHorizontal, Sparkles, X, Zap,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import AnalysisHistoryList from './AnalysisHistoryList'
import type { ProjectFacetItem, ProjectFacets, ProjectFilters, ProjectSearchItem, ProjectSearchResponse } from './types'

const EMPTY_FILTERS: ProjectFilters = { sourceKeys: [], states: [], schemes: [], disciplines: [] }
const EMPTY_FACETS: ProjectFacets = { sources: [], years: [], states: [], schemes: [], institutions: [], disciplines: [] }

const SAMPLE_QUERIES = [
  'Parkinson disease and basal ganglia feedback',
  'Metal oxide nanoparticles for water treatment',
  'Retrofitting ageing bridge infrastructure',
]

const SOURCE_STYLES: Record<string, string> = {
  PRISM: 'border-violet-200 bg-violet-50 text-violet-700',
  CSIR: 'border-sky-200 bg-sky-50 text-sky-700',
  BIRAC: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ICMR: 'border-rose-200 bg-rose-50 text-rose-700',
}

function formatBudget(amount: number | null, currency = 'INR') {
  if (amount === null) return null
  if (currency === 'INR') {
    if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(amount >= 100_000_000 ? 0 : 1)} Cr`
    if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(amount >= 1_000_000 ? 0 : 1)} L`
    return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`
  }
  return `${currency} ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`
}

function scorePercent(item: ProjectSearchItem) {
  if (!item.relevanceScore) return null
  return Math.round(Math.max(0, Math.min(1, item.relevanceScore)) * 100)
}

function displayFundingSource(item: Pick<ProjectSearchItem, 'fundingAgency' | 'sourceKey'>) {
  return item.fundingAgency || item.sourceKey
}

function parseList(value: string | null) {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []
}

function parseYear(value: string | null) {
  const year = Number(value)
  return Number.isFinite(year) && year > 0 ? year : undefined
}

function readFilters(searchParams: { get(name: string): string | null } | null | undefined): ProjectFilters {
  return {
    sourceKeys: parseList(searchParams?.get('source') || null),
    states: parseList(searchParams?.get('state') || null),
    schemes: parseList(searchParams?.get('scheme') || null),
    disciplines: parseList(searchParams?.get('discipline') || null),
    yearFrom: parseYear(searchParams?.get('from') || null),
    yearTo: parseYear(searchParams?.get('to') || null),
  }
}

function readSort(searchParams: { get(name: string): string | null } | null | undefined): ProjectSearchResponse['sort'] {
  const value = searchParams?.get('sort')
  return value === 'newest' || value === 'largest_budget' || value === 'relevance' ? value : 'relevance'
}

function writeList(params: URLSearchParams, key: string, values: string[]) {
  if (values.length) params.set(key, values.join(','))
}

function FilterSection({
  label, items, selected, onToggle, initialOpen = true,
}: {
  label: string
  items: ProjectFacetItem[]
  selected: string[]
  onToggle: (value: string) => void
  initialOpen?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)
  const visibleItems = items.slice(0, 10)
  if (!items.length) return null

  return (
    <div className="border-b border-slate-200 py-4 last:border-0">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-3 space-y-1.5">
          {visibleItems.map((item) => {
            const value = String(item.value)
            const active = selected.includes(value)
            return (
              <label key={value} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggle(value)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="min-w-0 flex-1 truncate text-slate-600">{value}</span>
                <span className="text-xs tabular-nums text-slate-400">{item.count}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function FiltersPanel({ facets, filters, onChange, onClear }: {
  facets: ProjectFacets
  filters: ProjectFilters
  onChange: (filters: ProjectFilters) => void
  onClear: () => void
}) {
  const toggle = (key: 'sourceKeys' | 'states' | 'schemes' | 'disciplines', value: string) => {
    const current = filters[key]
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] })
  }
  const years = facets.years.map((item) => Number(item.value)).filter(Number.isFinite)
  const minYear = years.length ? Math.min(...years) : 2000
  const maxYear = years.length ? Math.max(...years) : new Date().getFullYear()
  const activeCount = filters.sourceKeys.length + filters.states.length + filters.schemes.length + filters.disciplines.length + Number(Boolean(filters.yearFrom || filters.yearTo))

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-teal-700" />
          <span className="font-semibold text-slate-900">Refine results</span>
          {activeCount ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">{activeCount}</span> : null}
        </div>
        {activeCount ? <button type="button" onClick={onClear} className="text-xs font-semibold text-teal-700 hover:text-teal-900">Clear all</button> : null}
      </div>

      {years.length ? (
        <div className="border-b border-slate-200 py-4">
          <p className="text-sm font-semibold text-slate-800">Sanction year</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">From
              <select value={filters.yearFrom || ''} onChange={(event) => onChange({ ...filters, yearFrom: event.target.value ? Number(event.target.value) : undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100">
                <option value="">{minYear}</option>
                {years.sort((a, b) => a - b).map((year) => <option key={year}>{year}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">To
              <select value={filters.yearTo || ''} onChange={(event) => onChange({ ...filters, yearTo: event.target.value ? Number(event.target.value) : undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100">
                <option value="">{maxYear}</option>
                {years.sort((a, b) => b - a).map((year) => <option key={year}>{year}</option>)}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      <FilterSection label="Funding source" items={facets.sources} selected={filters.sourceKeys} onToggle={(value) => toggle('sourceKeys', value)} />
      <FilterSection label="State" items={facets.states} selected={filters.states} onToggle={(value) => toggle('states', value)} />
      <FilterSection label="Scheme" items={facets.schemes} selected={filters.schemes} onToggle={(value) => toggle('schemes', value)} initialOpen={false} />
      <FilterSection label="Discipline" items={facets.disciplines} selected={filters.disciplines} onToggle={(value) => toggle('disciplines', value)} initialOpen={false} />
    </div>
  )
}

function ResultSkeleton() {
  return <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5"><div className="h-5 w-3/4 rounded bg-slate-200" /><div className="mt-4 h-3 w-1/2 rounded bg-slate-100" /><div className="mt-5 space-y-2"><div className="h-3 rounded bg-slate-100" /><div className="h-3 w-5/6 rounded bg-slate-100" /></div></div>
}

function ResultCard({ item }: { item: ProjectSearchItem }) {
  const score = scorePercent(item)
  const summary = item.abstractText && item.abstractText.toUpperCase() !== 'NA' ? item.abstractText : item.executiveSummary
  const fundingSource = displayFundingSource(item)
  return (
    <article className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-lg hover:shadow-teal-950/5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${SOURCE_STYLES[item.sourceKey] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>{fundingSource}</span>
        {item.sanctionYear ? <span className="text-xs font-medium text-slate-500">Funded in {item.sanctionYear}</span> : null}
        {item.schemeName ? <span className="max-w-[240px] truncate rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{item.schemeName}</span> : null}
        {score !== null ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-teal-700"><Zap className="h-3.5 w-3.5" />{score}% match</span>
        ) : null}
      </div>

      <Link href={`/funding/intelligence/projects/${item.id}`} className="mt-3 block text-lg font-semibold leading-snug text-slate-900 transition group-hover:text-teal-800 sm:text-xl">
        {item.title}
      </Link>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
        {item.primaryInvestigatorName ? <span className="flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" />{item.primaryInvestigatorName}</span> : null}
        {item.primaryInstitutionName ? <span className="flex min-w-0 items-center gap-1.5"><Building2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{item.primaryInstitutionName}</span></span> : null}
        {item.state ? <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{item.state}</span> : null}
      </div>

      {summary ? <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">{summary}</p> : <p className="mt-4 text-sm italic text-slate-400">Detailed abstract is not available from this source.</p>}

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <span className="text-sm font-semibold text-slate-800">{formatBudget(item.budgetAmount, item.budgetCurrency || 'INR') || 'Budget not reported'}</span>
        <Link href={`/funding/intelligence/projects/${item.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-900">View evidence <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </article>
  )
}

export default function ExplorerPage() {
  const { token, user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams?.get('q') || ''
  const sort = searchParams?.get('sort') ? readSort(searchParams) : (query ? 'relevance' : 'newest')
  const filters = useMemo(() => readFilters(searchParams), [searchParams])
  const [draftQuery, setDraftQuery] = useState(query)
  const [data, setData] = useState<ProjectSearchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mobileFilters, setMobileFilters] = useState(false)

  const activeFilterCount = useMemo(() => filters.sourceKeys.length + filters.states.length + filters.schemes.length + filters.disciplines.length + Number(Boolean(filters.yearFrom || filters.yearTo)), [filters])

  const updateUrlState = useCallback((nextQuery: string, nextFilters: ProjectFilters, nextSort = sort) => {
    const params = new URLSearchParams()
    if (nextQuery) params.set('q', nextQuery)
    const effectiveSort = nextQuery ? nextSort : (nextSort === 'relevance' ? 'newest' : nextSort)
    if (effectiveSort !== (nextQuery ? 'relevance' : 'newest')) params.set('sort', effectiveSort)
    writeList(params, 'source', nextFilters.sourceKeys)
    writeList(params, 'state', nextFilters.states)
    writeList(params, 'scheme', nextFilters.schemes)
    writeList(params, 'discipline', nextFilters.disciplines)
    if (nextFilters.yearFrom) params.set('from', String(nextFilters.yearFrom))
    if (nextFilters.yearTo) params.set('to', String(nextFilters.yearTo))

    const next = params.toString()
    const current = searchParams?.toString() || ''
    if (next !== current) {
      const currentPath = pathname || '/funding/intelligence'
      router.replace(next ? `${currentPath}?${next}` : currentPath, { scroll: false })
    }
  }, [pathname, router, searchParams, sort])

  useEffect(() => { setDraftQuery(query) }, [query])

  const runSearch = useCallback(async (searchQuery: string, nextFilters: ProjectFilters, nextSort: ProjectSearchResponse['sort'], offset = 0, append = false) => {
    if (!token) return
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/project-intelligence/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, filters: nextFilters, limit: 20, offset, sort: nextSort }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Search failed')
      setData((current) => {
        if (!append || !current) return body
        const seen = new Set(current.results.map((item) => item.id))
        const nextResults = [...current.results, ...body.results.filter((item: ProjectSearchItem) => !seen.has(item.id))]
        return { ...body, results: nextResults }
      })
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Search failed')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [token])

  useEffect(() => { void runSearch(query, filters, sort) }, [filters, query, runSearch, sort])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    updateUrlState(draftQuery.trim(), filters)
  }

  const chooseSample = (sample: string) => {
    setDraftQuery(sample)
    updateUrlState(sample, filters)
  }
  const clearFilters = () => updateUrlState(query, EMPTY_FILTERS)
  const updateSort = (nextSort: ProjectSearchResponse['sort']) => updateUrlState(query, filters, nextSort)
  const approximateTotal = data?.approximateTotal ?? data?.results.length ?? 0
  const hasMore = Boolean(data && data.results.length < approximateTotal)
  const loadMore = () => {
    if (!data || loadingMore) return
    void runSearch(query, filters, sort, data.results.length, true)
  }

  if (authLoading) return <div className="min-h-[70vh] bg-slate-50 p-8 text-sm text-slate-500">Loading funding intelligence…</div>
  if (!user || !token) return <div className="flex min-h-[70vh] items-center justify-center bg-slate-50 p-6"><div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><Sparkles className="mx-auto h-8 w-8 text-teal-700" /><h1 className="mt-4 text-xl font-semibold text-slate-900">Sign in to explore funding intelligence</h1><Link href="/login" className="mt-5 inline-flex rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white">Sign in</Link></div></div>

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <section className="relative overflow-hidden border-b border-teal-950/10 bg-[#082f32] text-white">
        <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="absolute -bottom-36 left-1/4 h-72 w-72 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-teal-200"><Sparkles className="h-4 w-4" /> Funding intelligence</div>
              <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">See what gets funded. Position what comes next.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-teal-50/75 sm:text-base">Search awarded research by meaning, not just keywords. Compare ideas with real funding evidence and discover the strongest positioning angle.</p>
            </div>
            <Link href="/funding/intelligence/idea/new" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"><Sparkles className="h-4 w-4" /> Analyze an idea</Link>
          </div>

          <form onSubmit={submit} className="mt-8 flex max-w-4xl flex-col gap-2 rounded-2xl border border-white/15 bg-white p-2 shadow-2xl shadow-black/20 sm:flex-row">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-3">
              <Search className="h-5 w-5 shrink-0 text-slate-400" />
              <input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Describe a research topic or paste your idea…" className="h-12 min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 sm:text-base" />
              {draftQuery ? <button type="button" onClick={() => setDraftQuery('')} className="rounded-full p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button> : null}
            </div>
            <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-teal-700 px-6 text-sm font-semibold text-white transition hover:bg-teal-800"><Search className="h-4 w-4" /> Search landscape</button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-teal-50/70"><span>Try:</span>{SAMPLE_QUERIES.map((sample) => <button type="button" key={sample} onClick={() => chooseSample(sample)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 transition hover:bg-white/10">{sample}</button>)}</div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {data?.degradedMode ? <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><Zap className="mt-0.5 h-4 w-4 shrink-0" /><span>Semantic search is temporarily unavailable. Results are based on keyword evidence.</span></div> : null}
        {error ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

        <div className="mb-5 flex items-center justify-between gap-3 lg:hidden">
          <button type="button" onClick={() => setMobileFilters(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm"><Filter className="h-4 w-4" /> Filters {activeFilterCount ? <span className="rounded-full bg-teal-100 px-1.5 text-xs text-teal-800">{activeFilterCount}</span> : null}</button>
          <span className="text-sm text-slate-500">{loading ? 'Searching…' : `${data?.results.length || 0} of ${approximateTotal || 0}`}</span>
        </div>

        <div className="mb-5 lg:hidden">
          <AnalysisHistoryList token={token} compact />
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden self-start space-y-5 lg:sticky lg:top-5 lg:block">
            <AnalysisHistoryList token={token} compact />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <FiltersPanel facets={data?.facets || EMPTY_FACETS} filters={filters} onChange={(nextFilters) => updateUrlState(query, nextFilters)} onClear={clearFilters} />
            </div>
          </aside>

          <section>
            <div className="mb-4 hidden items-end justify-between gap-4 lg:flex">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Awarded research</p><h2 className="mt-1 text-2xl font-semibold text-slate-900">{query ? 'Evidence matched to your topic' : 'Recently funded projects'}</h2><p className="mt-1 text-sm text-slate-500">{loading ? 'Searching the corpus…' : `Showing ${data?.results.length || 0} of ${query ? `top ~${approximateTotal}` : approximateTotal} projects`}</p></div>
              <label className="text-xs font-semibold text-slate-500">Sort
                <select value={sort} onChange={(event) => updateSort(event.target.value as ProjectSearchResponse['sort'])} className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-teal-500">
                  {query ? <option value="relevance">Relevance</option> : null}
                  <option value="newest">Newest</option>
                  <option value="largest_budget">Largest budget</option>
                </select>
              </label>
            </div>

            {loading ? <div className="space-y-4"><ResultSkeleton /><ResultSkeleton /><ResultSkeleton /></div> : null}
            {!loading && data?.results.length ? <div className="space-y-4">{data.results.map((item) => <ResultCard key={item.id} item={item} />)}</div> : null}
            {!loading && hasMore ? (
              <div className="mt-5 flex justify-center">
                <button type="button" onClick={loadMore} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400">
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Load more
                </button>
              </div>
            ) : null}
            {!loading && !data?.results.length && !error ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><Search className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-4 text-lg font-semibold text-slate-900">No matching projects found</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Try a broader description or remove one of the filters. Semantic search works best with a one- or two-sentence research description.</p>{activeFilterCount ? <button type="button" onClick={clearFilters} className="mt-5 text-sm font-semibold text-teal-700">Clear filters</button> : null}</div>
            ) : null}
          </section>
        </div>
      </div>

      {mobileFilters ? <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close filters" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setMobileFilters(false)} /><div className="absolute inset-y-0 right-0 w-[88%] max-w-sm overflow-y-auto bg-white p-5 shadow-2xl"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Filters</h2><button type="button" onClick={() => setMobileFilters(false)} className="rounded-full p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><FiltersPanel facets={data?.facets || EMPTY_FACETS} filters={filters} onChange={(nextFilters) => updateUrlState(query, nextFilters)} onClear={clearFilters} /><button type="button" onClick={() => setMobileFilters(false)} className="sticky bottom-3 mt-5 w-full rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white">Show results</button></div></div> : null}
    </main>
  )
}
