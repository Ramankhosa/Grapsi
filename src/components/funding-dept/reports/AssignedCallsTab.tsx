'use client'

/**
 * Assigned Calls — every allocation in the viewer's schools, with the faculty
 * response, deadlines, the last follow-up and the submission, plus the actions
 * to move each one along.
 */
import Link from 'next/link'
import { clientTimeZone, useTenantLocale } from '@/hooks/useTenantLocale'
import { timeZoneLabel } from '@/lib/i18n/format'
import { Fragment, useState } from 'react'

import FacultyProfileDrawer from '@/components/faculty/FacultyProfileDrawer'
import AssignmentRowActions from '@/components/funding-dept/AssignmentRowActions'
import FollowUpPanel from '@/components/funding-dept/FollowUpPanel'
import ManualAllocationDetails from '@/components/funding-dept/ManualAllocationDetails'
import SubmissionVerificationButton from '@/components/funding-dept/SubmissionVerificationButton'
import { useToast } from '@/components/ui/toast'
import {
  ExportButtons, ReportFilters, ReportStamp, Pager, ScopeFilters, Search, Select, Stat, Status, Td, Th, Toggle, daysLeftLabel, define, fmtDate, plural,
  useHubReport, type Filters, type HubBase, type OpenTab,
} from './hubKit'

type Row = {
  applicationId: string | null; verified: boolean; lastFacultyContactAt: string | null
  id: string; status: string; outcome: string; createdAt: string; respondedAt: string | null; declinedReason: string | null
  call: { id: string; title: string; agency: string | null; deadline: string | null; daysToDeadline: number | null }
  internalDeadline: string | null; daysToDue: number | null; overdue: boolean
  faculty: { id: string; name: string; email: string | null }; school: { id: string; name: string }; assignedBy: { id: string; name: string } | null
  allocationMethod: string | null; allocationReason: string | null; allocationNote: string | null
  followUps: number; facultyContacts: number; lastFollowUp: { at: string; kind: string; by: string | null; note: string } | null; daysSinceFollowUp: number | null
  nextReminderAt: string | null; submittedAt: string | null; completedAt: string | null; submissionReference: string | null; submissionUrl: string | null; evidence: string | null; lapsedAt: string | null
  passedOnTo: { id: string; name: string; status: string } | null; passedOnFrom: { id: string; name: string } | null
}
type Payload = HubBase & { rows: Row[]; summary: { active: number; awaitingReply: number; overdue: number; silent: number; submittedThisMonth: number; awaitingVerification: number; verifiedThisMonth: number } }

const STATUS: Record<string, { label: string; cls: string }> = {
  ASSIGNED: { label: 'Awaiting reply', cls: 'nk-badge nk-badge-warn' }, ACCEPTED: { label: 'Accepted', cls: 'nk-badge nk-badge-live' },
  IN_PROGRESS: { label: 'In progress', cls: 'nk-badge nk-badge-live' }, COMPLETED: { label: 'Submission recorded', cls: 'nk-badge nk-badge-live' },
  DECLINED: { label: 'Declined', cls: 'nk-badge' }, CANCELLED: { label: 'Unallocated', cls: 'nk-badge' }, LAPSED: { label: 'Not applied for', cls: 'nk-badge' },
}
const OUTCOME: Record<string, string> = { AWARDED: 'nk-badge nk-badge-ok', REJECTED: 'nk-badge bg-red-50 text-red-800 border-red-200', WITHDRAWN: 'nk-badge' }
const kindLabel = (k: string) => ({ CALL: 'Call', EMAIL: 'Email', MEETING: 'Meeting', NOTE: 'Note', REMINDER: 'Reminder' } as Record<string, string>)[k] || k

export default function AssignedCallsTab({ filters, setFilters, openTab }: { filters: Filters; setFilters: (f: Filters) => void; openTab: OpenTab }) {
  useTenantLocale()
  const { showToast } = useToast()
  const [revision, setRevision] = useState(0)
  const [open, setOpen] = useState<string | null>(null); const [profile, setProfile] = useState<Row['faculty'] | null>(null)
  const page = Math.max(1, Number.parseInt(filters.page || '1', 10) || 1)
  const setPage = (next: number) => setFilters({ ...filters, page: String(next) })
  const { data, error, loading } = useHubReport<Payload>('assigned-calls', filters, page, revision)
  const set = (key: string, value: string) => { setFilters({ ...filters, [key]: value, page: '1', logPage: '1' }) }
  const patch = (next: Filters) => { setFilters({ ...filters, ...next, page: '1', logPage: '1' }) }
  const status = filters.status || 'active'
  const quick = (next: Filters) => { const { status: _s, due: _d, silent: _si, awaitingReply: _a, submittedIn: _m, evidence: _e, ...rest } = filters; setFilters({ ...rest, ...next, page: '1', logPage: '1' }) }
  const isQuick = (k: string) => k === 'active' ? status === 'active' && !filters.due && !filters.silent && !filters.awaitingReply
    : k === 'awaiting' ? filters.awaitingReply === 'true' : k === 'overdue' ? filters.due === 'overdue' : k === 'silent' ? filters.silent === 'true' : filters.submittedIn === 'month'
  const changed = (message: string) => { showToast({ type: 'success', title: message }); setRevision(r => r + 1) }
  const s = data?.summary

  return <div className="space-y-4">
    <ReportStamp data={data} />
    {filters.callId && <p className="flex flex-wrap items-center gap-2 rounded border border-cobalt-100 bg-cobalt-50 px-3 py-2 text-sm">Showing allocations for <strong>{filters.callTitle || 'one call'}</strong>
      <button className="text-cobalt-700 underline" onClick={() => { const { callId: _c, callTitle: _t, ...rest } = filters; setFilters({...rest,page:'1',logPage:'1'}) }}>Show all calls</button></p>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Stat title="Active allocations" value={s?.active} active={isQuick('active')} help="Assigned, accepted or in progress." onClick={() => quick({})} />
      <Stat title="No reply for 7+ days" value={s?.awaitingReply} active={isQuick('awaiting')} tone={s?.awaitingReply ? 'border-amber-300' : ''} help="Allocated more than 7 days ago and the faculty member has not accepted or declined." onClick={() => quick({ awaitingReply: 'true' })} />
      <Stat title="Overdue, not submitted" value={s?.overdue} active={isQuick('overdue')} tone={s?.overdue ? 'border-red-300' : ''} help="Active allocations past the internal deadline (or the agency deadline when no internal one was set)." onClick={() => quick({ due: 'overdue' })} />
      <Stat title="No faculty contact, 7+ days" value={s?.silent} active={isQuick('silent')} tone={s?.silent ? 'border-amber-300' : ''} help="Active allocations without a faculty call, email or meeting in the last seven days. Internal notes and reminders do not clear this alert." onClick={() => quick({ silent: 'true' })} />
      <Stat title="Recorded this month" value={s?.submittedThisMonth} detail={`${s?.verifiedThisMonth ?? 0} verified`} active={isQuick('submitted')} help={`Submission claims recorded since the 1st of this month (${timeZoneLabel(clientTimeZone())}). Verified submissions are shown separately below the total.`} onClick={() => quick({ status: 'submitted', submittedIn: 'month' })} />
      <Stat title="Awaiting verification" value={s?.awaitingVerification} active={filters.evidence === 'unverified'} help="Recorded submissions whose current evidence has not been verified. Notes alone are claims." onClick={() => quick({status:'submitted',evidence:'unverified'})} />
    </div>

    <ReportFilters filters={filters} options={data?.options}>
      <ScopeFilters options={data?.options} lens={data?.lens} filters={filters} patch={patch} />
      <Select label="Status" value={status} all={null} onChange={v => patch({ status: v, submittedIn: '', evidence: '' })}
        options={[['active', 'Active'], ['awaiting', 'Awaiting reply'], ['submitted', 'Submitted'], ['closed', 'Closed (unallocated, declined, not applied)'], ['all', 'All']]} />
      <Select label="Deadline" value={filters.due || ''} onChange={v => set('due', v)} all="Any"
        options={[['overdue', 'Overdue'], ['7', 'Due within 7 days'], ['14', 'Due within 14 days'], ['30', 'Due within 30 days']]} />
      <Toggle label="No faculty contact in 7+ days" checked={filters.silent === 'true'} onChange={v => set('silent', v ? 'true' : '')} />
      <Toggle label="Allocated by me" checked={filters.assignedBy === 'me'} onChange={v => set('assignedBy', v ? 'me' : '')} />
      <Select label="Submission evidence" value={filters.evidence || ''} onChange={value => patch({evidence:value,...(value ? {status:'submitted'} : {})})} options={[["unverified","Awaiting verification"],["verified","Verified"]]} />
      <Search value={filters.q || ''} onChange={v => set('q', v)} placeholder="Call, agency, faculty name or email" />
      <div className="ml-auto"><ExportButtons report="assigned-calls" filters={filters} snapshot={data?.snapshot} disabled={loading || !!error || !data} /></div>
    </ReportFilters>

    <Status loading={loading && !data} refreshing={loading && !!data} error={error} />
    {data && <p className="nk-sub text-xs">{plural(data.total, 'allocation')}{filters.submittedIn === 'month' ? ' submitted since the 1st of this month' : ''} · active first, soonest deadline first · deadline = internal deadline, else the agency deadline</p>}
    {data && <section className="nk-panel overflow-x-auto">
      <table className="dsr-table dsr-table-mobile min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>Call</Th><Th>Faculty · school</Th><Th>Status</Th><Th>Deadlines</Th><Th>Last follow-up</Th><Th>Submission</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
        <tbody>{data.rows.map(r => {
          const due = daysLeftLabel(r.daysToDue); const st = r.status === 'COMPLETED' && r.verified ? {label:'Verified submission',cls:'nk-badge nk-badge-ok'} : STATUS[r.status] || { label: r.status, cls: 'nk-badge' }
          const quiet = r.daysSinceFollowUp === null ? null : r.daysSinceFollowUp
          return <Fragment key={r.id}><tr>
            <Td label="Opportunity"><Link href={`/funding-dept/calls/${encodeURIComponent(r.call.id)}?school=${encodeURIComponent(r.school.id)}`} target="_blank" className="font-medium text-cobalt-700 hover:underline">{r.call.title}</Link>
              <p className="nk-sub text-xs">{r.call.agency || 'Agency not recorded'}</p>
              <p className="nk-sub text-xs">Allocated {fmtDate(r.createdAt)}{r.assignedBy ? ` by ${r.assignedBy.name}` : ''}</p>
              <ManualAllocationDetails allocationMethod={r.allocationMethod} allocationReason={r.allocationReason} allocationNote={r.allocationNote} /></Td>
            <Td label="Faculty and school"><button className="text-left font-medium text-cobalt-700 hover:underline" onClick={() => setProfile(r.faculty)}>{r.faculty.name}</button>
              <p className="nk-sub text-xs">{r.school.name}</p>
              {r.passedOnFrom && <p className="nk-sub text-xs">Passed on from {r.passedOnFrom.name}</p>}
              {r.passedOnTo && <p className="nk-sub text-xs">Passed on to {r.passedOnTo.name}</p>}</Td>
            <Td label="Allocation status"><span className={st.cls}>{st.label}</span>
              {r.status === 'ASSIGNED' && <p className="nk-sub text-xs">Sent {Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000)} days ago</p>}
              {r.respondedAt && r.status !== 'ASSIGNED' && <p className="nk-sub text-xs">Replied {fmtDate(r.respondedAt)}</p>}
              {r.declinedReason && <p className="text-xs text-red-700">“{r.declinedReason}”</p>}</Td>
            <Td label="Deadlines" className="whitespace-nowrap"><p className="text-xs">Internal: {fmtDate(r.internalDeadline)}</p><p className="text-xs">Entry: {fmtDate(r.call.deadline)}</p>
              {['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(r.status) && <p className={`text-xs ${due.tone}`}>{r.overdue ? `Overdue ${Math.abs(r.daysToDue || 0)} days` : due.text}</p>}</Td>
            <Td label="Contact and activity"><p className="mb-2 text-xs text-slate-500">{r.lastFacultyContactAt ? `Faculty contact: ${fmtDate(r.lastFacultyContactAt)}` : 'No faculty contact recorded'}</p><button className="text-left" title="Open the follow-up log and add a follow-up." onClick={() => setOpen(open === r.id ? null : r.id)}>
              {r.lastFollowUp ? <><span className={`text-xs ${quiet !== null && quiet >= 7 && ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(r.status) ? 'text-amber-700 font-medium' : ''}`}>{kindLabel(r.lastFollowUp.kind)} · {fmtDate(r.lastFollowUp.at)}</span>
                <span className="nk-sub block text-xs">{r.lastFollowUp.by || 'Unknown'} · {plural(r.followUps, 'entry', 'entries')}</span></>
                : <span className="text-xs text-amber-700">No follow-up yet</span>}
              <span className="block text-xs text-cobalt-700 underline">{open === r.id ? 'Hide log' : 'Log / add follow-up'}</span></button>
              {r.nextReminderAt && (new Date(r.nextReminderAt).getTime() < Date.now()
                ? <p className="text-xs text-amber-700" title="This reminder's time has passed and it has not been sent yet.">Reminder due since {fmtDate(r.nextReminderAt)}</p>
                : <p className="nk-sub text-xs">Reminder {fmtDate(r.nextReminderAt)}</p>)}</Td>
            <Td label="Submission evidence">{r.submittedAt || r.status === 'COMPLETED' ? <><span className="text-xs">Recorded{r.submittedAt || r.completedAt ? ` ${fmtDate(r.submittedAt || r.completedAt)}` : ''}</span>
              <span className={`mt-1 block text-xs font-semibold ${r.verified ? 'text-emerald-700' : r.evidence && !['NOTE','MISSING'].includes(r.evidence) ? 'text-blue-700' : 'text-amber-700'}`}>{r.verified ? 'Verified' : r.evidence && !['NOTE','MISSING'].includes(r.evidence) ? 'Evidence attached · unverified' : 'Claimed · evidence needed'}</span>
              {!r.verified && data.lens === 'department' && r.applicationId && <SubmissionVerificationButton applicationId={r.applicationId} schoolId={r.school.id} title={r.call.title} onVerified={() => changed('Submission evidence verified')} />}
              {r.submissionReference && <p className="nk-sub text-xs">Ref {r.submissionReference}</p>}
              {r.submissionUrl && <a href={r.submissionUrl} target="_blank" rel="noreferrer" className="block text-xs text-cobalt-700 underline">Evidence link</a>}
              {r.outcome !== 'PENDING' && <span className={`${OUTCOME[r.outcome] || 'nk-badge'} mt-1`}>{r.outcome.toLowerCase()}</span>}</>
              : r.lapsedAt ? <span className="text-xs">Closed {fmtDate(r.lapsedAt)}</span> : <span className="nk-sub text-xs">Not yet</span>}</Td>
            <Td label="Next action"><AssignmentRowActions compact onChanged={changed} assignment={{ id: r.id, status: r.status, outcome: r.outcome, deadlineAt: r.internalDeadline, declinedReason: r.declinedReason,
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
