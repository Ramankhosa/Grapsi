'use client'

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Bookmark, Compass, Search, SlidersHorizontal, Users, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import FacultyProfileDrawer from '@/components/faculty/FacultyProfileDrawer'
import { DISCOVERY_TASKS, EMPTY_DISCOVERY_QUERY, discoverySearchLink, readDiscoveryQuery,
  type DiscoveryArea, type DiscoveryCall, type DiscoveryPerson, type DiscoveryQuery, type DiscoveryResults, type DiscoveryTask } from '@/lib/discovery/types'

interface PeopleAccess { canSearchPeople: boolean; scopeLabel: string; units: Array<{ id: string; name: string; kind: string }> }
interface SavedSearch { name: string; state: DiscoveryQuery }
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20'
const secondaryClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50'
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50'

export default function ResearchDiscovery() {
  const { user, isLoading, authFetch } = useAuth()
  const [state, setState] = useState<DiscoveryQuery>({ ...EMPTY_DISCOVERY_QUERY })
  const [areas, setAreas] = useState<DiscoveryArea[]>([])
  const [areaQuery, setAreaQuery] = useState('')
  const [areaError, setAreaError] = useState('')
  const [access, setAccess] = useState<PeopleAccess | null>(null)
  const [accessError, setAccessError] = useState('')
  const [results, setResults] = useState<DiscoveryResults | null>(null)
  const [callOptions, setCallOptions] = useState<DiscoveryCall[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<SavedSearch[]>([])
  const [person, setPerson] = useState<DiscoveryPerson | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const optionsRequest = useRef<AbortController | null>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const userId = user?.user_id
  const storageKey = `grapsi:discovery:${userId || ''}`

  const loadOptions = useCallback(async () => {
    optionsRequest.current?.abort()
    const controller = new AbortController()
    optionsRequest.current = controller
    const [areaResult, peopleResult] = await Promise.allSettled([
      authFetch('/api/discovery/calls', { signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Could not load areas.'); return data }),
      authFetch('/api/discovery/people', { signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Could not check people access.'); return data }),
    ])
    if (controller.signal.aborted) return
    if (areaResult.status === 'fulfilled') { setAreas(areaResult.value.areas); setAreaError('') }
    else setAreaError(areaResult.reason.message)
    if (peopleResult.status === 'fulfilled') { setAccess(peopleResult.value); setAccessError('') }
    else setAccessError(peopleResult.reason.message)
  }, [authFetch])

  useEffect(() => {
    if (!userId) return
    activeRequest.current?.abort(); setResults(null); setCallOptions([]); setPerson(null); setAccess(null); setAreas([]); setBusy(false)
    setState(readDiscoveryQuery(new URLSearchParams(window.location.search)))
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]')
      setSaved(Array.isArray(value) ? value.filter(v => typeof v?.name === 'string' && v?.state && typeof v.state === 'object').slice(0, 8)
        .map(v => ({ name: v.name.slice(0, 80), state: readDiscoveryQuery(new URL(discoverySearchLink({ ...EMPTY_DISCOVERY_QUERY, ...v.state }), window.location.origin).searchParams) })) : [])
    } catch { setSaved([]) }
    void loadOptions()
    return () => { activeRequest.current?.abort(); optionsRequest.current?.abort() }
  }, [userId, storageKey, loadOptions])

  useEffect(() => {
    const restore = () => { activeRequest.current?.abort(); setBusy(false); setResults(null); setCallOptions([]); setState(readDiscoveryQuery(new URLSearchParams(window.location.search))) }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  function change(patch: Partial<DiscoveryQuery>) {
    activeRequest.current?.abort()
    setBusy(false); setResults(null); setCallOptions([]); setError(''); setNotice('')
    setState(previous => ({ ...previous, ...patch }))
  }
  function switchTask(task: DiscoveryTask) { change({ task, query: '', callId: '', callTitle: '' }) }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % DISCOVERY_TASKS.length
    else if (event.key === 'ArrowLeft') next = (index + DISCOVERY_TASKS.length - 1) % DISCOVERY_TASKS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = DISCOVERY_TASKS.length - 1
    else return
    event.preventDefault()
    document.getElementById(`discovery-tab-${DISCOVERY_TASKS[next].id}`)?.focus()
    switchTask(DISCOVERY_TASKS[next].id)
  }
  function toggleArea(id: string) {
    change({ areaIds: state.areaIds.includes(id) ? state.areaIds.filter(a => a !== id) : [...state.areaIds, id].slice(0, 20) })
  }

  async function search(page = 1) {
    const controller = new AbortController()
    activeRequest.current?.abort(); activeRequest.current = controller
    setBusy(true); setError(''); setNotice(''); setResults(null); setCallOptions([])
    try {
      const isCallPicker = state.task === 'alignment' && !state.callId
      const callSearch = state.task === 'calls' || isCallPicker
      const endpoint = callSearch ? '/api/discovery/calls' : '/api/discovery/people'
      const body = callSearch ? { mode: isCallPicker ? 'standard' : state.mode, query: state.query,
        areaIds: isCallPicker ? [] : state.areaIds, page, includeClosed: state.includeClosed, sort: state.sort }
        : { kind: state.task === 'person' ? 'person' : state.task === 'alignment' ? 'call' : state.mode,
          query: state.query, areaIds: state.task === 'people' && state.mode === 'standard' ? state.areaIds : [], unitId: state.unitId || undefined,
          callId: state.task === 'alignment' ? state.callId : undefined, page }
      const response = await authFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
      const payload = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(payload.error || 'Search could not be completed. Please retry.')
      window.history.pushState({}, '', discoverySearchLink(state))
      if (isCallPicker) { setCallOptions(payload.calls || []); setNotice(payload.total ? 'Choose the call you want to match.' : 'No calls found. Try a shorter title or the funder’s name.'); }
      else { setResults(payload); requestAnimationFrame(() => resultHeading.current?.focus()) }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Search could not be completed.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  function saveSearch() {
    const name = window.prompt('Name this search', DISCOVERY_TASKS.find(t => t.id === state.task)?.title)
    if (!name?.trim()) return
    const next = [{ name: name.trim().slice(0, 80), state }, ...saved.filter(s => discoverySearchLink(s.state) !== discoverySearchLink(state))].slice(0, 8)
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setNotice('Search saved on this browser. Access is checked again whenever you run it.') }
    catch { setNotice('This browser could not save the search. You can copy its link instead.') }
  }
  async function copySearch() {
    try { await navigator.clipboard.writeText(`${window.location.origin}${discoverySearchLink(state)}`); setNotice('Search link copied. Anyone opening it still needs permission to see the results.') }
    catch { setNotice('The browser could not copy the link. Run the search, then copy the address bar.') }
  }
  function personToCalls(p: DiscoveryPerson) {
    setPerson(null)
    change({ task: 'calls', mode: p.standardAreas.length ? 'standard' : 'semantic', areaIds: p.standardAreas.map(a => a.id).slice(0, 20),
      query: p.standardAreas.length ? '' : [...p.areas, ...p.savedAreas.map(a => a.label)].join('; ').slice(0, 300), callId: '', callTitle: '' })
    document.getElementById('discovery-search')?.focus()
  }
  const peopleTask = state.task !== 'calls'
  const restricted = peopleTask && !access?.canSearchPeople
  const areaInput = (state.task === 'calls' || state.task === 'people') && state.mode === 'standard'
  const task = DISCOVERY_TASKS.find(t => t.id === state.task)!
  const filteredAreas = areas.filter(a => a.label.toLowerCase().includes(areaQuery.trim().toLowerCase()))
  const selectedCall = Boolean(state.task === 'alignment' && state.callId)
  const semantic = results?.basis === 'semantic'

  if (isLoading) return <main className="mx-auto max-w-7xl p-8" role="status">Loading Research Discovery…</main>
  if (!user) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Research Discovery</h1><p className="mt-4">Sign in to discover funding calls and research expertise.</p><Link className={`${primaryClass} mt-4`} href="/login">Sign in</Link></main>

  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-teal-800"><Compass className="h-4 w-4" aria-hidden />Research connections</div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Research Discovery</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Connect research areas, funding opportunities and people. Start with a field, a person or a call.</p></div>
      <Link href="/dashboard" className={secondaryClass}>Back to dashboard</Link>
    </header>

    <div role="tablist" aria-label="What would you like to discover?" className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {DISCOVERY_TASKS.map((t, index) => <button key={t.id} type="button" role="tab" id={`discovery-tab-${t.id}`} aria-controls={`discovery-panel-${t.id}`}
        aria-selected={state.task === t.id} tabIndex={state.task === t.id ? 0 : -1} onKeyDown={e => tabKey(e, index)} onClick={() => switchTask(t.id)}
        className={`rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${state.task === t.id ? 'border-teal-800 bg-teal-900 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-900 hover:border-teal-500'}`}>
        <span className="text-sm font-semibold">{t.title}</span><span className={`mt-1 hidden text-xs leading-5 sm:block ${state.task === t.id ? 'text-teal-100' : 'text-slate-500'}`}>{t.description}</span>
      </button>)}
    </div>

    <section role="tabpanel" id={`discovery-panel-${state.task}`} aria-labelledby={`discovery-tab-${state.task}`} className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-teal-800" aria-hidden /><h2 className="font-semibold text-slate-900">Search focus</h2></div>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void search() }} className="mt-4 space-y-5">
          {(state.task === 'calls' || state.task === 'people') && <fieldset><legend className="mb-2 text-sm font-medium text-slate-800">How do you want to search?</legend>
            <div className="flex gap-4 text-sm">{(['standard', 'semantic'] as const).map(mode => <label key={mode} className="flex items-center gap-2"><input type="radio" name="area-mode" checked={state.mode === mode} onChange={() => change({ mode, query: '' })} />{mode === 'standard' ? 'Standard areas' : 'Own words'}</label>)}</div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{state.mode === 'standard' ? `${areas.length || 'Standard'} research areas. Match any selection; no school-wide assumptions.` : 'Describe your research question. Search looks for related meaning in the available research indexes.'}</p>
          </fieldset>}

          {areaInput && <fieldset disabled={restricted}><legend className="mb-2 text-sm font-medium text-slate-800">Research areas</legend>
            {areaError ? <div role="alert" className="text-sm text-red-700">{areaError}<button type="button" onClick={() => void loadOptions()} className="ml-2 underline">Retry</button></div> : <>
              <div className="mb-2 flex flex-wrap gap-1.5">{state.areaIds.map(id => <button type="button" key={id} onClick={() => toggleArea(id)} className="inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2 py-1 text-xs text-teal-900" aria-label={`Remove ${areas.find(a => a.id === id)?.label || 'area'}`}>{areas.find(a => a.id === id)?.label || 'Selected area'}<X className="h-3 w-3" aria-hidden /></button>)}</div>
              <input className={inputClass} aria-label="Filter standard research areas" placeholder="Type to find an area…" value={areaQuery} onChange={e => setAreaQuery(e.target.value)} />
              <div className="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-2">{filteredAreas.slice(0, 80).map(a => <label key={a.id} className="flex items-start gap-2 rounded-lg p-1.5 text-xs leading-5 text-slate-700 hover:bg-slate-50"><input type="checkbox" className="mt-1 accent-teal-800" checked={state.areaIds.includes(a.id)} disabled={!state.areaIds.includes(a.id) && state.areaIds.length >= 20} onChange={() => toggleArea(a.id)} /><span>{a.label}</span></label>)}
                {!filteredAreas.length && <p className="text-xs text-slate-500">No area with that name. Try your own words instead.</p>}</div>
              <div className="mt-2 flex justify-between gap-2 text-xs text-slate-500"><span>{state.areaIds.length}/20 selected{filteredAreas.length > 80 ? ' · type to narrow the list' : ''}</span><button type="button" className="text-teal-800 underline" onClick={() => change({ areaIds: [] })}>Clear</button></div>
            </>}
          </fieldset>}

          {selectedCall ? <div className="rounded-xl bg-teal-50 p-3 text-sm"><p className="text-xs font-medium uppercase text-teal-800">Selected call</p><p className="mt-1 font-medium text-slate-900">{state.callTitle || 'Selected funding call'}</p><button type="button" className="mt-2 text-xs text-teal-800 underline" onClick={() => change({ callId: '', callTitle: '', query: '' })}>Change call</button></div>
            : state.task === 'people' && state.mode === 'standard' ? null : <label className="block text-sm font-medium text-slate-800" htmlFor="discovery-search">{state.task === 'person' ? 'Name, email or employee ID' : state.task === 'alignment' ? 'Call title or funder' : state.mode === 'semantic' ? 'Describe the research' : 'Search within calls (optional)'}
              {(state.task !== 'people' || state.mode === 'semantic') && <textarea id="discovery-search" rows={state.mode === 'semantic' ? 4 : 2} maxLength={300} className={`${inputClass} mt-2 resize-y font-normal`} value={state.query} disabled={restricted}
                placeholder={state.task === 'person' ? 'e.g. a colleague’s name' : state.task === 'alignment' ? 'e.g. cancer research or Wellcome' : state.mode === 'semantic' ? 'e.g. low-cost biosensors for early cancer detection' : 'Title, topic or funder'} onChange={e => change({ query: e.target.value })} />}
            </label>}

          {peopleTask && access?.canSearchPeople && <label className="block text-sm font-medium text-slate-800">School or department<select className={`${inputClass} mt-2 font-normal`} value={state.unitId} onChange={e => change({ unitId: e.target.value })}><option value="">All within your access</option>{access.units.map(u => <option key={u.id} value={u.id}>{u.kind === 'DEPARTMENT' ? '↳ ' : ''}{u.name}</option>)}</select><span className="mt-2 block text-xs font-normal text-slate-500">{access.scopeLabel}. Schools include their departments.</span></label>}
          {state.task === 'calls' && <div className="space-y-3"><label className="block text-sm font-medium text-slate-800">Sort calls<select className={`${inputClass} mt-2 font-normal`} value={state.sort} onChange={e => change({ sort: e.target.value as DiscoveryQuery['sort'] })}><option value="best_match">Best match</option><option value="deadline_soonest">Deadline soonest</option></select></label><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={state.includeClosed} onChange={e => change({ includeClosed: e.target.checked })} />Include closed and upcoming calls</label></div>}
          {restricted && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{accessError || (access ? 'People discovery requires administrator, school manager or funding department access. You can still search funding calls.' : 'Checking your people-search access…')}</p>}
          <button type="submit" className={`${primaryClass} w-full`} disabled={busy || restricted || (state.task === 'people' && state.mode === 'standard' && !state.areaIds.length)}><Search className="h-4 w-4" aria-hidden />{busy ? 'Searching…' : state.task === 'alignment' ? selectedCall ? 'Find aligned people' : 'Find a call' : state.task === 'person' ? 'Find person' : state.task === 'people' ? 'Find people' : 'Find calls'}</button>
          <button type="button" className="w-full text-xs text-slate-500 underline" onClick={() => { change({ ...EMPTY_DISCOVERY_QUERY, task: state.task }); setAreaQuery('') }}>Reset this search</button>
        </form>
        <div className="mt-5 border-t border-slate-100 pt-4"><div className="flex flex-wrap gap-2"><button type="button" className={secondaryClass} onClick={saveSearch}><Bookmark className="h-3.5 w-3.5" aria-hidden />Save search</button><button type="button" className={secondaryClass} onClick={() => void copySearch()}>Copy link</button></div>
          {!!saved.length && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-slate-700">Saved on this browser ({saved.length})</summary><ul className="mt-2 space-y-2">{saved.map((s, i) => <li key={`${s.name}-${i}`} className="flex gap-2"><button className="flex-1 text-left text-teal-800 underline" onClick={() => change(s.state)}>{s.name}</button><button aria-label={`Delete saved search ${s.name}`} onClick={() => { const next = saved.filter((_, j) => j !== i); try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next) } catch { setNotice('Could not remove this saved search.') } }}><X className="h-3.5 w-3.5" aria-hidden /></button></li>)}</ul></details>}
        </div>
      </aside>

      <div className="min-w-0 space-y-4" aria-busy={busy}>
        {notice && <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{notice}</p>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" className="ml-2 underline" onClick={() => void search()}>Retry</button></div>}
        {busy && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600">Searching {state.task === 'calls' || (state.task === 'alignment' && !state.callId) ? 'funding calls' : 'researchers'}…</div>}
        {!!callOptions.length && <section><h2 className="mb-3 text-lg font-semibold">Select a funding call</h2><p className="mb-3 text-xs text-slate-500">Showing the first 12 calls. Narrow the title or funder to find a specific call.</p>{callOptions.map(c => <button type="button" key={c.id} className="mb-3 flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-teal-600" onClick={() => change({ callId: c.id, callTitle: c.schemeTitle, query: '' })}><span><span className="block font-medium text-slate-900">{c.schemeTitle}</span><span className="mt-1 block text-xs text-slate-500">{c.agencyName}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-teal-800" aria-hidden /></button>)}</section>}
        {results && <>
          <div className="flex flex-wrap items-end justify-between gap-2"><h2 ref={resultHeading} tabIndex={-1} className="text-xl font-semibold text-slate-950 outline-none">{results.total} {semantic ? `research suggestion${results.total === 1 ? '' : 's'}` : state.task === 'calls' ? `funding call${results.total === 1 ? '' : 's'}` : `${results.total === 1 ? 'person' : 'people'} found`}</h2><span className="text-xs text-slate-500">{semantic ? 'Top results · up to 50 · not an exhaustive count' : `Page ${results.page} of ${results.totalPages}`}</span></div>
          {results.warning && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{results.warning}</p>}
          {results.callRequiresRelease && <p className="rounded-xl bg-slate-100 p-3 text-xs leading-5 text-slate-700">This imported call is available for discovery. An administrator must release it to the funding department before it can be allocated.</p>}
          {results.total === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8"><h3 className="font-semibold text-slate-900">No results for this search</h3><p className="mt-2 text-sm leading-6 text-slate-600">{state.task === 'person' ? 'Try part of the name or an employee ID. Only active people within your access are searched.' : state.task === 'people' && state.mode === 'standard' ? 'This area may not yet be linked to faculty profiles. Try searching in your own words, or choose another area.' : 'Try fewer areas, a broader research description or a different school filter. A lack of results does not prove that no relevant expertise exists.'}</p></div>}
          {results.calls?.map(c => <article key={c.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-teal-800">{c.agencyName || 'Funding opportunity'}</p><span className="text-xs text-slate-500">{c.isRolling ? 'Rolling applications' : c.closeDate ? `Deadline ${new Date(c.closeDate).toLocaleDateString()}` : 'Deadline not stated'}</span></div><h3 className="mt-2 text-lg font-semibold leading-6 text-slate-900"><Link className="hover:underline" href={`/finder/calls/${encodeURIComponent(c.id)}`}>{c.schemeTitle}</Link></h3><p className="mt-3 text-sm leading-6 text-slate-600">{c.shortDescription}</p><p className="mt-3 text-xs text-slate-500">{c.matchReasons?.length ? c.matchReasons.join(' · ') : state.mode === 'standard' ? 'Matches the selected directory filters.' : 'Related to your research description.'}</p><div className="mt-4 flex flex-wrap gap-2"><Link className={secondaryClass} href={`/finder/calls/${encodeURIComponent(c.id)}`}>View call</Link>{access?.canSearchPeople && <button className={primaryClass} onClick={() => change({ task: 'alignment', callId: c.id, callTitle: c.schemeTitle, query: '' })}><Users className="h-4 w-4" aria-hidden />Find aligned people</button>}</div></article>)}
          {results.people?.map(p => <article key={p.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-lg font-semibold text-slate-950">{p.name}</h3><p className="mt-1 text-xs text-slate-500">{[p.designation, p.school, p.department].filter(Boolean).join(' · ') || 'Organisation placement not recorded'}</p></div><button className={secondaryClass} onClick={() => setPerson(p)}>View profile</button></div><p className="mt-3 text-sm leading-6 text-slate-600">{p.summary || 'Research summary not yet recorded.'}</p>
            <div className="mt-4 space-y-3"><AreaTags label="Standard area links" labels={p.standardAreas.map(a => a.label)} /><AreaTags label="Profile areas" labels={p.areas} /><AreaTags label="Saved research interests" labels={p.savedAreas.map(a => a.label)} /></div>
            {!p.areas.length && !p.standardAreas.length && !p.savedAreas.length && <p className="mt-3 text-xs text-slate-500">No research areas recorded in this result. Open the profile to inspect available publications.</p>}
            {p.matchReason && <p className="mt-4 rounded-lg bg-teal-50 p-2.5 text-xs leading-5 text-teal-900"><strong>Why shown:</strong> {p.matchReason}</p>}
            {!!p.eligibilityFlags?.length && <p className="mt-2 text-xs text-amber-900">Eligibility to check: {p.eligibilityFlags.join(' · ')}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{(p.areas.length > 0 || p.standardAreas.length > 0 || p.savedAreas.length > 0) && <button className={secondaryClass} onClick={() => personToCalls(p)}>Find calls in these areas <ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>}{state.task === 'alignment' && !results.callRequiresRelease && <Link className={secondaryClass} href={`/researcher-matching?callId=${encodeURIComponent(state.callId)}${state.unitId ? `&school=${encodeURIComponent(state.unitId)}` : ''}`}>Open matching workspace</Link>}</div>
          </article>)}
          {results.totalPages > 1 && <nav aria-label="Search result pages" className="flex items-center justify-between rounded-xl bg-white p-3"><button className={secondaryClass} disabled={results.page <= 1 || busy} onClick={() => void search(results.page - 1)}>Previous</button><span className="text-sm text-slate-600">{results.page} / {results.totalPages}</span><button className={secondaryClass} disabled={results.page >= results.totalPages || busy} onClick={() => void search(results.page + 1)}>Next</button></nav>}
        </>}
        {!results && !busy && !error && !callOptions.length && <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-teal-50/60 p-8 sm:p-10"><Compass className="mb-5 h-9 w-9 text-teal-800" aria-hidden /><h2 className="text-2xl font-semibold text-slate-950">{task.title}</h2><p className="mt-3 max-w-lg text-sm leading-7 text-slate-600">{state.task === 'calls' ? 'Choose a standard research area for a precise directory search, or describe an idea to explore related funding.' : state.task === 'people' ? 'Search individual expertise across your permitted schools. Use standard area links for precision, or your own words to explore profiles and publication evidence.' : state.task === 'person' ? 'Search by identity, then see what is actually recorded: profile areas, saved research interests and standard links. People with incomplete profiles can still appear.' : 'Find a funding call by title or funder, select it, then search for aligned researchers. Discovery does not assign the call or notify anyone.'}</p><div className="mt-6 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2"><div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Understand the evidence</h3><p className="mt-2 text-xs leading-6 text-slate-500">Standard links, declared interests and semantic suggestions are labelled separately. Research fit does not confirm eligibility.</p></div><div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Keep the search useful</h3><p className="mt-2 text-xs leading-6 text-slate-500">Start broad, narrow by area or school, and save a useful search. Results always follow your current access.</p></div></div></section>}
      </div>
    </section>
    {person && <FacultyProfileDrawer userId={person.id} fallbackName={person.name} fallbackHint={person.department} onClose={() => setPerson(null)} />}
  </main>
}

function AreaTags({ label, labels }: { label: string; labels: string[] }) {
  if (!labels.length) return null
  return <div><h4 className="mb-1.5 text-xs font-medium text-slate-600">{label}</h4><div className="flex flex-wrap gap-1.5">{labels.slice(0, 8).map((text, i) => <span key={`${text}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">{text}</span>)}</div>{labels.length > 8 && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">{labels.length - 8} more areas</summary><p className="mt-1 leading-6">{labels.slice(8).join(' · ')}</p></details>}</div>
}
