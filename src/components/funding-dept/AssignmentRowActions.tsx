'use client'

/**
 * Everything the department can do to one allocation, in one place: mark it
 * submitted, unallocate it, close it out as not applied for, pass it on, ask
 * again, reopen, and record the funding decision. Used by Assigned Calls, the
 * call window and the "Calls I assigned" page, so the rules (a reason for every
 * unallocation, proof for every submission) are the same everywhere.
 */
import { useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import ReassignDialog from './ReassignDialog'

export type RowAssignment = {
  id: string
  status: string
  outcome?: string | null
  deadlineAt: string | null
  declinedReason?: string | null
  callTitle: string
  facultyName: string
  facultyEmail?: string | null
  passedOnTo?: unknown
}

type Dialog = 'submitted' | 'unallocate' | 'lapse' | 'outcome' | 'reassign' | null
const LIVE = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS']
const input = 'mt-1 block w-full rounded border border-nickel-300 bg-white px-2 py-1.5 text-sm'

export default function AssignmentRowActions({ assignment, onChanged, compact = false }: { assignment: RowAssignment; onChanged: (message: string) => void; compact?: boolean }) {
  const { authFetch } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const s = assignment.status
  const size = compact ? 'nk-btn-xs' : 'nk-btn-sm'

  const patch = async (body: Record<string, unknown>, message: string) => {
    setBusy(true); setError('')
    try {
      const r = await authFetch(`/api/assignments/${encodeURIComponent(assignment.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await r.json().catch(() => null)
      if (!r.ok) throw Error(data?.error || 'Could not update this allocation.')
      setDialog(null); onChanged(message)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return <>
    <div className="flex flex-wrap justify-end gap-1.5">
      {LIVE.includes(s) && <button className={`nk-btn-primary ${size}`} onClick={() => { setError(''); setDialog('submitted') }} title="Record that the proposal went to the agency, with a reference, link or note.">Mark submitted</button>}
      {s === 'DECLINED' && <button className={`nk-btn-secondary ${size}`} disabled={busy} onClick={() => void patch({ status: 'ASSIGNED' }, 'Asked again')}>Ask again</button>}
      {!assignment.passedOnTo && ['DECLINED', ...LIVE].includes(s) && <button className={`nk-btn-secondary ${size}`} onClick={() => setDialog('reassign')} title="Hand this call to someone else; the chase history travels with it.">Pass on</button>}
      {LIVE.includes(s) && <button className={`nk-btn-ghost ${size}`} onClick={() => { setError(''); setDialog('lapse') }} title="The faculty member never applied. Removes it from chase queues.">Not applied for</button>}
      {['DECLINED', 'LAPSED', ...LIVE].includes(s) && <button className={`nk-btn-ghost ${size}`} onClick={() => { setError(''); setDialog('unallocate') }} title="Withdraw this allocation. The person goes back on the shortlist.">Unallocate</button>}
      {s === 'LAPSED' && <button className={`nk-btn-secondary ${size}`} disabled={busy} onClick={() => void patch({ status: 'IN_PROGRESS' }, 'Reopened')}>Reopen</button>}
      {s === 'CANCELLED' && <button className={`nk-btn-secondary ${size}`} disabled={busy} onClick={() => void patch({ status: 'ASSIGNED' }, 'Allocated again')}>Allocate again</button>}
      {s === 'COMPLETED' && <button className={`nk-btn-secondary ${size}`} onClick={() => { setError(''); setDialog('outcome') }}>Record outcome</button>}
    </div>
    {error && !dialog && <p role="alert" className="mt-1 text-right text-xs text-red-700">{error}</p>}

    {dialog === 'reassign' && <ReassignDialog assignment={{ id: assignment.id, status: s, deadlineAt: assignment.deadlineAt, declinedReason: assignment.declinedReason ?? null,
      call: { title: assignment.callTitle }, assignee: { name: assignment.facultyName, email: assignment.facultyEmail || '' } }}
      onClose={() => setDialog(null)} onDone={message => { setDialog(null); onChanged(message) }} />}

    {dialog && dialog !== 'reassign' && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && setDialog(null)}>
      <form role="dialog" aria-modal="true" className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 text-left shadow-xl" onClick={e => e.stopPropagation()} onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget); const v = (k: string) => String(f.get(k) || '').trim()
        if (dialog === 'submitted') void patch({ status: 'COMPLETED', submissionReference: v('reference') || null, submissionUrl: v('url') || null, submissionNotes: v('notes') || null, submittedAt: v('date') || null }, 'Marked submitted')
        if (dialog === 'unallocate') void patch({ status: 'CANCELLED', cancelReason: v('reason') }, 'Unallocated')
        if (dialog === 'lapse') void patch({ status: 'LAPSED', lapsedReason: v('reason') }, 'Closed out as not applied for')
        if (dialog === 'outcome') { const outcome = v('outcome'); const amount = Number(v('amount')); void patch({ outcome, awardAmount: outcome === 'AWARDED' && amount > 0 ? amount : null, awardCurrency: outcome === 'AWARDED' ? v('currency') || 'INR' : null }, 'Outcome recorded') }
      }}>
        <h2 className="text-base font-semibold">{{ submitted: 'Mark submitted', unallocate: 'Unallocate', lapse: 'Not applied for', outcome: 'Record the funding decision' }[dialog]}</h2>
        <p className="nk-sub text-sm">{assignment.facultyName} · {assignment.callTitle}</p>
        {dialog === 'submitted' && <>
          <label className="block text-xs">Submission reference / application number<input name="reference" maxLength={200} className={input} /></label>
          <label className="block text-xs">Link to the submission<input name="url" maxLength={2000} className={input} placeholder="https://" /></label>
          <label className="block text-xs">Notes<textarea name="notes" maxLength={5000} rows={2} className={input} /></label>
          <label className="block text-xs">Submitted on<input name="date" type="date" className={input} max={new Date().toISOString().slice(0, 10)} /></label>
          <p className="nk-sub text-xs">A reference, link or note is required as proof.</p></>}
        {dialog === 'unallocate' && <label className="block text-xs">Why is the department withdrawing this allocation?<textarea name="reason" required minLength={3} maxLength={2000} rows={3} className={input} placeholder="e.g. faculty on leave; reallocating to a better fit" />
          <span className="nk-sub mt-1 block">Kept in the follow-up log. The person goes back on the shortlist; the call reappears in Pendency if nobody else is allocated.</span></label>}
        {dialog === 'lapse' && <label className="block text-xs">What happened, and can the call still be applied for?<textarea name="reason" required minLength={3} maxLength={2000} rows={3} className={input} /></label>}
        {dialog === 'outcome' && <>
          <label className="block text-xs">Decision<select name="outcome" defaultValue={assignment.outcome || 'PENDING'} className={input}><option value="PENDING">Awaiting decision</option><option value="AWARDED">Awarded</option><option value="REJECTED">Rejected</option><option value="WITHDRAWN">Withdrawn</option></select></label>
          <div className="flex gap-2"><label className="block flex-1 text-xs">Amount awarded<input name="amount" type="number" min={0} step="any" className={input} /></label>
            <label className="block w-24 text-xs">Currency<input name="currency" defaultValue="INR" maxLength={10} className={input} /></label></div></>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="nk-btn-secondary nk-btn-sm" disabled={busy} onClick={() => setDialog(null)}>Cancel</button>
          <button className="nk-btn-primary nk-btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form></div>}
  </>
}
