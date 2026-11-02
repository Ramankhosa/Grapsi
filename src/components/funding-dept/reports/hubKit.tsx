'use client'

/**
 * Shared pieces for the DSR Reports hub tabs: the report fetch hook, filter
 * controls, clickable summary tiles, pager and export buttons. Every tab keeps
 * its filters in the URL, so any report can open another one already filtered.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ChevronDown, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { clientTimeZone } from '@/hooks/useTenantLocale'

import { useAuth } from '@/lib/auth-context'
import { REPORT_DEFINITIONS } from '@/lib/fundingDept/reportGlossary'

export type Filters = Record<string, string>
export type HubOptions = { schools: Array<{ id: string; name: string }>; members: Array<{ id: string; userId: string; name: string }>; deputySchools?: number }
export type HubBase = { asOf: string; snapshot?: string; periodLabel?: string; timeZone?: string; lens: 'department' | 'member'; portfolio?: 'primary' | 'deputy'; options: HubOptions; viewerMemberId: string | null; total: number; page: number; pageSize: number }
export type OpenTab = (tab: HubTab, filters?: Filters) => void
export type HubTab = 'incoming' | 'assigned' | 'pendency' | 'followups'

export const field = 'min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-50'
export const define = (term: string) => REPORT_DEFINITIONS.find(d => d.term === term)?.definition || ''
export const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { timeZone: /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(s) ? 'UTC' : clientTimeZone(), day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** The filters that define whose work a report shows; they travel with every jump between reports. */
export const SCOPE_KEYS = ['memberId', 'schoolId', 'portfolio'] as const
export function daysLeftLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return { text: 'No deadline', tone: 'nk-sub' }
  if (days < 0) return { text: `Closed ${Math.abs(days)} day${days === -1 ? '' : 's'} ago`, tone: 'text-red-700' }
  if (days === 0) return { text: 'Closes today', tone: 'text-red-700 font-medium' }
  return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: days <= 7 ? 'text-amber-700 font-medium' : 'nk-sub' }
}

export function useHubReport<T extends { snapshot?: string }>(report: string, filters: Filters, page: number, revision: number) {
  const { authFetch } = useAuth()
  const [result, setResult] = useState<{ key: string; value: T } | null>(null)
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const snapshots = useRef(new Map<string, string>())
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)); query.set('page', String(page))
  const identity = new URLSearchParams(query); identity.delete('page'); identity.delete('logPage')
  const scopeKey = `${report}?${identity}`
  const key = `${report}?${query}@${revision}:${refresh}`
  useEffect(() => {
    const reload = () => { snapshots.current.clear(); setRefresh(value => value + 1) }
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', reload); window.addEventListener('dsr:refresh', reload)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('dsr:refresh', reload); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  const priorRevision = useRef(revision)
  if (priorRevision.current !== revision) { snapshots.current.clear(); priorRevision.current = revision }
  useEffect(() => {
    let live = true; setLoading(true); setError('')
    const params = new URLSearchParams(query)
    const snapshot = snapshots.current.get(scopeKey)
    if (snapshot) params.set('snapshot', snapshot)
    authFetch(`/api/funding-dept/reports/${report}?${params}`).then(async response => {
      const body = await response.json().catch(() => null)
      if (!response.ok) { if (response.status === 409) snapshots.current.delete(scopeKey); throw Error(body?.error || `Report request failed (${response.status}).`) }
      if (live) { if (body?.snapshot) snapshots.current.set(scopeKey, body.snapshot); setResult({ key, value: body }) }
    }).catch(reason => { if (live) setError(reason.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // key contains the query, revision, and refresh generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, authFetch])
  return { data: result?.key === key && !error ? result.value : null, error, loading }
}

export function useExport(report: string, filters: Filters, snapshot?: string) {
  const { authFetch } = useAuth(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const run = async (format: 'csv' | 'xlsx') => {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)); query.set('format', format)
      if (snapshot) query.set('snapshot', snapshot)
      const response = await authFetch(`/api/funding-dept/reports/${report}?${query}`)
      if (!response.ok) throw Error((await response.json().catch(() => null))?.error || 'Export failed.')
      const href = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = href
      link.download = `dsr-${report}-${new Date().toISOString().slice(0, 10)}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch (reason) { setError((reason as Error).message) } finally { running.current = false; setBusy(false) }
  }
  return { run, error, busy }
}

export function Select({ label, value, onChange, options, all = 'All', help }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>; all?: string | null; help?: string }) {
  return <label className="flex flex-col gap-1 text-xs" title={help}>{label}
    <select className={field} value={value} onChange={e => onChange(e.target.value)}>{all !== null && <option value="">{all}</option>}{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
}
export function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return <label className="flex items-center gap-2 pb-2 text-xs" title={help}><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /> {label}</label>
}
export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  useEffect(() => { if (draft === value) return; const t = setTimeout(() => onChange(draft), 400); return () => clearTimeout(t) }, [draft, value, onChange])
  return <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs">Search<input className={field} value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} /></label>
}

export function ReportFilters({ filters, options, children }: { filters: Filters; options?: HubOptions; children: React.ReactNode }) {
  const [open,setOpen] = useState(false)
  const count = Object.entries(filters).filter(([key,value]) => value && !['page','logPage','callTitle','assignmentLabel'].includes(key)).length
  const scope = [options?.schools.find(school => school.id === filters.schoolId)?.name,options?.members.find(member => member.id === filters.memberId)?.name].filter(Boolean).join(' · ')
  return <section className="nk-panel p-4" aria-label="Report filters">
    <button type="button" className="flex min-h-10 w-full items-center justify-between gap-3 text-sm font-medium text-slate-700 md:hidden" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />Filters & export{count>0&&<span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{count}</span>}</span><ChevronDown className={`h-4 w-4 transition ${open?'rotate-180':''}`} />
    </button>
    {scope&&<p className="mt-1 text-xs text-slate-500 md:hidden">{scope}</p>}
    <div className={`${open?'flex':'hidden'} flex-wrap items-end gap-3 max-md:mt-4 md:flex`}>{children}</div>
  </section>
}

/**
 * School and member pickers, shared by every tab: the head picks a member; a
 * coordinator who also covers schools as deputy switches between their own
 * schools and the ones they cover. Changing either resets the school, whose
 * options depend on it.
 */
export function ScopeFilters({ options, lens, filters, patch }: { options?: HubOptions; lens?: string; filters: Filters; patch: (next: Filters) => void }) {
  const deputy = filters.portfolio === 'deputy'
  return <>
    {lens === 'department' && <Select label="DSR member" value={filters.memberId || ''} onChange={v => patch({ memberId: v, schoolId: '', coordinatorId:'', noCoordinator:'' })} all="All members"
      options={(options?.members || []).map(m => [m.id, m.name])} help="Incoming and Assigned follow the available coordinator. Missed work follows the accountable owner at closing. Follow-ups show performed activity." />}
    {lens === 'member' && (deputy || (options?.deputySchools || 0) > 0) && <Select label="Portfolio" value={deputy ? 'deputy' : ''} all={null}
      onChange={v => patch({ portfolio: v === 'deputy' ? 'deputy' : '', schoolId: '' })} options={[['', 'My schools'], ['deputy', 'Schools I cover as deputy']]}
      help="Your own schools, or the schools you cover for another member. The two are never added together." />}
    {(options?.schools.length || 0) > 1 && <Select label="School" value={filters.schoolId || ''} onChange={v => patch({ schoolId: v })}
      all={lens === 'department' ? 'All schools' : deputy ? 'All schools I cover' : 'All my schools'} options={(options?.schools || []).map(s => [s.id, s.name])} />}
  </>
}

export function Stat({ title, value, help, active, tone = '', onClick, detail }: { title: string; value: number | string | undefined; help: string; active?: boolean; tone?: string; onClick?: () => void; detail?: string }) {
  return <button type="button" title={help} disabled={!onClick} onClick={onClick} aria-pressed={active}
    className={`min-w-0 rounded-2xl border p-4 text-left transition enabled:hover:border-blue-300 enabled:hover:shadow-sm sm:p-5 ${active ? 'border-blue-400 bg-blue-50' : `border-slate-200 bg-white ${tone}`}`}>
    <span className="block text-xs text-nickel-600">{title}</span><span className="mt-2 block text-3xl font-semibold tracking-tight tabular-nums">{value ?? '—'}</span>{detail&&<span className="mt-2 block text-xs text-slate-500">{detail}</span>}</button>
}

export function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => { if (page > pages) onChange(pages) }, [page, pages, onChange])
  return <div className="flex items-center justify-end gap-3 p-3 text-sm"><span className="nk-sub">{total} records · page {page} of {pages}</span>
    <button className="nk-btn-secondary nk-btn-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <button className="nk-btn-secondary nk-btn-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div>
}

export function ExportButtons({ report, filters, snapshot, disabled = false }: { report: string; filters: Filters; snapshot?: string; disabled?: boolean }) {
  const { run, error, busy } = useExport(report, filters, snapshot)
  return <div className="flex flex-wrap items-center gap-2">{error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    <button disabled={disabled || busy} className="nk-btn-secondary nk-btn-xs" title="Every matching row from this report snapshot." onClick={() => run('csv')}><ArrowDownToLine className="h-3.5 w-3.5" />{busy ? 'Preparing…' : 'CSV'}</button>
    <button disabled={disabled || busy} className="nk-btn-secondary nk-btn-xs" title="Excel workbook with the same snapshot and period as this report." onClick={() => run('xlsx')}>Excel</button></div>
}

export function ReportStamp({ data }: { data: Pick<HubBase, 'asOf' | 'periodLabel'> | null }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
    <span>{data?.periodLabel || 'Loading report context…'}{data?.asOf ? ` · Updated ${new Date(data.asOf).toLocaleString('en-IN', {timeZone:clientTimeZone(),day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}` : ''}</span>
    <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 font-medium text-blue-700 hover:bg-blue-50" onClick={() => window.dispatchEvent(new Event('dsr:refresh'))}><RefreshCw className="h-3.5 w-3.5" />Refresh report</button>
  </div>
}

export function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <th className={`px-3 py-2.5 text-left text-xs font-medium text-nickel-600 ${className}`}>{children}</th> }
export function Td({ children, className = '', label }: { children: React.ReactNode; className?: string; label?: string }) { return <td data-label={label} className={`border-t border-nickel-100 px-3 py-2.5 align-top ${className}`}>{children}</td> }

/** First load, error, or — while new filters load over the old figures — a visible "Updating…". */
export function Status({ loading, error, refreshing }: { loading: boolean; error: string; refreshing?: boolean }) {
  if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline" onClick={() => window.dispatchEvent(new Event('dsr:refresh'))}>Try again</button></div>
  if (loading) return <p role="status" className="nk-sub text-sm">Loading…</p>
  if (refreshing) return <p role="status" className="nk-sub text-xs">Updating…</p>
  return null
}
