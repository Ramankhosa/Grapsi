'use client'

import { useState } from 'react'
import { Building2, ChevronRight, Users } from 'lucide-react'
import DiscoveryPeople, { flattenUnits, type PeopleProps } from './DiscoveryPeople'
import type { DiscoveryOrg, DiscoveryOrgUnit } from '@/lib/discovery/org'
import { UNPLACED_UNIT, type DiscoveryArea } from '@/lib/discovery/types'

export default function OrganisationBrowser({ org, state, onChange, areas, access, onOpenPerson, onPersonCalls, onAreaCalls }: Omit<PeopleProps, 'org'> & {
  org: DiscoveryOrg; onAreaCalls: (areas: DiscoveryArea[], filter: DiscoveryOrg['areaFilter']) => void
}) {
  const [query, setQuery] = useState('')
  const all = flattenUnits(org.roots)
  const selected = all.find(unit => unit.id === state.orgUnitId)
  const unplaced = state.orgUnitId === UNPLACED_UNIT
  const invalid = !!state.orgUnitId && !selected && !unplaced
  const name = selected?.name || (unplaced ? 'People without a unit' : 'Your organisation')
  function matches(unit: DiscoveryOrgUnit): boolean { return unit.name.toLowerCase().includes(query.toLowerCase().trim()) || unit.children.some(matches) }
  function tree(units: DiscoveryOrgUnit[]) {
    return <ul className="space-y-1">{units.filter(matches).map(unit => <li key={unit.id}>
      <div className="flex items-center"><button type="button" aria-current={state.orgUnitId === unit.id ? 'true' : undefined} onClick={() => onChange({ orgUnitId: unit.id })}
        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${state.orgUnitId === unit.id ? 'bg-blue-50 font-medium text-blue-800' : 'text-slate-600 hover:bg-slate-50'}`}>
        <span className="min-w-0 break-words">{unit.name}</span><span className="shrink-0 text-xs text-slate-400">{unit.rollupCount}</span></button></div>
      {!!unit.children.length && <details open={query.trim() || selected?.path.includes(unit.id) ? true : undefined} key={`${unit.id}-${query ? 'search' : 'browse'}`} className="ml-3 border-l border-slate-200 pl-2">
        <summary className="cursor-pointer px-2 py-2 text-xs text-slate-500">{unit.children.length} {unit.children.length === 1 ? 'unit' : 'units'}</summary>{tree(unit.children)}</details>}
    </li>)}</ul>
  }
  return <div className="grid items-start gap-6 lg:grid-cols-[272px_minmax(0,1fr)]">
    <aside className="cb-card p-4"><h2 className="cb-eyebrow flex items-center gap-2"><Building2 className="h-4 w-4" aria-hidden />Browse organisation</h2>
      <label className="cb-label mt-4">Find a school or department<input type="search" className="cb-input mt-2" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search units…" /></label>
      <nav aria-label="Organisation units" className="mt-4 space-y-2">
        <button type="button" aria-current={!state.orgUnitId ? 'true' : undefined} onClick={() => onChange({ orgUnitId: '' })} className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-sm ${!state.orgUnitId ? 'bg-blue-50 font-medium text-blue-800' : 'text-slate-600 hover:bg-slate-50'}`}>All people<span className="text-xs">{org.totalPeople}</span></button>
        {tree(org.roots)}
        {!!query && !org.roots.some(matches) && <p className="p-3 text-xs text-slate-500">No schools or departments with that name.</p>}
        {!!org.unplacedCount && <button type="button" onClick={() => onChange({ orgUnitId: UNPLACED_UNIT })} aria-current={unplaced ? 'true' : undefined} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${unplaced ? 'bg-blue-50 text-blue-800' : 'text-slate-500 hover:bg-slate-50'}`}>Without an active unit<span className="text-xs">{org.unplacedCount}</span></button>}
      </nav>
    </aside>
    <div className="min-w-0 space-y-5">
      {invalid ? <div role="alert" className="cb-card p-6">This school or department is no longer available. Choose another unit.</div> : <>
        <section className="cb-card p-5 sm:p-6">
          {selected && <p className="mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-400">{selected.path.map(id => all.find(unit => unit.id === id)).filter((unit): unit is DiscoveryOrgUnit => !!unit).map((unit, i) => <span key={unit.id} className="inline-flex items-center gap-1">{i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}<button type="button" className="min-h-8 hover:text-blue-700" onClick={() => onChange({ orgUnitId: unit.id })}>{unit.name}</button></span>)}</p>}
          <p className="cb-eyebrow">{selected?.levelLabel || 'Organisation directory'}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{name}</h2>
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Users className="h-4 w-4" aria-hidden />{selected ? `${selected.rollupCount} people including departments · ${selected.directCount} directly in this unit` : `${unplaced ? org.unplacedCount : org.totalPeople} active people`}</p>
          {!!selected?.heads.length && <div className="mt-4"><h3 className="cb-eyebrow mb-2">Unit heads</h3><div className="flex flex-wrap gap-2">{selected.heads.map(head => <button key={head.userId} type="button" className="cb-btn-secondary cb-btn-sm" onClick={() => onOpenPerson({ id: head.userId, name: head.name })}>{head.name}{head.title ? ` · ${head.title}` : ''}</button>)}</div></div>}
          {!!selected?.areas.length && <div className="mt-4 border-t border-slate-100 pt-4"><h3 className="cb-eyebrow mb-2">Unit research areas</h3><div className="flex flex-wrap gap-1.5">{selected.areas.map(area => <span key={area.id} className="cb-badge">{area.label}</span>)}</div><p className="cb-hint mt-2">These describe the unit. Individual profiles show each person’s own expertise.</p>
            <button type="button" className="cb-btn-secondary mt-3" onClick={() => onAreaCalls(selected.areas, org.areaFilter)}>Find calls for these areas</button></div>}
        </section>
        <DiscoveryPeople key={state.orgUnitId || 'all'} state={state} onChange={onChange} areas={areas} access={access} org={org}
          browseUnit={state.orgUnitId} onOpenPerson={onOpenPerson} onPersonCalls={onPersonCalls} />
      </>}
    </div>
  </div>
}
