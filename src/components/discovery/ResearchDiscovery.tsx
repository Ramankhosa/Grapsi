'use client'

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { Bookmark, Building2, Compass, Copy, Search, Users, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import FacultyProfileDrawer from '@/components/faculty/FacultyProfileDrawer'
import CallDetailPanel from '@/components/funding/CallDetailPanel'
import DiscoveryCalls from './DiscoveryCalls'
import DiscoveryPeople, { type PeopleAccess } from './DiscoveryPeople'
import OrganisationBrowser from './OrganisationBrowser'
import type { DiscoveryOrg } from '@/lib/discovery/org'
import { DIRECTORY_DEFAULT_FILTERS, encodeDirectoryFilters } from '@/lib/recommendations/directoryUrl'
import { DISCOVERY_TABS, EMPTY_DISCOVERY_QUERY, discoverySearchLink, legacySavedSearchLink, readDiscoveryQuery,
  type DiscoveryArea, type DiscoveryPerson, type DiscoveryQuery, type DiscoveryTab } from '@/lib/discovery/types'

interface SavedSearch { name: string; link: string }
const icons = { calls: Search, people: Users, org: Building2 }

export default function ResearchDiscovery() {
  const { user, isLoading, authFetch } = useAuth()
  const [state, setState] = useState<DiscoveryQuery>({ ...EMPTY_DISCOVERY_QUERY })
  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [areas, setAreas] = useState<DiscoveryArea[]>([])
  const [access, setAccess] = useState<PeopleAccess | null>(null)
  const [org, setOrg] = useState<DiscoveryOrg | null>(null)
  const [optionErrors, setOptionErrors] = useState<string[]>([])
  const [retry, setRetry] = useState(0)
  const [saved, setSaved] = useState<SavedSearch[]>([])
  const [notice, setNotice] = useState('')
  const [person, setPerson] = useState<{ id: string; name: string; department?: string | null } | null>(null)
  const [call, setCall] = useState<{ id: string; title: string } | null>(null)
  const userId = user?.user_id
  const storageKey = `grapsi:discovery:${userId || ''}`

  const restore = useCallback((link: string) => {
    setState(readDiscoveryQuery(new URL(link, window.location.origin).searchParams))
    setRevision(value => value + 1)
    setNotice(''); setPerson(null); setCall(null)
  }, [])

  useEffect(() => {
    if (!userId) { setReady(false); return }
    restore(window.location.href)
    setReady(true)
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
      const searches: SavedSearch[] = []
      if (Array.isArray(value)) for (const entry of value.slice(0, 8)) {
        if (typeof entry?.name !== 'string') continue
        const link = typeof entry.link === 'string' && entry.link.startsWith('/discovery?') ? entry.link
          : entry.state && typeof entry.state === 'object' ? legacySavedSearchLink(entry.state)
            || discoverySearchLink(readDiscoveryQuery(new URL(discoverySearchLink({ ...EMPTY_DISCOVERY_QUERY, ...entry.state }), window.location.origin).searchParams)) : null
        if (link) searches.push({ name: entry.name.slice(0, 80), link: discoverySearchLink(readDiscoveryQuery(new URL(link, window.location.origin).searchParams)) })
      }
      setSaved(searches)
    } catch { setSaved([]) }
    const onPop = () => restore(window.location.href)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [userId, storageKey, restore])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    setAccess(null); setOrg(null); setAreas([]); setOptionErrors([])
    const paths = ['/api/discovery/calls', '/api/discovery/people', '/api/discovery/org']
    void Promise.allSettled(paths.map(async path => {
      const response = await authFetch(path, { signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Discovery options could not be loaded.')
      return data
    })).then(([areaResult, accessResult, orgResult]) => {
      if (controller.signal.aborted) return
      if (areaResult.status === 'fulfilled') setAreas(areaResult.value.areas)
      if (accessResult.status === 'fulfilled') setAccess(accessResult.value)
      if (orgResult.status === 'fulfilled') setOrg(orgResult.value)
      setOptionErrors([areaResult, accessResult, orgResult].flatMap(result => result.status === 'rejected' ? [String(result.reason.message)] : []))
    })
    return () => controller.abort()
  }, [authFetch, userId, retry])

  function change(patch: Partial<DiscoveryQuery>) {
    setNotice('')
    setState(previous => ({ ...previous, ...patch }))
  }
  function navigate(patch: Partial<DiscoveryQuery>) {
    const next = { ...state, ...patch }
    change(patch)
    window.history.pushState({}, '', discoverySearchLink(next))
  }
  function switchTab(tab: DiscoveryTab) { navigate({ tab, ...(tab === 'org' ? { query: '', designation: '', careerStage: '', includeSubunits: true } : {}) }) }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3
      : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1
    if (next < 0) return
    event.preventDefault()
    switchTab(DISCOVERY_TABS[next].id)
    document.getElementById(`discovery-tab-${DISCOVERY_TABS[next].id}`)?.focus()
  }
  function findPeople(selected: { id: string; title: string }) {
    setCall(null)
    navigate({ tab: 'people', peopleMode: 'call', callId: selected.id, callTitle: selected.title, query: '' })
  }
  function areaCalls(selected: DiscoveryArea[], filter: 'importedAreaIds' | 'taxonomyAreaIds' = 'importedAreaIds') {
    setPerson(null)
    navigate({ tab: 'calls', callMode: 'directory', callQuery: '', callPage: 1,
      callFilters: encodeDirectoryFilters({ ...DIRECTORY_DEFAULT_FILTERS, [filter]: selected.map(a => a.id).slice(0, 50) }) })
    setRevision(value => value + 1)
  }
  function personCalls(p: DiscoveryPerson) {
    if (p.standardAreas.length) areaCalls(p.standardAreas)
    else {
      setPerson(null)
      navigate({ tab: 'calls', callMode: 'semantic', callQuery: [...p.areas, ...p.savedAreas.map(a => a.label)].join('; ').slice(0, 300), callFilters: null, callPage: 1 })
      setRevision(value => value + 1)
    }
  }
  function saveSearch() {
    const name = window.prompt('Name this search', DISCOVERY_TABS.find(t => t.id === state.tab)?.title)
    if (!name?.trim()) return
    const link = discoverySearchLink(state)
    const next = [{ name: name.trim().slice(0, 80), link }, ...saved.filter(s => s.link !== link)].slice(0, 8)
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setNotice('Search saved on this browser.') }
    catch { setNotice('This browser could not save the search. Copy its link instead.') }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}${discoverySearchLink(state)}`); setNotice('Search link copied. Results follow the reader’s organisation and access.') }
    catch { window.history.replaceState({}, '', discoverySearchLink(state)); setNotice('Copy the search link from your address bar.') }
  }

  if (isLoading || (user && !ready)) return <main className="p-8" role="status">Loading Research Discovery…</main>
  if (!user) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Research Discovery</h1><p className="my-4">Sign in to discover funding and colleagues.</p><Link className="cb-btn-primary" href="/login">Sign in</Link></main>

  return <main className="cb-page min-h-screen bg-slate-50/60 text-slate-900">
    <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="cb-eyebrow flex items-center gap-2"><Compass className="h-4 w-4" aria-hidden />Research connections</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Research Discovery</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Explore funding, find colleagues and see the research across your organisation.</p></div>
        <Link href="/dashboard" className="cb-btn-secondary">Back to dashboard</Link>
      </header>
      <div className="mb-6 mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div role="tablist" aria-label="Discover" className="flex gap-1">
          {DISCOVERY_TABS.map((tab, index) => { const Icon = icons[tab.id]; return <button key={tab.id} type="button" role="tab" id={`discovery-tab-${tab.id}`}
            aria-controls={`discovery-panel-${tab.id}`} aria-selected={state.tab === tab.id} tabIndex={state.tab === tab.id ? 0 : -1}
            onKeyDown={event => tabKey(event, index)} onClick={() => switchTab(tab.id)} className={`cb-tab !min-h-10 ${state.tab === tab.id ? 'cb-tab-active' : ''}`}>
            <Icon className="hidden h-4 w-4 sm:block" aria-hidden />{tab.title}</button> })}
        </div>
        <div className="flex gap-1"><button type="button" className="cb-btn-ghost cb-btn-sm" onClick={saveSearch}><Bookmark className="h-4 w-4" aria-hidden />Save search</button>
          <button type="button" className="cb-btn-ghost cb-btn-sm" onClick={() => void copyLink()}><Copy className="h-4 w-4" aria-hidden />Copy link</button></div>
      </div>
      {!!saved.length && <details className="mb-4 text-sm"><summary className="cursor-pointer text-slate-600">Saved on this browser ({saved.length})</summary>
        <ul className="mt-2 flex flex-wrap gap-2">{saved.map((search, index) => <li key={`${search.name}-${index}`} className="cb-chip">
          <button type="button" className="min-h-10" onClick={() => { restore(search.link); window.history.pushState({}, '', search.link) }}>{search.name}</button>
          <button type="button" className="p-2" aria-label={`Delete saved search ${search.name}`} onClick={() => {
            const next = saved.filter((_, i) => i !== index)
            try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next) } catch { setNotice('Could not remove this saved search.') }
          }}><X className="h-3.5 w-3.5" aria-hidden /></button></li>)}</ul></details>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
      {!!optionErrors.length && <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{optionErrors.join(' ')} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>Retry options</button></div>}
      <section role="tabpanel" id={`discovery-panel-${state.tab}`} aria-labelledby={`discovery-tab-${state.tab}`}>
        {state.tab === 'calls' ? <DiscoveryCalls key={`calls-${state.callMode}-${revision}-${userId}`} state={state} onChange={change}
          onOpenCall={setCall} onFindPeople={access?.canSearchPeople ? findPeople : undefined} />
          : state.tab === 'people' ? <DiscoveryPeople key={`people-${revision}-${userId}`} state={state} onChange={change} areas={areas} access={access} org={org}
            onOpenPerson={setPerson} onPersonCalls={personCalls} onOpenCall={setCall} />
            : org ? <OrganisationBrowser org={org} state={state} onChange={navigate} areas={areas} access={access}
              onOpenPerson={setPerson} onPersonCalls={personCalls} onAreaCalls={areaCalls} />
              : <p role="status" className="cb-card p-8">{optionErrors.length ? 'Organisation is unavailable. Retry loading above.' : 'Loading your organisation…'}</p>}
      </section>
    </div>
    {person && <FacultyProfileDrawer userId={person.id} fallbackName={person.name} fallbackHint={person.department}
      profileUrl={`/api/discovery/people/${encodeURIComponent(person.id)}`} tone="cobalt" onClose={() => setPerson(null)} />}
    {call && <CallDetailPanel callId={call.id} fallbackTitle={call.title} onClose={() => setCall(null)} onFindPeople={access?.canSearchPeople ? findPeople : undefined} />}
  </main>
}
