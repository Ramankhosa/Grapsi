'use client'

import { AlertTriangle, ArrowLeft, CalendarRange, Check, CheckCircle2, ChevronDown, Database, Eye, Loader2, Search, SlidersHorizontal, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

interface Funder { id: string; name: string; country: string | null; type: string | null; calls: number }
interface Website {
  host: string
  calls: number
  liveCalls: number
  matchedCalls: number
  nextDeadline: string | null
  latestAdded: string | null
  documents: number
  funders: Funder[]
  sampleUrls: string[]
  watched: { siteId: string; status: string; watchPoints: number } | null
  suggestions: Array<{ url: string; covers: number; reason: string }>
  warnings: Array<{ code: string; message: string }>
  suggested: { frequencyMinutes: number; priority: 'HIGH' | 'NORMAL' | 'LOW'; documentHosts: string[] }
}
interface Facet { value: string; calls: number }
interface Facets { kinds: Facet[]; areas: Facet[]; careerStages: Facet[]; countries: Facet[]; funderTypes: Facet[] }

interface Setup {
  watchUrl: string
  customUrl: string
  pageKind: 'PAGE' | 'FEED' | 'SITEMAP'
  funderIds: string[]
  officialWebsite: boolean
  frequencyMinutes: number
  priority: 'HIGH' | 'NORMAL' | 'LOW'
  relatedHosts: string
  documentHosts: string
  keywords: string
  excludeKeywords: string
  fetchMode: 'AUTO' | 'FETCH' | 'BROWSER'
  dailyBudgetUsd: string
  note: string
  preview: { state: 'idle' | 'loading' | 'ok' | 'error'; message?: string; title?: string | null; lines?: number; feedUrl?: string | null }
}

interface Result { host: string; status: string; message: string; funderLinks: string; websiteSaved: number; notes?: string[]; firstCheckAt?: string | null }

interface Filters {
  q: string
  title: string
  country: string
  type: string
  status: 'LIVE' | 'ANY' | 'CLOSED'
  dateField: 'DEADLINE' | 'OPENS' | 'PUBLISHED' | 'ADDED'
  from: string
  to: string
  kinds: string[]
  areas: string[]
  stages: string[]
  minAward: string
  unwatched: boolean
  oneOff: boolean
  sort: 'LIVE' | 'DEADLINE' | 'RECENT' | 'CALLS' | 'NAME'
}

const EMPTY_FILTERS: Filters = { q: '', title: '', country: '', type: '', status: 'LIVE', dateField: 'DEADLINE', from: '', to: '', kinds: [], areas: [], stages: [], minAward: '', unwatched: true, oneOff: false, sort: 'LIVE' }
const PAGE = 25
/** Matches the server's BULK_IMPORT_CAP. */
const BULK_CAP = 500
const PICK_CAP = 200

const FREQUENCIES = [
  [1440, 'Every day'],
  [4320, 'Every 3 days'],
  [10080, 'Every week'],
] as const
const DATE_FIELDS = [['DEADLINE', 'Deadline'], ['OPENS', 'Opens'], ['PUBLISHED', 'Published'], ['ADDED', 'Added to database']] as const
const SORTS = [['LIVE', 'Most live calls'], ['DEADLINE', 'Soonest deadline'], ['RECENT', 'Newest calls'], ['CALLS', 'Most matching calls'], ['NAME', 'Website A–Z']] as const
const TYPE_LABEL: Record<string, string> = { GOVERNMENT: 'Government', FOUNDATION: 'Foundation', INTERGOVERNMENTAL: 'Intergovernmental', CORPORATE: 'Corporate', UNIVERSITY: 'University', VENTURE: 'Venture' }
const WARNING_TONE: Record<string, string> = {
  FILE_HOST: 'border-red-200 bg-red-50 text-red-800',
  FUNDER_MISMATCH: 'border-red-200 bg-red-50 text-red-800',
  SHARED_PORTAL: 'border-amber-200 bg-amber-50 text-amber-800',
  NEEDS_BROWSER: 'border-amber-200 bg-amber-50 text-amber-800',
  FEW_CALLS: 'border-nickel-200 bg-nickel-50 text-nickel-700',
}
const WARNING_LABEL: Record<string, string> = {
  FILE_HOST: 'File store, not a listing',
  FUNDER_MISMATCH: 'Funder link looks wrong',
  SHARED_PORTAL: 'Shared portal',
  NEEDS_BROWSER: 'May need a browser',
  FEW_CALLS: 'Few calls',
}

let regionNames: Intl.DisplayNames | null = null
function countryName(code: string) {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const daysFromToday = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d) }
const shortDate = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

const DATE_PRESETS: Array<{ label: string; apply: () => Pick<Filters, 'dateField' | 'from' | 'to'> }> = [
  { label: 'Deadline in the next 30 days', apply: () => ({ dateField: 'DEADLINE', from: daysFromToday(0), to: daysFromToday(30) }) },
  { label: 'Deadline in the next 90 days', apply: () => ({ dateField: 'DEADLINE', from: daysFromToday(0), to: daysFromToday(90) }) },
  { label: 'Opened in the last 90 days', apply: () => ({ dateField: 'OPENS', from: daysFromToday(-90), to: daysFromToday(0) }) },
  { label: 'Added in the last 30 days', apply: () => ({ dateField: 'ADDED', from: daysFromToday(-30), to: daysFromToday(0) }) },
]

/** The filters as query parameters; the bulk import sends the same string. */
function queryFor(f: Filters, offset = 0) {
  const p = new URLSearchParams({ status: f.status, sort: f.sort, unwatched: f.unwatched ? '1' : '0', oneOff: f.oneOff ? '1' : '0', offset: String(offset) })
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.title.trim()) p.set('title', f.title.trim())
  if (f.country) p.set('country', f.country)
  if (f.type) p.set('type', f.type)
  if (f.from || f.to) p.set('dateField', f.dateField)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.kinds.length) p.set('kinds', f.kinds.join('|'))
  if (f.areas.length) p.set('areas', f.areas.join('|'))
  if (f.stages.length) p.set('stages', f.stages.join('|'))
  if (Number(f.minAward) > 0) p.set('minAward', String(Number(f.minAward)))
  return p.toString()
}

function activeFilterCount(f: Filters) {
  return [f.title.trim(), f.country, f.type, f.from || f.to, f.minAward].filter(Boolean).length + f.kinds.length + f.areas.length + f.stages.length + (f.status !== 'LIVE' ? 1 : 0)
}

function defaultSetup(site: Website): Setup {
  return {
    watchUrl: site.suggestions[0]?.url ?? `https://${site.host}/`,
    customUrl: '',
    pageKind: 'PAGE',
    // Funders in the catalogue are vetted: link every funder publishing here.
    funderIds: site.funders.slice(0, 40).map((f) => f.id),
    officialWebsite: false,
    frequencyMinutes: site.suggested.frequencyMinutes,
    priority: site.suggested.priority,
    relatedHosts: '',
    documentHosts: site.suggested.documentHosts.join(', '),
    keywords: '',
    excludeKeywords: '',
    fetchMode: site.warnings.some((w) => w.code === 'NEEDS_BROWSER') ? 'BROWSER' : 'AUTO',
    dailyBudgetUsd: '',
    note: '',
    preview: { state: 'idle' },
  }
}

const hosts = (value: string) => value.split(/[,\s]+/).map((h) => h.trim().toLowerCase()).filter(Boolean)

/** A filter that takes several values: a menu of checkboxes with call counts. */
function MultiFilter({ label, options, value, onChange, format = (v) => v }: { label: string; options: Facet[]; value: string[]; onChange: (next: string[]) => void; format?: (v: string) => string }) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const shown = options.filter((o) => !find || format(o.value).toLowerCase().includes(find.toLowerCase()))
  return (
    <div className="relative">
      <button type="button" className={`cb-chip ${value.length ? 'cb-chip-active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}{value.length ? ` · ${value.length}` : ''} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-72 rounded-xl border border-hairline bg-ground p-2 shadow-lg">
            {options.length > 8 && <input className="cb-input mb-2 py-1.5 text-[12.5px]" placeholder={`Find ${label.toLowerCase()}`} value={find} onChange={(e) => setFind(e.target.value)} autoFocus />}
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {shown.length === 0 && <p className="px-2 py-1.5 text-[12px] text-nickel-500">Nothing in the database.</p>}
              {shown.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink-soft hover:bg-nickel-50">
                  <input type="checkbox" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))} />
                  <span className="min-w-0 flex-1 truncate">{format(o.value)}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-nickel-500">{o.calls.toLocaleString()}</span>
                </label>
              ))}
            </div>
            {value.length > 0 && <button type="button" className="cb-btn-ghost cb-btn-xs mt-1 w-full justify-center" onClick={() => onChange([])}>Clear</button>}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Sources → Add from funding database. Filter the calls already in the
 * catalogue (dates, title, category, area, country…), grouped by website; tick
 * websites, a page, or every match; add them at once with suggested settings,
 * or review each one first.
 */
export default function MonitorCatalogImport({ authedFetch, isSuperAdmin, onAdded }: { authedFetch: AuthedFetch; isSuperAdmin: boolean; onAdded: () => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [showMore, setShowMore] = useState(false)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [offset, setOffset] = useState(0)
  const [websites, setWebsites] = useState<Website[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Map<string, Website>>(new Map())
  /** "Every matching website", minus the ones unticked. */
  const [allMode, setAllMode] = useState(false)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<'pick' | 'setup' | 'done'>('pick')
  const [setups, setSetups] = useState<Record<string, Setup>>({})
  const [defaults, setDefaults] = useState<{ frequencyMinutes: number | null; priority: 'SUGGESTED' | 'HIGH' | 'NORMAL' | 'LOW' }>({ frequencyMinutes: null, priority: 'SUGGESTED' })
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [summary, setSummary] = useState<{ matched: number; capped: boolean } | null>(null)

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const query = useMemo(() => queryFor(filters), [filters])

  useEffect(() => {
    void authedFetch('/api/funding/monitor/catalog-import?facets=1').then((r) => (r.ok ? r.json() : null)).then((data) => data && setFacets(data)).catch(() => undefined)
  }, [authedFetch])

  const search = useCallback(async (from: number) => {
    setLoading(true)
    setError('')
    try {
      const response = await authedFetch(`/api/funding/monitor/catalog-import?${queryFor(filters, from)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Search failed')
      setWebsites(data.websites)
      setTotal(data.total)
      setOffset(from)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [authedFetch, filters])

  useEffect(() => {
    const timer = setTimeout(() => void search(0), 300)
    return () => clearTimeout(timer)
  }, [search])

  // "Every match" means every match of these filters; a new search starts over.
  useEffect(() => { setAllMode(false); setExcluded(new Set()) }, [query])

  const selectable = (site: Website) => site.watched?.status !== 'ACTIVE'
  const isOn = (site: Website) => (allMode ? !excluded.has(site.host) : picked.has(site.host))
  const selectedCount = allMode ? Math.min(BULK_CAP, Math.max(0, total - excluded.size)) : picked.size

  function togglePick(site: Website) {
    if (allMode) {
      setExcluded((old) => { const next = new Set(old); if (next.has(site.host)) next.delete(site.host); else next.add(site.host); return next })
      return
    }
    setPicked((old) => {
      const next = new Map(old)
      if (next.has(site.host)) next.delete(site.host)
      else if (next.size < PICK_CAP) next.set(site.host, site)
      return next
    })
  }

  function pickPage() {
    setAllMode(false)
    setPicked((old) => {
      const next = new Map(old)
      const page = websites.filter(selectable)
      const allOn = page.every((s) => next.has(s.host))
      for (const site of page) {
        if (allOn) next.delete(site.host)
        else if (next.size < PICK_CAP) next.set(site.host, site)
      }
      return next
    })
  }

  function clearSelection() {
    setAllMode(false)
    setExcluded(new Set())
    setPicked(new Map())
  }

  function applyDefaults(setup: Setup): Setup {
    return {
      ...setup,
      ...(defaults.frequencyMinutes ? { frequencyMinutes: defaults.frequencyMinutes } : {}),
      ...(defaults.priority !== 'SUGGESTED' ? { priority: defaults.priority } : {}),
    }
  }

  function startSetup() {
    const next: Record<string, Setup> = {}
    for (const site of picked.values()) next[site.host] = applyDefaults(setups[site.host] ?? defaultSetup(site))
    setSetups(next)
    setStep('setup')
  }

  function update(host: string, patch: Partial<Setup>) {
    setSetups((old) => ({ ...old, [host]: { ...old[host], ...patch } }))
  }

  async function preview(host: string) {
    const setup = setups[host]
    const url = setup.watchUrl === 'custom' ? setup.customUrl : setup.watchUrl
    update(host, { preview: { state: 'loading' } })
    try {
      const response = await authedFetch('/api/funding/monitor/sources/preview', { method: 'POST', body: JSON.stringify({ url }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not open the page')
      update(host, { preview: { state: 'ok', title: data.pageTitle, lines: data.totalLines, feedUrl: data.feedUrl } })
    } catch (e) {
      update(host, { preview: { state: 'error', message: e instanceof Error ? e.message : 'Could not open the page' } })
    }
  }

  const problems = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [host, s] of Object.entries(setups)) {
      const url = s.watchUrl === 'custom' ? s.customUrl : s.watchUrl
      try {
        const u = new URL(url)
        if (u.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) out[host] = `The page to watch must be on ${host}`
      } catch {
        out[host] = 'Enter the full address of the page to watch, starting with https://'
      }
      if (s.dailyBudgetUsd && !(Number(s.dailyBudgetUsd) >= 0 && Number(s.dailyBudgetUsd) <= 100)) out[host] = 'Daily AI budget must be between 0 and 100 USD'
    }
    return out
  }, [setups])

  function finish(data: { results: Result[]; matched?: number; capped?: boolean }) {
    setResults(data.results)
    setSummary(typeof data.matched === 'number' ? { matched: data.matched, capped: Boolean(data.capped) } : null)
    setStep('done')
    clearSelection()
    onAdded()
  }

  async function post(body: unknown) {
    const response = await authedFetch('/api/funding/monitor/catalog-import', { method: 'POST', body: JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not add the websites')
    return data
  }

  const payloadFor = (entries: Array<[string, Setup]>) => entries.map(([host, s]) => ({
    host,
    watchUrl: s.watchUrl === 'custom' ? s.customUrl : s.watchUrl,
    pageKind: s.pageKind,
    funderIds: s.funderIds,
    officialWebsite: s.officialWebsite,
    frequencyMinutes: s.frequencyMinutes,
    priority: s.priority,
    relatedHosts: hosts(s.relatedHosts),
    documentHosts: hosts(s.documentHosts),
    keywords: s.keywords,
    excludeKeywords: s.excludeKeywords,
    fetchMode: s.fetchMode,
    dailyBudgetUsd: s.dailyBudgetUsd ? Number(s.dailyBudgetUsd) : null,
    note: s.note || null,
  }))

  async function submit() {
    if (Object.keys(problems).length) return
    setSaving(true)
    setError('')
    try {
      finish(await post({ websites: payloadFor(Object.entries(setups)) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the websites')
    } finally {
      setSaving(false)
    }
  }

  /** Add the selection straight away with each website's suggested settings. */
  async function quickAdd() {
    if (!selectedCount) return
    if (selectedCount > 25 && !window.confirm(`${isSuperAdmin ? 'Add' : 'Send'} ${selectedCount} websites ${isSuperAdmin ? 'to the pipeline' : 'for approval'} with suggested settings? First checks are spread out so the crawler takes them steadily.`)) return
    setSaving(true)
    setError('')
    try {
      const chosenDefaults = { frequencyMinutes: defaults.frequencyMinutes, priority: defaults.priority === 'SUGGESTED' ? null : defaults.priority, excludeKeywords: '' }
      if (allMode) {
        finish(await post({ all: { query, defaults: chosenDefaults, excludeHosts: [...excluded] } }))
      } else {
        const sites = [...picked.values()]
        const files = sites.filter((s) => s.warnings.some((w) => w.code === 'FILE_HOST'))
        const entries = sites.filter((s) => !files.includes(s)).map((s): [string, Setup] => [s.host, applyDefaults(defaultSetup(s))])
        const data = entries.length ? await post({ websites: payloadFor(entries) }) : { results: [] }
        finish({ results: [...data.results, ...files.map((s) => ({ host: s.host, status: 'SKIPPED', message: 'Mostly files, not pages: add it as a document host on the website that links to these files', funderLinks: 'NONE', websiteSaved: 0 }))] })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the websites')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'done') {
    const added = results.filter((r) => r.status === 'ADDED' || r.status === 'ALREADY_WATCHED')
    const pending = results.filter((r) => r.status === 'PENDING_APPROVAL')
    const skipped = results.filter((r) => !['ADDED', 'ALREADY_WATCHED', 'PENDING_APPROVAL'].includes(r.status))
    const notes = [...new Set(results.flatMap((r) => r.notes ?? []))]
    const lastStart = results.map((r) => r.firstCheckAt).filter((v): v is string => Boolean(v)).sort().pop()
    return (
      <section className="space-y-4">
        {added.length > 0 && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-green-900">
              <CheckCircle2 className="h-5 w-5" /> {added.length} website{added.length === 1 ? '' : 's'} added to the pipeline
            </p>
            <p className="mt-1 text-[13px] text-green-800">
              Approved, with every funder publishing there linked. {lastStart ? `First checks are spread out until ${new Date(lastStart).toLocaleString()} so the crawler and AI budget take them steadily.` : 'The first check is due now.'} New pages will appear in Crawl, and funding calls in Review.
            </p>
          </div>
        )}
        {pending.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-[15px] font-semibold text-amber-900">{pending.length} website{pending.length === 1 ? '' : 's'} sent to a super admin for approval</p>
            <p className="mt-1 text-[13px] text-amber-800">A super admin approves them together under Sources → Watched websites (“Approve all”); nothing new is fetched until then.</p>
          </div>
        )}
        {summary?.capped && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {summary.matched.toLocaleString()} websites matched; one run adds at most {BULK_CAP}. Run the same search again to add the next batch.
          </p>
        )}
        {notes.map((note) => (
          <p key={note} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}
          </p>
        ))}
        {skipped.length > 0 && <p className="text-[12.5px] text-nickel-600">{skipped.length} not added; the reason is shown beside each one below.</p>}
        <ul className="max-h-[28rem] divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline bg-ground">
          {results.map((r) => (
            <li key={r.host} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="font-mono font-medium text-ink">{r.host}</span>
              <span className={r.status === 'ADDED' || r.status === 'ALREADY_WATCHED' ? 'text-green-800' : r.status === 'PENDING_APPROVAL' ? 'text-amber-800' : r.status === 'SKIPPED' ? 'text-nickel-600' : 'text-red-700'}>{r.message}</span>
              {r.firstCheckAt && <span className="text-nickel-500">First check {new Date(r.firstCheckAt).toLocaleString()}</span>}
              {r.funderLinks === 'SUGGESTED' && <span className="text-nickel-500">Funder links applied on approval</span>}
              {r.websiteSaved > 0 && <span className="text-nickel-500">Website saved on {r.websiteSaved} funder{r.websiteSaved === 1 ? '' : 's'}</span>}
            </li>
          ))}
        </ul>
        <button type="button" className="cb-btn-secondary cb-btn-sm" onClick={() => { setStep('pick'); setSetups({}); void search(0) }}>
          Add more websites
        </button>
      </section>
    )
  }

  if (step === 'setup') {
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="cb-btn-ghost cb-btn-sm" onClick={() => setStep('pick')}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to search
          </button>
          <p className="text-[13px] text-nickel-600">Confirm how each website is watched. Most of this is filled in from the database.{isSuperAdmin ? '' : ' A super admin approves the site, its scope and budget before anything is fetched.'}</p>
        </div>
        {Object.entries(setups).map(([host, s]) => {
          const site = picked.get(host)
          if (!site) return null
          return (
            <article key={host} className="space-y-4 rounded-xl border border-hairline bg-ground p-5">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[14px] font-semibold text-ink">{host}</p>
                  <p className="text-[12.5px] text-nickel-500">{site.calls} calls in the database · {site.liveCalls} live</p>
                </div>
                <button type="button" className="cb-btn-ghost cb-btn-xs" onClick={() => { togglePick(site); setSetups((old) => { const next = { ...old }; delete next[host]; return next }) }}>
                  <X className="h-3 w-3" /> Skip this website
                </button>
              </header>
              {site.warnings.length > 0 && (
                <ul className="space-y-1">
                  {site.warnings.map((w) => (
                    <li key={w.code} className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] ${WARNING_TONE[w.code] ?? ''}`}>
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w.message}
                    </li>
                  ))}
                </ul>
              )}

              <fieldset className="space-y-2">
                <legend className="cb-label">Page to watch <span className="font-normal text-nickel-500">· required</span></legend>
                {site.suggestions.map((sug, i) => (
                  <label key={sug.url} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 ${s.watchUrl === sug.url ? 'border-cobalt-300 bg-cobalt-50' : 'border-hairline hover:bg-nickel-50'}`}>
                    <input type="radio" className="mt-1" checked={s.watchUrl === sug.url} onChange={() => update(host, { watchUrl: sug.url, preview: { state: 'idle' } })} />
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[12.5px] text-ink">{sug.url}</span>
                      <span className="text-[11.5px] text-nickel-500">{i === 0 && sug.covers > 1 ? 'Suggested. ' : ''}{sug.reason}</span>
                    </span>
                  </label>
                ))}
                {s.preview.feedUrl && (
                  <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 ${s.watchUrl === s.preview.feedUrl ? 'border-cobalt-300 bg-cobalt-50' : 'border-green-200 bg-green-50/50'}`}>
                    <input type="radio" className="mt-1" checked={s.watchUrl === s.preview.feedUrl} onChange={() => update(host, { watchUrl: s.preview.feedUrl!, pageKind: 'FEED' })} />
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-[12.5px] text-ink">{s.preview.feedUrl}</span>
                      <span className="text-[11.5px] text-green-800">Feed found on the page. Feeds are the most reliable way to see new calls.</span>
                    </span>
                  </label>
                )}
                <label className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${s.watchUrl === 'custom' ? 'border-cobalt-300 bg-cobalt-50' : 'border-hairline'}`}>
                  <input type="radio" className="mt-2.5" checked={s.watchUrl === 'custom'} onChange={() => update(host, { watchUrl: 'custom' })} />
                  <input className="cb-input font-mono text-[12.5px]" placeholder={`https://${host}/funding/calls/`} value={s.customUrl} onFocus={() => update(host, { watchUrl: 'custom' })} onChange={(e) => update(host, { customUrl: e.target.value, preview: { state: 'idle' } })} aria-label="Another page on this website" />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="cb-btn-secondary cb-btn-xs" onClick={() => void preview(host)} disabled={s.preview.state === 'loading'}>
                    {s.preview.state === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Check this page
                  </button>
                  {s.preview.state === 'ok' && <span className="text-[12px] text-green-800"><Check className="inline h-3 w-3" /> Opened: {s.preview.title ?? 'untitled page'} · {s.preview.lines} lines of text{s.preview.feedUrl ? ' · feed found' : ''}</span>}
                  {s.preview.state === 'error' && <span className="text-[12px] text-red-700">{s.preview.message}</span>}
                </div>
                {problems[host] && <p className="text-[12px] text-red-700">{problems[host]}</p>}
              </fieldset>

              <div className="grid gap-4 md:grid-cols-2">
                <fieldset className="space-y-1.5">
                  <legend className="cb-label">Funders <span className="font-normal text-nickel-500">· all publishing here are linked</span></legend>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-hairline p-2">
                    {site.funders.length === 0 && <p className="text-[12px] text-nickel-500">No funder is linked to these calls.</p>}
                    {site.funders.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                        <input type="checkbox" checked={s.funderIds.includes(f.id)} onChange={(e) => update(host, { funderIds: e.target.checked ? [...s.funderIds, f.id] : s.funderIds.filter((id) => id !== f.id) })} />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="shrink-0 text-[11px] text-nickel-500">{f.country ?? ''} · {f.calls} calls</span>
                      </label>
                    ))}
                  </div>
                  <label className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                    <input type="checkbox" className="mt-0.5" checked={s.officialWebsite} onChange={(e) => update(host, { officialWebsite: e.target.checked })} />
                    <span>
                      This is the ticked funders&apos; own official website
                      <span className="block text-[11.5px] text-nickel-500">{isSuperAdmin ? 'Also saved as the funder website in the database.' : 'Saved as a suggestion; a super admin confirms funder links.'}</span>
                    </span>
                  </label>
                </fieldset>
                <div className="grid grid-cols-2 gap-3 self-start">
                  <label className="flex flex-col gap-1">
                    <span className="cb-label">Check</span>
                    <select className="cb-select" value={s.frequencyMinutes} onChange={(e) => update(host, { frequencyMinutes: Number(e.target.value) })}>
                      {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <span className="text-[11px] text-nickel-500">Suggested from {site.calls} calls</span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="cb-label">Priority</span>
                    <select className="cb-select" value={s.priority} onChange={(e) => update(host, { priority: e.target.value as Setup['priority'] })}>
                      <option value="HIGH">High</option>
                      <option value="NORMAL">Normal</option>
                      <option value="LOW">Low</option>
                    </select>
                    <span className="text-[11px] text-nickel-500">Suggested from {site.liveCalls} live calls</span>
                  </label>
                  <label className="col-span-2 flex flex-col gap-1">
                    <span className="cb-label">Page type</span>
                    <select className="cb-select" value={s.pageKind} onChange={(e) => update(host, { pageKind: e.target.value as Setup['pageKind'] })}>
                      <option value="PAGE">Listing page</option>
                      <option value="FEED">RSS or Atom feed</option>
                      <option value="SITEMAP">Sitemap</option>
                    </select>
                  </label>
                </div>
              </div>

              <details className="rounded-lg border border-hairline bg-inset px-3 py-2">
                <summary className="cursor-pointer text-[12.5px] font-medium text-ink-soft">Advanced: linked websites, document hosts, words, browser, budget, note</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1"><span className="cb-label">Linked websites the crawl may follow</span><input className="cb-input" placeholder="portal.example.org, apply.example.org" value={s.relatedHosts} onChange={(e) => update(host, { relatedHosts: e.target.value })} /></label>
                  <label className="flex flex-col gap-1"><span className="cb-label">Document hosts (files only)</span><input className="cb-input" placeholder="cdn.example.org" value={s.documentHosts} onChange={(e) => update(host, { documentHosts: e.target.value })} /></label>
                  <label className="flex flex-col gap-1"><span className="cb-label">Only keep items mentioning</span><input className="cb-input" placeholder="research, fellowship" value={s.keywords} onChange={(e) => update(host, { keywords: e.target.value })} /></label>
                  <label className="flex flex-col gap-1"><span className="cb-label">Ignore items mentioning</span><input className="cb-input" placeholder="tender, procurement, vacancy" value={s.excludeKeywords} onChange={(e) => update(host, { excludeKeywords: e.target.value })} /></label>
                  <label className="flex flex-col gap-1"><span className="cb-label">How to read the page</span>
                    <select className="cb-select" value={s.fetchMode} onChange={(e) => update(host, { fetchMode: e.target.value as Setup['fetchMode'] })}>
                      <option value="AUTO">Detect automatically</option>
                      <option value="FETCH">Plain download</option>
                      <option value="BROWSER">Needs a browser (app-style portal)</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1"><span className="cb-label">Daily AI budget, USD</span><input className="cb-input" inputMode="decimal" placeholder="Platform default" value={s.dailyBudgetUsd} onChange={(e) => update(host, { dailyBudgetUsd: e.target.value })} /></label>
                  <label className="flex flex-col gap-1 md:col-span-2"><span className="cb-label">Note for other admins</span><input className="cb-input" placeholder="Why this website is watched" value={s.note} onChange={(e) => update(host, { note: e.target.value })} /></label>
                </div>
              </details>
            </article>
          )
        })}
        {error && <p role="alert" className="text-[13px] text-red-700">{error}</p>}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-hairline bg-ground/95 py-3 backdrop-blur">
          {Object.keys(problems).length > 0 && <span className="text-[12.5px] text-red-700">Fix {Object.keys(problems).length} page address{Object.keys(problems).length === 1 ? '' : 'es'} above</span>}
          <button type="button" className="cb-btn-primary" disabled={saving || !Object.keys(setups).length} onClick={() => void submit()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {isSuperAdmin ? 'Add' : 'Send'} {Object.keys(setups).length} website{Object.keys(setups).length === 1 ? '' : 's'} {isSuperAdmin ? 'to the pipeline' : 'for approval'}
          </button>
        </div>
      </section>
    )
  }

  const filterCount = activeFilterCount(filters)
  const pageSelectable = websites.filter(selectable)
  const pageAllOn = !allMode && pageSelectable.length > 0 && pageSelectable.every((s) => picked.has(s.host))
  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-3">
        <label className="relative block">
          <span className="sr-only">Search funders, programmes, countries or websites</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nickel-400" />
          <input className="cb-input h-11 pl-9 text-[14px]" placeholder="Search funders, programmes or websites: NIH, Horizon Europe, ukri.org" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        </label>

        <div className="space-y-2.5 rounded-xl border border-hairline bg-inset p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className="cb-input h-8 w-56 py-1 text-[12.5px]" placeholder="Call title contains…" aria-label="Call title contains" value={filters.title} onChange={(e) => set({ title: e.target.value })} />
            <MultiFilter label="Grant category" options={facets?.kinds ?? []} value={filters.kinds} onChange={(kinds) => set({ kinds })} />
            <MultiFilter label="Research area" options={facets?.areas ?? []} value={filters.areas} onChange={(areas) => set({ areas })} />
            <select className="cb-select h-8 w-auto py-1 text-[12.5px]" value={filters.country} onChange={(e) => set({ country: e.target.value })} aria-label="Country">
              <option value="">All countries</option>
              {(facets?.countries ?? []).map((c) => <option key={c.value} value={c.value}>{countryName(c.value)} ({c.calls.toLocaleString()})</option>)}
            </select>
            <select className="cb-select h-8 w-auto py-1 text-[12.5px]" value={filters.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })} aria-label="Call status">
              <option value="LIVE">Has live calls</option>
              <option value="ANY">Any call status</option>
              <option value="CLOSED">Only closed calls</option>
            </select>
            <button type="button" className={`cb-chip ${showMore ? 'border-cobalt-300 bg-cobalt-50 text-cobalt-700' : ''}`} onClick={() => setShowMore(!showMore)} aria-expanded={showMore}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> More filters
            </button>
            {filterCount > 0 && <button type="button" className="cb-btn-ghost cb-btn-xs" onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q })}><X className="h-3 w-3" /> Clear {filterCount} filter{filterCount === 1 ? '' : 's'}</button>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-nickel-500" />
            <select className="cb-select h-8 w-auto py-1 text-[12.5px]" value={filters.dateField} onChange={(e) => set({ dateField: e.target.value as Filters['dateField'] })} aria-label="Date of the call">
              {DATE_FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" className="cb-input h-8 w-auto py-1 text-[12.5px]" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
            <span className="text-[12px] text-nickel-500">to</span>
            <input type="date" className="cb-input h-8 w-auto py-1 text-[12.5px]" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
            {DATE_PRESETS.map((preset) => (
              <button key={preset.label} type="button" className="cb-btn-ghost cb-btn-xs" onClick={() => set(preset.apply())}>{preset.label}</button>
            ))}
            {(filters.from || filters.to) && <button type="button" className="cb-btn-ghost cb-btn-xs" onClick={() => set({ from: '', to: '' })}><X className="h-3 w-3" /> Any date</button>}
          </div>

          {showMore && (
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-2.5">
              <MultiFilter label="Career stage" options={facets?.careerStages ?? []} value={filters.stages} onChange={(stages) => set({ stages })} />
              <select className="cb-select h-8 w-auto py-1 text-[12.5px]" value={filters.type} onChange={(e) => set({ type: e.target.value })} aria-label="Funder type">
                <option value="">All funder types</option>
                {(facets?.funderTypes ?? []).map((t) => <option key={t.value} value={t.value}>{TYPE_LABEL[t.value] ?? t.value} ({t.calls.toLocaleString()})</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">Largest award at least
                <input className="cb-input h-8 w-28 py-1 text-[12.5px]" inputMode="numeric" placeholder="USD" value={filters.minAward} onChange={(e) => set({ minAward: e.target.value.replace(/[^0-9]/g, '') })} aria-label="Minimum award in USD" />
              </label>
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"><input type="checkbox" checked={filters.unwatched} onChange={(e) => set({ unwatched: e.target.checked })} /> Not yet watched</label>
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"><input type="checkbox" checked={filters.oneOff} onChange={(e) => set({ oneOff: e.target.checked })} /> Include one-call websites</label>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-nickel-500">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          <span>{loading ? 'Searching the funding database…' : `${total.toLocaleString()} website${total === 1 ? '' : 's'} match · showing ${websites.length ? offset + 1 : 0}–${offset + websites.length}`}</span>
          <span className="ml-auto flex items-center gap-2">
            <select className="cb-select h-8 w-auto py-1 text-[12.5px]" value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })} aria-label="Sort by">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </span>
        </div>

        {total > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-ground px-3 py-2 text-[12.5px]">
            <button type="button" className="cb-btn-secondary cb-btn-xs" onClick={pickPage} disabled={!pageSelectable.length}>{pageAllOn ? 'Untick this page' : `Tick this page (${pageSelectable.length})`}</button>
            {!allMode ? (
              <button type="button" className="cb-btn-secondary cb-btn-xs" onClick={() => { setPicked(new Map()); setExcluded(new Set()); setAllMode(true) }}>
                Tick all {Math.min(total, BULK_CAP).toLocaleString()} matching{total > BULK_CAP ? ` (of ${total.toLocaleString()})` : ''}
              </button>
            ) : (
              <span className="font-medium text-cobalt-700">All {selectedCount.toLocaleString()} matching websites are ticked{excluded.size ? ` (${excluded.size} unticked)` : ''}. Untick any you do not want.</span>
            )}
            {selectedCount > 0 && <button type="button" className="cb-btn-ghost cb-btn-xs" onClick={clearSelection}>Clear selection</button>}
          </div>
        )}
        {error && <p role="alert" className="text-[13px] text-red-700">{error}</p>}

        <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-ground">
          {!loading && websites.length === 0 && <li className="p-6 text-center text-[13px] text-nickel-500">No websites match. Widen the dates, clear a category, or include closed calls.</li>}
          {websites.map((site) => {
            const on = selectable(site) && isOn(site)
            const active = site.watched?.status === 'ACTIVE'
            return (
              <li key={site.host}>
                <label className={`flex cursor-pointer gap-3 px-4 py-3 transition-colors ${on ? 'bg-cobalt-50' : 'hover:bg-nickel-50'} ${active ? 'cursor-default opacity-60' : ''}`}>
                  <input type="checkbox" className="mt-1" checked={on} disabled={active} onChange={() => togglePick(site)} aria-label={`Select ${site.host}`} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13.5px] font-semibold text-ink">{site.host}</span>
                      {site.watched && (
                        <span className={`rounded-full px-2 py-px text-[10.5px] font-medium ${active ? 'bg-green-100 text-green-800' : 'bg-nickel-100 text-nickel-600'}`}>
                          {active ? `Watched · ${site.watched.watchPoints} page${site.watched.watchPoints === 1 ? '' : 's'}` : `Known site · ${site.watched.status.toLowerCase()}`}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[12.5px] text-ink-soft">
                      {site.funders.slice(0, 3).map((f) => f.name).join(' · ') || 'No funder linked'}
                      {site.funders.length > 3 ? ` · +${site.funders.length - 3} more` : ''}
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-[11.5px] text-nickel-500">
                      <span className="truncate font-mono">Watch: {site.suggestions[0]?.url.replace(/^https?:\/\//, '')}</span>
                      {site.nextDeadline && <span>Next deadline {shortDate(site.nextDeadline)}</span>}
                      {site.latestAdded && <span>Newest call added {shortDate(site.latestAdded)}</span>}
                    </p>
                    {site.warnings.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {site.warnings.map((w) => (
                          <span key={w.code} title={w.message} className={`rounded-full border px-2 py-px text-[10.5px] font-medium ${WARNING_TONE[w.code] ?? ''}`}>
                            {WARNING_LABEL[w.code] ?? w.code}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[15px] font-semibold tabular-nums text-ink">{site.matchedCalls}</p>
                    <p className="text-[11px] text-nickel-500">{site.matchedCalls === site.calls ? 'calls' : `matching of ${site.calls}`}</p>
                    <p className={`mt-1 text-[12px] font-medium tabular-nums ${site.liveCalls ? 'text-green-700' : 'text-nickel-400'}`}>{site.liveCalls} live</p>
                  </div>
                </label>
              </li>
            )
          })}
        </ul>
        {total > PAGE && (
          <div className="flex items-center justify-between">
            <button type="button" className="cb-btn-secondary cb-btn-sm" disabled={offset === 0 || loading} onClick={() => void search(Math.max(0, offset - PAGE))}>Previous</button>
            <button type="button" className="cb-btn-secondary cb-btn-sm" disabled={offset + PAGE >= total || loading} onClick={() => void search(offset + PAGE)}>Next</button>
          </div>
        )}
      </div>

      <aside className="h-fit space-y-3 rounded-xl border border-hairline bg-inset p-4 lg:sticky lg:top-4" aria-label="Selected websites">
        <p className="text-[13px] font-semibold text-ink">{selectedCount.toLocaleString()} selected</p>
        {selectedCount === 0 ? (
          <p className="text-[12.5px] text-nickel-500">Tick websites, a page, or every match. Funders in the database are already vetted, so they can go in together with suggested settings.</p>
        ) : allMode ? (
          <p className="text-[12.5px] text-ink-soft">Every website matching the filters{excluded.size ? `, except ${excluded.size}` : ''}. File stores and blocked sites are skipped and reported.</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {[...picked.values()].map((site) => (
              <li key={site.host} className="flex items-center justify-between gap-2 rounded-md bg-ground px-2 py-1">
                <span className="truncate font-mono text-[12px] text-ink">{site.host}</span>
                <button type="button" className="text-nickel-400 hover:text-ink" onClick={() => togglePick(site)} aria-label={`Remove ${site.host}`}><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <label className="flex flex-col gap-1">
          <span className="cb-label">Check every</span>
          <select className="cb-select" value={defaults.frequencyMinutes ?? ''} onChange={(e) => setDefaults((d) => ({ ...d, frequencyMinutes: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">Suggested per website</option>
            {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="cb-label">Priority</span>
          <select className="cb-select" value={defaults.priority} onChange={(e) => setDefaults((d) => ({ ...d, priority: e.target.value as typeof d.priority }))}>
            <option value="SUGGESTED">Suggested per website</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        {error && <p role="alert" className="text-[12.5px] text-red-700">{error}</p>}
        <button type="button" className="cb-btn-primary w-full justify-center" disabled={!selectedCount || saving} onClick={() => void quickAdd()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} {isSuperAdmin ? 'Add' : 'Send'} {selectedCount ? selectedCount.toLocaleString() : ''} {isSuperAdmin ? 'now' : 'for approval'}
        </button>
        <button type="button" className="cb-btn-secondary w-full justify-center" disabled={allMode || !picked.size || picked.size > 50 || saving} onClick={startSetup} title={allMode || picked.size > 50 ? 'Review one by one works for up to 50 ticked websites' : undefined}>
          Review each first
        </button>
        <p className="text-[11.5px] text-nickel-500">
          {isSuperAdmin ? 'Adding approves the sites and links their funders.' : 'A super admin approves your requests together.'} Batches of more than 10 start checking a few minutes apart. Alerts for new finds go to you.
        </p>
      </aside>
    </section>
  )
}
