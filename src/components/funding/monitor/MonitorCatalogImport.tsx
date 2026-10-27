'use client'

import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Database, Eye, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

interface Funder { id: string; name: string; country: string | null; type: string | null; calls: number }
interface Website {
  host: string
  calls: number
  liveCalls: number
  documents: number
  funders: Funder[]
  sampleUrls: string[]
  watched: { siteId: string; status: string; watchPoints: number } | null
  suggestions: Array<{ url: string; covers: number; reason: string }>
  warnings: Array<{ code: string; message: string }>
  suggested: { frequencyMinutes: number; priority: 'HIGH' | 'NORMAL' | 'LOW'; documentHosts: string[] }
}

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

interface Result { host: string; status: string; message: string; funderLinks: string; websiteSaved: number; notes?: string[] }

const FREQUENCIES = [
  [1440, 'Every day'],
  [4320, 'Every 3 days'],
  [10080, 'Every week'],
] as const
const COUNTRIES = [['', 'All countries'], ['US', 'United States'], ['GB', 'United Kingdom'], ['IN', 'India'], ['DE', 'Germany'], ['FR', 'France'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['NL', 'Netherlands'], ['CH', 'Switzerland'], ['CA', 'Canada'], ['AU', 'Australia'], ['JP', 'Japan'], ['BE', 'Belgium']]
const TYPES = [['', 'All funder types'], ['GOVERNMENT', 'Government'], ['FOUNDATION', 'Foundation'], ['INTERGOVERNMENTAL', 'Intergovernmental'], ['CORPORATE', 'Corporate'], ['UNIVERSITY', 'University']]
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

function defaultSetup(site: Website): Setup {
  const shared = site.funders.length >= 5
  // A funder from another country than the main one is likely a wrong link; leave it unticked.
  const mainCountry = site.funders[0]?.country ?? null
  const plausible = site.funders.filter((f) => !mainCountry || !f.country || f.country === mainCountry)
  return {
    watchUrl: site.suggestions[0]?.url ?? `https://${site.host}/`,
    customUrl: '',
    pageKind: 'PAGE',
    funderIds: (shared ? site.funders.slice(0, 1) : plausible).map((f) => f.id),
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

/**
 * Sources → Add from funding database. Search the calls already in the
 * catalog, grouped by website; pick websites; confirm a short setup for each;
 * add them approved, with their first check due at once.
 */
export default function MonitorCatalogImport({ authedFetch, isSuperAdmin, onAdded }: { authedFetch: AuthedFetch; isSuperAdmin: boolean; onAdded: () => void }) {
  const [q, setQ] = useState('')
  const [country, setCountry] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<'LIVE' | 'ANY' | 'CLOSED'>('LIVE')
  const [unwatched, setUnwatched] = useState(true)
  const [oneOff, setOneOff] = useState(false)
  const [offset, setOffset] = useState(0)
  const [websites, setWebsites] = useState<Website[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Map<string, Website>>(new Map())
  const [step, setStep] = useState<'pick' | 'setup' | 'done'>('pick')
  const [setups, setSetups] = useState<Record<string, Setup>>({})
  const [defaults, setDefaults] = useState<{ frequencyMinutes: number | null; priority: 'SUGGESTED' | 'HIGH' | 'NORMAL' | 'LOW' }>({ frequencyMinutes: null, priority: 'SUGGESTED' })
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Result[]>([])

  const search = useCallback(async (from: number) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ q, status, unwatched: unwatched ? '1' : '0', oneOff: oneOff ? '1' : '0', offset: String(from) })
      if (country) params.set('country', country)
      if (type) params.set('type', type)
      const response = await authedFetch(`/api/funding/monitor/catalog-import?${params}`)
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
  }, [authedFetch, q, status, unwatched, oneOff, country, type])

  useEffect(() => {
    const timer = setTimeout(() => void search(0), 300)
    return () => clearTimeout(timer)
  }, [search])

  function togglePick(site: Website) {
    setPicked((old) => {
      const next = new Map(old)
      if (next.has(site.host)) next.delete(site.host)
      else if (next.size < 25) next.set(site.host, site)
      return next
    })
  }

  function startSetup() {
    const next: Record<string, Setup> = {}
    for (const site of picked.values()) {
      const base = setups[site.host] ?? defaultSetup(site)
      next[site.host] = {
        ...base,
        ...(defaults.frequencyMinutes ? { frequencyMinutes: defaults.frequencyMinutes } : {}),
        ...(defaults.priority !== 'SUGGESTED' ? { priority: defaults.priority } : {}),
      }
    }
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

  async function submit() {
    if (Object.keys(problems).length) return
    setSaving(true)
    setError('')
    try {
      const payload = Object.entries(setups).map(([host, s]) => ({
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
      const response = await authedFetch('/api/funding/monitor/catalog-import', { method: 'POST', body: JSON.stringify({ websites: payload }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not add the websites')
      setResults(data.results)
      setStep('done')
      setPicked(new Map())
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the websites')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'done') {
    const added = results.filter((r) => r.status === 'ADDED' || r.status === 'ALREADY_WATCHED')
    const pending = results.filter((r) => r.status === 'PENDING_APPROVAL')
    const notes = [...new Set(results.flatMap((r) => r.notes ?? []))]
    return (
      <section className="space-y-4">
        {added.length > 0 && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-green-900">
              <CheckCircle2 className="h-5 w-5" /> {added.length} website{added.length === 1 ? '' : 's'} added to the pipeline
            </p>
            <p className="mt-1 text-[13px] text-green-800">Approved, and the first check is due now. New pages will appear in Crawl, and funding calls in Review.</p>
          </div>
        )}
        {pending.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-[15px] font-semibold text-amber-900">{pending.length} website{pending.length === 1 ? '' : 's'} sent to a super admin for approval</p>
            <p className="mt-1 text-[13px] text-amber-800">Your choices are saved on each website. A super admin approves them under Sources → Watched websites; nothing new is fetched until then.</p>
          </div>
        )}
        {notes.map((note) => (
          <p key={note} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}
          </p>
        ))}
        <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-ground">
          {results.map((r) => (
            <li key={r.host} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="font-mono font-medium text-ink">{r.host}</span>
              <span className={r.status === 'ADDED' || r.status === 'ALREADY_WATCHED' ? 'text-green-800' : r.status === 'PENDING_APPROVAL' ? 'text-amber-800' : 'text-red-700'}>{r.message}</span>
              {r.funderLinks === 'SUGGESTED' && <span className="text-nickel-500">Funder links saved as suggestions for a super admin</span>}
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
                  <legend className="cb-label">Funder <span className="font-normal text-nickel-500">· confirm</span></legend>
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

  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-3">
        <label className="relative block">
          <span className="sr-only">Search funders, programmes, countries or websites</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nickel-400" />
          <input className="cb-input h-11 pl-9 text-[14px]" placeholder="Search funders, programmes or websites: NIH, Horizon Europe, ukri.org" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select className="cb-select w-auto text-[12.5px]" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
            {COUNTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="cb-select w-auto text-[12.5px]" value={type} onChange={(e) => setType(e.target.value)} aria-label="Funder type">
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="cb-select w-auto text-[12.5px]" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Call status">
            <option value="LIVE">Has live calls</option>
            <option value="ANY">Any call status</option>
            <option value="CLOSED">Only closed calls</option>
          </select>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"><input type="checkbox" checked={unwatched} onChange={(e) => setUnwatched(e.target.checked)} /> Not yet watched</label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"><input type="checkbox" checked={oneOff} onChange={(e) => setOneOff(e.target.checked)} /> Include one-call websites</label>
        </div>
        <p className="flex items-center gap-2 text-[12.5px] text-nickel-500">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          {loading ? 'Searching the funding database…' : `${total.toLocaleString()} website${total === 1 ? '' : 's'} match · showing ${websites.length ? offset + 1 : 0}–${offset + websites.length}`}
        </p>
        {error && <p role="alert" className="text-[13px] text-red-700">{error}</p>}

        <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-ground">
          {!loading && websites.length === 0 && <li className="p-6 text-center text-[13px] text-nickel-500">No websites match. Try a funder name or a country, or include closed calls.</li>}
          {websites.map((site) => {
            const on = picked.has(site.host)
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
                    <p className="truncate font-mono text-[11.5px] text-nickel-500">Watch: {site.suggestions[0]?.url.replace(/^https?:\/\//, '')}</p>
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
                    <p className="text-[15px] font-semibold tabular-nums text-ink">{site.calls}</p>
                    <p className="text-[11px] text-nickel-500">calls</p>
                    <p className={`mt-1 text-[12px] font-medium tabular-nums ${site.liveCalls ? 'text-green-700' : 'text-nickel-400'}`}>{site.liveCalls} live</p>
                  </div>
                </label>
              </li>
            )
          })}
        </ul>
        {total > 25 && (
          <div className="flex items-center justify-between">
            <button type="button" className="cb-btn-secondary cb-btn-sm" disabled={offset === 0 || loading} onClick={() => void search(Math.max(0, offset - 25))}>Previous</button>
            <button type="button" className="cb-btn-secondary cb-btn-sm" disabled={offset + 25 >= total || loading} onClick={() => void search(offset + 25)}>Next</button>
          </div>
        )}
      </div>

      <aside className="h-fit space-y-3 rounded-xl border border-hairline bg-inset p-4 lg:sticky lg:top-4" aria-label="Selected websites">
        <p className="text-[13px] font-semibold text-ink">{picked.size} selected</p>
        {picked.size === 0 ? (
          <p className="text-[12.5px] text-nickel-500">Tick the websites to watch. You confirm the details for each one next.</p>
        ) : (
          <ul className="space-y-1">
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
        <p className="text-[11.5px] text-nickel-500">Alerts for new finds go to you.</p>
        <button type="button" className="cb-btn-primary w-full justify-center" disabled={!picked.size} onClick={startSetup}>
          Review and add {picked.size || ''}
        </button>
      </aside>
    </section>
  )
}
