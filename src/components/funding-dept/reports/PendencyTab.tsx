'use client'

/**
 * Pendency — calls that directly matched faculty in a school where nobody was
 * allocated. The head sees it by member first; everyone sees the calls.
 */
import Link from 'next/link'
import { Fragment, useState } from 'react'

import AllocateCallButton from '@/components/funding-dept/AllocateCallButton'
import { ActionEditor } from '@/components/funding-dept/ManagementWorkspace'
import { PENDENCY_STATE_LABELS, type PendencyState } from '@/lib/fundingDept/reportGlossary'
import {
  ExportButtons, Pager, ScopeFilters, Search, Select, Stat, Status, Td, Th, daysLeftLabel, define, field, fmtDate, plural,
  useHubReport, type Filters, type HubBase, type OpenTab,
} from './hubKit'

type Row = {
  callId: string; title: string; agency: string | null; deadline: string | null; daysToDeadline: number | null
  school: { id: string; name: string }; coordinator: { id: string; name: string } | null; state: PendencyState
  matchedFaculty: number; firstMatchedAt: string; daysUnallocated: number; releasedAllocations: number; escalated: string[]; lastActivityAt: string | null
  completed: { at: string; by: string | null; note: string | null } | null
}
type Member = { coordinatorId: string | null; name: string; missed: number; atRisk: number; pending: number; completedNoAllocation: number; oldestDays: number
  schools: Array<{ id: string; name: string; missed: number; atRisk: number; pending: number; completedNoAllocation: number }> }
type Payload = HubBase & { rows: Row[]; members: Member[]; summary: { missed: number; atRisk: number; pending: number; completedNoAllocation: number } }

const TONE: Record<PendencyState, string> = { MISSED: 'nk-badge bg-red-50 text-red-800 border-red-200', AT_RISK: 'nk-badge nk-badge-warn', PENDING: 'nk-badge', COMPLETED_NO_ALLOCATION: 'nk-badge' }
const RUNG: Record<string, string> = { OFFICER: 'coordinator', HEAD: 'head', ADMIN: 'administrators' }

export default function PendencyTab({ filters, setFilters, openTab }: { filters: Filters; setFilters: (f: Filters) => void; openTab: OpenTab }) {
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0); const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const { data, error, loading } = useHubReport<Payload>('pendency', filters, page, revision)
  const set = (key: string, value: string) => { setFilters({ ...filters, [key]: value }); setPage(1) }
  const setMany = (next: Filters) => { setFilters({ ...filters, ...next }); setPage(1) }
  const s = data?.summary
  const memberIdOf = (userId: string | null) => data?.options.members.find(m => m.userId === userId)?.id || ''
  const refresh = () => setRevision(r => r + 1)
  const people = (data?.options.members || []).map(m => ({ id: m.userId, name: m.name }))

  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat title="At risk" value={s?.atRisk} active={filters.state === 'AT_RISK'} tone={s?.atRisk ? 'border-amber-300' : ''} help={define(`Pendency: ${PENDENCY_STATE_LABELS.AT_RISK}`)} onClick={() => set('state', 'AT_RISK')} />
      <Stat title="Pending" value={s?.pending} active={filters.state === 'PENDING'} help={define(`Pendency: ${PENDENCY_STATE_LABELS.PENDING}`)} onClick={() => set('state', 'PENDING')} />
      <Stat title="Missed" value={s?.missed} active={filters.state === 'MISSED'} tone={s?.missed ? 'border-red-300' : ''} help={define(`Pendency: ${PENDENCY_STATE_LABELS.MISSED}`)} onClick={() => set('state', 'MISSED')} />
      <Stat title="Closed by coordinator, no allocation" value={s?.completedNoAllocation} active={filters.state === 'COMPLETED_NO_ALLOCATION'} help={define(`Pendency: ${PENDENCY_STATE_LABELS.COMPLETED_NO_ALLOCATION}`)} onClick={() => set('state', 'COMPLETED_NO_ALLOCATION')} />
    </div>
    <p className="nk-sub text-xs" title={define('Pendency vs. escalation ladder')}>{define('Directly matched call')} Pendency counts at risk + pending + missed.</p>

    <div className="nk-panel flex flex-wrap items-end gap-3 p-4">
      <ScopeFilters options={data?.options} lens={data?.lens} filters={filters} patch={setMany} />
      <Select label="State" value={filters.state || ''} onChange={v => set('state', v)} all="Pendency (at risk, pending, missed)"
        options={[['AT_RISK', 'At risk'], ['PENDING', 'Pending'], ['MISSED', 'Missed'], ['COMPLETED_NO_ALLOCATION', 'Closed by coordinator, no allocation'], ['all', 'Everything']]} />
      <label className="flex flex-col gap-1 text-xs" title="Useful for a post-mortem: which calls were missed in a given month.">Deadline from<input type="date" className={field} value={filters.deadlineFrom || ''} onChange={e => set('deadlineFrom', e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs">Deadline to<input type="date" className={field} value={filters.deadlineTo || ''} onChange={e => set('deadlineTo', e.target.value)} /></label>
      <Select label="Matched faculty" value={filters.minMatches || ''} onChange={v => set('minMatches', v)} all="Any number" options={[['2', '2 or more'], ['3', '3 or more'], ['5', '5 or more']]} />
      <Search value={filters.q || ''} onChange={v => set('q', v)} placeholder="Call title, agency or ID" />
      <div className="ml-auto"><ExportButtons report="pendency" filters={filters} /></div>
    </div>
    <Status loading={loading && !data} refreshing={loading && !!data} error={error} />

    {data?.lens === 'department' && data.members.length > 0 && <section className="nk-panel overflow-x-auto">
      <div className="flex items-baseline justify-between p-3"><h2 className="font-semibold">By DSR member</h2><span className="nk-sub text-xs">Click a number to list those calls below</span></div>
      <table className="min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>DSR member (responsible coordinator)</Th><Th className="text-right">At risk</Th><Th className="text-right">Pending</Th><Th className="text-right">Missed</Th><Th className="text-right">Closed, no allocation</Th><Th className="text-right">Oldest open (days)</Th><Th>See also</Th></tr></thead>
        <tbody>{data.members.map(m => {
          const key = m.coordinatorId || 'none'; const mid = memberIdOf(m.coordinatorId)
          // Each number opens exactly its rows: this coordinator's calls (in this school, for a school row).
          const num = (n: number, state: string, schoolId?: string) => <button className="tabular-nums text-cobalt-700 disabled:text-nickel-400" disabled={!n || !mid && !schoolId}
            onClick={() => setMany({ state, memberId: mid || filters.memberId || '', schoolId: schoolId || filters.schoolId || '' })}>{n}</button>
          return <Fragment key={key}><tr>
            <Td><button className="text-left font-medium" aria-expanded={!!expanded[key]} onClick={() => setExpanded(e => ({ ...e, [key]: !e[key] }))}>{expanded[key] ? '−' : '+'} {m.name}</button>
              {!m.coordinatorId && <p className="text-xs text-amber-700">Schools nobody covers — assign coverage</p>}</Td>
            <Td className="text-right">{num(m.atRisk, 'AT_RISK')}</Td><Td className="text-right">{num(m.pending, 'PENDING')}</Td>
            <Td className={`text-right ${m.missed ? 'font-semibold text-red-700' : ''}`}>{num(m.missed, 'MISSED')}</Td><Td className="text-right">{num(m.completedNoAllocation, 'COMPLETED_NO_ALLOCATION')}</Td>
            <Td className="text-right tabular-nums">{m.atRisk + m.pending > 0 ? m.oldestDays : '—'}</Td>
            <Td>{mid && <div className="flex flex-wrap gap-2 text-xs"><button className="text-cobalt-700 underline" onClick={() => openTab('incoming', { memberId: mid, action: 'NOT_STARTED' })}>Not-started calls</button>
              <button className="text-cobalt-700 underline" onClick={() => openTab('followups', { memberId: mid })}>Follow-up effort</button></div>}</Td></tr>
            {expanded[key] && m.schools.map(sc => <tr key={`${key}:${sc.id}`} className="bg-nickel-50"><Td className="pl-8 text-xs">{sc.name}</Td>
              <Td className="text-right">{num(sc.atRisk, 'AT_RISK', sc.id)}</Td><Td className="text-right">{num(sc.pending, 'PENDING', sc.id)}</Td><Td className="text-right">{num(sc.missed, 'MISSED', sc.id)}</Td>
              <Td className="text-right">{num(sc.completedNoAllocation, 'COMPLETED_NO_ALLOCATION', sc.id)}</Td><Td>{''}</Td><Td>{''}</Td></tr>)}
          </Fragment>
        })}</tbody></table></section>}

    {data && <p className="nk-sub text-xs">{plural(data.total, 'call–school pair')} · at risk first, then pending, then the most recent misses</p>}
    {data && <section className="nk-panel overflow-x-auto">
      <table className="min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>Call</Th><Th>School · coordinator</Th><Th>State</Th><Th>Deadline</Th><Th className="text-right">Matched faculty</Th><Th>Unallocated for</Th><Th>DSR activity</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>{data.rows.map(r => {
          const dl = daysLeftLabel(r.daysToDeadline); const href = `/funding-dept/calls/${encodeURIComponent(r.callId)}?school=${encodeURIComponent(r.school.id)}`
          return <tr key={`${r.callId}:${r.school.id}`}>
            <Td><Link href={href} target="_blank" className="font-medium text-cobalt-700 hover:underline">{r.title}</Link><p className="nk-sub text-xs">{r.agency || 'Agency not recorded'}</p></Td>
            <Td>{r.school.name}<p className="nk-sub text-xs">{r.coordinator?.name || <span className="text-amber-700">No coordinator</span>}</p></Td>
            <Td><span className={TONE[r.state]} title={define(`Pendency: ${PENDENCY_STATE_LABELS[r.state]}`)}>{PENDENCY_STATE_LABELS[r.state]}</span>
              {r.completed && <p className="mt-1 max-w-[16rem] text-xs">{r.completed.by || 'Coordinator'}: {r.completed.note || 'no note'}</p>}</Td>
            <Td className="whitespace-nowrap">{fmtDate(r.deadline)}<p className={`text-xs ${dl.tone}`}>{dl.text}</p></Td>
            <Td className="text-right"><Link href={href} target="_blank" className="tabular-nums text-cobalt-700 underline" title="Open the call window to see and allocate the matched faculty.">{r.matchedFaculty}</Link>
              <p className="nk-sub text-xs">since {fmtDate(r.firstMatchedAt)}</p></Td>
            <Td className="tabular-nums">{plural(r.daysUnallocated, 'day')}{r.state === 'MISSED' && <p className="nk-sub text-xs">until the deadline</p>}
              {r.releasedAllocations > 0 && <p className="text-xs text-amber-700">{plural(r.releasedAllocations, 'allocation')} fell through</p>}</Td>
            <Td>{r.lastActivityAt ? <span className="text-xs">Last {fmtDate(r.lastActivityAt)}</span> : <span className="text-xs text-red-700">Nothing recorded</span>}
              {r.escalated.length > 0 && <p className="nk-sub text-xs">Escalated to {r.escalated.map(e => RUNG[e] || e).join(', ')}</p>}</Td>
            <Td><div className="flex flex-col items-end gap-1.5">
              {r.state !== 'MISSED' && <AllocateCallButton call={{ id: r.callId, title: r.title, agency: r.agency, closeDate: r.deadline }} initialSchoolId={r.school.id} onAssigned={refresh} className="nk-btn-primary nk-btn-xs" />}
              <Link href={href} target="_blank" className="nk-btn-secondary nk-btn-xs">Open call</Link>
              {data.lens === 'department' && r.state === 'MISSED' && <ActionEditor schoolId={r.school.id} callId={r.callId} people={people} query="" onSaved={refresh} corrective buttonLabel="Corrective action"
                defaults={{ title: `Missed call: ${r.title}`, waitingWith: 'DSR' }} help="Record a corrective action for this missed call, with a named owner and due date." />}
            </div></Td>
          </tr>
        })}{!data.rows.length && <tr><td colSpan={8} className="p-8 text-center nk-sub">Nothing here. Every directly matched call in scope has someone allocated, or was judged not relevant.</td></tr>}</tbody></table>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
  </div>
}
