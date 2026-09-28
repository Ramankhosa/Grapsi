'use client'

/**
 * Shared pieces for the DSR Reports hub tabs: the report fetch hook, filter
 * controls, clickable summary tiles, pager and export buttons. Every tab keeps
 * its filters in the URL, so any report can open another one already filtered.
 */
import { useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { REPORT_DEFINITIONS } from '@/lib/fundingDept/reportGlossary'

export type Filters = Record<string, string>
export type HubOptions = { schools: Array<{ id: string; name: string }>; members: Array<{ id: string; userId: string; name: string }>; deputySchools?: number }
export type HubBase = { asOf: string; lens: 'department' | 'member'; portfolio?: 'primary' | 'deputy'; options: HubOptions; viewerMemberId: string | null; total: number; page: number; pageSize: number }
export type OpenTab = (tab: HubTab, filters?: Filters) => void
export type HubTab = 'incoming' | 'assigned' | 'pendency' | 'followups'

export const field = 'rounded border border-nickel-300 bg-white px-2 py-1.5 text-sm'
export const define = (term: string) => REPORT_DEFINITIONS.find(d => d.term === term)?.definition || ''
export const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** The filters that define whose work a report shows; they travel with every jump between reports. */
export const SCOPE_KEYS = ['memberId', 'schoolId', 'portfolio'] as const
export function daysLeftLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return { text: 'No deadline', tone: 'nk-sub' }
  if (days < 0) return { text: `Closed ${Math.abs(days)} day${days === -1 ? '' : 's'} ago`, tone: 'text-red-700' }
  if (days === 0) return { text: 'Closes today', tone: 'text-red-700 font-medium' }
  return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: days <= 7 ? 'text-amber-700 font-medium' : 'nk-sub' }
}

export function useHubReport<T>(report: string, filters: Filters, page: number, revision: number) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)); query.set('page', String(page))
  const url = `/api/funding-dept/reports/${report}?${query}`
  useEffect(() => {
    let live = true; setLoading(true); setError('')
    authFetch(url).then(async r => {
      const body = await r.json().catch(() => null)
      if (!r.ok) throw Error(body?.error || `Report request failed (${r.status}).`)
      if (live) setData(body)
    }).catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [url, revision, authFetch])
  return { data, error, loading }
}

export function useExport(report: string, filters: Filters) {
  const { authFetch } = useAuth(); const [error, setError] = useState('')
  const run = async (format: 'csv' | 'xlsx') => {
    setError('')
    try {
      const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)); query.set('format', format)
      const r = await authFetch(`/api/funding-dept/reports/${report}?${query}`)
      if (!r.ok) throw Error((await r.json().catch(() => null))?.error || 'Export failed.')
      const href = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = href; a.download = `dsr-${report}.${format}`; a.click(); URL.revokeObjectURL(href)
    } catch (e) { setError((e as Error).message) }
  }
  return { run, error }
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

/**
 * School and member pickers, shared by every tab: the head picks a member; a
 * coordinator who also covers schools as deputy switches between their own
 * schools and the ones they cover. Changing either resets the school, whose
 * options depend on it.
 */
export function ScopeFilters({ options, lens, filters, patch }: { options?: HubOptions; lens?: string; filters: Filters; patch: (next: Filters) => void }) {
  const deputy = filters.portfolio === 'deputy'
  return <>
    {lens === 'department' && <Select label="DSR member" value={filters.memberId || ''} onChange={v => patch({ memberId: v, schoolId: '' })} all="All members"
      options={(options?.members || []).map(m => [m.id, m.name])} help="Show one member's work: their primary schools (Pendency: the calls they are responsible for)." />}
    {lens === 'member' && (deputy || (options?.deputySchools || 0) > 0) && <Select label="Portfolio" value={deputy ? 'deputy' : ''} all={null}
      onChange={v => patch({ portfolio: v === 'deputy' ? 'deputy' : '', schoolId: '' })} options={[['', 'My schools'], ['deputy', 'Schools I cover as deputy']]}
      help="Your own schools, or the schools you cover for another member. The two are never added together." />}
    {(options?.schools.length || 0) > 1 && <Select label="School" value={filters.schoolId || ''} onChange={v => patch({ schoolId: v })}
      all={lens === 'department' ? 'All schools' : deputy ? 'All schools I cover' : 'All my schools'} options={(options?.schools || []).map(s => [s.id, s.name])} />}
  </>
}

export function Stat({ title, value, help, active, tone = '', onClick }: { title: string; value: number | string | undefined; help: string; active?: boolean; tone?: string; onClick?: () => void }) {
  return <button type="button" title={help} disabled={!onClick} onClick={onClick} aria-pressed={active}
    className={`rounded border p-3 text-left transition enabled:hover:border-cobalt-400 ${active ? 'border-cobalt-500 bg-cobalt-50' : `border-nickel-200 bg-white ${tone}`}`}>
    <span className="block text-xs text-nickel-600">{title}</span><span className="block text-2xl font-semibold tabular-nums">{value ?? '—'}</span></button>
}

export function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="flex items-center justify-end gap-3 p-3 text-sm"><span className="nk-sub">{total} records · page {page} of {pages}</span>
    <button className="nk-btn-secondary nk-btn-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <button className="nk-btn-secondary nk-btn-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div>
}

export function ExportButtons({ report, filters }: { report: string; filters: Filters }) {
  const { run, error } = useExport(report, filters)
  return <div className="flex items-center gap-2">{error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    <button className="nk-btn-secondary nk-btn-xs" title="Every row matching these filters, with a Definitions sheet." onClick={() => run('csv')}>Export CSV</button>
    <button className="nk-btn-secondary nk-btn-xs" title="Every row matching these filters, as Excel, with a Definitions sheet." onClick={() => run('xlsx')}>Export XLSX</button></div>
}

export function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <th className={`px-3 py-2.5 text-left text-xs font-medium text-nickel-600 ${className}`}>{children}</th> }
export function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <td className={`border-t border-nickel-100 px-3 py-2.5 align-top ${className}`}>{children}</td> }

/** First load, error, or — while new filters load over the old figures — a visible "Updating…". */
export function Status({ loading, error, refreshing }: { loading: boolean; error: string; refreshing?: boolean }) {
  if (error) return <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
  if (loading) return <p role="status" className="nk-sub text-sm">Loading…</p>
  if (refreshing) return <p role="status" className="nk-sub text-xs">Updating…</p>
  return null
}
