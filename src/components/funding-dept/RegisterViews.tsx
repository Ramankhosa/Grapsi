'use client'

/**
 * The reports built on stored call-to-school responsibilities: Overview, Call
 * Register, Mapping register and Audit trail. Every figure here is a count the
 * server takes over the same rows the Register lists, so clicking a number
 * opens exactly the records it counts.
 */
import Link from 'next/link'
import { Fragment, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import {
  DEADLINE_STATE_LABELS, DEADLINE_STATES, REPORT_DEFINITIONS, REVIEW_STATE_LABELS, REVIEW_STATES, SUBMISSION_STATE_LABELS,
  type DeadlineState, type ReviewState, type SubmissionState,
} from '@/lib/fundingDept/reportGlossary'

export type RegisterFilterState = Record<string, string>

const field = 'rounded border border-nickel-300 bg-white px-2 py-1.5 text-sm'
const date = (s?: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded'
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const define = (term: string) => REPORT_DEFINITIONS.find(d => d.term === term)?.definition || ''
const SUBMISSION_FILTERS: Array<[string, string]> = [['NO_ALLOCATION', 'No allocation'], ['NONE_SUBMITTED', 'Allocated, none submitted'], ['PARTLY_SUBMITTED', 'Partly submitted'], ['ALL_SUBMITTED', 'All submitted']]
const SOURCES: Array<[string, string]> = [['ORIGIN', 'Origin school'], ['INGESTION_DIRECT', 'Direct discipline match'], ['INGESTION_KEYWORD', 'Keyword match'], ['INGESTION_BROAD', 'Broad discipline group'], ['ADDED_BY_HEAD', 'Added by the head'], ['RECONSTRUCTED_FROM_WORK', 'Reconstructed from work']]
const deadlineTone = (s: DeadlineState) => s.startsWith('MISSED') ? 'text-red-700' : s === 'CLOSING_SOON' ? 'text-amber-700' : 'nk-sub'

function useJson<T>(url: string | null, revision = 0) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!url) return
    let live = true; setLoading(true); setError('')
    authFetch(url).then(async r => { const body = await r.json().catch(() => null); if (!r.ok) throw Error(body?.error || `Request failed (${r.status})`); if (live) setData(body) })
      .catch(e => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [url, revision, authFetch])
  return { data, error, loading }
}

function Pager({ page, total = 0, pageSize = 20, onChange }: { page: number; total?: number; pageSize?: number; onChange: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="flex items-center justify-end gap-3 p-3 text-sm"><span>{total} records · Page {page} of {pages}</span>
    <button className="nk-btn-secondary nk-btn-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <button className="nk-btn-secondary nk-btn-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button></div>
}
function Stat({ title, value, help, onClick, tone = '' }: { title: string; value: number | string | undefined; help: string; onClick?: () => void; tone?: string }) {
  return <button title={help} disabled={!onClick} onClick={onClick} className={`rounded border border-nickel-200 bg-white p-3 text-left enabled:hover:border-cobalt-400 ${tone}`}>
    <span className="block text-xs text-nickel-600">{title}</span><span className="block text-2xl font-semibold">{value ?? '—'}</span></button>
}
function useDownload() {
  const { authFetch } = useAuth(); const [error, setError] = useState('')
  const download = async (url: string, name: string) => {
    setError('')
    try { const r = await authFetch(url); if (!r.ok) throw Error((await r.json().catch(() => null))?.error || 'Export failed.'); const href = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = href; a.download = name; a.click(); URL.revokeObjectURL(href) }
    catch (e) { setError((e as Error).message) }
  }
  return { download, error }
}

/* ------------------------------------------------------------------ Overview */

type OverviewPayload = {
  totals: Record<'callsEntered' | 'callsMapped' | 'reviewsPending' | 'reviewedUnallocated' | 'allocations' | 'submissions' | 'responsibilities', number>
  needsAttention: Record<'overdueActions' | 'reviewsOverdue' | 'closingSoonUnallocated' | 'missedNeverAllocated' | 'missedAllocatedNotSubmitted' | 'withoutCoordinator', number>
  schools: Array<{ school_id: string; school_name: string; coordinator_id: string | null; coordinator_name: string | null; responsibilities: number; reviews_pending: number; reviewed_unallocated: number; allocated: number; closed: number; submissions: number; missed: number }>
  unclassified: { total: number; overdue: number; overdueAfterDays: number } | null
  routingEnabled: boolean; windowLabel: string; asOf: string; lens: string
}

export function OverviewView({ periodQuery, revision, openRegister, openActions, openMapping }: {
  periodQuery: string; revision: number; openRegister: (f: RegisterFilterState) => void; openActions: (queue?: string) => void; openMapping: (tab: string) => void
}) {
  const { data, error, loading } = useJson<OverviewPayload>(`/api/funding-dept/reports/overview?${periodQuery}`, revision)
  const { download, error: exportError } = useDownload()
  if (error) return <p role="alert" className="text-red-700">{error}</p>
  if (!data) return <p className="nk-sub">{loading ? 'Loading overview…' : ''}</p>
  const t = data.totals, n = data.needsAttention
  const all = { window: 'all' }
  return <div className="space-y-5">
    {!data.routingEnabled && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Calls are mapped to schools but not yet routed into coordinator queues. The department head can switch on “Route calls by school relevance” in funding department settings after reviewing the Mapping register.</p>}
    <section className="nk-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">Needs attention now</h2><span className="nk-sub text-xs">Ignores the reporting period, so no backlog or missed call is filtered out of view</span></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat title="Overdue actions" value={n.overdueActions} help="School responsibilities with an open named action past its due date. My Actions also flags late first reviews and silent work." onClick={() => openRegister({ window: 'all', overdueActions: 'true' })} tone={n.overdueActions ? 'border-red-300' : ''} />
        <Stat title="Reviews overdue" value={n.reviewsOverdue} help="School responsibilities not reviewed within the department's untouched threshold." onClick={() => openRegister({ ...all, reviewState: 'NOT_REVIEWED' })} />
        <Stat title="Closing soon, not allocated" value={n.closingSoonUnallocated} help={define(`Deadline: ${DEADLINE_STATE_LABELS.CLOSING_SOON}`)} onClick={() => openRegister({ ...all, deadlineState: 'CLOSING_SOON' })} tone={n.closingSoonUnallocated ? 'border-amber-300' : ''} />
        <Stat title="Missed, never allocated" value={n.missedNeverAllocated} help={define(`Deadline: ${DEADLINE_STATE_LABELS.MISSED_NEVER_ALLOCATED}`)} onClick={() => openRegister({ ...all, deadlineState: 'MISSED_NEVER_ALLOCATED' })} tone={n.missedNeverAllocated ? 'border-red-300' : ''} />
        <Stat title="Missed, allocated not submitted" value={n.missedAllocatedNotSubmitted} help={define(`Deadline: ${DEADLINE_STATE_LABELS.MISSED_ALLOCATED_NOT_SUBMITTED}`)} onClick={() => openRegister({ ...all, deadlineState: 'MISSED_ALLOCATED_NOT_SUBMITTED' })} tone={n.missedAllocatedNotSubmitted ? 'border-red-300' : ''} />
        <Stat title="Responsibilities with no coordinator" value={n.withoutCoordinator} help="Mapped calls in schools nobody covers. Assign coverage." onClick={() => openMapping('schools')} />
      </div>
      <p className="mt-3 text-sm"><button className="text-cobalt-700 underline" onClick={() => openActions()}>Open My Actions</button> for every outstanding duty, most urgent first.</p>
      {data.unclassified && <p className="mt-1 text-sm"><button className="text-cobalt-700 underline" onClick={() => openMapping('unclassified')}>Unclassified queue: {data.unclassified.total} open call{data.unclassified.total === 1 ? '' : 's'}</button>
        {data.unclassified.overdue > 0 && <span className="ml-2 text-red-700">{data.unclassified.overdue} older than {data.unclassified.overdueAfterDays} days</span>}</p>}
    </section>
    <section className="nk-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{data.windowLabel}</h2><span className="nk-sub text-xs">Calls that entered in this period, with their progress as of {new Date(data.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat title="Calls entered" value={t.callsEntered} help={define('Unique calls')} />
        <Stat title="Calls mapped to a school" value={t.callsMapped} help="Unique calls with at least one school responsibility." onClick={() => openRegister({})} />
        <Stat title="School reviews pending" value={t.reviewsPending} help={define(`Review: ${REVIEW_STATE_LABELS.NOT_REVIEWED}`)} onClick={() => openRegister({ reviewState: 'NOT_REVIEWED' })} />
        <Stat title="Reviewed, not allocated" value={t.reviewedUnallocated} help={define(`Review: ${REVIEW_STATE_LABELS.REVIEWED_ALLOCATION_PENDING}`)} onClick={() => openRegister({ reviewState: 'REVIEWED_ALLOCATION_PENDING' })} />
        <Stat title="Allocations made" value={t.allocations} help={define('Allocations')} onClick={() => openRegister({ reviewState: 'ALLOCATED' })} />
        <Stat title="Submissions" value={t.submissions} help={define('Submissions')} onClick={() => openRegister({ submission: 'PARTLY_SUBMITTED' })} />
      </div>
    </section>
    <section className="nk-panel overflow-x-auto">
      <div className="flex items-center justify-between p-3"><h2 className="font-semibold">Coordinator by school</h2>
        {data.lens === 'department' && <button className="nk-btn-secondary nk-btn-xs" title="One workbook for a school or university review meeting: overview, register, missed calls, corrective actions and the unclassified queue." onClick={() => download(`/api/funding-dept/reports/governance?${periodQuery}`, 'dsr-governance-pack.xlsx')}>Download governance pack</button>}</div>
      {exportError && <p role="alert" className="px-3 text-red-700">{exportError}</p>}
      <table className="min-w-full text-left text-sm"><thead className="bg-nickel-50"><tr>{['School', 'Responsible coordinator', 'Responsibilities', 'Not reviewed', 'Reviewed, not allocated', 'Allocated', 'Closed', 'Submissions', 'Missed'].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{data.schools.map(s => {
          const open = (extra: RegisterFilterState) => () => openRegister({ schoolId: s.school_id, ...extra })
          const cell = (value: number, extra: RegisterFilterState) => <td className="border-t border-nickel-100 px-3 py-2"><button className="text-cobalt-700 disabled:text-nickel-400" disabled={!value} onClick={open(extra)}>{value}</button></td>
          return <tr key={s.school_id}><td className="border-t border-nickel-100 px-3 py-2 font-medium">{s.school_name}</td>
            <td className="border-t border-nickel-100 px-3 py-2">{s.coordinator_name || <button className="text-amber-700 underline" onClick={() => openMapping('schools')}>Assign coverage</button>}</td>
            {cell(s.responsibilities, {})}{cell(s.reviews_pending, { reviewState: 'NOT_REVIEWED' })}{cell(s.reviewed_unallocated, { reviewState: 'REVIEWED_ALLOCATION_PENDING' })}
            {cell(s.allocated, { reviewState: 'ALLOCATED' })}{cell(s.closed, { reviewState: 'CLOSED_NO_ALLOCATION' })}
            <td className="border-t border-nickel-100 px-3 py-2">{s.submissions}</td>{cell(s.missed, { window: 'all', deadlineState: 'MISSED_NEVER_ALLOCATED' })}</tr>
        })}{!data.schools.length && <tr><td colSpan={9} className="p-5 text-center nk-sub">No school responsibilities in this period. Calls reach schools once they are classified and mapped.</td></tr>}</tbody></table>
    </section>
  </div>
}

/* ------------------------------------------------------------------ Register */

type Responsibility = {
  schoolId: string; schoolName: string; sourceLabel: string; tier: string | null; mappingReason: string | null; mappedAt: string; backfilled: boolean
  coordinator: { id: string; name: string } | null; transferred: boolean; reviewState: ReviewState; deadlineState: DeadlineState
  allocations: Array<{ applicationId: string; faculty: string | null; allocatedBy: string | null; allocatedAt: string; submissionState: SubmissionState; workingStage: string | null }>
  independent: Array<{ applicationId: string; faculty: string | null; submissionState: SubmissionState }>
  disposition: { reason: string; explanation: string | null } | null; nextAction: { title: string; owner: string | null; dueAt: string | null } | null
}
type RegisterRow = { callId: string; title: string; agency: string | null; enteredAt: string; deadline: string | null; schoolNames: string[]; submissionLabel: string; deadlineState: DeadlineState; nextAction: string; responsibilities: Responsibility[] }
type RegisterPayload = { rows: RegisterRow[]; total: number; page: number; pageSize: number; totals: { calls: number; responsibilities: number; schools: number; allocations: number; allocatedSubmissions: number }; windowLabel: string; lens: string }

export function RegisterView({ periodQuery, filters, setFilters, schools, revision, onAudit }: {
  periodQuery: string; filters: RegisterFilterState; setFilters: (f: RegisterFilterState) => void; schools: Array<{ id: string; name: string }>; revision: number; onAudit: (callId: string) => void
}) {
  const [page, setPage] = useState(1); const [open, setOpen] = useState<Record<string, boolean>>({})
  useEffect(() => setPage(1), [periodQuery, filters])
  const query = new URLSearchParams(periodQuery)
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v)
  const { data, error, loading } = useJson<RegisterPayload>(`/api/funding-dept/reports/register?${query}&page=${page}`, revision)
  const { download, error: exportError } = useDownload()
  const set = (key: string, value: string) => setFilters({ ...filters, [key]: value })
  const pick = (key: string, title: string, options: Array<[string, string]>) => <label className="flex flex-col gap-1 text-xs">{title}<select className={field} value={filters[key] || ''} onChange={e => set(key, e.target.value)}><option value="">All</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  return <div className="space-y-4">
    <div className="nk-panel flex flex-wrap items-end gap-3 p-4">
      {pick('schoolId', 'School', schools.map(s => [s.id, s.name]))}
      {pick('reviewState', 'Review state', REVIEW_STATES.map(s => [s, REVIEW_STATE_LABELS[s]]))}
      {pick('submission', 'Submission', SUBMISSION_FILTERS)}
      {pick('deadlineState', 'Deadline', DEADLINE_STATES.map(s => [s, DEADLINE_STATE_LABELS[s]]))}
      {pick('source', 'Mapping source', SOURCES)}
      <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" checked={filters.overdueActions === 'true'} onChange={e => set('overdueActions', e.target.checked ? 'true' : '')} /> Overdue actions only</label>
      <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" checked={filters.window === 'all'} onChange={e => set('window', e.target.checked ? 'all' : '')} /> All periods</label>
      <div className="ml-auto flex gap-2">
        <button className="nk-btn-secondary nk-btn-xs" onClick={() => setFilters({ window: 'all', deadlineState: 'MISSED_NEVER_ALLOCATED' })}>Missed, never allocated</button>
        <button className="nk-btn-secondary nk-btn-xs" onClick={() => setFilters({ window: 'all', deadlineState: 'MISSED_ALLOCATED_NOT_SUBMITTED' })}>Missed, not submitted</button>
        <button className="nk-btn-secondary nk-btn-xs" onClick={() => setFilters({})}>Clear</button>
        <button className="nk-btn-secondary nk-btn-xs" title="Every row matching these filters, as on screen, with a Definitions sheet." onClick={() => download(`/api/funding-dept/reports/register?${query}&format=csv`, 'dsr-call-register.csv')}>Export CSV</button>
        <button className="nk-btn-secondary nk-btn-xs" onClick={() => download(`/api/funding-dept/reports/register?${query}&format=xlsx`, 'dsr-call-register.xlsx')}>Export XLSX</button>
      </div>
    </div>
    {(error || exportError) && <p role="alert" className="text-red-700">{error || exportError}</p>}
    {loading && <p role="status" className="nk-sub">Loading register…</p>}
    {data && <p className="nk-sub text-sm" title={`${define('Unique calls')} ${define('School responsibilities')}`}>{data.windowLabel}: {plural(data.totals.calls, 'unique call')} · {plural(data.totals.responsibilities, 'school responsibility', 'school responsibilities')} in {plural(data.totals.schools, 'school')} · {data.totals.allocatedSubmissions} of {plural(data.totals.allocations, 'allocation')} submitted</p>}
    {data && <section className="nk-panel overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-nickel-50"><tr>{['Call', 'Entered', 'Relevant schools', 'Allocation & submission', 'Deadline', 'Next action'].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{data.rows.map(row => <Fragment key={row.callId}>
        <tr className="align-top"><td className="border-t border-nickel-100 px-3 py-2"><button className="text-left font-medium text-cobalt-700" aria-expanded={!!open[row.callId]} onClick={() => setOpen(o => ({ ...o, [row.callId]: !o[row.callId] }))}>{open[row.callId] ? '−' : '+'} {row.title}</button><p className="nk-sub">{row.agency || 'Agency not recorded'}</p></td>
          <td className="border-t border-nickel-100 px-3 py-2">{date(row.enteredAt)}</td>
          <td className="border-t border-nickel-100 px-3 py-2">{row.schoolNames.join(', ')}</td>
          <td className="border-t border-nickel-100 px-3 py-2">{row.submissionLabel}</td>
          <td className="border-t border-nickel-100 px-3 py-2">{date(row.deadline)}<p className={deadlineTone(row.deadlineState)}>{DEADLINE_STATE_LABELS[row.deadlineState]}</p></td>
          <td className="border-t border-nickel-100 px-3 py-2">{row.nextAction}</td></tr>
        {open[row.callId] && <tr><td colSpan={6} className="bg-nickel-50 p-3"><div className="space-y-3">{row.responsibilities.map(r => <div key={r.schoolId} className="rounded border border-nickel-200 bg-white p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-medium">{r.schoolName}</p><span className="nk-badge" title={define(`Review: ${REVIEW_STATE_LABELS[r.reviewState]}`)}>{REVIEW_STATE_LABELS[r.reviewState]}</span></div>
          <p className="nk-sub">Mapped {date(r.mappedAt)} · {r.sourceLabel}{r.mappingReason ? ` — ${r.mappingReason}` : ''}{r.backfilled ? ' · reconstructed at backfill' : ''}</p>
          <p>Responsible now: {r.coordinator?.name || <span className="text-amber-700">No coordinator — assign coverage</span>}{r.transferred ? ' (transferred)' : ''}</p>
          {r.allocations.map(a => <p key={a.applicationId} className="text-sm">Allocated {a.faculty || 'faculty not recorded'} · by {a.allocatedBy || 'not recorded'} on {date(a.allocatedAt)} · <span title={define(`Submission: ${SUBMISSION_STATE_LABELS[a.submissionState]}`)}>{SUBMISSION_STATE_LABELS[a.submissionState]}</span>{a.workingStage ? ` (${a.workingStage.toLowerCase().replace(/_/g, ' ')})` : ''}</p>)}
          {r.independent.map(a => <p key={a.applicationId} className="text-sm">Independent application: {a.faculty} · {SUBMISSION_STATE_LABELS[a.submissionState]}</p>)}
          {r.disposition && <p className="text-sm">Closed: {r.disposition.reason.toLowerCase().replace(/_/g, ' ')}{r.disposition.explanation ? ` — ${r.disposition.explanation}` : ''}</p>}
          <p className="text-sm">Next: {r.nextAction ? `${r.nextAction.title} · ${r.nextAction.owner || ''}${r.nextAction.dueAt ? ` · due ${date(r.nextAction.dueAt)}` : ''}` : 'No open action'} · <span className={deadlineTone(r.deadlineState)}>{DEADLINE_STATE_LABELS[r.deadlineState]}</span></p>
          <p className="mt-1 flex gap-3 text-sm"><Link className="text-cobalt-700 underline" target="_blank" href={`/funding-dept/calls/${encodeURIComponent(row.callId)}?school=${encodeURIComponent(r.schoolId)}`}>Open call workspace</Link><button className="text-cobalt-700 underline" onClick={() => onAudit(row.callId)}>Audit trail</button></p>
        </div>)}</div></td></tr>}
      </Fragment>)}{!data.rows.length && <tr><td colSpan={6} className="p-6 text-center nk-sub">No calls match these filters.</td></tr>}</tbody></table>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
  </div>
}

/* ------------------------------------------------------------ Mapping register */

export function MappingView({ tab, setTab, schools, isHead, revision, refresh }: { tab: string; setTab: (t: string) => void; schools: Array<{ id: string; name: string }>; isHead: boolean; revision: number; refresh: () => void }) {
  const { authFetch } = useAuth()
  const [page, setPage] = useState(1); const [filters, setFilters] = useState<RegisterFilterState>({}); const [actionError, setActionError] = useState('')
  useEffect(() => setPage(1), [tab, filters])
  const query = new URLSearchParams({ tab, page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) })
  const { data, error, loading } = useJson<any>(`/api/funding-dept/reports/mapping?${query}`, revision)
  const { download, error: exportError } = useDownload()
  const change = async (operation: 'ADD' | 'END', callId: string, schoolId: string) => {
    const reason = window.prompt(operation === 'END' ? 'Why does this school no longer own this call?' : 'Why should this school own this call?')
    if (!reason?.trim()) return
    setActionError('')
    const r = await authFetch('/api/funding-dept/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, callId, schoolId, reason }) })
    if (!r.ok) setActionError((await r.json()).error); else refresh()
  }
  const tabs: Array<[string, string]> = [['mapped', 'Mapped'], ...(isHead ? [['unclassified', 'Unclassified queue'] as [string, string]] : []), ['schools', 'Schools without areas or coverage']]
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">{tabs.map(([id, name]) => <button key={id} className={tab === id ? 'nk-btn-primary nk-btn-sm' : 'nk-btn-secondary nk-btn-sm'} onClick={() => setTab(id)}>{name}</button>)}</div>
    {tab === 'mapped' && <div className="nk-panel flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-col gap-1 text-xs">School<select className={field} value={filters.schoolId || ''} onChange={e => setFilters({ ...filters, schoolId: e.target.value })}><option value="">All</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs">Source<select className={field} value={filters.source || ''} onChange={e => setFilters({ ...filters, source: e.target.value })}><option value="">All</option>{SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs">Status<select className={field} value={filters.active || ''} onChange={e => setFilters({ ...filters, active: e.target.value })}><option value="">All</option><option value="active">Active</option><option value="ended">Ended</option></select></label>
      <label className="flex flex-col gap-1 text-xs">Call<input className={field} placeholder="Title or identifier" value={filters.callSearch || ''} onChange={e => setFilters({ ...filters, callSearch: e.target.value })} /></label>
      <button className="nk-btn-secondary nk-btn-xs ml-auto" onClick={() => download(`/api/funding-dept/reports/mapping?${query}&format=xlsx`, 'dsr-mapping-register.xlsx')}>Export XLSX</button>
    </div>}
    {(error || exportError || actionError) && <p role="alert" className="text-red-700">{error || exportError || actionError}</p>}
    {loading && <p role="status" className="nk-sub">Loading…</p>}
    {data && tab === 'mapped' && <section className="nk-panel overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-nickel-50"><tr>{['Call', 'School', 'Source and reason', 'Mapped', 'Status', ...(isHead ? ['Head action'] : [])].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{data.rows.map((r: any) => <tr key={`${r.call_id}:${r.school_id}`} className="align-top">
        <td className="border-t border-nickel-100 px-3 py-2">{r.title}</td><td className="border-t border-nickel-100 px-3 py-2">{r.school_name}</td>
        <td className="border-t border-nickel-100 px-3 py-2">{r.sourceLabel}{r.tier ? ` (${r.tier})` : ''}<p className="nk-sub">{r.reason}</p></td>
        <td className="border-t border-nickel-100 px-3 py-2">{date(r.mapped_at)}<p className="nk-sub">{r.reconstructed ? 'Reconstructed at backfill' : r.mapped_by || 'Automatic'}</p></td>
        <td className="border-t border-nickel-100 px-3 py-2">{r.is_active ? 'Active' : <span>Ended {date(r.ended_at)} by {r.ended_by}<p className="nk-sub">{r.ended_reason}</p></span>}</td>
        {isHead && <td className="border-t border-nickel-100 px-3 py-2">{r.is_active ? <button className="nk-btn-secondary nk-btn-xs" onClick={() => change('END', r.call_id, r.school_id)}>End mapping</button> : <button className="nk-btn-secondary nk-btn-xs" onClick={() => change('ADD', r.call_id, r.school_id)}>Reinstate</button>}</td>}
      </tr>)}{!data.rows.length && <tr><td colSpan={6} className="p-6 text-center nk-sub">No mappings match these filters.</td></tr>}</tbody></table>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
    {data && tab === 'unclassified' && <section className="nk-panel overflow-x-auto">
      <p className="p-3 text-sm">{data.total} open call{data.total === 1 ? '' : 's'} nobody has classified. They map to no school until classified, so they stay with the head. {data.overdue > 0 && <span className="text-red-700">{data.overdue} older than {data.overdueAfterDays} days.</span>}</p>
      <table className="min-w-full text-left text-sm"><thead className="bg-nickel-50"><tr>{['Call', 'Age', 'Deadline', 'Origin school', 'Fix', 'Route to a school'].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.id} className="align-top"><td className="border-t border-nickel-100 px-3 py-2">{r.title}<p className="nk-sub">{r.agency || ''}{r.global ? ' · global catalog' : ''}</p></td>
          <td className={`border-t border-nickel-100 px-3 py-2 ${r.ageDays >= data.overdueAfterDays ? 'text-red-700' : ''}`}>{r.ageDays} days</td><td className="border-t border-nickel-100 px-3 py-2">{date(r.deadline)}</td>
          <td className="border-t border-nickel-100 px-3 py-2">{r.origin_school || '—'}</td>
          <td className="border-t border-nickel-100 px-3 py-2"><Link className="text-cobalt-700 underline" target="_blank" href={`/funding-dept/calls/${encodeURIComponent(r.id)}`}>Classify the call</Link></td>
          <td className="border-t border-nickel-100 px-3 py-2"><select className={field} defaultValue="" onChange={e => { if (e.target.value) change('ADD', r.id, e.target.value); e.target.value = '' }}><option value="">Add a school…</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td></tr>)}
          {!data.rows.length && <tr><td colSpan={6} className="p-6 text-center nk-sub">Every open call is classified.</td></tr>}</tbody></table>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
    {data && tab === 'schools' && <section className="nk-panel p-4">{data.rows.map((r: any) => <div key={r.id} className="border-b py-3"><p className="font-medium">{r.name}</p>{r.problems.map((p: string) => <p key={p} className="text-sm text-amber-800">{p}</p>)}
      <Link className="text-sm text-cobalt-700 underline" href={r.nextAction === 'Assign coverage' ? '/tenant-admin/funding-dept' : '/tenant-admin/faculty'}>{r.nextAction}</Link></div>)}
      {!data.rows.length && <p className="nk-sub">Every school has research areas and a coordinator.</p>}</section>}
  </div>
}

/* --------------------------------------------------------------- Audit trail */

export function AuditView({ periodQuery, callId, setCallId, schools, revision }: { periodQuery: string; callId: string; setCallId: (id: string) => void; schools: Array<{ id: string; name: string }>; revision: number }) {
  const [page, setPage] = useState(1); const [schoolId, setSchoolId] = useState(''); const [entityType, setEntityType] = useState('')
  useEffect(() => setPage(1), [callId, schoolId, entityType, periodQuery])
  const query = new URLSearchParams(periodQuery)
  if (callId) { query.set('callId', callId); query.set('window', 'all') }
  if (schoolId) query.set('schoolId', schoolId)
  if (entityType) query.set('entityType', entityType)
  const { data, error, loading } = useJson<any>(`/api/funding-dept/reports/audit?${query}&page=${page}`, revision)
  const { download, error: exportError } = useDownload()
  return <div className="space-y-4">
    <div className="nk-panel flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-col gap-1 text-xs">School<select className={field} value={schoolId} onChange={e => setSchoolId(e.target.value)}><option value="">All</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs">What<select className={field} value={entityType} onChange={e => setEntityType(e.target.value)}><option value="">Everything</option>{[['MAPPING', 'Mapping'], ['REVIEW', 'Review decisions'], ['RESPONSIBILITY', 'Responsibility transfers'], ['OWNERSHIP', 'School coverage'], ['DISPOSITION', 'Closure reasons'], ['ACTION', 'Named actions'], ['VERIFICATION', 'Submission verification'], ['ORIGIN_ATTRIBUTION', 'Origin corrections']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {callId && <p className="text-sm">One call · <button className="text-cobalt-700 underline" onClick={() => setCallId('')}>Show all calls</button></p>}
      <button className="nk-btn-secondary nk-btn-xs ml-auto" onClick={() => download(`/api/funding-dept/reports/audit?${query}&format=xlsx`, 'dsr-audit-trail.xlsx')}>Export XLSX</button>
    </div>
    {(error || exportError) && <p role="alert" className="text-red-700">{error || exportError}</p>}
    {loading && <p role="status" className="nk-sub">Loading audit trail…</p>}
    {data && <section className="nk-panel">{data.rows.map((r: any) => <details key={r.id} className="border-b px-4 py-3 text-sm"><summary className="cursor-pointer">{new Date(r.occurred_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {r.actor_name || (r.inferred ? 'Recorded at backfill' : 'System')} · {r.summary}{r.call_title ? ` · ${r.call_title}` : ''}</summary>
      {r.reason && <p className="mt-1">Reason: {r.reason}</p>}<pre className="mt-1 whitespace-pre-wrap text-xs text-nickel-600">{JSON.stringify({ before: r.before_data, after: r.after_data }, null, 2)}</pre></details>)}
      {!data.rows.length && <p className="p-5 nk-sub">No recorded changes match these filters.</p>}
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
  </div>
}
