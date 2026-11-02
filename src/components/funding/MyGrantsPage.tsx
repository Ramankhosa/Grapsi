'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Search, ShieldCheck, Star, StickyNote } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import FundingWorkspaceHeader, { FundingWorkspaceLink } from './FundingWorkspaceHeader'
import PersonalGrantActions, { PersonalGrantProvider, usePersonalGrantItems } from './PersonalGrantActions'
import { localDateTime, localToUtc, validTimeZone } from '@/lib/personalGrants/dates'
import type { PersonalCalendarEvent, PersonalGrant } from '@/lib/personalGrants/types'

type View = 'favourites' | 'library' | 'calendar'
const titleOf = (item: PersonalGrant) => item.funding_call?.scheme_title || item.funding_call?.title || 'Funding opportunity'
const agencyOf = (item: PersonalGrant) => item.funding_call?.agency_name || item.funding_call?.agencyName || 'Funding opportunity'
function monthBounds(month: string, zone: string) {
  const [year, m] = month.split('-').map(Number)
  const next = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 7)
  return { from: localToUtc(`${month}-01T00:00`, zone).toISOString(), to: localToUtc(`${next}-01T00:00`, zone).toISOString() }
}

function GrantCard({ item }: { item: PersonalGrant }) {
  const items = usePersonalGrantItems()
  const current = items[item.funding_call_id] || item
  const deadline = item.funding_call?.close_date || item.funding_call?.deadlineAt
  return <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-xs font-medium text-slate-500">{agencyOf(item)}</p>
    <Link href={`/finder/calls/${encodeURIComponent(item.funding_call_id)}`} className="mt-2 text-lg font-semibold leading-snug tracking-tight text-slate-900 hover:text-blue-700">{titleOf(item)}</Link>
    <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">{deadline && <span className="rounded-lg bg-slate-50 px-2 py-1">Published deadline · {new Date(deadline).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })}</span>}<span className="rounded-lg bg-blue-50 px-2 py-1 text-blue-700">{current.events.length} calendar {current.events.length === 1 ? 'entry' : 'entries'}</span></div>
    {current.notes ? <p className="mt-4 line-clamp-3 whitespace-pre-wrap break-words rounded-xl bg-amber-50/60 p-3 text-sm leading-6 text-slate-600">{current.notes}</p> : <p className="mt-4 text-sm text-slate-400">Add notes to keep your next steps close.</p>}
    <div className="mt-auto pt-5"><PersonalGrantActions compact callId={item.funding_call_id} title={titleOf(item)} /></div>
  </article>
}

function SavedGrantGrid({ items, total, view }: { items: PersonalGrant[]; total: number; view: View }) {
  const store = usePersonalGrantItems()
  const shown = items.filter(item => view !== 'favourites' || (store[item.funding_call_id] || item).is_favourite)
  const count = total - (items.length - shown.length)
  return <><p className="mb-4 text-sm text-slate-500">{count.toLocaleString()} {view === 'favourites' ? 'favourite' : 'saved'} {count === 1 ? 'grant' : 'grants'}</p>{shown.length < items.length && <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">Removed from favourites. Your notes and calendar entries remain in All saved grants.</p>}<div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{shown.map(item => <GrantCard key={item.id} item={item} />)}</div></>
}

function CalendarContent({ items, eventIds, month, zone }: { items: PersonalGrant[]; eventIds: string[]; month: string; zone: string }) {
  const store = usePersonalGrantItems()
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => setSelected(null), [month, zone])
  const originalIds = new Set(items.flatMap(item => item.events.map(event => event.id)))
  const visibleIds = new Set(eventIds)
  const events = items.flatMap(item => {
    const current = store[item.funding_call_id] || item
    return current.events.filter(event => (visibleIds.has(event.id) || !originalIds.has(event.id)) && localDateTime(event.event_at, zone).startsWith(month)).map(event => ({ ...event, personal_grant: current }))
  }).sort((a, b) => a.event_at.localeCompare(b.event_at))
  const groups = new Map<string, PersonalCalendarEvent[]>()
  for (const event of events) { const key = localDateTime(event.event_at, zone).slice(0, 10); groups.set(key, [...(groups.get(key) || []), event]) }
  const [year, m] = month.split('-').map(Number)
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate()
  const today = localDateTime(new Date(), zone).slice(0, 10)
  const shown = selected ? [[selected, groups.get(selected) || []] as const] : [...groups.entries()]
  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
    <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div key={day} className="p-3 text-center text-xs font-medium text-slate-500">{day}</div>)}</div>
      <div className="grid grid-cols-7">{Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => {
        const day = i - offset + 1
        if (day < 1 || day > days) return <div key={i} className="min-h-[108px] border-b border-r border-slate-100 bg-slate-50/60" />
        const key = `${month}-${String(day).padStart(2, '0')}`
        const entries = groups.get(key) || []
        return <button key={i} type="button" aria-pressed={selected === key} aria-label={`${key}, ${entries.length} calendar entries`} onClick={() => setSelected(selected === key ? null : key)} className={`min-h-[108px] min-w-0 border-b border-r border-slate-100 p-2 text-left align-top transition hover:bg-blue-50 ${selected === key ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : ''}`}><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${key === today ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>{day}</span>{entries.slice(0, 2).map(event => <span key={event.id} className="mt-1 block truncate rounded-md bg-blue-100/70 px-1.5 py-1 text-[11px] text-blue-800">{event.title}</span>)}{entries.length > 2 && <span className="mt-1 block text-[11px] text-slate-500">+{entries.length - 2} more</span>}</button>
      })}</div>
    </div>
    <section aria-label="Calendar agenda" className="min-w-0"><div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-base font-semibold text-slate-900">{selected ? new Date(`${selected}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'long', timeZone: 'UTC' }) : 'This month’s agenda'}</h2>{selected && <button type="button" className="text-sm text-blue-700" onClick={() => setSelected(null)}>Whole month</button>}</div>
      {shown.length === 0 || (selected && !shown[0][1].length) ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><CalendarDays className="mx-auto h-8 w-8 text-blue-300" /><p className="mt-3 text-sm font-medium text-slate-700">Room for your next opportunity</p><p className="mt-2 text-sm leading-6 text-slate-500">Open a grant and choose Plan & notes to add a milestone or email reminder.</p><Link href="/finder" className="funding-button-primary mt-4">Discover grants</Link></div> : <div className="space-y-5">{shown.map(([date, entries]) => <div key={date}><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</h3><ul className="space-y-3">{entries.map(event => <li key={event.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><div className="rounded-xl bg-blue-50 px-2.5 py-2 text-xs font-semibold text-blue-700">{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(new Date(event.event_at))}</div><div className="min-w-0"><h4 className="break-words text-sm font-semibold text-slate-900">{event.title}</h4><Link href={`/finder/calls/${event.personal_grant.funding_call_id}`} className="mt-1 block text-sm leading-5 text-slate-500 hover:text-blue-700">{titleOf(event.personal_grant)}</Link></div></div><p className={`mt-3 text-xs ${event.reminder_state === 'FAILED' ? 'text-rose-700' : 'text-slate-500'}`}>{({ NONE: 'No email reminder', PENDING: 'Email reminder scheduled', SENDING: 'Email is being sent', SENT: 'Email reminder sent', FAILED: 'Delivery needs attention · edit to reschedule' })[event.reminder_state]}</p><div className="mt-3"><PersonalGrantActions compact callId={event.personal_grant.funding_call_id} title={titleOf(event.personal_grant)} /></div></li>)}</ul></div>)}</div>}
    </section>
  </div>
}

export default function MyGrantsPage() {
  const { user, isLoading, authFetch } = useAuth()
  const searchParams = useSearchParams(); const params = searchParams || new URLSearchParams(); const router = useRouter(); const pathname = usePathname()
  const view: View = params.get('view') === 'calendar' ? 'calendar' : params.get('view') === 'library' ? 'library' : 'favourites'
  const rawPage = Number(params.get('page') || 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const query = params.get('q') || ''
  const [search, setSearch] = useState(query)
  const [zone, setZone] = useState('UTC')
  const [clientReady, setClientReady] = useState(false)
  useEffect(() => { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); setClientReady(true) }, [])
  useEffect(() => setSearch(query), [query])
  const monthParam = params.get('month')
  const month = monthParam && /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : localDateTime(new Date(), zone).slice(0, 7)
  const navigate = (changes: Record<string, string | null>) => { const next = new URLSearchParams(params.toString()); for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) } router.replace(`${pathname}?${next}`, { scroll: false }) }
  const scope = `${user?.tenant_id || ''}/${user?.user_id || ''}`
  const key = `${scope}:${view}:${month}:${zone}:${page}:${query}`
  const liveKey = useRef(key); liveKey.current = key
  const [data, setData] = useState<{ key: string; items: PersonalGrant[]; eventIds: string[]; total: number; pageSize: number } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const sequence = useRef(0)
  const load = useCallback(async () => {
    if (!user?.tenant_id || !clientReady) return
    const run = ++sequence.current; setLoading(true); setError('')
    try {
      let url: string
      if (view === 'calendar') { const bounds = monthBounds(month, zone); url = `/api/funding/personal-grants/calendar?${new URLSearchParams({ ...bounds, page: String(page) })}` }
      else url = `/api/funding/personal-grants?${new URLSearchParams({ view, q: query, page: String(page) })}`
      const response = await authFetch(url); const body = await response.json()
      if (!response.ok) throw new Error(body.message || body.error || 'Could not load your grants.')
      const items: PersonalGrant[] = view === 'calendar' ? [...new Map((body.events as PersonalCalendarEvent[]).map(event => [event.personal_grant.funding_call_id, event.personal_grant])).values()] : body.items
      if (run === sequence.current && liveKey.current === key) setData({ key, items, eventIds: view === 'calendar' ? body.events.map((event: PersonalCalendarEvent) => event.id) : [], total: body.total, pageSize: body.pageSize })
    } catch (e) { if (run === sequence.current && liveKey.current === key) { setError(e instanceof Error ? e.message : 'Could not load your grants.'); setData(null) } }
    finally { if (run === sequence.current && liveKey.current === key) setLoading(false) }
  }, [authFetch, clientReady, key, month, page, query, user?.tenant_id, view, zone])
  const invalidate = useCallback(() => { sequence.current++ }, [])
  useEffect(() => { void load(); return invalidate }, [load, invalidate])
  useEffect(() => { const focus = () => { if (!document.querySelector('[role="dialog"]')) void load() }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus) }, [load])
  const current = data?.key === key ? data : null
  const items = useMemo(() => current?.items || [], [current])
  const moveMonth = (offset: number) => { const [year, m] = month.split('-').map(Number); navigate({ month: new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7), page: null }) }
  if (isLoading) return <p className="p-8 text-sm text-slate-500">Loading your workspace…</p>
  if (!user) return <div className="p-8"><p className="mb-4 text-slate-600">Sign in to save grants, notes and reminders.</p><Link href="/login" className="funding-button-primary">Sign in</Link></div>
  if (!user.tenant_id) return <p className="p-8 text-sm text-slate-600">Use your personal tenant account to save grants and reminders.</p>
  return <main className="funding-workspace min-h-screen bg-slate-50/70 pb-16"><div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8 sm:py-8">
    <FundingWorkspaceHeader section="personal" title="Keep your next grant moving." description="Your favourite opportunities, personal notes and calendar reminders — together in one private workspace." actions={<FundingWorkspaceLink href="/finder">Discover grants</FundingWorkspaceLink>} />
    <div className="mt-6 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" />Your notes, favourites and calendar are visible only to you.</div>
    <div className="my-6 flex flex-wrap items-center justify-between gap-4"><nav aria-label="My grants views" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">{([['favourites', 'Favourites', Star], ['library', 'All saved grants', StickyNote], ['calendar', 'Grant calendar', CalendarDays]] as const).map(([value, label, Icon]) => <button key={value} type="button" aria-label={label} aria-current={view === value ? 'page' : undefined} onClick={() => navigate({ view: value, page: null, q: null })} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium ${view === value ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}><Icon className="h-4 w-4" /><span className="hidden sm:inline">{label}</span><span className="sm:hidden">{value === 'calendar' ? 'Calendar' : value === 'library' ? 'Saved grants' : label}</span></button>)}</nav>
      {view !== 'calendar' && <form onSubmit={e => { e.preventDefault(); navigate({ q: search.trim() || null, page: null }) }} className="flex w-full max-w-sm gap-2"><label className="relative flex-1"><span className="sr-only">Search saved grants</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your grants…" maxLength={200} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm" /></label><button type="submit" className="funding-button-secondary">Search</button></form>}
    </div>
    {view === 'calendar' && <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-2"><button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className="rounded-xl border border-slate-200 bg-white p-2.5"><ChevronLeft className="h-4 w-4" /></button><label className="sr-only" htmlFor="grant-calendar-month">Calendar month</label><input id="grant-calendar-month" type="month" min="2000-01" max="2100-12" value={month} onChange={e => { if (e.target.value) navigate({ month: e.target.value, page: null }) }} className="min-h-11 max-w-[190px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800" /><button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className="rounded-xl border border-slate-200 bg-white p-2.5"><ChevronRight className="h-4 w-4" /></button><button type="button" onClick={() => navigate({ month: localDateTime(new Date(), zone).slice(0, 7), page: null })} className="ml-1 text-sm text-blue-700">Today</button></div><label className="flex flex-wrap items-center gap-2 text-xs text-slate-500">Calendar time zone<select aria-label="Calendar time zone" value={zone} onChange={e => { if (validTimeZone(e.target.value)) { setZone(e.target.value); navigate({ page: null }) } }} className="min-h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700">{[...new Set([zone, 'Asia/Kolkata', 'Europe/London', 'Europe/Brussels', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'])].map(value => <option key={value}>{value}</option>)}</select></label></div>}
    <div className="mb-4 flex justify-end"><button type="button" disabled={loading} onClick={() => void load()} className="text-xs font-medium text-blue-700 disabled:opacity-50">Refresh saved grants</button></div>
    {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{error}<button type="button" onClick={() => void load()} className="ml-3 underline">Try again</button></div> : loading || !current ? <div role="status" className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map(i => <div key={i} className="h-56 animate-pulse rounded-2xl bg-slate-200/60" />)}<span className="sr-only">Loading your grants</span></div> : <PersonalGrantProvider callIds={items.map(item => item.funding_call_id)} initialItems={items}>
      {view === 'calendar' ? <CalendarContent items={items} eventIds={current.eventIds} month={month} zone={zone} /> : items.length ? <SavedGrantGrid items={items} total={current.total} view={view} /> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><Star className="mx-auto h-10 w-10 text-amber-300" /><h2 className="mt-4 text-xl font-semibold text-slate-900">{query ? 'No saved grants match your search' : view === 'favourites' ? 'Your next opportunity starts here' : 'Make space for your next idea'}</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">{query ? 'Try a different grant title or clear the search.' : 'Star a grant in Discovery, add a personal note, or plan a calendar reminder. It will be waiting here when you return.'}</p><Link href="/finder" className="funding-button-primary mt-6">Discover grants</Link></div>}
    </PersonalGrantProvider>}
    {current && current.total > current.pageSize && <nav aria-label="Saved grants pages" className="mt-6 flex items-center justify-between gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => navigate({ page: String(page - 1) })} className="funding-button-secondary">Previous</button><span className="text-xs text-slate-500">Page {page} of {Math.ceil(current.total / current.pageSize)}{view === 'calendar' ? ' · calendar entries' : ''}</span><button type="button" disabled={page * current.pageSize >= current.total || loading} onClick={() => navigate({ page: String(page + 1) })} className="funding-button-secondary">Next</button></nav>}
  </div></main>
}
