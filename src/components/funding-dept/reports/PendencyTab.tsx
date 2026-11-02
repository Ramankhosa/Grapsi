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
  ExportButtons, ReportFilters, ReportStamp, Pager, ScopeFilters, Search, Select, Stat, Status, Td, Th, daysLeftLabel, define, field, fmtDate, plural,
  useHubReport, type Filters, type HubBase, type OpenTab,
} from './hubKit'

type Row = {
  daysInStage: number
  nextAction: { title: string; owner: string | null; dueAt: string | null; waitingWith: string; blocker: string | null } | null
  workState: string
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
  const [revision, setRevision] = useState(0); const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showMemberTable,setShowMemberTable] = useState(false)
  const page = Math.max(1, Number.parseInt(filters.page || '1', 10) || 1)
  const setPage = (next: number) => setFilters({ ...filters, page: String(next) })
  const { data, error, loading } = useHubReport<Payload>('pendency', filters, page, revision)
  const set = (key: string, value: string) => { setFilters({ ...filters, [key]: value, page: '1', logPage: '1' }) }
  const setMany = (next: Filters) => { setFilters({ ...filters, ...next, page: '1', logPage: '1' }) }
  const s = data?.summary
  const memberIdOf = (userId: string | null) => data?.options.members.find(m => m.userId === userId)?.id || ''
  const refresh = () => setRevision(r => r + 1)
  const people = (data?.options.members || []).map(m => ({ id: m.userId, name: m.name }))

  return <div className="space-y-4">
    <ReportStamp data={data} />
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat title="At risk" value={s?.atRisk} active={filters.state === 'AT_RISK'} tone={s?.atRisk ? 'border-amber-300' : ''} help={define(`Pendency: ${PENDENCY_STATE_LABELS.AT_RISK}`)} onClick={() => set('state', 'AT_RISK')} />
      <Stat title="Pending" value={s?.pending} active={filters.state === 'PENDING'} help={define(`Pendency: ${PENDENCY_STATE_LABELS.PENDING}`)} onClick={() => set('state', 'PENDING')} />
      <Stat title="Missed" value={s?.missed} active={filters.state === 'MISSED'} tone={s?.missed ? 'border-red-300' : ''} help={define(`Pendency: ${PENDENCY_STATE_LABELS.MISSED}`)} onClick={() => set('state', 'MISSED')} />
      <Stat title="Closed by coordinator, no allocation" value={s?.completedNoAllocation} active={filters.state === 'COMPLETED_NO_ALLOCATION'} help={define(`Pendency: ${PENDENCY_STATE_LABELS.COMPLETED_NO_ALLOCATION}`)} onClick={() => set('state', 'COMPLETED_NO_ALLOCATION')} />
    </div>
    <details className="text-xs leading-5 text-slate-500"><summary className="cursor-pointer font-medium">How these counts work</summary><p className="mt-2">All mapped school responsibilities and current matching calls awaiting a submission or reasoned closure. Missed records use activity and accountable ownership at entry closing; late completion does not erase them. Open work follows the available operational coordinator.</p></details>

    <ReportFilters filters={filters} options={data?.options}>
      <ScopeFilters options={data?.options} lens={data?.lens} filters={filters} patch={setMany} />
      <Select label="State" value={filters.state || ''} onChange={v => set('state', v)} all="Pendency (at risk, pending, missed)"
        options={[['AT_RISK', 'At risk'], ['PENDING', 'Pending'], ['MISSED', 'Missed'], ['COMPLETED_NO_ALLOCATION', 'Closed by coordinator, no allocation'], ['all', 'Everything']]} />
      <label className="flex flex-col gap-1 text-xs" title="Useful for a post-mortem: which calls were missed in a given month.">Deadline from<input type="date" className={field} value={filters.deadlineFrom || ''} onChange={e => set('deadlineFrom', e.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs">Deadline to<input type="date" className={field} value={filters.deadlineTo || ''} onChange={e => set('deadlineTo', e.target.value)} /></label>
      <Select label="Work remaining" value={filters.workState || ''} onChange={value => set('workState',value)} all="All stages" options={[["NOT_REVIEWED","Needs review"],["ALLOCATION_PENDING","Needs allocation"],["ALLOCATED_NOT_SUBMITTED","Awaiting submission"],["NO_NEXT_ACTION","No named next action"]]} />
      <Select label="Matched faculty" value={filters.minMatches || ''} onChange={v => set('minMatches', v)} all="Any number" options={[['2', '2 or more'], ['3', '3 or more'], ['5', '5 or more']]} />
      <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" checked={filters.matchedOnly==='true'} onChange={e=>set('matchedOnly',e.target.checked?'true':'')} />Matched faculty, no allocation only</label>
      <label className="flex items-center gap-2 pb-2 text-xs"><input type="checkbox" checked={filters.noCoordinator==='true' || filters.coordinatorId==='none'} onChange={e=>setMany({noCoordinator:e.target.checked?'true':'',memberId:'',coordinatorId:''})} />No coordinator recorded</label>
      <Search value={filters.q || ''} onChange={v => set('q', v)} placeholder="Call title, agency or ID" />
      <div className="ml-auto"><ExportButtons report="pendency" filters={filters} snapshot={data?.snapshot} disabled={loading || !!error || !data} /></div>
    </ReportFilters>
    <Status loading={loading && !data} refreshing={loading && !!data} error={error} />
    {filters.coordinatorId&&<p className="text-sm">Responsible coordinator: {data?.members[0]?.name || 'Recorded coordinator'} <button className="text-cobalt-700 underline" onClick={()=>setMany({coordinatorId:'',noCoordinator:'',memberId:''})}>Clear</button></p>}

    {data?.lens === 'department' && data.members.length > 0 && <section className="nk-panel overflow-x-auto">
      <div className="flex items-baseline justify-between gap-3 p-3"><h2 className="font-semibold">By DSR member</h2><span className="hidden text-xs text-slate-500 md:inline">Click a number to list those calls below</span><button type="button" className="min-h-9 text-xs font-medium text-blue-700 md:hidden" aria-expanded={showMemberTable} onClick={()=>setShowMemberTable(value=>!value)}>{showMemberTable?'Hide breakdown':'Show breakdown'}</button></div>
      <div className={`${showMemberTable?'':'hidden'} overflow-x-auto md:block`}>
      <table className="dsr-table min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>DSR member (responsible coordinator)</Th><Th className="text-right">At risk</Th><Th className="text-right">Pending</Th><Th className="text-right">Missed</Th><Th className="text-right">Closed, no allocation</Th><Th className="text-right">Oldest open (days)</Th><Th>See also</Th></tr></thead>
        <tbody>{data.members.map(m => {
          const key = m.coordinatorId || 'none'; const mid = memberIdOf(m.coordinatorId)
          // Each number opens exactly its rows: this coordinator's calls (in this school, for a school row).
          const num = (n: number, state: string, schoolId?: string) => <button className="tabular-nums text-cobalt-700 disabled:text-nickel-400" disabled={!n}
            onClick={() => setMany({ state, coordinatorId:m.coordinatorId || 'none', noCoordinator:'', memberId: mid || '', schoolId: schoolId || filters.schoolId || '' })}>{n}</button>
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
        })}</tbody></table></div></section>}

    {data && <p className="nk-sub text-xs">{plural(data.total, 'call–school pair')} · at risk first, then pending, then the most recent misses</p>}
    {data && <section className="nk-panel overflow-x-auto">
      <table className="dsr-table dsr-table-mobile min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>Call</Th><Th>School · coordinator</Th><Th>State</Th><Th>Entry deadline</Th><Th className="text-right">Matched faculty</Th><Th>Outstanding for</Th><Th>Next action · blocker</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>{data.rows.map(r => {
          const dl = daysLeftLabel(r.daysToDeadline); const href = `/funding-dept/calls/${encodeURIComponent(r.callId)}?school=${encodeURIComponent(r.school.id)}`
          return <tr key={`${r.callId}:${r.school.id}`}>
            <Td label="Opportunity"><Link href={href} target="_blank" className="font-medium text-cobalt-700 hover:underline">{r.title}</Link><p className="nk-sub text-xs">{r.agency || 'Agency not recorded'}</p></Td>
            <Td label="Accountable coordinator">{r.school.name}<p className="nk-sub text-xs">{r.coordinator?.name || <span className="text-amber-700">No coordinator</span>}</p></Td>
            <Td label="Work remaining"><span className={TONE[r.state]} title={define(`Pendency: ${PENDENCY_STATE_LABELS[r.state]}`)}>{PENDENCY_STATE_LABELS[r.state]}</span>
              <p className="mt-1 text-xs">{{NOT_REVIEWED:'Not reviewed',ALLOCATION_PENDING:'Allocation pending',ALLOCATED_NOT_SUBMITTED:r.state === 'MISSED' ? 'Allocated, no on-time submission' : 'Allocated, awaiting submission',NO_COORDINATOR:'No available coordinator',COMPLETED_NO_ALLOCATION:'Closed with a reason'}[r.workState] || r.workState}</p>
              {r.completed && <p className="mt-1 max-w-[16rem] text-xs">{r.completed.by || 'Coordinator'}: {r.completed.note || 'no note'}</p>}</Td>
            <Td label="Entry deadline" className="whitespace-nowrap">{fmtDate(r.deadline)}<p className={`text-xs ${dl.tone}`}>{dl.text}</p></Td>
            <Td label="Matched faculty" className="text-right"><Link href={href} target="_blank" className="tabular-nums text-cobalt-700 underline" title="Open the call window to see and allocate the matched faculty.">{r.matchedFaculty}</Link>
              <p className="nk-sub text-xs">Responsibility since {fmtDate(r.firstMatchedAt)}</p></Td>
            <Td label="Responsibility age" className="tabular-nums">{plural(r.daysUnallocated, 'day')}{r.state === 'MISSED' && <p className="nk-sub text-xs">until the deadline</p>}
              {r.releasedAllocations > 0 && <p className="text-xs text-amber-700">{plural(r.releasedAllocations, 'allocation')} fell through</p>}</Td>
            <Td label="Next action and blocker">{r.nextAction ? <div className="mb-3 text-xs"><p className="font-semibold text-slate-800">{r.nextAction.title}</p><p className="mt-1 text-slate-500">{r.nextAction.owner || 'No task owner'} · due {fmtDate(r.nextAction.dueAt)}</p><p className="mt-1 text-slate-500">Waiting with {r.nextAction.waitingWith?.toLowerCase()}</p>{r.nextAction.blocker && <p className="mt-1 text-amber-800">Blocker: {r.nextAction.blocker}</p>}</div> : <p className="mb-2 text-xs font-medium text-amber-800">No named next action</p>}
              {r.daysInStage != null && <p className="mb-1 text-xs text-slate-500">{plural(r.daysInStage,'day')} in the current action/review stage</p>}{r.lastActivityAt ? <span className="text-xs">Last {fmtDate(r.lastActivityAt)}</span> : <span className="text-xs text-red-700">Nothing recorded</span>}
              {r.escalated.length > 0 && <p className="nk-sub text-xs">Escalated to {r.escalated.map(e => RUNG[e] || e).join(', ')}</p>}</Td>
            <Td label="Take action"><div className="flex flex-col items-end gap-1.5">
              {['NOT_REVIEWED','ALLOCATION_PENDING'].includes(r.workState) && !['MISSED','COMPLETED_NO_ALLOCATION'].includes(r.state) && <AllocateCallButton call={{ id: r.callId, title: r.title, agency: r.agency, closeDate: r.deadline }} initialSchoolId={r.school.id} onAssigned={refresh} className="nk-btn-primary nk-btn-xs" />}
              {r.workState === 'ALLOCATED_NOT_SUBMITTED' && <button type="button" className="nk-btn-primary nk-btn-xs" onClick={() => openTab('assigned',{callId:r.callId,callTitle:r.title,schoolId:r.school.id,status:'active'})}>Follow up / record submission</button>}
              {r.workState === 'NO_COORDINATOR' && data.lens === 'department' && <Link href="/funding-dept/accountability?view=mapping" className="nk-btn-primary nk-btn-xs">Assign coverage</Link>}
              <Link href={href} target="_blank" className="nk-btn-secondary nk-btn-xs">{r.workState === 'NOT_REVIEWED' ? 'Review opportunity' : 'Open call'}</Link>
              {r.state !== 'COMPLETED_NO_ALLOCATION' && <ActionEditor schoolId={r.school.id} callId={r.callId} people={people} query="" onSaved={refresh} buttonLabel={r.nextAction ? 'Add next action' : 'Set next action'} />}
              {data.lens === 'department' && r.state === 'MISSED' && <ActionEditor schoolId={r.school.id} callId={r.callId} people={people} query="" onSaved={refresh} corrective buttonLabel="Corrective action"
                defaults={{ title: `Missed call: ${r.title}`, waitingWith: 'DSR' }} help="Record a corrective action for this missed call, with a named owner and due date." />}
            </div></Td>
          </tr>
        })}{!data.rows.length && <tr><td colSpan={8} className="p-8 text-center nk-sub">No outstanding school responsibilities match these filters.</td></tr>}</tbody></table>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
  </div>
}
