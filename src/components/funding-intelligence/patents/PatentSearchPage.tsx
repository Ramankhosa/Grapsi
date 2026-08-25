'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Bookmark, FileSearch, Filter, Info, Loader2, RefreshCw, Search, Sparkles, X,
} from 'lucide-react'

import { useAuth } from '@/lib/auth-context'
import {
  EMPTY_PATENT_FILTERS,
  PATENT_QUERY_BOUNDS,
  PATENT_SEARCH_LIMITS,
  PATENT_SEARCH_LIMIT_CHOICES,
  applyPatentFilters,
  clampLimit,
  countActivePatentFilters,
  readPatentFiltersFromParams,
  readPatentSort,
  sortPatents,
  tokenizeHighlightTerms,
  writePatentFiltersToParams,
} from '@/lib/patentIntelligence/searchCore'
import type { PatentFilters, PatentSearchResponse, PatentSort } from '@/lib/patentIntelligence/types'
import PatentCoverageLine from './PatentCoverageLine'
import PatentFacetsPanel from './PatentFacetsPanel'
import PatentResultCard from './PatentResultCard'
import ShortlistDrawer from './ShortlistDrawer'
import ShortlistRail from './ShortlistRail'
import { describePatentError, formatCountdown, type PatentErrorCopy } from './patentErrorCopy'
import { authHeaders, usePatentShortlist } from './usePatentShortlist'

const SAMPLE_QUERIES = [
  'Low-cost electrochemical biosensor for point-of-care diagnostics in rural clinics',
  'Graphene-oxide membrane for arsenic removal from groundwater',
  'Drone-based crop stress detection using multispectral imaging',
]

const TONE_STYLES: Record<PatentErrorCopy['tone'], string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
}

function ResultSkeleton() {
  return <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5"><div className="h-4 w-1/3 rounded bg-slate-100" /><div className="mt-3 h-5 w-3/4 rounded bg-slate-200" /><div className="mt-4 h-3 w-1/2 rounded bg-slate-100" /><div className="mt-5 space-y-2"><div className="h-3 rounded bg-slate-100" /><div className="h-3 w-5/6 rounded bg-slate-100" /><div className="h-3 w-2/3 rounded bg-slate-100" /></div></div>
}

function ErrorBanner({ copy, countdown, onRetry }: { copy: PatentErrorCopy; countdown: number | null; onRetry?: () => void }) {
  const Icon = copy.tone === 'info' ? Info : AlertTriangle
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${TONE_STYLES[copy.tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{copy.title}</p>
        <p className="mt-0.5 leading-6 opacity-90">{copy.detail}{countdown ? ` Try again in ${formatCountdown(countdown)}.` : ''}</p>
        {copy.requestId ? <p className="mt-1 font-mono text-[11px] opacity-70">Request ID: {copy.requestId}</p> : null}
      </div>
      {onRetry && !copy.disablesSearch ? (
        <button type="button" onClick={onRetry} disabled={Boolean(countdown)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-current/20 px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
      ) : null}
    </div>
  )
}

export default function PatentSearchPage() {
  const { token, user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const query = searchParams?.get('q')?.trim() || ''
  const limit = clampLimit(searchParams?.get('n') || PATENT_SEARCH_LIMITS.default)
  const sort = readPatentSort(searchParams?.get('sort'))
  const runId = searchParams?.get('runId')?.trim() || null
  const filters = useMemo(() => readPatentFiltersFromParams((key) => searchParams?.get(key) ?? null), [searchParams])
  const contextParams = searchParams?.toString() || ''

  const [draftQuery, setDraftQuery] = useState(query)
  const [data, setData] = useState<PatentSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorCopy, setErrorCopy] = useState<PatentErrorCopy | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [mobileFilters, setMobileFilters] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(searchParams?.get('shortlist') === '1')
  const [runTitle, setRunTitle] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const shortlist = usePatentShortlist(token)
  const terms = useMemo(() => tokenizeHighlightTerms(query), [query])
  const activeFilterCount = countActivePatentFilters(filters)
  const visible = useMemo(() => sortPatents(applyPatentFilters(data?.results || [], filters), sort), [data, filters, sort])
  const searchDisabled = Boolean(errorCopy?.disablesSearch)

  const updateUrlState = useCallback((next: { query?: string; limit?: number; sort?: PatentSort; filters?: PatentFilters; shortlist?: boolean }) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    const nextQuery = next.query ?? query
    if (nextQuery) params.set('q', nextQuery)
    else params.delete('q')
    const nextLimit = next.limit ?? limit
    if (nextLimit !== PATENT_SEARCH_LIMITS.default) params.set('n', String(nextLimit))
    else params.delete('n')
    const nextSort = next.sort ?? sort
    if (nextSort !== 'relevance') params.set('sort', nextSort)
    else params.delete('sort')
    writePatentFiltersToParams(params, next.filters ?? filters)
    if (next.shortlist !== undefined) {
      if (next.shortlist) params.set('shortlist', '1')
      else params.delete('shortlist')
    }
    const serialized = params.toString()
    if (serialized !== (searchParams?.toString() || '')) {
      const currentPath = pathname || '/funding/intelligence/patents'
      router.replace(serialized ? `${currentPath}?${serialized}` : currentPath, { scroll: false })
    }
  }, [filters, limit, pathname, query, router, searchParams, sort])

  useEffect(() => { setDraftQuery(query) }, [query])

  // Auto-grow the textarea with the pasted idea, within reason.
  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(220, Math.max(52, node.scrollHeight))}px`
  }, [draftQuery])

  useEffect(() => {
    if (!countdown) return
    const timer = setInterval(() => setCountdown((value) => (value && value > 1 ? value - 1 : null)), 1000)
    return () => clearInterval(timer)
  }, [countdown])

  useEffect(() => {
    if (!token || !runId) { setRunTitle(null); return }
    let cancelled = false
    fetch(`/api/idea-intelligence/${encodeURIComponent(runId)}`, { headers: authHeaders(token), cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setRunTitle(body?.run?.title || body?.title || null) })
      .catch(() => { if (!cancelled) setRunTitle(null) })
    return () => { cancelled = true }
  }, [runId, token])

  const runSearch = useCallback(async (searchQuery: string, searchLimit: number) => {
    if (!token || !searchQuery) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setErrorCopy(null)
    setCountdown(null)
    try {
      const response = await fetch('/api/patent-intelligence/search', {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify({ query: searchQuery, limit: searchLimit }),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const copy = describePatentError(body, response.status)
        setErrorCopy(copy)
        if (copy.retryAfterSeconds) setCountdown(copy.retryAfterSeconds)
        setData(null)
        return
      }
      setData(body as PatentSearchResponse)
    } catch (searchError) {
      if ((searchError as Error)?.name === 'AbortError') return
      setErrorCopy({ code: 'NETWORK', tone: 'error', title: 'Patent search failed.', detail: 'Check your connection and try again.' })
      setData(null)
    } finally {
      if (abortRef.current === controller) setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!query) { setData(null); setErrorCopy(null); return }
    void runSearch(query, limit)
  }, [limit, query, runSearch])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = draftQuery.replace(/\s+/g, ' ').trim()
    if (next.length < PATENT_QUERY_BOUNDS.min) return
    if (next === query) { void runSearch(next, limit); return }
    updateUrlState({ query: next.slice(0, PATENT_QUERY_BOUNDS.max), filters: EMPTY_PATENT_FILTERS })
  }
  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }
  const chooseSample = (sample: string) => {
    setDraftQuery(sample)
    updateUrlState({ query: sample, filters: EMPTY_PATENT_FILTERS })
  }
  const clearFilters = () => updateUrlState({ filters: EMPTY_PATENT_FILTERS })
  const openDrawer = () => { setDrawerOpen(true); updateUrlState({ shortlist: true }) }
  const closeDrawer = useCallback(() => { setDrawerOpen(false); updateUrlState({ shortlist: false }) }, [updateUrlState])
  const detailHref = (publicationNumber: string) => `/funding/intelligence/patents/${encodeURIComponent(publicationNumber)}${contextParams ? `?${contextParams}` : ''}`

  if (authLoading) return <div className="min-h-[70vh] bg-slate-50 p-8 text-sm text-slate-500">Loading patent search…</div>
  if (!user || !token) return <div className="flex min-h-[70vh] items-center justify-center bg-slate-50 p-6"><div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><FileSearch className="mx-auto h-8 w-8 text-teal-700" /><h1 className="mt-4 text-xl font-semibold text-slate-900">Sign in to search patents</h1><Link href="/login" className="mt-5 inline-flex rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white">Sign in</Link></div></div>

  const resultCount = data?.results.length || 0
  const draftLength = Array.from(draftQuery).length

  return (
    <main className="min-h-screen bg-[#f6f8f7] text-slate-900">
      <section className="relative overflow-hidden border-b border-teal-950/10 bg-[#082f32] text-white">
        <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="absolute -bottom-36 left-1/4 h-72 w-72 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-teal-200"><Sparkles className="h-4 w-4" /> Funding intelligence · Patent search</div>
              <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">Find the patents your proposal has to answer to.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-teal-50/75 sm:text-base">Paste a paragraph of your idea or a few technical phrases. Results come from PatentNest and are ranked by meaning, not keyword overlap — save the ones worth citing.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/funding/intelligence" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"><ArrowLeft className="h-4 w-4" /> Back to landscape</Link>
              <button type="button" onClick={openDrawer} className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"><Bookmark className="h-4 w-4" /> Shortlist <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs tabular-nums">{shortlist.items.length}</span></button>
            </div>
          </div>

          <form onSubmit={submit} role="search" className="mt-8 flex max-w-4xl flex-col gap-2 rounded-2xl border border-white/15 bg-white p-2 shadow-2xl shadow-black/20 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2">
              <Search className="mt-2.5 h-5 w-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <label htmlFor="patent-query" className="sr-only">Describe the invention or research idea</label>
                <textarea
                  id="patent-query"
                  ref={textareaRef}
                  value={draftQuery}
                  onChange={(event) => setDraftQuery(event.target.value)}
                  onKeyDown={onTextareaKeyDown}
                  maxLength={PATENT_QUERY_BOUNDS.max}
                  rows={1}
                  disabled={searchDisabled}
                  placeholder="Describe the invention or paste a paragraph of your idea…"
                  className="block w-full resize-none bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed sm:text-base"
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Enter to search · Shift+Enter for a new line</span>
                  <span className={draftLength > PATENT_QUERY_BOUNDS.max - 100 ? 'text-amber-600' : ''}>{draftLength.toLocaleString('en-IN')} / {PATENT_QUERY_BOUNDS.max.toLocaleString('en-IN')}</span>
                </div>
              </div>
              {draftQuery ? <button type="button" onClick={() => setDraftQuery('')} className="mt-1.5 rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Clear query"><X className="h-4 w-4" /></button> : null}
            </div>
            <button type="submit" disabled={searchDisabled || loading || draftLength < PATENT_QUERY_BOUNDS.min} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-teal-700 px-6 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search patents
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-teal-50/70"><span>Try:</span>{SAMPLE_QUERIES.map((sample) => <button type="button" key={sample} onClick={() => chooseSample(sample)} disabled={searchDisabled} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-left transition hover:bg-white/10 disabled:opacity-50">{sample}</button>)}</div>

          {runId ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200/20 bg-white/10 px-4 py-3 text-sm text-teal-50">
              <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-teal-200" /> Searching from your analysis{runTitle ? <> “<span className="font-semibold">{runTitle}</span>”</> : null} — saved patents will be linked to it.</span>
              <Link href={`/funding/intelligence/idea/${encodeURIComponent(runId)}`} className="text-xs font-semibold text-teal-100 underline-offset-2 hover:underline">View analysis</Link>
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-4">
          {errorCopy ? <ErrorBanner copy={errorCopy} countdown={countdown} onRetry={() => void runSearch(query, limit)} /> : null}
          {shortlist.error ? (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p><span className="font-semibold">Shortlist update failed.</span> {shortlist.error}</p>
            </div>
          ) : null}
          {data ? <PatentCoverageLine coverage={data.coverage} resultCount={resultCount} limit={data.limit} capped={data.capped} cached={data.diagnostics.cached} upstreamRemaining={data.diagnostics.upstreamRemaining} /> : null}
        </div>

        <div className="mb-5 mt-5 flex items-center justify-between gap-3 lg:hidden">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMobileFilters(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm"><Filter className="h-4 w-4" /> Filters {activeFilterCount ? <span className="rounded-full bg-teal-100 px-1.5 text-xs text-teal-800">{activeFilterCount}</span> : null}</button>
            <button type="button" onClick={openDrawer} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm"><Bookmark className="h-4 w-4" /> {shortlist.items.length}</button>
          </div>
          <span className="text-sm text-slate-500" aria-live="polite">{loading ? 'Searching…' : data ? `${visible.length} of ${resultCount}` : ''}</span>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden self-start space-y-5 lg:sticky lg:top-5 lg:block">
            <ShortlistRail shortlist={shortlist} onOpen={openDrawer} runId={runId} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <PatentFacetsPanel facets={data?.facets || { jurisdictions: [], applicants: [], years: [], classifications: [], kinds: [] }} filters={filters} onChange={(nextFilters) => updateUrlState({ filters: nextFilters })} onClear={clearFilters} />
            </div>
          </aside>

          <section>
            <div className="mb-4 hidden items-end justify-between gap-4 lg:flex">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Related patents</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">{query ? 'Patents matched to your query' : 'Search the patent corpus'}</h2>
                <p className="mt-1 text-sm text-slate-500" aria-live="polite">
                  {loading ? 'Searching PatentNest…' : data ? `Showing ${visible.length} of ${resultCount} (top ${data.limit} by relevance)` : 'Describe an invention above to see the closest patents.'}
                </p>
              </div>
              <div className="flex items-end gap-3">
                <label className="text-xs font-semibold text-slate-500">Results per search
                  <select value={limit} onChange={(event) => updateUrlState({ limit: Number(event.target.value) })} className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-teal-500">
                    {PATENT_SEARCH_LIMIT_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-500">Sort
                  <select value={sort} onChange={(event) => updateUrlState({ sort: readPatentSort(event.target.value) })} className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-teal-500">
                    <option value="relevance">Relevance</option>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                  </select>
                </label>
              </div>
            </div>

            {loading ? <div className="space-y-4"><ResultSkeleton /><ResultSkeleton /><ResultSkeleton /></div> : null}

            {!loading && data && visible.length ? (
              <div className="space-y-4">
                {visible.map((item) => <PatentResultCard key={item.id} item={item} terms={terms} shortlist={shortlist} ideaRunId={runId} detailHref={detailHref(item.publicationNumber)} />)}
                {data.capped ? <p className="px-1 pt-2 text-center text-xs leading-5 text-slate-500">Showing the top {data.limit} by relevance — PatentNest returns at most 50 per search. Narrow or rephrase the query to see different patents.</p> : null}
              </div>
            ) : null}

            {!loading && data && !resultCount && !errorCopy ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><Search className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-4 text-lg font-semibold text-slate-900">No patents matched</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Try a longer, plainer description of the invention — one or two sentences about the problem and the approach work best.</p></div>
            ) : null}

            {!loading && data && resultCount && !visible.length ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><Filter className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-4 text-lg font-semibold text-slate-900">Your filters hide all {resultCount} results</h3><button type="button" onClick={clearFilters} className="mt-4 text-sm font-semibold text-teal-700">Clear filters</button></div>
            ) : null}

            {!loading && !data && !errorCopy ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['Paste the problem and the approach', 'Semantic search reads meaning, so a short paragraph beats a keyword list.'],
                  ['Save anything you would cite', 'Shortlist patents from the results; your list follows you across searches.'],
                  ['Export for the prior-art section', 'Copy the shortlist as Markdown citations or download a CSV for the proposal.'],
                ].map(([title, detail]) => (
                  <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><FileSearch className="h-5 w-5 text-teal-700" /><h3 className="mt-3 font-semibold text-slate-900">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p></div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {mobileFilters ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close filters" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setMobileFilters(false)} />
          <div className="absolute inset-y-0 right-0 w-[88%] max-w-sm overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Filters</h2><button type="button" onClick={() => setMobileFilters(false)} className="rounded-full p-2 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button></div>
            <PatentFacetsPanel facets={data?.facets || { jurisdictions: [], applicants: [], years: [], classifications: [], kinds: [] }} filters={filters} onChange={(nextFilters) => updateUrlState({ filters: nextFilters })} onClear={clearFilters} />
            <button type="button" onClick={() => setMobileFilters(false)} className="sticky bottom-3 mt-5 w-full rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white">Show results</button>
          </div>
        </div>
      ) : null}

      <ShortlistDrawer open={drawerOpen} onClose={closeDrawer} shortlist={shortlist} runId={runId} contextParams={contextParams} />
    </main>
  )
}
