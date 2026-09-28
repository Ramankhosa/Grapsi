'use client'

/**
 * Incoming Calls — every call that concerns the coordinator's schools, with a
 * chip per school and the coordinator's own "action completed" mark.
 */
import Link from 'next/link'
import { Fragment, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { ACTION_STATUS_LABELS, type ActionStatus } from '@/lib/fundingDept/reportGlossary'
import {
  ExportButtons, Pager, ScopeFilters, Search, Select, Stat, Status, Td, Th, Toggle, daysLeftLabel, define, field, fmtDate, plural,
  useHubReport, type Filters, type HubBase, type OpenTab,
} from './hubKit'

type School = {
  schoolId: string; schoolName: string; sourceLabels: string[]; coordinator: { id: string; name: string } | null
  matchedFaculty: number; shortlisted: number; allocations: number; liveAllocations: number; submitted: number; followUps: number
  triageStatus: string | null; actionStatus: ActionStatus; completed: { at: string; by: string | null; note: string | null } | null
}
type Row = {
  callId: string; title: string; agency: string | null; deadline: string | null; daysToDeadline: number | null
  actionStatus: ActionStatus; matchedFaculty: number; shortlisted: number; allocations: number; liveAllocations: number; submitted: number; schools: School[]
}
type Payload = HubBase & { rows: Row[]; summary: { openCalls: number; notStarted: number; closingSoonNotCompleted: number; completed: number }; matchesRefreshedAt: string | null }

const STATUS_STYLE: Record<ActionStatus, { badge: string; dot: string }> = {
  NOT_STARTED: { badge: 'nk-badge nk-badge-warn', dot: 'bg-amber-500' },
  IN_PROGRESS: { badge: 'nk-badge nk-badge-live', dot: 'bg-cobalt-500' },
  COMPLETED: { badge: 'nk-badge nk-badge-ok', dot: 'bg-emerald-600' },
}

export default function IncomingCallsTab({ filters, setFilters, openTab }: { filters: Filters; setFilters: (f: Filters) => void; openTab: OpenTab }) {
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0); const [marking, setMarking] = useState<string | null>(null)
  const { data, error, loading } = useHubReport<Payload>('incoming-calls', filters, page, revision)
  const set = (key: string, value: string) => { setFilters({ ...filters, [key]: value }); setPage(1) }
  const patch = (next: Filters) => { setFilters({ ...filters, ...next }); setPage(1) }
  const quick = (next: Filters) => { const { action: _a, closingWithin: _c, ...rest } = filters; setFilters({ ...rest, ...next }); setPage(1) }
  const s = data?.summary
  const isQuick = (a: string, c = '') => (filters.action || '') === a && (filters.closingWithin || '') === c

  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat title={filters.includeExpired === 'true' ? 'Calls (open)' : 'Open calls'} value={s?.openCalls} active={isQuick('')} help="Every open call that concerns your schools. Click to clear the action filters." onClick={() => quick({})} />
      <Stat title="Not started" value={s?.notStarted} active={isQuick('NOT_STARTED')} tone={s?.notStarted ? 'border-amber-300' : ''} help={define('Action: Not started')} onClick={() => quick({ action: 'NOT_STARTED' })} />
      <Stat title="Closing in 7 days, not completed" value={s?.closingSoonNotCompleted} active={isQuick('NOT_COMPLETED', '7')} tone={s?.closingSoonNotCompleted ? 'border-red-300' : ''} help="Open calls closing within 7 India calendar days where at least one of your schools has not marked its action completed." onClick={() => quick({ action: 'NOT_COMPLETED', closingWithin: '7' })} />
      <Stat title="Action completed" value={s?.completed} active={isQuick('COMPLETED')} help={define('Action: Action completed')} onClick={() => quick({ action: 'COMPLETED' })} />
    </div>

    <div className="nk-panel flex flex-wrap items-end gap-3 p-4">
      <ScopeFilters options={data?.options} lens={data?.lens} filters={filters} patch={patch} />
      <Select label="Action status" value={filters.action || ''} onChange={v => set('action', v)}
        options={[['NOT_STARTED', 'Not started'], ['IN_PROGRESS', 'In progress'], ['NOT_COMPLETED', 'Not completed'], ['COMPLETED', 'Action completed']]} />
      <Select label="Closing within" value={filters.closingWithin || ''} onChange={v => set('closingWithin', v)} all="Any deadline"
        options={[['7', '7 days'], ['14', '14 days'], ['30', '30 days']]} />
      <Select label="How it reached the school" value={filters.source || ''} onChange={v => set('source', v)} all="Any route"
        options={[['MAPPED', 'Discipline mapping'], ['MATCHED_FACULTY', 'Matched faculty'], ['ORIGIN', 'Origin school']]} />
      <Toggle label="Include expired calls" checked={filters.includeExpired === 'true'} onChange={v => set('includeExpired', v ? 'true' : '')} help="Also show calls whose deadline has passed." />
      <Search value={filters.q || ''} onChange={v => set('q', v)} placeholder="Call title, agency or ID" />
      <div className="ml-auto"><ExportButtons report="incoming-calls" filters={filters} /></div>
    </div>

    <Status loading={loading && !data} refreshing={loading && !!data} error={error} />
    {data && <p className="nk-sub text-xs">{plural(data.total, 'call')} · sorted by deadline, soonest first · schools reached by discipline mapping or by a strong/moderate faculty match
      {data.matchesRefreshedAt ? ` · faculty matches refreshed ${new Date(data.matchesRefreshedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`
        : data.options.schools.length ? ' · faculty matching has not run yet for some schools' : ' · no schools in this view'}</p>}

    {data && <section className="nk-panel overflow-x-auto">
      <table className="min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>Call</Th><Th>Deadline</Th><Th>Schools</Th><Th className="text-right">Matched faculty</Th><Th>Shortlisted · allocated · submitted</Th><Th>Action</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>{data.rows.map(row => {
          const dl = daysLeftLabel(row.daysToDeadline)
          return <Fragment key={row.callId}>
            <tr>
              <Td><Link href={`/funding-dept/calls/${encodeURIComponent(row.callId)}`} target="_blank" className="font-medium text-cobalt-700 hover:underline" title="Open the call window in a new tab: schools, matching faculty, allocate and shortlist.">{row.title}</Link>
                <p className="nk-sub text-xs">{row.agency || 'Agency not recorded'}</p></Td>
              <Td className="whitespace-nowrap">{fmtDate(row.deadline)}<p className={`text-xs ${dl.tone}`}>{dl.text}</p></Td>
              <Td><div className="flex max-w-md flex-wrap gap-1.5">{row.schools.map(sc => <span key={sc.schoolId} className="inline-flex items-center gap-1.5 rounded-full border border-nickel-200 bg-white px-2 py-0.5 text-xs"
                title={`${sc.schoolName}\nReached by: ${sc.sourceLabels.join(', ')}\nCoordinator: ${sc.coordinator?.name || 'none'}\n${ACTION_STATUS_LABELS[sc.actionStatus]}${sc.completed ? ` on ${fmtDate(sc.completed.at)} by ${sc.completed.by || 'unknown'}${sc.completed.note ? ` — ${sc.completed.note}` : ''}` : ''}`}>
                <span className={`h-2 w-2 rounded-full ${STATUS_STYLE[sc.actionStatus].dot}`} aria-hidden />{sc.schoolName}{sc.matchedFaculty > 0 && <span className="text-nickel-500">· {sc.matchedFaculty}</span>}</span>)}</div></Td>
              <Td className="text-right tabular-nums">{row.matchedFaculty}</Td>
              <Td className="tabular-nums">{row.shortlisted} · {row.allocations > 0
                ? <button className="text-cobalt-700 underline" title="Open these allocations in Assigned Calls, including any unallocated, declined or lapsed." onClick={() => openTab('assigned', { callId: row.callId, status: 'all', callTitle: row.title })}>{row.liveAllocations}</button> : 0} · {row.submitted}
                {row.allocations > row.liveAllocations && <span className="nk-sub block text-xs">+{row.allocations - row.liveAllocations} closed</span>}</Td>
              <Td><span className={STATUS_STYLE[row.actionStatus].badge} title={define(`Action: ${ACTION_STATUS_LABELS[row.actionStatus]}`)}>{ACTION_STATUS_LABELS[row.actionStatus]}</span></Td>
              <Td className="whitespace-nowrap text-right"><div className="flex justify-end gap-2">
                <Link href={`/funding-dept/calls/${encodeURIComponent(row.callId)}`} target="_blank" className="nk-btn-secondary nk-btn-xs">Open call</Link>
                <button className="nk-btn-secondary nk-btn-xs" aria-expanded={marking === row.callId} onClick={() => setMarking(marking === row.callId ? null : row.callId)}>{row.actionStatus === 'COMPLETED' ? 'Completed ✓' : 'Mark completed'}</button></div></Td>
            </tr>
            {marking === row.callId && <tr><td colSpan={7} className="bg-nickel-50 p-3"><MarkCompleted row={row} onDone={() => { setMarking(null); setRevision(r => r + 1) }} /></td></tr>}
          </Fragment>
        })}{!data.rows.length && <tr><td colSpan={7} className="p-8 text-center nk-sub">{filters.action || filters.closingWithin || filters.q ? 'No calls match these filters.' : 'No open calls concern these schools yet. Calls arrive once they are classified to a school or match its faculty.'}</td></tr>}</tbody></table>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
  </div>
}

/** Per-school completion for one call: tick the schools whose work is done, or undo. */
export function MarkCompleted({ row, onDone }: { row: { callId: string; schools: Array<Pick<School, 'schoolId' | 'schoolName' | 'actionStatus' | 'completed'>> }; onDone: () => void }) {
  const { authFetch } = useAuth()
  const open = row.schools.filter(s => s.actionStatus !== 'COMPLETED')
  const [picked, setPicked] = useState<string[]>(open.map(s => s.schoolId)); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const send = async (schoolIds: string[], completed: boolean) => {
    setBusy(true); setError('')
    try {
      const r = await authFetch(`/api/funding-dept/calls/${encodeURIComponent(row.callId)}/action-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schoolIds, completed, note: note.trim() || null }) })
      if (!r.ok) throw Error((await r.json().catch(() => null))?.error || 'Could not save.')
      onDone()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="space-y-3">
    {open.length > 0 && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); if (picked.length) void send(picked, true) }}>
      <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-xs text-nickel-600">Mark the DSR action completed for</legend>
        {open.map(s => <label key={s.schoolId} className="flex items-center gap-1.5"><input type="checkbox" checked={picked.includes(s.schoolId)} onChange={e => setPicked(p => e.target.checked ? [...p, s.schoolId] : p.filter(id => id !== s.schoolId))} />{s.schoolName}</label>)}</fieldset>
      <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs">What was done (optional)<input className={field} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. circulated to HoDs; two faculty allocated" /></label>
      <button className="nk-btn-primary nk-btn-sm" disabled={busy || !picked.length}>{busy ? 'Saving…' : 'Mark completed'}</button>
    </form>}
    {row.schools.filter(s => s.actionStatus === 'COMPLETED').map(s => <p key={s.schoolId} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="nk-badge nk-badge-ok">Completed</span>{s.schoolName} · {fmtDate(s.completed?.at)}{s.completed?.by ? ` by ${s.completed.by}` : ''}{s.completed?.note ? ` — ${s.completed.note}` : ''}
      <button className="nk-btn-ghost nk-btn-xs" disabled={busy} onClick={() => void send([s.schoolId], false)}>Undo</button></p>)}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>
}
