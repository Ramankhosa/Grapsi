'use client'
import { ChevronDown, ChevronRight, Copy, FileSpreadsheet, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PageOutcome } from '@/lib/monitor/outcomes'
import type { ReviewSummary } from '@/lib/monitor/reviewList'

import DiscoveryDetail from './DiscoveryDetail'
import { OUTCOME_STYLES } from './outcome'
type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>

const ALL_LANES: Array<[string, string]> = [['PENDING', 'To review'], ['WAITING_LOCAL', 'Waiting for laptop'], ['NEEDS_EVIDENCE', 'Needs evidence'], ['UPDATE_PROPOSED', 'Updates'], ['PUBLISHED', 'Published'], ['REJECTED', 'Rejected'], ['SNOOZED', 'Snoozed'], ['AUDIT', 'Screened out'], ['ALL', 'All']]
// "Most promising first": found calls ahead of pages that could not be read.
const OUTCOME_RANK: Partial<Record<PageOutcome, number>> = { FUNDING_FOUND: 0, PUBLISHED: 1, UNSURE: 2, INCOMPLETE: 3, SCREENING: 4, WAITING_LOCAL: 5, UNREADABLE: 6, NOT_FUNDING: 7 }
const DEADLINES: Array<[string, string]> = [['', 'Any deadline'], ['open', 'Open now'], ['soon', 'Closes within 30 days'], ['upcoming', 'Opens later'], ['passed', 'Deadline passed'], ['none', 'No date found']]
const DUPLICATES: Array<[string, string]> = [['', 'Duplicates: any'], ['catalogue', 'Possibly in the catalogue'], ['repeat', 'Found more than once'], ['clear', 'No duplicate found']]
const SORTS: Array<[string, string]> = [['promising', 'Most promising first'], ['deadline', 'Deadline, soonest first'], ['newest', 'Newest found first'], ['title', 'Title A–Z']]
const DAY = 86_400_000

const today = () => new Date().toISOString().slice(0, 10)
function deadlineBucket(row: ReviewSummary, now: string): string {
  const close = row.facts.deadline
  if (['EXPIRED', 'CANCELLED', 'WITHDRAWN'].includes(row.lifecycle) || (close && close < now)) return 'passed'
  if (row.lifecycle === 'FUTURE') return 'upcoming'
  if (close && Date.parse(close) - Date.parse(now) <= 30 * DAY) return 'soon'
  if (['OPEN', 'ROLLING', 'REOPENED'].includes(row.lifecycle) || row.facts.rolling || close) return 'open'
  return 'none'
}
function deadlineText(row: ReviewSummary, now: string) {
  const close = row.facts.deadline
  if (!close) return row.facts.rolling ? { main: 'Rolling', sub: 'no fixed deadline' } : row.facts.opens ? { main: '—', sub: `opens ${row.facts.opens}` } : { main: '—', sub: 'no date found' }
  const days = Math.round((Date.parse(close) - Date.parse(now)) / DAY)
  return { main: close, sub: days < 0 ? `passed ${-days} d ago` : days === 0 ? 'closes today' : `in ${days} d` }
}
const isDuplicate = (row: ReviewSummary) => row.duplicates.catalogue.length > 0
const isRepeat = (row: ReviewSummary) => row.duplicates.discoveries.length > 0

export default function MonitorDiscoveries({ authedFetch, canOperate, canPublish, lanes = ALL_LANES, intro }: { authedFetch: AuthedFetch; canOperate: boolean; canPublish: boolean; lanes?: Array<[string, string]>; intro?: string }) {
  const [lane, setLane] = useState(lanes[0][0])
  const [rows, setRows] = useState<ReviewSummary[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [serverQ, setServerQ] = useState('')
  const [outcome, setOutcome] = useState('')
  const [deadline, setDeadline] = useState('')
  const [duplicate, setDuplicate] = useState('')
  const [host, setHost] = useState('')
  const [sort, setSort] = useState('promising')
  const request = useRef(0)
  // The parent passes a new lanes array on every render; only its contents matter.
  const laneKey = lanes.map(l => l[0]).join(',')

  const load = useCallback(async () => {
    const id = ++request.current
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ lane, lanes: laneKey })
      if (serverQ) params.set('q', serverQ)
      const response = await authedFetch(`/api/funding/monitor/discoveries?${params}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not load discoveries')
      if (id !== request.current) return // A newer lane or search answered first.
      setRows(data.rows); setCounts(data.counts ?? {}); setTotal(data.total); setTruncated(Boolean(data.truncated))
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : 'Could not load discoveries') }
    finally { if (id === request.current) setLoading(false) }
  }, [authedFetch, lane, laneKey, serverQ])
  useEffect(() => { void load() }, [load])
  // A lane bigger than one load is searched on the server; otherwise the search filters what is loaded.
  useEffect(() => {
    if (!truncated && !serverQ) return
    const timer = setTimeout(() => setServerQ(q.trim()), 400)
    return () => clearTimeout(timer)
  }, [q, truncated, serverQ])
  function switchLane(value: string) {
    if (value === lane) return
    setLane(value); setOpen(null); setRows([]); setServerQ(''); setOutcome(''); setHost('')
  }

  const now = today()
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = rows.filter(row => {
      if (outcome && row.outcome !== outcome) return false
      if (host && row.host !== host) return false
      if (deadline && deadlineBucket(row, now) !== deadline) return false
      if (duplicate === 'catalogue' && !isDuplicate(row)) return false
      if (duplicate === 'repeat' && !isRepeat(row)) return false
      if (duplicate === 'clear' && (isDuplicate(row) || isRepeat(row))) return false
      if (words.length) {
        const hay = `${row.title} ${row.facts.funder ?? ''} ${row.host} ${row.url ?? ''} ${row.reason ?? ''}`.toLowerCase()
        if (!words.every(w => hay.includes(w))) return false
      }
      return true
    })
    const byDeadline = (r: ReviewSummary) => r.facts.deadline && r.facts.deadline >= now ? r.facts.deadline : '9999'
    return list.sort((a, b) =>
      sort === 'deadline' ? byDeadline(a).localeCompare(byDeadline(b)) || b.found.localeCompare(a.found)
        : sort === 'newest' ? b.found.localeCompare(a.found)
          : sort === 'title' ? a.title.localeCompare(b.title)
            : (OUTCOME_RANK[a.outcome] ?? 9) - (OUTCOME_RANK[b.outcome] ?? 9) || b.found.localeCompare(a.found))
  }, [rows, q, outcome, host, deadline, duplicate, sort, now])

  const tally = <K extends string>(key: (r: ReviewSummary) => K) => { const m = new Map<K, number>(); for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1); return m }
  const outcomes = useMemo(() => [...tally(r => r.outcome).entries()].sort((a, b) => (OUTCOME_RANK[a[0]] ?? 9) - (OUTCOME_RANK[b[0]] ?? 9)), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const hosts = useMemo(() => [...tally(r => r.host).entries()].sort((a, b) => b[1] - a[1]), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const duplicates = rows.filter(isDuplicate).length
  const filtered = Boolean(q || outcome || deadline || duplicate || host)

  async function download() {
    setExporting(true); setError('')
    try {
      const response = await authedFetch(`/api/funding/monitor/discoveries/export?lane=${lane}`)
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? 'The download failed')
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'source-watch.xlsx'
      const href = URL.createObjectURL(await response.blob())
      const link = document.createElement('a'); link.href = href; link.download = name; link.click()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : 'The download failed') }
    finally { setExporting(false) }
  }
  function clearFilters() { setQ(''); setServerQ(''); setOutcome(''); setDeadline(''); setDuplicate(''); setHost('') }

  return <section className="space-y-3">
    {intro !== '' && <p className="cb-hint">{intro ?? 'New announcements and source changes appear here. Review the quoted evidence before publishing. Drafts are never published automatically.'}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {lanes.map(([value, label]) => <button key={value} className={`cb-chip ${lane === value ? 'cb-chip-active' : ''}`} onClick={() => switchLane(value)}>{label}{counts[value] !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{counts[value].toLocaleString('en-GB')}</span>}</button>)}
      <span className="ml-auto flex gap-2">
        <button className="cb-btn-secondary cb-btn-sm" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Refresh</button>
        <button className="cb-btn-secondary cb-btn-sm" disabled={exporting} onClick={() => void download()} title="An Excel sheet of this whole lane, with the duplicate check, for manual review">{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />} Download Excel</button>
      </span>
    </div>

    <div className="cb-card-inset flex flex-wrap items-center gap-2 p-2">
      <label className="relative min-w-[14rem] flex-1">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input className="cb-input w-full pl-8" placeholder="Search title, funder, website or link" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <select aria-label="Result" className="cb-select w-auto" value={outcome} onChange={e => setOutcome(e.target.value)}>
        <option value="">All results</option>
        {outcomes.map(([value, n]) => <option key={value} value={value}>{OUTCOME_STYLES[value].label} ({n})</option>)}
      </select>
      <select aria-label="Deadline" className="cb-select w-auto" value={deadline} onChange={e => setDeadline(e.target.value)}>{DEADLINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select aria-label="Duplicates" className="cb-select w-auto" value={duplicate} onChange={e => setDuplicate(e.target.value)}>{DUPLICATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select aria-label="Website" className="cb-select w-auto max-w-[13rem]" value={host} onChange={e => setHost(e.target.value)}>
        <option value="">All websites</option>
        {hosts.map(([value, n]) => <option key={value} value={value}>{value} ({n})</option>)}
      </select>
      <select aria-label="Sort" className="cb-select w-auto" value={sort} onChange={e => setSort(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {filtered && <button className="cb-btn-ghost cb-btn-sm" onClick={clearFilters}><X className="h-3.5 w-3.5" /> Clear</button>}
    </div>

    <p className="cb-hint" aria-live="polite">
      {loading && !rows.length ? 'Loading…' : <>Showing {shown.length.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}{truncated && !serverQ ? ` (the newest ${rows.length.toLocaleString('en-GB')} are loaded; searching looks through all of them)` : ''}{duplicates > 0 && <> · <button className="underline" onClick={() => setDuplicate('catalogue')}>{duplicates} may already be in the catalogue</button></>}</>}
    </p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!loading && !shown.length && <p className="cb-hint">{filtered ? 'Nothing matches these filters.' : 'Nothing in this view yet. The Crawl stage shows whether websites are being checked.'}</p>}

    <ul className={`divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white ${loading && rows.length ? 'opacity-60' : ''}`}>
      {shown.map(row => <ReviewRow key={row.id} row={row} now={now} open={open === row.id} onToggle={() => setOpen(open === row.id ? null : row.id)}>
        {open === row.id && <DiscoveryDetail id={row.id} summary={row} authedFetch={authedFetch} canOperate={canOperate} canPublish={canPublish} onOpen={id => setOpen(id)} onChanged={() => void load()} />}
      </ReviewRow>)}
    </ul>
  </section>
}

function ReviewRow({ row, now, open, onToggle, children }: { row: ReviewSummary; now: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const style = OUTCOME_STYLES[row.outcome]
  const due = deadlineText(row, now)
  const passed = deadlineBucket(row, now) === 'passed'
  return <li id={`discovery-${row.id}`} className="relative">
    <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${style.dot}`} />
    <button className="grid w-full grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 py-2.5 pl-4 pr-3 text-left hover:bg-gray-50 md:grid-cols-[minmax(0,1fr)_8rem_8.5rem_14rem_1rem]" aria-expanded={open} onClick={onToggle}>
      <span className="min-w-0">
        <span className="block truncate font-medium text-gray-900" title={row.title}>{row.title}</span>
        <span className="block truncate text-[12px] text-gray-500">{[row.facts.funder, row.host].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="hidden text-[13px] md:block"><span className={`block tabular-nums ${passed ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{due.main}</span><span className={`block text-[11px] ${passed ? 'text-red-700' : 'text-gray-500'}`}>{due.sub}</span></span>
      <span className="hidden truncate text-[13px] text-gray-700 md:block" title={row.facts.award ?? ''}>{row.facts.award ?? <span className="text-gray-400">—</span>}</span>
      <span className="col-span-2 flex flex-wrap items-center gap-1.5 md:col-span-1 md:justify-end">
        <span className="text-[12px] text-gray-600 md:hidden">{due.main === '—' ? due.sub : `${due.main} · ${due.sub}`}</span>
        {isDuplicate(row) && <span title={row.duplicates.catalogue.map(t => `${t.reason}: ${t.title}`).join('\n')} className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900"><Copy className="h-3 w-3" />In catalogue?</span>}
        {isRepeat(row) && <span title={row.duplicates.discoveries.map(t => `${t.reason}: ${t.title} (${t.host})`).join('\n')} className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">Found {row.duplicates.discoveries.length + 1}×</span>}
        {row.call && <span className="inline-flex items-center rounded-full border border-cobalt-200 bg-cobalt-50 px-2 py-0.5 text-[11px] font-medium text-cobalt-800">Drafted</span>}
        <span title={row.outcomeDetail} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{style.label}</span>
      </span>
      <span className="hidden pt-0.5 text-gray-400 md:block">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
    </button>
    {children}
  </li>
}
