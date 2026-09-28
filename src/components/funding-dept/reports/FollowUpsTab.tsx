'use client'

/**
 * Follow-ups — the weekly record of effort behind every allocation: who
 * followed up, how often, which allocations went silent, and the contact trail
 * that led to each submission.
 */
import Link from 'next/link'
import { useState } from 'react'

import {
  ExportButtons, Pager, ScopeFilters, Select, Stat, Status, Td, Th, Toggle, define, fmtDate, plural,
  useHubReport, type Filters, type HubBase, type OpenTab,
} from './hubKit'

type Cell = { followUps: number; facultyContacts: number; reminders: number; active: number; touched: number; silent: number }
type Member = { userId: string; name: string; weeks: Record<string, Cell>; total: Cell }
type Effort = { assignmentId: string; callId: string; callTitle: string; faculty: string; school: string; owner: string | null; status: string; allocatedAt: string
  perWeek: Record<string, number>; followUps: number; facultyContacts: number; daysToFirstContact: number | null; lastFollowUpAt: string | null
  highestStage: string | null; result: 'SUBMITTED' | 'IN_PROGRESS' | 'CLOSED'; silentThisWeek: boolean }
type Log = { id: string; at: string; week: string; kind: string; target: string; stage: string | null; note: string; author: string | null; authorId: string
  callId: string | null; callTitle: string | null; faculty: string | null; assignmentId: string | null; school: string | null }
type Payload = HubBase & { weeks: string[]; members: Member[]; effort: Effort[]; effortTotal: number; log: Log[]; logTotal: number
  totals: { followUps: number; facultyContacts: number; activeAssignments: number; silentThisWeek: number } }

/** followUpReport.NO_OWNER: allocations in a school with no coordinator (not importable into a client bundle). */
const NO_OWNER_ROW = 'no-coordinator'
const weekLabel = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const STAGE: Record<string, string> = { CONTACTED: 'Contacted', PREPARING: 'Preparing', APPROVALS: 'Approvals', SUBMITTED: 'Submitted' }
const KIND: Record<string, string> = { CALL: 'Call', EMAIL: 'Email', MEETING: 'Meeting', NOTE: 'Note', REMINDER: 'Reminder' }
const RESULT: Record<Effort['result'], { label: string; cls: string }> = { SUBMITTED: { label: 'Submitted', cls: 'nk-badge nk-badge-ok' }, IN_PROGRESS: { label: 'In progress', cls: 'nk-badge nk-badge-live' }, CLOSED: { label: 'Closed, not submitted', cls: 'nk-badge' } }

export default function FollowUpsTab({ filters, setFilters, openTab }: { filters: Filters; setFilters: (f: Filters) => void; openTab: OpenTab }) {
  const [page, setPage] = useState(1)
  const query = { weeks: '8', ...filters }
  const { data, error, loading } = useHubReport<Payload>('follow-ups', query, page, 0)
  const set = (key: string, value: string) => { setFilters({ ...filters, [key]: value }); setPage(1) }
  const setMany = (next: Filters) => { setFilters({ ...filters, ...next }); setPage(1) }
  const t = data?.totals
  const current = data?.weeks[data.weeks.length - 1]
  const memberIdOf = (userId: string) => data?.options.members.find(m => m.userId === userId)?.id || ''
  const maxCell = Math.max(1, ...(data?.members || []).flatMap(m => Object.values(m.weeks).map(c => c.followUps)))

  return <div className="space-y-4">
    {filters.assignmentId && <p className="flex flex-wrap items-center gap-2 rounded border border-cobalt-100 bg-cobalt-50 px-3 py-2 text-sm">Showing one allocation: <strong>{filters.assignmentLabel || filters.assignmentId}</strong>
      <button className="text-cobalt-700 underline" onClick={() => { const { assignmentId: _a, assignmentLabel: _l, ...rest } = filters; setFilters(rest) }}>Show all</button></p>}
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat title={`Follow-ups (${data?.weeks.length ?? query.weeks} weeks)`} value={t?.followUps} help={define('Follow-up')} />
      <Stat title="Faculty contacts" value={t?.facultyContacts} help={define('Faculty contact')} />
      <Stat title="Active allocations this week" value={t?.activeAssignments} help="Allocations assigned, accepted or in progress at some point this week, counted against their responsible coordinator." onClick={() => openTab('assigned', filters.memberId ? { memberId: filters.memberId } : {})} />
      <Stat title="Silent this week" value={t?.silentThisWeek} active={filters.silentOnly === 'true'} tone={t?.silentThisWeek ? 'border-amber-300' : ''} help={define('Silent assignment')} onClick={() => set('silentOnly', filters.silentOnly === 'true' ? '' : 'true')} />
    </div>

    <div className="nk-panel flex flex-wrap items-end gap-3 p-4">
      <ScopeFilters options={data?.options} lens={data?.lens} filters={filters} patch={setMany} />
      <Select label="Weeks" value={query.weeks} all={null} onChange={v => set('weeks', v)} options={[['4', 'Last 4 weeks'], ['8', 'Last 8 weeks'], ['12', 'Last 12 weeks'], ['26', 'Last 26 weeks']]} />
      <Toggle label="Faculty contacts only" checked={filters.facultyOnly === 'true'} onChange={v => set('facultyOnly', v ? 'true' : '')} help="Count only calls, emails and meetings with the faculty member." />
      <Toggle label="Only allocations silent this week" checked={filters.silentOnly === 'true'} onChange={v => set('silentOnly', v ? 'true' : '')} />
      <div className="ml-auto"><ExportButtons report="follow-ups" filters={query} /></div>
    </div>
    <Status loading={loading && !data} refreshing={loading && !!data} error={error} />

    {data && <section className="nk-panel overflow-x-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2 p-3"><h2 className="font-semibold">Week by week</h2>
        <span className="nk-sub text-xs">{define('Follow-up week')} Each cell: follow-ups logged · allocations silent of those active. Click a cell for its log.</span></div>
      <table className="min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>DSR member</Th>{data.weeks.map(w => <Th key={w} className="text-center">{weekLabel(w)}{w === current ? ' (now)' : ''}</Th>)}<Th className="text-right">Total</Th></tr></thead>
        <tbody>{data.members.map(m => <tr key={m.userId}>
          <Td><span className="font-medium">{m.name}</span>{memberIdOf(m.userId) && data.lens === 'department' && <button className="block text-xs text-cobalt-700 underline" onClick={() => set('memberId', memberIdOf(m.userId))}>Only this member</button>}
            {m.userId === NO_OWNER_ROW && <p className="text-xs text-amber-700">Allocations in schools nobody covers — assign coverage</p>}</Td>
          {data.weeks.map(w => { const c = m.weeks[w]; const selected = filters.logWeek === w && filters.logAuthor === m.userId
            const shade = c.followUps ? `rgba(29,78,216,${0.08 + 0.3 * (c.followUps / maxCell)})` : undefined
            return <Td key={w} className="p-1 text-center"><button className={`w-full rounded px-1.5 py-1 ${selected ? 'ring-2 ring-cobalt-500' : ''}`} style={{ background: shade }}
              title={`${weekLabel(w)}: ${c.followUps} follow-ups${c.reminders && filters.facultyOnly !== 'true' ? ` (${c.reminders} of them reminders)` : ''}, ${c.facultyContacts} faculty contacts; ${c.touched} of ${c.active} owned allocations followed up`}
              onClick={() => setMany(selected ? { logWeek: '', logAuthor: '' } : { logWeek: w, logAuthor: m.userId })}>
              <span className="block font-semibold tabular-nums">{c.followUps}</span>
              <span className={`block text-[11px] tabular-nums ${c.silent ? 'text-amber-700' : 'text-nickel-500'}`}>{c.active ? `${c.silent}/${c.active} silent` : '—'}</span></button></Td> })}
          <Td className="text-right tabular-nums">{m.total.followUps}<p className="nk-sub text-xs">{m.total.facultyContacts} faculty</p></Td>
        </tr>)}{!data.members.length && <tr><td colSpan={data.weeks.length + 2} className="p-6 text-center nk-sub">No follow-ups or active allocations in these weeks.</td></tr>}</tbody></table>
    </section>}

    {data && <section className="nk-panel overflow-x-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2 p-3"><h2 className="font-semibold">Effort by allocation</h2><span className="nk-sub text-xs">{plural(data.effortTotal, 'allocation')} active in these weeks · the contact trail behind each submission</span></div>
      <table className="min-w-full text-sm"><thead className="bg-nickel-50"><tr><Th>Faculty · call</Th><Th>Owner</Th><Th>Follow-ups per week</Th><Th className="text-right">Total</Th><Th>First contact</Th><Th>Last follow-up</Th><Th>Stage reached</Th><Th>Result</Th></tr></thead>
        <tbody>{data.effort.map(e => <tr key={e.assignmentId}>
          <Td><button className="text-left font-medium text-cobalt-700 hover:underline" title="Open this allocation in Assigned Calls." onClick={() => openTab('assigned', { assignmentId: e.assignmentId, status: 'all' })}>{e.faculty}</button>
            <Link href={`/funding-dept/calls/${encodeURIComponent(e.callId)}`} target="_blank" className="block text-xs text-nickel-600 hover:underline">{e.callTitle}</Link><p className="nk-sub text-xs">{e.school} · allocated {fmtDate(e.allocatedAt)}</p></Td>
          <Td className="text-xs">{e.owner || '—'}</Td>
          <Td><div className="flex gap-0.5" aria-label="Follow-ups per week">{data.weeks.map(w => { const n = e.perWeek[w] || 0
            return <span key={w} title={`${weekLabel(w)}: ${n}`} className={`flex h-5 w-5 items-center justify-center rounded-sm text-[10px] tabular-nums ${n ? 'bg-cobalt-600 text-white' : w === current && e.silentThisWeek ? 'bg-amber-100 text-amber-800' : 'bg-nickel-100 text-nickel-400'}`}>{n || ''}</span> })}</div></Td>
          <Td className="text-right tabular-nums">{e.followUps}<p className="nk-sub text-xs">{e.facultyContacts} faculty</p></Td>
          <Td className="text-xs">{e.daysToFirstContact === null ? <span className="text-amber-700">Never contacted</span> : `${e.daysToFirstContact} days after allocation`}</Td>
          <Td className="text-xs">{fmtDate(e.lastFollowUpAt)}</Td>
          <Td className="text-xs">{e.highestStage ? STAGE[e.highestStage] || e.highestStage : '—'}</Td>
          <Td><span className={RESULT[e.result].cls}>{RESULT[e.result].label}</span></Td>
        </tr>)}{!data.effort.length && <tr><td colSpan={8} className="p-6 text-center nk-sub">No allocations match.</td></tr>}</tbody></table>
      <Pager page={page} total={data.effortTotal} pageSize={data.pageSize} onChange={setPage} /></section>}

    {data && <section className="nk-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 p-3"><h2 className="font-semibold">Follow-up log{filters.logWeek ? ` · week of ${weekLabel(filters.logWeek)}` : ''}{filters.logAuthor ? ` · ${data.members.find(m => m.userId === filters.logAuthor)?.name || ''}` : ''}</h2>
        <span className="nk-sub text-xs">{data.logTotal > data.log.length ? `Latest ${data.log.length} of ${data.logTotal} — export for all` : plural(data.logTotal, 'entry', 'entries')}
          {(filters.logWeek || filters.logAuthor) && <button className="ml-2 text-cobalt-700 underline" onClick={() => setMany({ logWeek: '', logAuthor: '' })}>Clear</button>}</span></div>
      <ul className="divide-y divide-nickel-100">{data.log.map(l => <li key={l.id} className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-sm">
        <span className="w-28 shrink-0 text-xs text-nickel-600">{new Date(l.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        <span className="w-32 shrink-0 text-xs">{l.author || 'Unknown'}</span>
        <span className="nk-badge shrink-0">{KIND[l.kind] || l.kind}{l.target === 'FACULTY' && ['CALL', 'EMAIL', 'MEETING'].includes(l.kind) ? ' · faculty' : l.target === 'AGENCY' ? ' · agency' : ''}</span>
        {l.stage && <span className="nk-badge nk-badge-live shrink-0">{STAGE[l.stage] || l.stage}</span>}
        <span className="min-w-[12rem] flex-1"><span className="text-xs text-nickel-600">{[l.faculty, l.callTitle, l.school].filter(Boolean).join(' · ')}</span><span className="block">{l.note}</span></span>
      </li>)}{!data.log.length && <li className="p-6 text-center nk-sub">No follow-ups logged.</li>}</ul>
    </section>}
  </div>
}
