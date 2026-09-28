'use client'

/**
 * DSR Reports: four connected reports, with the call window (the call page)
 * as the fifth.
 *
 * The tab and every filter live in the URL. Any figure can open another report
 * already filtered, a link can be shared, and the browser's back button undoes
 * a jump between reports.
 */
import { useCallback, useEffect, useState } from 'react'

import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import AssignedCallsTab from './AssignedCallsTab'
import FollowUpsTab from './FollowUpsTab'
import IncomingCallsTab from './IncomingCallsTab'
import PendencyTab from './PendencyTab'
import { SCOPE_KEYS, type Filters, type HubTab } from './hubKit'

const TABS: Array<{ id: HubTab; label: string; help: string }> = [
  { id: 'incoming', label: 'Incoming Calls', help: 'Open calls that concern your schools, which schools they reach, and whether each school’s DSR action is completed.' },
  { id: 'assigned', label: 'Assigned Calls', help: 'Every allocation in your schools: the faculty response, deadlines, last follow-up and submission. Mark submitted, follow up or unallocate.' },
  { id: 'pendency', label: 'Pendency', help: 'Calls that directly matched faculty in your schools but nobody was allocated: at risk now, or already missed.' },
  { id: 'followups', label: 'Follow-ups', help: 'Week-by-week follow-up effort on allocated calls, by DSR member and by assignment.' },
]
const isTab = (v: string | null): v is HubTab => TABS.some(t => t.id === v)

function readUrl(): { tab: HubTab | null; filters: Filters } {
  const params = new URLSearchParams(window.location.search)
  const tab = params.get('tab'); params.delete('tab')
  return { tab: isTab(tab) ? tab : null, filters: Object.fromEntries(params) }
}

export default function DsrReportsHub() {
  const { me, loading } = useFundingDeptMe()
  const [tab, setTab] = useState<HubTab | null>(null)
  const [filters, setFiltersState] = useState<Filters>({})

  // The URL wins; otherwise the head starts on Pendency, coordinators on Incoming Calls.
  const defaultTab: HubTab = me.isHead || me.capabilities.isTenantWide ? 'pendency' : 'incoming'
  useEffect(() => {
    if (loading || tab) return
    const fromUrl = readUrl()
    setFiltersState(fromUrl.filters)
    setTab(fromUrl.tab || defaultTab)
  }, [loading, tab, defaultTab])

  // Back to the bare hub URL lands on the same default as the first load did.
  useEffect(() => {
    const onPop = () => { const u = readUrl(); setTab(u.tab || defaultTab); setFiltersState(u.filters) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [defaultTab])

  const write = (nextTab: HubTab, next: Filters, push: boolean) => {
    const params = new URLSearchParams({ tab: nextTab, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)) })
    const url = `${window.location.pathname}?${params}`
    if (push) window.history.pushState(null, '', url); else window.history.replaceState(null, '', url)
  }
  const setFilters = useCallback((next: Filters) => { setFiltersState(next); if (tab) write(tab, next, false) }, [tab])
  /** Jump to another report. The member, school and portfolio lens travel with you; the rest is what the link asked for. */
  const openTab = useCallback((next: HubTab, extra: Filters = {}) => {
    const carried: Filters = {}
    for (const key of SCOPE_KEYS) if (filters[key]) carried[key] = filters[key]
    const merged = { ...carried, ...extra }
    setTab(next); setFiltersState(merged); write(next, merged, true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [filters])

  if (loading || !tab) return <p className="nk-sub">Loading…</p>
  if (!me.isMember && !me.canAdminister) return <div className="nk-panel p-6"><p className="nk-title">DSR reports</p><p className="nk-sub mt-1">These reports are for funding-department members. Ask your department head to add you.</p></div>

  const current = TABS.find(t => t.id === tab)!
  return <div className="space-y-5">
    <nav className="flex flex-wrap gap-1 border-b border-nickel-200" role="tablist" aria-label="DSR reports">
      {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} title={t.help}
        className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t.id ? 'border-cobalt-600 text-cobalt-700' : 'border-transparent text-nickel-600 hover:text-nickel-900'}`}
        onClick={() => openTab(t.id)}>{t.label}</button>)}
    </nav>
    <p className="nk-sub text-sm">{current.help}</p>
    {tab === 'incoming' && <IncomingCallsTab filters={filters} setFilters={setFilters} openTab={openTab} />}
    {tab === 'assigned' && <AssignedCallsTab filters={filters} setFilters={setFilters} openTab={openTab} />}
    {tab === 'pendency' && <PendencyTab filters={filters} setFilters={setFilters} openTab={openTab} />}
    {tab === 'followups' && <FollowUpsTab filters={filters} setFilters={setFilters} openTab={openTab} />}
  </div>
}
