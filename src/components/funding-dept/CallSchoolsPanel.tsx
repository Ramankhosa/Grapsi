'use client'

/**
 * The call window's "All schools" panel: every school this call concerns in the
 * viewer's reach, side by side — how the call reached it, matched faculty,
 * shortlist, allocations, submissions, and the coordinator's action status.
 * Picking a school opens its matching faculty below, where they can be
 * allocated or shortlisted.
 */
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { ACTION_STATUS_LABELS, type ActionStatus } from '@/lib/fundingDept/reportGlossary'
import { MarkCompleted } from '@/components/funding-dept/reports/IncomingCallsTab'

type School = {
  schoolId: string; schoolName: string; sourceLabels: string[]; coordinator: { id: string; name: string } | null
  matchedFaculty: number; shortlisted: number; allocations: number; liveAllocations: number; submitted: number; followUps: number
  actionStatus: ActionStatus; completed: { at: string; by: string | null; note: string | null } | null
}
type Payload = { callId: string; row: { schools: School[]; actionStatus: ActionStatus } | null; otherSchools: Array<{ id: string; name: string }>; canAddSchool: boolean; matchesRefreshedAt: string | null }

const BADGE: Record<ActionStatus, string> = { NOT_STARTED: 'nk-badge nk-badge-warn', IN_PROGRESS: 'nk-badge nk-badge-live', COMPLETED: 'nk-badge nk-badge-ok' }
const field = 'rounded border border-nickel-300 bg-white px-2 py-1.5 text-sm'

export default function CallSchoolsPanel({ callId, selectedSchoolId, onSelect, revision, onChanged, onLoaded }: {
  callId: string; selectedSchoolId: string; onSelect: (schoolId: string) => void; revision: number; onChanged: () => void
  /** The schools this call reaches, in panel order, each time the panel loads. */
  onLoaded?: (schoolIds: string[]) => void
}) {
  const { authFetch } = useAuth()
  const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState(''); const [marking, setMarking] = useState(false)
  const [own, setOwn] = useState(0)
  const load = useCallback(async () => {
    try {
      const r = await authFetch(`/api/funding-dept/calls/${encodeURIComponent(callId)}/schools`)
      const body = await r.json().catch(() => null)
      if (!r.ok) throw Error(body?.error || 'Could not load the schools for this call.')
      setData(body); setError('')
      onLoaded?.((body as Payload).row?.schools.map(s => s.schoolId) || [])
    } catch (e) { setError((e as Error).message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, callId])
  useEffect(() => { void load() }, [load, revision, own])
  const changed = () => { setOwn(v => v + 1); onChanged() }

  if (error) return <p role="alert" className="nk-panel p-3 text-sm text-red-700">{error}</p>
  if (!data) return <p className="nk-sub text-sm">Loading schools…</p>
  const schools = data.row?.schools || []

  return <section className="nk-panel mt-6 overflow-x-auto">
    <div className="flex flex-wrap items-baseline justify-between gap-2 p-3">
      <h2 className="nk-title text-lg">All schools for this call</h2>
      <div className="flex items-center gap-2">
        {schools.length > 0 && <button className="nk-btn-secondary nk-btn-sm" aria-expanded={marking} onClick={() => setMarking(v => !v)}>{data.row?.actionStatus === 'COMPLETED' ? 'Action completed ✓' : 'Mark action completed'}</button>}
      </div>
    </div>
    {marking && data.row && <div className="border-t border-nickel-100 bg-nickel-50 p-3"><MarkCompleted row={{ callId, schools }} onDone={() => { setMarking(false); changed() }} /></div>}
    {schools.length === 0 ? <p className="nk-sub p-4 text-sm">This call has not reached any of your schools by discipline mapping or a strong/moderate faculty match. You can still allocate it from the button above.</p>
      : <table className="min-w-full text-sm"><thead className="bg-nickel-50"><tr>{['School', 'How it got here', 'Coordinator', 'Matched faculty', 'Shortlisted', 'Allocated', 'Submitted', 'DSR action', ''].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-nickel-600">{h}</th>)}</tr></thead>
        <tbody>{schools.map(s => { const on = s.schoolId === selectedSchoolId
          return <tr key={s.schoolId} className={on ? 'bg-cobalt-50' : ''}>
            <td className="border-t border-nickel-100 px-3 py-2 font-medium">{s.schoolName}</td>
            <td className="border-t border-nickel-100 px-3 py-2 text-xs">{s.sourceLabels.join(', ')}</td>
            <td className="border-t border-nickel-100 px-3 py-2 text-xs">{s.coordinator?.name || <span className="text-amber-700">No coordinator</span>}</td>
            <td className="border-t border-nickel-100 px-3 py-2 tabular-nums">{s.matchedFaculty}</td>
            <td className="border-t border-nickel-100 px-3 py-2 tabular-nums">{s.shortlisted}</td>
            <td className="border-t border-nickel-100 px-3 py-2 tabular-nums">{s.liveAllocations}{s.allocations > s.liveAllocations ? <span className="nk-sub text-xs"> (+{s.allocations - s.liveAllocations} closed)</span> : ''}</td>
            <td className="border-t border-nickel-100 px-3 py-2 tabular-nums">{s.submitted}</td>
            <td className="border-t border-nickel-100 px-3 py-2"><span className={BADGE[s.actionStatus]}>{ACTION_STATUS_LABELS[s.actionStatus]}</span>
              {s.completed?.note && <p className="nk-sub mt-0.5 max-w-[14rem] text-xs">{s.completed.note}</p>}</td>
            <td className="border-t border-nickel-100 px-3 py-2 text-right"><button className={on ? 'nk-btn-primary nk-btn-xs' : 'nk-btn-secondary nk-btn-xs'} onClick={() => onSelect(s.schoolId)}>{on ? 'Showing below' : 'Show faculty'}</button></td>
          </tr> })}</tbody></table>}
    {data.canAddSchool && data.otherSchools.length > 0 && <AddSchool callId={callId} schools={data.otherSchools} onAdded={changed} />}
    <p className="nk-sub px-3 pb-3 pt-2 text-xs">Matched faculty = current strong or moderate automatic matches{data.matchesRefreshedAt ? `, refreshed ${new Date(data.matchesRefreshedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}` : ''}. The list below ranks everyone in the selected school live.</p>
  </section>
}

/** Head only: route this call to a school the classifier missed, with a reason for the audit trail. */
function AddSchool({ callId, schools, onAdded }: { callId: string; schools: Array<{ id: string; name: string }>; onAdded: () => void }) {
  const { authFetch } = useAuth(); const [open, setOpen] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  if (!open) return <p className="px-3 pt-2 text-xs"><button className="text-cobalt-700 underline" onClick={() => setOpen(true)}>Add a school to this call</button></p>
  return <form className="flex flex-wrap items-end gap-2 border-t border-nickel-100 px-3 py-3" onSubmit={async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError('')
    try {
      const r = await authFetch('/api/funding-dept/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'ADD', callId, schoolId: f.get('school'), reason: f.get('reason') }) })
      if (!r.ok) throw Error((await r.json().catch(() => null))?.error || 'Could not add the school.')
      setOpen(false); onAdded()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <label className="text-xs">School<select name="school" required className={`${field} block`}><option value="">Choose</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label className="min-w-[16rem] flex-1 text-xs">Why this school<input name="reason" required minLength={3} maxLength={2000} className={`${field} block w-full`} placeholder="e.g. interdisciplinary call; faculty interest known" /></label>
    <button className="nk-btn-primary nk-btn-xs" disabled={busy}>{busy ? 'Adding…' : 'Add school'}</button>
    <button type="button" className="nk-btn-secondary nk-btn-xs" onClick={() => setOpen(false)}>Cancel</button>
    {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
  </form>
}
