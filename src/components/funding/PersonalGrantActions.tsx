'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarPlus, ChevronLeft, Loader2, Star, StickyNote } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import WorkspaceDialog from '@/components/ui/WorkspaceDialog'
import { localDateTime } from '@/lib/personalGrants/dates'
import type { PersonalGrant, PersonalGrantEvent } from '@/lib/personalGrants/types'

const emptyItem = (callId: string): PersonalGrant => ({ id: '', funding_call_id: callId, is_favourite: false, notes: '', notes_revision: 0, events: [] })
type Store = { items: Record<string, PersonalGrant>; ready: boolean; error: string; refresh: () => Promise<void>; save: (callId: string, patch: object) => Promise<PersonalGrant>; reload: (callId: string) => Promise<void> }
const Context = createContext<Store | null>(null)
async function readResponse(response: Response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || body.error || 'Could not load your saved grants. Please try again.')
  return body
}

/** One batch per result page, rather than a private-data request for every card. */
export function PersonalGrantProvider({ callIds, initialItems, children, onChanged }: { callIds: string[]; initialItems?: PersonalGrant[]; children: ReactNode; onChanged?: () => void }) {
  const { user, authFetch } = useAuth()
  const idsKey = [...new Set(callIds)].sort().join(',')
  const scope = `${user?.tenant_id || ''}/${user?.user_id || ''}`
  const [data, setData] = useState<{ key: string; items: Record<string, PersonalGrant> }>({ key: '', items: {} })
  const [error, setError] = useState('')
  const [readyKey, setReadyKey] = useState('')
  const sequence = useRef(0)
  const requestKey = `${scope}:${idsKey}`
  const currentKey = useRef(requestKey); currentKey.current = requestKey
  const refresh = useCallback(async () => {
    if (!user?.tenant_id || !user.user_id) return
    const run = ++sequence.current
    setError('')
    try {
      const items = initialItems || (idsKey ? (await readResponse(await authFetch(`/api/funding/personal-grants?callIds=${encodeURIComponent(idsKey)}`))).items as PersonalGrant[] : [])
      if (run !== sequence.current || currentKey.current !== requestKey) return
      setData({ key: requestKey, items: Object.fromEntries(items.map(item => [item.funding_call_id, item])) }); setReadyKey(requestKey)
    } catch (e) { if (run === sequence.current && currentKey.current === requestKey) { setError(e instanceof Error ? e.message : 'Could not load saved grants.'); setReadyKey('') } }
  }, [authFetch, idsKey, initialItems, requestKey, user?.tenant_id, user?.user_id])
  const invalidate = useCallback(() => { sequence.current++ }, [])
  useEffect(() => { void refresh(); return invalidate }, [refresh, invalidate])
  const store = useMemo<Store>(() => ({
    items: data.key === requestKey ? data.items : {}, ready: readyKey === requestKey, error, refresh,
    save: async (callId, patch) => {
      const { item } = await readResponse(await authFetch(`/api/funding/personal-grants/${encodeURIComponent(callId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }))
      if (currentKey.current === requestKey) { setData(current => ({ key: requestKey, items: { ...(current.key === requestKey ? current.items : {}), [callId]: item } })); onChanged?.() }
      return item
    },
    reload: async callId => {
      const { item } = await readResponse(await authFetch(`/api/funding/personal-grants/${encodeURIComponent(callId)}`))
      if (currentKey.current === requestKey) { setData(current => ({ key: requestKey, items: { ...(current.key === requestKey ? current.items : {}), [callId]: item || emptyItem(callId) } })); onChanged?.() }
    },
  }), [authFetch, data, error, onChanged, readyKey, refresh, requestKey])
  return <Context.Provider key={scope} value={store}>{children}</Context.Provider>
}

export function usePersonalGrantItems() { return useContext(Context)?.items || {} }

export function PersonalGrantLoadError() {
  const store = useContext(Context)
  return store?.error ? <div role="alert" className="my-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{store.error}<button type="button" onClick={() => void store.refresh()} className="ml-3 underline">Retry saved grants</button></div> : null
}

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100'
const dateLabel = (event: PersonalGrantEvent) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone }).format(new Date(event.event_at))
const reminderLabel: Record<PersonalGrantEvent['reminder_state'], string> = { NONE: 'No email reminder', PENDING: 'Email scheduled', SENDING: 'Sending email', SENT: 'Email sent', FAILED: 'Delivery needs attention' }

export default function PersonalGrantActions({ callId, title, compact = false, disabled = false }: { callId: string; title: string; compact?: boolean; disabled?: boolean }) {
  const store = useContext(Context)
  const { user, authFetch } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notes, setNotes] = useState('')
  const [notesRevision, setNotesRevision] = useState(0)
  const [savedNotes, setSavedNotes] = useState('')
  const [discard, setDiscard] = useState(false)
  const [form, setForm] = useState<{ event?: PersonalGrantEvent; title: string; time: string; zone: string; remind: boolean; reminder: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  if (!user?.tenant_id || !store) return null
  const item = store.items[callId] || emptyItem(callId)
  const available = store.ready && !disabled
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please try again.') } finally { setBusy(false) }
  }
  const toggle = () => void run(async () => { await store.save(callId, { is_favourite: !item.is_favourite }) })
  const show = () => { setNotes(item.notes); setSavedNotes(item.notes); setNotesRevision(item.notes_revision); setForm(null); setError(''); setNotice(''); setDiscard(false); setConfirmDelete(null); setOpen(true) }
  const close = (value: boolean) => { if (!value && (notes !== savedNotes || form)) { setDiscard(true); return } setOpen(value) }
  const editEvent = (event?: PersonalGrantEvent) => {
    const zone = event?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0)
    const time = event ? localDateTime(event.event_at, zone) : localDateTime(tomorrow, zone)
    setForm({ event, title: event?.title || 'Prepare grant application', time, zone, remind: Boolean(event?.reminder_at), reminder: event?.reminder_at ? localDateTime(event.reminder_at, zone) : time }); setError(''); setNotice(''); setConfirmDelete(null)
  }
  return <>
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'rounded-xl bg-slate-50 p-3'}`}>
      <button type="button" disabled={!available || busy} onClick={toggle} aria-label={item.is_favourite ? `Remove ${title} from favourites` : `Favourite ${title}`} aria-pressed={item.is_favourite}
        className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium disabled:opacity-40 ${item.is_favourite ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300'}`}>
        <Star className="h-4 w-4" fill={item.is_favourite ? 'currentColor' : 'none'} aria-hidden="true" />{!compact && (item.is_favourite ? 'Favourited' : 'Favourite')}
      </button>
      <button type="button" disabled={!available || busy} onClick={show} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"><StickyNote className="h-4 w-4" aria-hidden="true" />Plan & notes{item.events.length > 0 && <span className="rounded-md bg-blue-50 px-1.5 text-xs text-blue-700">{item.events.length}</span>}</button>
      {!compact && <Link href="/funding/my-grants" className="ml-auto text-sm text-blue-700">My grants →</Link>}
    </div>
    {!open && error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    <WorkspaceDialog open={open} onOpenChange={close} busy={busy} title={form ? (form.event ? 'Edit calendar entry' : 'Add to grant calendar') : 'Your grant workspace'} description={title}>
      {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {discard ? <div className="space-y-4"><p className="text-sm text-slate-700">You have unsaved changes. Close without saving?</p><div className="flex gap-2"><button type="button" className="funding-button-primary" onClick={() => setDiscard(false)}>Keep editing</button><button type="button" className="funding-button-secondary" onClick={() => { setDiscard(false); setOpen(false); setForm(null) }}>Discard changes</button></div></div> : form ? <form onSubmit={event => { event.preventDefault(); void run(async () => {
        const url = form.event ? `/api/funding/personal-grants/events/${form.event.id}` : `/api/funding/personal-grants/${encodeURIComponent(callId)}/events`
        await readResponse(await authFetch(url, { method: form.event ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title, local_event_at: form.time, timezone: form.zone, reminder_local_at: form.remind ? form.reminder : null, ...(form.event ? { revision: form.event.revision } : {}) }) }))
        await store.reload(callId); setForm(null); setNotice('Calendar entry saved.')
      }) }} className="space-y-4">
        <button type="button" onClick={() => { setForm(null); setError('') }} className="flex items-center gap-1 text-sm text-slate-500"><ChevronLeft className="h-4 w-4" />Back to notes</button>
        <label className="block text-sm font-medium text-slate-700">Entry title<input required maxLength={160} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputClass} /></label>
        <label className="block text-sm font-medium text-slate-700">Calendar date and time<input required type="datetime-local" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className={inputClass} /></label>
        <label className="block text-sm font-medium text-slate-700">Time zone<input required maxLength={100} list={`grant-zones-${callId}`} value={form.zone} onChange={e => setForm({ ...form, zone: e.target.value })} className={inputClass} /><datalist id={`grant-zones-${callId}`}>{['Asia/Kolkata', 'Europe/London', 'Europe/Brussels', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'].map(zone => <option key={zone} value={zone} />)}</datalist></label>
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4"><label className="flex items-center gap-2 text-sm font-medium text-slate-800"><input type="checkbox" checked={form.remind} onChange={e => setForm({ ...form, remind: e.target.checked })} className="h-4 w-4 accent-blue-600" />Email me a reminder</label>
          {form.remind && <label className="mt-3 block text-sm text-slate-700">Send reminder on<input required type="datetime-local" value={form.reminder} max={form.time} onChange={e => setForm({ ...form, reminder: e.target.value })} className={inputClass} /></label>}
          <p className="mt-2 break-words text-xs leading-5 text-slate-500">Sent to {user.email} in {form.zone}. Reminders are checked every minute; delivery can take a few minutes.</p>
        </div>
        {form.event?.reminder_state === 'FAILED' && <p className="text-sm text-amber-800">Delivery could not be confirmed. Choose a new reminder time to reschedule.</p>}
        <button type="submit" disabled={busy} className="funding-button-primary w-full">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{form.event ? 'Save calendar entry' : 'Add to calendar'}</button>
      </form> : <div className="space-y-6">
        <section><div className="flex items-center justify-between gap-2"><label htmlFor={`notes-${callId}`} className="text-sm font-semibold text-slate-900">Personal notes</label><span className="text-xs text-slate-500">Only you can see these</span></div>
          <textarea id={`notes-${callId}`} rows={5} maxLength={10000} disabled={busy} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ideas, eligibility checks, documents to prepare…" className={inputClass} />
          <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-slate-400">{notes.length.toLocaleString()} / 10,000</span><button type="button" disabled={busy || notes === savedNotes} onClick={() => void run(async () => { const updated = await store.save(callId, { notes, notes_revision: notesRevision }); setNotesRevision(updated.notes_revision); setSavedNotes(notes); setNotice('Personal notes saved.') })} className="funding-button-primary">Save notes</button></div>
          {error.includes('another tab') && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>Copy your unsaved draft before loading the latest notes. Loading replaces the text in this editor.</p><button type="button" className="mt-2 text-sm text-blue-700 underline" onClick={() => void run(async () => {
            const response = await readResponse(await authFetch(`/api/funding/personal-grants/${encodeURIComponent(callId)}`)); const latest: PersonalGrant = response.item || emptyItem(callId)
            setNotes(latest.notes); setSavedNotes(latest.notes); setNotesRevision(latest.notes_revision); await store.reload(callId); setNotice('Latest saved notes loaded.')
          })}>Load latest saved notes</button></div>}
        </section>
        <section><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">Grant calendar</h3><button type="button" disabled={busy || notes !== savedNotes} onClick={() => editEvent()} className="funding-button-secondary"><CalendarPlus className="h-4 w-4" />Add calendar entry</button></div>
          {notes !== savedNotes && <p className="mt-2 text-xs text-amber-800">Save your notes before editing the calendar.</p>}
          <p className="mt-2 text-xs leading-5 text-slate-500">Create your own milestones. Check the funder’s published deadline before applying.</p>
          {item.events.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">No calendar entries yet.</p> : <ul className="mt-3 space-y-2">{item.events.map(event => <li key={event.id} className="rounded-xl border border-slate-200 p-3"><p className="break-words text-sm font-medium text-slate-800">{event.title}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(event)} · {event.timezone}</p><p className={`mt-1 text-xs ${event.reminder_state === 'FAILED' ? 'text-rose-700' : 'text-blue-700'}`}>{reminderLabel[event.reminder_state]}{event.reminder_at && event.reminder_state === 'PENDING' ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone }).format(new Date(event.reminder_at))}` : ''}</p>
            {event.reminder_state === 'FAILED' && <p className="mt-1 text-xs text-rose-700">Edit and choose a new reminder time to try again.</p>}
            <div className="mt-2 flex flex-wrap gap-3"><button type="button" disabled={busy || notes !== savedNotes || event.reminder_state === 'SENDING'} onClick={() => editEvent(event)} className="min-h-9 text-xs font-medium text-blue-700 disabled:opacity-40">Edit</button><button type="button" disabled={busy || notes !== savedNotes || event.reminder_state === 'SENDING'} onClick={() => setConfirmDelete(event.id)} className="min-h-9 text-xs text-slate-500 disabled:opacity-40">Remove entry</button></div>
            {confirmDelete === event.id && <div className="mt-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-800"><p>Remove this calendar entry and cancel its pending reminder?</p><div className="mt-2 flex gap-3"><button type="button" disabled={busy} onClick={() => void run(async () => { await readResponse(await authFetch(`/api/funding/personal-grants/events/${event.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: event.revision }) })); await store.reload(callId); setConfirmDelete(null); setNotice('Entry removed. Its pending reminder is cancelled.') })} className="min-h-9 font-semibold">Remove and cancel</button><button type="button" onClick={() => setConfirmDelete(null)} className="min-h-9">Keep entry</button></div></div>}
          </li>)}</ul>}
        </section>
        <Link href="/funding/my-grants?view=calendar" className="block text-center text-sm font-medium text-blue-700">Open my grant calendar →</Link>
      </div>}
    </WorkspaceDialog>
  </>
}
