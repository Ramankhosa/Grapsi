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
import { Inbox, UsersRound, CircleAlert, MessagesSquare, X } from 'lucide-react'

import { useFundingDeptMe } from '@/lib/client/useFundingDeptMe'
import { useAuth } from '@/lib/auth-context'
import { useTenantLocale } from '@/hooks/useTenantLocale'
import WorkspaceDialog from '@/components/ui/WorkspaceDialog'
import AssignedCallsTab from './AssignedCallsTab'
import FollowUpsTab from './FollowUpsTab'
import IncomingCallsTab from './IncomingCallsTab'
import PendencyTab from './PendencyTab'
import { SCOPE_KEYS, type Filters, type HubTab } from './hubKit'

const TABS: Array<{ id: HubTab; label: string; help: string }> = [
  { id: 'incoming', label: 'Incoming Calls', help: 'Open opportunities for your schools, their faculty matches, and recorded DSR review outcomes. Application progress is tracked separately.' },
  { id: 'assigned', label: 'Assigned Calls', help: 'Every allocation in your schools: the faculty response, deadlines, last follow-up and submission. Mark submitted, follow up or unallocate.' },
  { id: 'pendency', label: 'Pendency', help: 'All outstanding school responsibilities: not reviewed, awaiting allocation, or allocated without submission. Includes calls without faculty matches.' },
  { id: 'followups', label: 'Follow-ups', help: 'Week-by-week follow-up effort on allocated calls, by DSR member and by assignment.' },
]
const isTab = (v: string | null): v is HubTab => TABS.some(t => t.id === v)

function readUrl(): { tab: HubTab | null; filters: Filters } {
  const params = new URLSearchParams(window.location.search)
  const tab = params.get('tab'); params.delete('tab')
  return { tab: isTab(tab) ? tab : null, filters: Object.fromEntries(params) }
}

export default function DsrReportsHub() {
  useTenantLocale()
  const { me, loading } = useFundingDeptMe()
  const { user } = useAuth()
  const [tab, setTab] = useState<HubTab | null>(null)
  const [filters, setFiltersState] = useState<Filters>({})
  const [savedViews, setSavedViews] = useState<Array<{name:string;tab:HubTab;filters:Filters}>>([])
  const [savingView,setSavingView] = useState(false)
  const viewStorageKey = `grapsi:dsr-views:${user?.tenant_id || ''}:${user?.user_id || ''}`
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(viewStorageKey) || '[]'); setSavedViews(Array.isArray(saved) ? saved.filter(value => typeof value?.name === 'string' && isTab(value.tab) && value.filters && Object.values(value.filters).every(filter => typeof filter === 'string')).slice(0,10) : []) }
    catch { setSavedViews([]) }
  },[viewStorageKey])
  const saveViews = (next:typeof savedViews) => { setSavedViews(next); try { localStorage.setItem(viewStorageKey,JSON.stringify(next)) } catch { /* The current view still works when browser storage is unavailable. */ } }

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
  const setFilters = useCallback((next: Filters) => { setFiltersState(next); if (tab) write(tab, next, next.q === filters.q) }, [tab, filters.q])
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
    <nav className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5" role="tablist" aria-label="DSR reports"
      onKeyDown={event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const currentIndex = TABS.findIndex(t => t.id === tab); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length-1 : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length; openTab(TABS[nextIndex].id); document.getElementById(`dsr-tab-${TABS[nextIndex].id}`)?.focus() } }}>
      {TABS.map((t, index) => { const Icon = [Inbox,UsersRound,CircleAlert,MessagesSquare][index]; return <button key={t.id} id={`dsr-tab-${t.id}`} role="tab" tabIndex={tab === t.id ? 0 : -1} aria-controls={`dsr-panel-${t.id}`} aria-selected={tab === t.id} title={t.help}
        className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition sm:flex-none ${tab === t.id ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        onClick={() => openTab(t.id)}><Icon className="h-4 w-4" aria-hidden="true" />{t.label}</button>})}
    </nav>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-3xl text-sm leading-6 text-slate-500">{current.help}</p>
      <div className="flex flex-wrap items-center gap-2">
        {savedViews.length > 0 && <select aria-label="Saved report views" value="" className="min-h-9 max-w-[200px] rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600" onChange={event => { const selected=savedViews[Number(event.target.value)]; if(selected){setTab(selected.tab);setFiltersState(selected.filters);write(selected.tab,selected.filters,true)} }}><option value="">Saved views</option>{savedViews.map((saved,index)=><option key={saved.name} value={index}>{saved.name}</option>)}</select>}
        <button type="button" className="min-h-9 px-2 text-xs font-medium text-blue-700" onClick={()=>setSavingView(true)}>Save view</button>
        {Object.entries(filters).some(([key,value])=>value&&!['page','logPage'].includes(key)) && <button type="button" className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-700" onClick={() => setFilters({})}><X className="h-3.5 w-3.5" />Clear filters</button>}
      </div></div>
    <WorkspaceDialog open={savingView} onOpenChange={setSavingView} title="Save this report view" description="Keep this tab and its filters for your next visit on this browser.">
      <form className="space-y-4" onSubmit={event => { event.preventDefault();const name=String(new FormData(event.currentTarget).get('name')||'').trim();if(name){saveViews([...savedViews.filter(saved=>saved.name!==name),{name,tab,filters:{...filters,page:'1',logPage:'1'}}].slice(-10));setSavingView(false)} }}>
        <label className="block text-sm font-medium text-slate-700">View name<input name="name" required maxLength={60} placeholder="e.g. My allocations needing contact" className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
        <button className="funding-button-primary w-full">Save view</button>
      </form>
      {savedViews.length>0&&<div className="mt-5 border-t border-slate-100 pt-4"><p className="text-xs font-medium text-slate-500">Saved on this browser</p>{savedViews.map(saved=><div key={saved.name} className="mt-2 flex items-center justify-between gap-3 text-sm"><span>{saved.name}</span><button type="button" aria-label={`Delete saved view ${saved.name}`} className="rounded-lg p-2 text-slate-400 hover:text-red-700" onClick={()=>saveViews(savedViews.filter(value=>value.name!==saved.name))}><X className="h-4 w-4" /></button></div>)}</div>}
    </WorkspaceDialog>
    <section id={`dsr-panel-${tab}`} role="tabpanel" aria-labelledby={`dsr-tab-${tab}`} tabIndex={0}>
    {tab === 'incoming' && <IncomingCallsTab filters={filters} setFilters={setFilters} openTab={openTab} />}
    {tab === 'assigned' && <AssignedCallsTab filters={filters} setFilters={setFilters} openTab={openTab} />}
    {tab === 'pendency' && <PendencyTab filters={filters} setFilters={setFilters} openTab={openTab} />}
    {tab === 'followups' && <FollowUpsTab filters={filters} setFilters={setFilters} openTab={openTab} />}
    </section>
  </div>
}
