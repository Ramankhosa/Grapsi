'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Search, UserRound, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import type { DiscoveryOrg, DiscoveryOrgUnit } from '@/lib/discovery/org'
import { PEOPLE_MODES, UNPLACED_UNIT, discoverySearchLink, type DiscoveryArea, type DiscoveryCall,
  type DiscoveryPerson, type DiscoveryQuery, type DiscoveryResults } from '@/lib/discovery/types'

export interface PeopleAccess {
  canSearchPeople: boolean; scopeLabel: string
  capabilities: { canAssign: boolean; canOpenMatching: boolean; canSeeEmployeeIds: boolean }
  designations: Array<{ value: string; count: number }>; careerStages: Array<{ value: string; count: number }>
}
export function flattenUnits(units: DiscoveryOrgUnit[]): DiscoveryOrgUnit[] {
  return units.flatMap(unit => [unit, ...flattenUnits(unit.children)])
}
export interface PeopleProps {
  state: DiscoveryQuery; onChange: (patch: Partial<DiscoveryQuery>) => void
  areas: DiscoveryArea[]; access: PeopleAccess | null; org: DiscoveryOrg | null
  onOpenPerson: (person: { id: string; name: string; department?: string | null }) => void
  onPersonCalls: (person: DiscoveryPerson) => void
  onOpenCall?: (call: { id: string; title: string }) => void
  browseUnit?: string
}

export default function DiscoveryPeople({ state, onChange, areas, access, org, onOpenPerson, onPersonCalls, onOpenCall, browseUnit }: PeopleProps) {
  const { authFetch } = useAuth()
  const [results, setResults] = useState<DiscoveryResults | null>(null)
  const [picker, setPicker] = useState<DiscoveryResults | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [areaQuery, setAreaQuery] = useState('')
  const [callQuery, setCallQuery] = useState('')
  const active = useRef<AbortController | null>(null)
  const browse = browseUnit !== undefined
  const mode = state.peopleMode
  const units = org ? flattenUnits(org.roots) : []
  function change(patch: Partial<DiscoveryQuery>) {
    active.current?.abort(); setBusy(false); setResults(null); setPicker(null); setError('')
    onChange(patch)
  }
  async function search(page = 1, pickingCall = false) {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setError(''); setResults(null)
    if (pickingCall) setPicker(null)
    try {
      const kind = browse || (mode === 'name' && !state.query.trim()) ? 'browse'
        : mode === 'name' ? 'person' : mode === 'areas' ? 'standard' : mode
      const body = pickingCall ? { mode: 'standard', query: callQuery, page } : {
        kind, query: browse ? state.query : mode === 'call' ? '' : state.query, page,
        areaIds: !browse && mode === 'areas' ? state.areaIds : [],
        unitId: (browse ? browseUnit : state.unitId) || undefined, includeSubunits: state.includeSubunits,
        designation: state.designation || undefined, careerStage: state.careerStage || undefined,
        callId: !browse && mode === 'call' ? state.callId : undefined,
      }
      const response = await authFetch(`/api/discovery/${pickingCall ? 'calls' : 'people'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      })
      const payload = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(payload.error || 'Search could not be completed.')
      if (pickingCall) setPicker(payload)
      else { setResults(payload); window.history.replaceState({}, '', discoverySearchLink(state)) }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Search could not be completed.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    if (browse || mode === 'name' || (mode === 'call' && state.callId) || (mode === 'areas' && state.areaIds.length) || (mode === 'semantic' && state.query.trim().length >= 2)) void search()
    return () => active.current?.abort()
    // The browser remounts on unit changes; edits otherwise wait for form submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const filteredAreas = areas.filter(area => area.label.toLowerCase().includes(areaQuery.trim().toLowerCase()))
  const callPicker = !browse && mode === 'call' && !state.callId
  const disabled = busy || !access?.canSearchPeople || (!browse && mode === 'areas' && !state.areaIds.length)

  return <div className={browse ? 'space-y-5' : 'grid items-start gap-6 lg:grid-cols-[272px_minmax(0,1fr)]'}>
    <aside className="cb-card p-5">
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); void search(1, callPicker) }}>
        {!browse && <fieldset><legend className="cb-eyebrow mb-2">Find colleagues</legend><div className="space-y-1">
          {PEOPLE_MODES.map(item => <label key={item.id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="people-mode" checked={mode === item.id}
            onChange={() => change({ peopleMode: item.id, query: '' })} className="accent-blue-600" />{item.label}</label>)}
        </div></fieldset>}
        {!browse && mode === 'areas' ? <fieldset><legend className="cb-label mb-2">Research areas</legend>
          <input type="search" className="cb-input" aria-label="Filter standard research areas" value={areaQuery} onChange={event => setAreaQuery(event.target.value)} placeholder="Find an area…" />
          <div className="mt-2 flex flex-wrap gap-1">{state.areaIds.map(id => <button key={id} type="button" className="cb-chip" aria-label={`Remove ${areas.find(a => a.id === id)?.label || 'selected area'}`}
            onClick={() => change({ areaIds: state.areaIds.filter(value => value !== id) })}>{areas.find(a => a.id === id)?.label || 'Selected area'}<X className="h-3 w-3" aria-hidden /></button>)}</div>
          <div className="mt-2 max-h-60 overflow-y-auto">{filteredAreas.slice(0, 80).map(area => <label key={area.id} className="flex min-h-10 items-center gap-2 text-xs leading-5"><input type="checkbox" className="accent-blue-600"
            checked={state.areaIds.includes(area.id)} disabled={state.areaIds.length >= 20 && !state.areaIds.includes(area.id)}
            onChange={() => change({ areaIds: state.areaIds.includes(area.id) ? state.areaIds.filter(id => id !== area.id) : [...state.areaIds, area.id] })} />{area.label}</label>)}</div>
          <p className="cb-hint mt-2">{areas.length ? `${state.areaIds.length}/20 selected. Matches any selected area.` : 'Research areas are unavailable. Retry loading options above.'}{filteredAreas.length > 80 ? ' Type to narrow the list.' : ''}</p>
        </fieldset> : callPicker ? <label className="cb-label">Call title or funder<input type="search" className="cb-input mt-2" value={callQuery} maxLength={300} onChange={event => { active.current?.abort(); setBusy(false); setPicker(null); setCallQuery(event.target.value) }} /></label>
          : !browse && mode === 'call' ? <div className="rounded-lg bg-slate-50 p-3"><p className="cb-eyebrow">Selected call</p><p className="mt-2 break-words text-sm font-medium">{state.callTitle || 'Selected funding call'}</p>
            <div className="mt-2 flex flex-wrap gap-1"><button type="button" className="cb-btn-ghost cb-btn-sm" onClick={() => onOpenCall?.({ id: state.callId, title: state.callTitle })}>Call details</button><button type="button" className="cb-btn-ghost cb-btn-sm" onClick={() => change({ callId: '', callTitle: '' })}>Change call</button></div></div>
            : <label className="cb-label">{mode === 'semantic' && !browse ? 'Describe expertise' : access?.capabilities.canSeeEmployeeIds && !browse ? 'Name, email or employee ID' : browse ? 'Filter people by name or email' : 'Name or email'}
              {mode === 'semantic' && !browse ? <textarea rows={4} maxLength={300} className="cb-input mt-2" value={state.query} onChange={event => change({ query: event.target.value })} placeholder="e.g. microfluidics for cancer diagnostics" />
                : <input type="search" maxLength={300} className="cb-input mt-2" value={state.query} onChange={event => change({ query: event.target.value })} placeholder="Browse all or enter a name" />}</label>}
        {!browse && <label className="cb-label">School or department<select aria-label="School or department" className="cb-select mt-2" value={state.unitId} onChange={event => change({ unitId: event.target.value })}><option value="">All of your organisation</option>
          {units.map(unit => <option key={unit.id} value={unit.id}>{'— '.repeat(Math.min(unit.depth, 5))}{unit.name}</option>)}</select></label>}
        {(browse || state.unitId) && browseUnit !== UNPLACED_UNIT && <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={state.includeSubunits} onChange={event => change({ includeSubunits: event.target.checked })} />Include departments below this unit</label>}
        <div className={browse ? 'grid gap-4 sm:grid-cols-2' : 'space-y-4'}>
          <label className="cb-label">Designation<select aria-label="Designation" className="cb-select mt-2" value={state.designation} onChange={event => change({ designation: event.target.value })}><option value="">All designations</option>{access?.designations.map(option => <option key={option.value} value={option.value}>{option.value} ({option.count})</option>)}</select></label>
          <label className="cb-label">Career stage<select aria-label="Career stage" className="cb-select mt-2" value={state.careerStage} onChange={event => change({ careerStage: event.target.value })}><option value="">All career stages</option>{access?.careerStages.map(option => <option key={option.value} value={option.value}>{option.value.replace(/_/g, ' ')} ({option.count})</option>)}</select></label>
        </div>
        {!access && <p role="status" className="cb-hint">Waiting for people search options. Retry loading above if unavailable.</p>}
        <button type="submit" disabled={disabled} className="cb-btn-primary w-full"><Search className="h-4 w-4" aria-hidden />{busy ? 'Searching…' : callPicker ? 'Find a call' : !browse && mode === 'call' ? 'Find aligned people' : browse ? 'Update people' : 'Find people'}</button>
        <button type="button" className="cb-btn-ghost w-full" onClick={() => change({ query: '', areaIds: [], unitId: '', designation: '', careerStage: '', includeSubunits: true, callId: '', callTitle: '' })}>Reset filters</button>
      </form>
    </aside>
    <div className="min-w-0 space-y-4" aria-busy={busy}>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error} <button type="button" className="underline" onClick={() => void search(1, callPicker)}>Retry</button></div>}
      {busy && <p role="status" className="cb-card p-6 text-sm text-slate-500">{callPicker ? 'Finding calls…' : 'Finding people…'}</p>}
      {picker && <section aria-label="Choose a funding call" className="space-y-3"><h2 className="text-lg font-semibold">Choose a funding call</h2>{!picker.total && <p className="cb-hint">No calls found. Try a shorter title or a funder’s name.</p>}
        {picker.calls?.map((call: DiscoveryCall) => <button key={call.id} type="button" className="cb-card flex min-h-20 w-full items-center justify-between gap-3 p-5 text-left hover:border-blue-400"
          onClick={() => change({ callId: call.id, callTitle: call.schemeTitle, query: '' })}><span className="min-w-0"><span className="block text-sm font-semibold">{call.schemeTitle}</span><span className="mt-1 block text-xs text-slate-500">{call.agencyName}</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden /></button>)}
        <Pages results={picker} busy={busy} onPage={page => void search(page, true)} />
      </section>}
      {results && <>
        <div aria-live="polite" className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-lg font-semibold">{results.total} {results.basis === 'semantic' ? `research suggestion${results.total === 1 ? '' : 's'}` : `${results.total === 1 ? 'person' : 'people'} found`}</h2>
          <p className="text-xs text-slate-500">{results.bounded ? 'Top results · up to 50 · not an exhaustive count' : `Page ${results.page} of ${results.totalPages}`}</p></div>
        {results.warning && <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">{results.warning}</p>}
        {results.callRequiresRelease && <p className="cb-card-inset p-3 text-sm text-slate-600">An administrator must release this imported call to the funding department before it can be allocated.</p>}
        {!results.total && <div className="cb-card border-dashed p-8"><h3 className="font-semibold">No people found</h3><p className="cb-hint mt-2">Try fewer filters or a broader description. A missing research profile does not mean a colleague has no relevant expertise.</p></div>}
        <div className="grid gap-4 xl:grid-cols-2">{results.people?.map(person => <PersonCard key={person.id} person={person} onOpen={() => onOpenPerson(person)} onCalls={() => onPersonCalls(person)}
          matchingHref={!browse && mode === 'call' && !results.callRequiresRelease && access?.capabilities.canOpenMatching ? `/researcher-matching?callId=${encodeURIComponent(state.callId)}${state.unitId ? `&school=${encodeURIComponent(state.unitId)}` : ''}` : undefined} />)}</div>
        <Pages results={results} busy={busy} onPage={page => void search(page)} />
      </>}
      {!results && !picker && !busy && !error && <section className="cb-card p-8"><UserRound className="h-7 w-7 text-slate-400" aria-hidden /><h2 className="mt-4 text-lg font-semibold">{callPicker ? 'Start with a funding call' : 'Discover your colleagues'}</h2><p className="cb-hint mt-2">{callPicker ? 'Find a call by title or funder, choose it, then look for aligned researchers.' : 'Search by name, choose standard areas or describe the expertise you need. Results show the research evidence available.'}</p></section>}
    </div>
  </div>
}

function Pages({ results, busy, onPage }: { results: DiscoveryResults; busy: boolean; onPage: (page: number) => void }) {
  if (results.totalPages <= 1) return null
  return <nav aria-label="Search result pages" className="flex flex-wrap items-center justify-between gap-2 pt-2"><button type="button" className="cb-btn-secondary" disabled={busy || results.page <= 1} onClick={() => onPage(results.page - 1)}>Previous</button><span className="text-sm text-slate-500">{results.page} / {results.totalPages}</span><button type="button" className="cb-btn-secondary" disabled={busy || results.page >= results.totalPages} onClick={() => onPage(results.page + 1)}>Next</button></nav>
}
function PersonCard({ person, onOpen, onCalls, matchingHref }: { person: DiscoveryPerson; onOpen: () => void; onCalls: () => void; matchingHref?: string }) {
  const eligibility = person.eligibility
  return <article className="cb-card flex min-w-0 flex-col p-5">
    <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-500" aria-hidden>{person.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</div>
      <div className="min-w-0"><h3 className="break-words text-base font-semibold"><button type="button" onClick={onOpen} className="text-left hover:text-blue-700 hover:underline">{person.name}</button></h3><p className="mt-1 text-xs leading-5 text-slate-500">{[person.designation, person.department, person.school].filter(Boolean).join(' · ') || 'Organisation placement not recorded'}</p></div></div>
    <p className="mt-4 text-sm leading-6 text-slate-600">{person.summary || 'Research summary not yet recorded.'}</p>
    <div className="mt-4 space-y-3"><AreaTags label="Standard area links" labels={person.standardAreas.map(a => a.label)} /><AreaTags label="Profile areas" labels={person.areas} /><AreaTags label="Saved research interests" labels={person.savedAreas.map(a => a.label)} /></div>
    {!person.areas.length && !person.standardAreas.length && !person.savedAreas.length && <p className="cb-hint mt-3">No research areas recorded. Open the profile for available publications.</p>}
    {person.matchReason && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600"><strong>Why shown:</strong> {person.matchReason}</p>}
    {eligibility ? <div className="mt-3 rounded-lg border border-slate-200 p-3 text-xs leading-5"><strong>{eligibility.group === 'CONFLICT' ? 'Eligibility conflict' : eligibility.group === 'CHECK' ? 'Eligibility needs checking' : 'Recorded eligibility checks passed'}</strong>
      {eligibility.conflicts.map((text, i) => <p key={`conflict-${i}`} className="mt-1 text-red-700">{text}</p>)}{eligibility.toCheck.map((text, i) => <p key={`check-${i}`} className="mt-1 text-amber-800">{text}</p>)}<p className="mt-1 text-slate-500">Research fit and eligibility are separate checks.</p></div>
      : !!person.eligibilityFlags?.length && <p className="mt-3 text-xs leading-5 text-amber-800">Eligibility to check: {person.eligibilityFlags.join(' · ')}</p>}
    <div className="mt-auto flex flex-wrap gap-2 pt-5"><button type="button" className="cb-btn-secondary cb-btn-sm" onClick={onOpen}>View profile</button>
      {!!(person.areas.length || person.standardAreas.length || person.savedAreas.length) && <button type="button" className="cb-btn-ghost cb-btn-sm" onClick={onCalls}>Find calls in these areas<ArrowRight className="h-3.5 w-3.5" aria-hidden /></button>}
      {matchingHref && <Link href={matchingHref} className="cb-btn-ghost cb-btn-sm">Open matching workspace</Link>}</div>
  </article>
}
function AreaTags({ label, labels }: { label: string; labels: string[] }) {
  if (!labels.length) return null
  return <div><h4 className="mb-1.5 text-[11px] font-medium text-slate-500">{label}</h4><div className="flex flex-wrap gap-1.5">{labels.slice(0, 6).map((text, i) => <span key={`${text}-${i}`} className="cb-badge max-w-full break-words">{text}</span>)}</div>{labels.length > 6 && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">{labels.length - 6} more areas</summary><p className="mt-2 leading-6">{labels.slice(6).join(' · ')}</p></details>}</div>
}
