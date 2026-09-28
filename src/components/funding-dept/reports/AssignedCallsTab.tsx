'use client'

/**
 * Assigned Calls — every allocation in the viewer's schools, with the faculty
 * response, deadlines, the last follow-up and the submission, plus the actions
 * to move each one along.
 */
import Link from 'next/link'
import { Fragment, useState } from 'react'

import FacultyProfileDrawer from '@/components/faculty/FacultyProfileDrawer'
import AssignmentRowActions from '@/components/funding-dept/AssignmentRowActions'
import FollowUpPanel from '@/components/funding-dept/FollowUpPanel'
import ManualAllocationDetails from '@/components/funding-dept/ManualAllocationDetails'
import { useToast } from '@/components/ui/toast'
import {
  ExportButtons, Pager, ScopeFilters, Search, Select, Stat, Status, Td, Th, Toggle, daysLeftLabel, define, fmtDate, plural,
  useHubReport, type Filters, type HubBase, type OpenTab,
} from './hubKit'

type Row = {
  id: string; status: string; outcome: string; createdAt: string; respondedAt: string | null; declinedReason: string | null
  call: { id: string; title: string; agency: string | null; deadline: string | null; daysToDeadline: number | null }
  internalDeadline: string | null; daysToDue: number | null; overdue: boolean
  faculty: { id: string; name: string; email: string | null }; school: { id: string; name: string }; assignedBy: { id: string; name: string } | null
  allocationMethod: string | null; allocationReason: string | null; allocationNote: string | null
  followUps: number; facultyContacts: number; lastFollowUp: { at: string; kind: string; by: string | null; note: string } | null; daysSinceFollowUp: number | null
  nextReminderAt: string | null; submittedAt: string | null; completedAt: string | null; submissionReference: string | null; submissionUrl: string | null; evidence: string | null; lapsedAt: string | null
  passedOnTo: { id: string; name: string; status: string } | null; passedOnFrom: { id: string; name: string } | null
}
type Payload = HubBase & { rows: Row[]; summary: { active: number; awaitingReply: number; overdue: number; silent: number; submittedThisMonth: number } }

const STATUS: Record<string, { label: string; cls: string }> = {
  ASSIGNED: { label: 'Awaiting reply', cls: 'nk-badge nk-badge-warn' }, ACCEPTED: { label: 'Accepted', cls: 'nk-badge nk-badge-live' },
  IN_PROGRESS: { label: 'In progress', cls: 'nk-badge nk-badge-live' }, COMPLETED: { label: 'Submitted', cls: 'nk-badge nk-badge-ok' },
  DECLINED: { label: 'Declined', cls: 'nk-badge' }, CANCELLED: { label: 'Unallocated', cls: 'nk-badge' }, LAPSED: { label: 'Not applied for', cls: 'nk-badge' },
}
const OUTCOME: Record<string, string> = { AWARDED: 'nk-badge nk-badge-ok', REJECTED: 'nk-badge bg-red-50 text-red-800 border-red-200', WITHDRAWN: 'nk-badge' }
const kindLabel = (k: string) => ({ CALL: 'Call', EMAIL: 'Email', MEETING: 'Meeting', NOTE: 'Note', REMINDER: 'Reminder' } as Record<string, string>)[k] || k

export default function AssignedCallsTab({ filters, setFilters, openTab }: { filters: Filters; setFilters: (f: Filters) => void; openTab: OpenTab }) {
  const { showToast } = useToast()
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0)
  const [open, setOpen] = useState<string | null>(null); const [profile, setProfile] = useState<Row['faculty'] | null>(null)
  const { data, error, loading } = useHubReport<Payload>('assigned-calls', filters, page, revision)
  const set = (key: string, value: string) => { setFilters({ ...filters, [key]: value }); setPage(1) }
  const patch = (next: Filters) => { setFilters({ ...filters, ...next }); setPage(1) }
  const status = filters.status || 'active'
  const quick = (next: Filters) => { const { status: _s, due: _d, silent: _si, awaitingReply: _a, submittedIn: _m, ...rest } = filters; setFilters({ ...rest, ...next }); setPage(1) }
  const isQuick = (k: string) => k === 'active' ? status === 'active' && !filters.due && !filters.silent && !filters.awaitingReply
    : k === 'awaiting' ? filters.awaitingReply === 'true' : k === 'overdue' ? filters.due === 'overdue' : k === 'silent' ? filters.silent === 'true' : filters.submittedIn === 'month'
  const changed = (message: string) => { showToast({ type: 'success', title: message }); setRevision(r => r + 1) }
  const s = data?.summary

  return <div className="space-y-4">
    {filters.callId && <p className="flex flex-wrap items-center gap-2 rounded border border-cobalt-100 bg-cobalt-50 px-3 py-2 text-sm">Showing allocations for <strong>{filters.callTitle || 'one call'}</strong>
      <button className="text-cobalt-700 underline" onClick={() => { const { callId: _c, callTitle: _t, ...rest } = filters; setFilters(rest) }}>Show all calls</button></p>}
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      <Stat title="Active allocations" value={s?.active} active={isQuick('active')} help="Assigned, accepted or in progress." onClick={() => quick({})} />
      <Stat title="No reply for 7+ days" value={s?.awaitingReply} active={isQuick('awaiting')} tone={s?.awaitingReply ? 'border-amber-300' : ''} help="Allocated more than 7 days ago and the faculty member has not accepted or declined." onClick={() => quick({ awaitingReply: 'true' })} />
      <Stat title="Overdue, not submitted" value={s?.overdue} active={isQuick('overdue')} tone={s?.overdue ? 'border-red-300' : ''} help="Active allocations past the internal deadline (or the agency deadline when no internal one was set)." onClick={() => quick({ due: 'overdue' })} />
      <Stat title="Silent for 7+ days" value={s?.silent} active={isQuick('silent')} tone={s?.silent ? 'border-amber-300' : ''} help="Active allocations with no follow-up logged in the last 7 days." onClick={() => quick({ silent: 'true' })} />
      <Stat title="Submitted this month" value={s?.submittedThisMonth} active={isQuick('submitted')} help="Allocations recorded as submitted since the 1st of this month (India time)." onClick={() => quick({ status: 'submitted', submittedIn: 'month' })} />
    </div>

    <div className="nk-panel flex flex-wrap items-end gap-3 p-4">
      <ScopeFilters options={data?.options} lens={data?.lens} filters={filters} patch={patch} />
      <Select label="Status" value={status} all={null} onChange={v => patch({ status: v, submittedIn: '' })}
        options={[['active', 'Active'], ['awaiting', 'Awaiting reply'], ['submitted', 'Submitted'], ['closed', 'Closed (unallocated, declined, not applied)'], ['all', 'All']]} />
      <Select label="Deadline" value={filters.due || ''} onChange={v => set('due', v)} all="Any"
        options={[['overdue', 'Overdue'], ['7', 'Due within 7 days'], ['14', 'Due within 14 days'], ['30', 'Due within 30 days']]} />
      <Toggle label="No follow-up in 7+ days" checked={filters.silent === 'true'} onChange={v => set('silent', v ? 'true' : '')} />
      <Toggle label="Allocated by me" checked={filters.assignedBy === 'me'} onChange={v => set('assignedBy', v ? 'me' : '')} />
      <Search value={filters.q || ''} onChange={v => set('q', v)} placeholder="Call, agency, faculty name or email" />
      <div className="ml-auto"><ExportButtons report="assigned-calls" filters={filters} /></div>
    </div>

    <Status loading={loading && !data} refreshing={loading && !!data} error={error} />
    {data && <p className="nk-sub text-xs">{plural(data.total, 'allocation')}{filters.submittedIn === 'month' ? ' submitted since the 1st of this month' : ''} · active first, soonest deadline first · deadline = internal deadline, else the agency deadline</p>}
    {data && <section className="nk-panel overflow-x-auto">
      <table className="min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>Call</Th><Th>Faculty · school</Th><Th>Status</Th><Th>Deadlines</Th><Th>Last follow-up</Th><Th>Submission</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>{data.rows.map(r => {
          const due = daysLeftLabel(r.daysToDue); const st = STATUS[r.status] || { label: r.status, cls: 'nk-badge' }
          const quiet = r.daysSinceFollowUp === null ? null : r.daysSinceFollowUp
          return <Fragment key={r.id}><tr>
            <Td><Link href={`/funding-dept/calls/${encodeURIComponent(r.call.id)}?school=${encodeURIComponent(r.school.id)}`} target="_blank" className="font-medium text-cobalt-700 hover:underline">{r.call.title}</Link>
              <p className="nk-sub text-xs">{r.call.agency || 'Agency not recorded'}</p>
              <p className="nk-sub text-xs">Allocated {fmtDate(r.createdAt)}{r.assignedBy ? ` by ${r.assignedBy.name}` : ''}</p>
              <ManualAllocationDetails allocationMethod={r.allocationMethod} allocationReason={r.allocationReason} allocationNote={r.allocationNote} /></Td>
            <Td><button className="text-left font-medium text-cobalt-700 hover:underline" onClick={() => setProfile(r.faculty)}>{r.faculty.name}</button>
              <p className="nk-sub text-xs">{r.school.name}</p>
              {r.passedOnFrom && <p className="nk-sub text-xs">Passed on from {r.passedOnFrom.name}</p>}
              {r.passedOnTo && <p className="nk-sub text-xs">Passed on to {r.passedOnTo.name}</p>}</Td>
            <Td><span className={st.cls}>{st.label}</span>
              {r.status === 'ASSIGNED' && <p className="nk-sub text-xs">Sent {Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000)} days ago</p>}
              {r.respondedAt && r.status !== 'ASSIGNED' && <p className="nk-sub text-xs">Replied {fmtDate(r.respondedAt)}</p>}
              {r.declinedReason && <p className="text-xs text-red-700">“{r.declinedReason}”</p>}</Td>
            <Td className="whitespace-nowrap"><p className="text-xs">Internal: {fmtDate(r.internalDeadline)}</p><p className="text-xs">Agency: {fmtDate(r.call.deadline)}</p>
              {['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(r.status) && <p className={`text-xs ${due.tone}`}>{r.overdue ? `Overdue ${Math.abs(r.daysToDue || 0)} days` : due.text}</p>}</Td>
            <Td><button className="text-left" title="Open the follow-up log and add a follow-up." onClick={() => setOpen(open === r.id ? null : r.id)}>
              {r.lastFollowUp ? <><span className={`text-xs ${quiet !== null && quiet >= 7 && ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(r.status) ? 'text-amber-700 font-medium' : ''}`}>{kindLabel(r.lastFollowUp.kind)} · {fmtDate(r.lastFollowUp.at)}</span>
                <span className="nk-sub block text-xs">{r.lastFollowUp.by || 'Unknown'} · {plural(r.followUps, 'entry', 'entries')}</span></>
                : <span className="text-xs text-amber-700">No follow-up yet</span>}
              <span className="block text-xs text-cobalt-700 underline">{open === r.id ? 'Hide log' : 'Log / add follow-up'}</span></button>
              {r.nextReminderAt && (new Date(r.nextReminderAt).getTime() < Date.now()
                ? <p className="text-xs text-amber-700" title="This reminder's time has passed and it has not been sent yet.">Reminder due since {fmtDate(r.nextReminderAt)}</p>
                : <p className="nk-sub text-xs">Reminder {fmtDate(r.nextReminderAt)}</p>)}</Td>
            <Td>{r.submittedAt || r.status === 'COMPLETED' ? <><span className="text-xs">Submitted{r.submittedAt || r.completedAt ? ` ${fmtDate(r.submittedAt || r.completedAt)}` : ''}</span>
              {r.submissionReference && <p className="nk-sub text-xs">Ref {r.submissionReference}</p>}
              {r.submissionUrl && <a href={r.submissionUrl} target="_blank" rel="noreferrer" className="block text-xs text-cobalt-700 underline">Evidence link</a>}
              {r.outcome !== 'PENDING' && <span className={`${OUTCOME[r.outcome] || 'nk-badge'} mt-1`}>{r.outcome.toLowerCase()}</span>}</>
              : r.lapsedAt ? <span className="text-xs">Closed {fmtDate(r.lapsedAt)}</span> : <span className="nk-sub text-xs">Not yet</span>}</Td>
            <Td><AssignmentRowActions compact onChanged={changed} assignment={{ id: r.id, status: r.status, outcome: r.outcome, deadlineAt: r.internalDeadline, declinedReason: r.declinedReason,
              callTitle: r.call.title, facultyName: r.faculty.name, facultyEmail: r.faculty.email, passedOnTo: r.passedOnTo }} /></Td>
          </tr>
          {open === r.id && <tr><td colSpan={7} className="bg-nickel-50 p-4"><div className="mb-2 flex flex-wrap gap-3 text-xs">
            <button className="text-cobalt-700 underline" onClick={() => openTab('followups', { assignmentId: r.id, weeks: '12', assignmentLabel: `${r.faculty.name} · ${r.call.title}` })}>See this allocation’s week-by-week effort</button></div>
            <FollowUpPanel assignmentId={r.id} onLogged={() => setRevision(v => v + 1)} /></td></tr>}
          </Fragment>
        })}{!data.rows.length && <tr><td colSpan={7} className="p-8 text-center nk-sub">No allocations match these filters.</td></tr>}</tbody></table>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} /></section>}
    <p className="nk-sub text-xs" title={define('Silent assignment')}>Need to allocate a call? Start from <button className="text-cobalt-700 underline" onClick={() => openTab('incoming')}>Incoming Calls</button> or <button className="text-cobalt-700 underline" onClick={() => openTab('pendency')}>Pendency</button>.</p>
    {profile && <FacultyProfileDrawer userId={profile.id} fallbackName={profile.name} onClose={() => setProfile(null)} onAllocated={() => setRevision(v => v + 1)} />}
  </div>
}
