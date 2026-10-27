'use client'

import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Globe2,
  Radar,
  RefreshCw,
  Settings2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

import MonitorAddSource from './MonitorAddSource'
import MonitorCatalogImport from './MonitorCatalogImport'
import MonitorDiscoveries from './MonitorDiscoveries'
import MonitorEvidence from './MonitorEvidence'
import MonitorHealth from './MonitorHealth'
import MonitorOperators from './MonitorOperators'
import MonitorQuality from './MonitorQuality'
import MonitorQueue from './MonitorQueue'
import MonitorSites from './MonitorSites'
import MonitorSiteTree from './MonitorSiteTree'
import MonitorSources from './MonitorSources'
import type { MonitorChange, MonitorEngine, MonitorSource } from './types'

/**
 * Source Watch as one pipeline, read left to right: websites go in (Sources),
 * get crawled (Crawl), the AI screens what it finds (Screen), a person decides
 * (Review), and calls reach the catalog (Publish). Quality and Settings sit
 * beside the pipeline rather than in it.
 */

type Stage = 'sources' | 'crawl' | 'screen' | 'review' | 'publish'
type Side = 'quality' | 'settings'
type View = Stage | Side

interface Summary {
  stages: {
    sources: { activeSites: number; pausedSites: number; suggestedSites: number; pendingApproval: number; watchPoints: number; suggestedFeeds: number; skipRules: number }
    crawl: { checks24h: number; failed24h: number; incomplete24h: number; skipped24h: number; failingWatchPoints: number; deadTasks: number; quietWatchPoints: number }
    screen: { waitingLocal: number; screening: number; notFunding: number; unreadable: number; unchangedReused: number; laptopMissingHosts: string[]; aiCostMicros: string; aiAttempts: number }
    review: { fundingFound: number; unsure: number; incomplete: number }
    publish: { drafted: number; published: number }
  }
  attention: Stage
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad'
interface StageDef {
  key: Stage
  step: string
  title: string
  icon: LucideIcon
  blurb: string
}

const STAGES: StageDef[] = [
  { key: 'sources', step: 'Set up', title: 'Sources', icon: Globe2, blurb: 'Choose funder websites and the pages to watch on each. Pick them from the funding database or add an address.' },
  { key: 'crawl', step: 'Collect', title: 'Crawl', icon: Radar, blurb: 'Every page the crawler knows on each website, level by level, coloured by what it led to. Mark pages you never want visited.' },
  { key: 'screen', step: 'AI filter', title: 'Screen', icon: Bot, blurb: 'The AI separates funding calls from everything else. Check what it screened out so nothing real is lost.' },
  { key: 'review', step: 'You decide', title: 'Review', icon: ClipboardCheck, blurb: 'Funding opportunities the AI found, with quoted evidence. Draft, reject or snooze. Nothing is published automatically.' },
  { key: 'publish', step: 'Outcome', title: 'Publish', icon: CheckCircle2, blurb: 'Calls that came from Source Watch and reached the catalog.' },
]

const SUBVIEWS: Record<Stage | 'settings', Array<{ key: string; label: string; operatorOnly?: boolean; superOnly?: boolean; v2Only?: boolean }>> = {
  sources: [
    { key: 'import', label: 'Add from funding database', operatorOnly: true },
    { key: 'websites', label: 'Watched websites' },
    { key: 'watchpoints', label: 'Watched pages' },
    { key: 'add', label: 'Add by address', operatorOnly: true },
  ],
  crawl: [
    { key: 'tree', label: 'Page tree', v2Only: true },
    { key: 'log', label: 'Check log' },
    { key: 'health', label: 'Crawler health' },
  ],
  screen: [],
  review: [],
  publish: [],
  settings: [
    { key: 'operators', label: 'Who can operate', superOnly: true },
    { key: 'legacy', label: 'Legacy finds', v2Only: true },
  ],
}

/** Old ?tab= links keep working. */
const LEGACY_TABS: Record<string, [View, string?]> = {
  discoveries: ['review'],
  sites: ['sources', 'websites'],
  quality: ['quality'],
  queue: ['review'],
  sources: ['sources', 'watchpoints'],
  evidence: ['crawl', 'log'],
  health: ['crawl', 'health'],
  add: ['sources', 'add'],
  operators: ['settings', 'operators'],
}

function initialView(): { view: View | null; sub: string | null } {
  if (typeof window === 'undefined') return { view: null, sub: null }
  const params = new URLSearchParams(window.location.search)
  const stage = params.get('stage') as View | null
  if (stage && ['sources', 'crawl', 'screen', 'review', 'publish', 'quality', 'settings'].includes(stage)) return { view: stage, sub: params.get('view') }
  const legacy = LEGACY_TABS[params.get('tab') ?? '']
  return legacy ? { view: legacy[0], sub: legacy[1] ?? null } : { view: null, sub: null }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const QUEUE_STATES = [
  { key: 'NEW', label: 'Open' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'DISMISSED', label: 'Dismissed' },
  { key: 'SNOOZED', label: 'Snoozed' },
]

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-nickel-600',
  good: 'text-green-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
}
const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-nickel-300',
  good: 'bg-green-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-600',
}

function usd(micros: string) {
  return `$${(Number(micros) / 1e6).toFixed(2)}`
}

function stageStatus(key: Stage, s: Summary['stages'] | undefined, engine: MonitorEngine, legacyOpen: number | null): { line: string; sub: string; tone: Tone } {
  if (key === 'review' && engine === 'legacy') return { line: legacyOpen ? `${legacyOpen} waiting` : 'Queue', sub: 'Legacy review queue', tone: legacyOpen ? 'good' : 'neutral' }
  if (!s) return { line: '—', sub: 'Counts appear once the crawler runs', tone: 'neutral' }
  switch (key) {
    case 'sources': {
      const x = s.sources
      if (x.activeSites === 0 && !x.pendingApproval) return { line: 'No websites yet', sub: 'Add the first one', tone: 'warn' }
      const todo = [x.pendingApproval ? `${x.pendingApproval} awaiting approval` : '', x.suggestedFeeds ? `${x.suggestedFeeds} feed${x.suggestedFeeds === 1 ? '' : 's'} to approve` : ''].filter(Boolean).join(' · ')
      return { line: `${x.activeSites} website${x.activeSites === 1 ? '' : 's'}`, sub: todo || `${x.watchPoints} pages watched`, tone: todo ? 'warn' : 'neutral' }
    }
    case 'crawl': {
      const x = s.crawl
      if (x.failingWatchPoints || x.deadTasks) return { line: `${x.failingWatchPoints + x.deadTasks} need a look`, sub: `${x.checks24h} checks in 24 h`, tone: 'bad' }
      const sub = [x.incomplete24h ? `${x.incomplete24h} incomplete` : '', x.skipped24h ? `${x.skipped24h} skipped` : '', x.quietWatchPoints ? `${x.quietWatchPoints} quiet, checked less` : ''].filter(Boolean).join(' · ')
      return { line: `${x.checks24h} checks in 24 h`, sub: sub || 'All checks complete', tone: x.incomplete24h ? 'warn' : 'neutral' }
    }
    case 'screen': {
      const x = s.screen
      if (x.laptopMissingHosts.length) return { line: `${x.waitingLocal} waiting for laptop`, sub: `Laptop not set up for ${x.laptopMissingHosts.length} website${x.laptopMissingHosts.length === 1 ? '' : 's'}`, tone: 'bad' }
      return {
        line: x.waitingLocal ? `${x.waitingLocal} waiting for laptop` : `${x.screening} being screened`,
        sub: `${x.notFunding} not funding${x.unchangedReused ? ` (${x.unchangedReused} unchanged, not re-analysed)` : ''} · ${usd(x.aiCostMicros)} AI`,
        tone: x.unreadable ? 'warn' : 'neutral',
      }
    }
    case 'review': {
      const x = s.review
      const waiting = x.fundingFound + x.unsure + x.incomplete
      return {
        line: x.fundingFound ? `${x.fundingFound} funding found` : waiting ? `${waiting} to look at` : 'All caught up',
        sub: [x.unsure ? `${x.unsure} unsure` : '', x.incomplete ? `${x.incomplete} details incomplete` : ''].filter(Boolean).join(' · ') || 'Waiting for your decision',
        tone: x.fundingFound ? 'good' : waiting ? 'warn' : 'neutral',
      }
    }
    case 'publish':
      return { line: `${s.publish.published} published`, sub: `${s.publish.drafted} drafted in the catalog`, tone: s.publish.published ? 'good' : 'neutral' }
  }
}

export default function SourceMonitorPage() {
  const { token, user, isLoading: authLoading } = useAuth()

  const canOperate = useMemo(
    () =>
      Boolean(
        user?.roles?.includes('SUPER_ADMIN') ||
          (user?.roles?.includes('ADMIN') && user?.ati_id === 'PLATFORM') ||
          user?.platformPermissions?.includes('funding.operations.write')
      ),
    [user?.ati_id, user?.platformPermissions, user?.roles]
  )

  // Granting access is a super-admin act — the team-role endpoints enforce the
  // same thing server-side, so this only decides whether the tab is offered.
  const canManageOperators = Boolean(user?.roles?.includes('SUPER_ADMIN'))
  const canPublish = canManageOperators || Boolean(user?.platformPermissions?.includes('funding.publisher.write'))

  const [{ view: requestedView, sub: requestedSub }] = useState(initialView)
  const [view, setView] = useState<View | null>(requestedView)
  const [subs, setSubs] = useState<Record<string, string>>(requestedView && requestedSub ? { [requestedView]: requestedSub } : {})
  const [summary, setSummary] = useState<Summary | null>(null)
  const [engine, setEngine] = useState<MonitorEngine>('legacy')
  const [queueState, setQueueState] = useState('NEW')
  const [changes, setChanges] = useState<MonitorChange[]>([])
  const [sources, setSources] = useState<MonitorSource[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const authedFetch = useCallback(
    (path: string, init: RequestInit = {}) =>
      fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {}),
        },
      }),
    [token]
  )

  const load = useCallback(async () => {
    // No token once auth has settled means signed out — stop loading and say
    // so, rather than leaving a spinner running forever.
    if (!token) {
      if (!authLoading) setLoading(false)
      return
    }
    setError(null)
    try {
      const [changesResponse, sourcesResponse] = await Promise.all([
        authedFetch(`/api/funding/monitor/changes?state=${queueState}`),
        authedFetch('/api/funding/monitor/sources'),
      ])
      if (!changesResponse.ok || !sourcesResponse.ok) {
        throw new Error(
          changesResponse.status === 403 || sourcesResponse.status === 403
            ? 'You do not have access to source monitoring.'
            : 'Could not load monitoring data.'
        )
      }
      const changesData = await changesResponse.json()
      const sourcesData = await sourcesResponse.json()
      setChanges(changesData.changes ?? [])
      setSources(sourcesData.sources ?? [])
      // Which engine runs decides what "Check now" does and what Review shows.
      const [healthResponse, summaryResponse] = await Promise.all([
        authedFetch('/api/funding/monitor/liveness'),
        authedFetch('/api/funding/monitor/pipeline'),
      ])
      if (healthResponse.ok || healthResponse.status === 503) {
        const liveness = await healthResponse.json()
        setEngine(liveness.engine === 'v2' ? 'v2' : 'legacy')
      }
      setSummary(summaryResponse.ok ? await summaryResponse.json() : null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load monitoring data.')
    } finally {
      setLoading(false)
    }
  }, [authLoading, authedFetch, queueState, token])

  useEffect(() => {
    void load()
  }, [load])

  // Open on the stage that needs attention unless a link asked for another.
  const activeView: View = view ?? summary?.attention ?? (engine === 'v2' ? 'review' : 'sources')

  const go = useCallback((next: View, sub?: string) => {
    setView(next)
    if (sub) setSubs((old) => ({ ...old, [next]: sub }))
    try {
      const params = new URLSearchParams(window.location.search)
      params.delete('tab')
      params.set('stage', next)
      if (sub) params.set('view', sub)
      else params.delete('view')
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
    } catch {
      // history unavailable; the view still changes
    }
  }, [])

  const openCount = useMemo(() => (queueState === 'NEW' ? changes.length : null), [changes.length, queueState])

  async function actOnChange(changeId: string, body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await authedFetch(`/api/funding/monitor/changes/${changeId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Action failed')
      if (data.state === 'CONFIRMED') {
        setNotice(
          data.alreadyLinked
            ? 'Already sent to funding intake.'
            : 'Sent to funding intake — it will appear as a draft call once processed.'
        )
      }
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function checkNow(sourceId: string): Promise<string> {
    const response = await authedFetch(`/api/funding/monitor/sources/${sourceId}/check`, {
      method: 'POST',
    })
    const data = await response.json()

    if (data.status === 'queued' && data.taskId) {
      // v2: the worker runs the check. Follow its task for up to a minute.
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(2000)
        const poll = await authedFetch(`/api/funding/monitor/tasks/${data.taskId}`)
        if (!poll.ok) break
        const { task, checkRun } = await poll.json()
        if (task.status === 'DONE') {
          await load()
          if (!checkRun) return 'Check finished.'
          if (checkRun.status === 'NOT_MODIFIED') return 'Not modified since the last check.'
          const scope = checkRun.complete ? 'complete' : 'incomplete — the rest continues next check'
          return `Checked ${checkRun.pages_visited} page(s): ${checkRun.items_observed} items, ${checkRun.new_resources} new (${scope}).`
        }
        if (task.status === 'DEAD' || task.status === 'FAILED_PERMANENT' || task.status === 'CANCELED') {
          await load()
          return `Check failed: ${task.last_error ?? task.terminal_reason ?? task.status}`
        }
        if (task.status === 'QUEUED' && task.last_error) {
          return `Check deferred: ${task.last_error}`
        }
      }
      await load()
      return 'Check queued — the worker will run it shortly. See the Crawl stage for the result.'
    }

    await load()
    if (data.status === 'baseline') return 'Baseline saved — future checks compare against it.'
    if (data.status === 'unchanged') return 'No change since the last check.'
    if (data.status === 'changed') return 'Change detected — see Review.'
    return `Check failed: ${data.message ?? 'unknown error'}`
  }

  async function toggleStatus(source: MonitorSource) {
    setBusy(true)
    try {
      await authedFetch(`/api/funding/monitor/sources/${source.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: source.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSource(source: MonitorSource) {
    if (
      !window.confirm(
        `Delete "${source.name}" and its entire history? Confirmed opportunities already sent to intake are unaffected.`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await authedFetch(`/api/funding/monitor/sources/${source.id}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="cb-page py-10">
        <p className="cb-hint">Loading source monitoring…</p>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="cb-page py-10">
        <div className="cb-card p-8 text-center">
          <p className="cb-title">Sign in to view source monitoring</p>
          <p className="cb-hint mt-1">
            Watching funder pages is a funding-operator tool. Sign in with an account that has
            funding access.
          </p>
          <a className="cb-btn-primary mt-4" href="/login">
            Sign in
          </a>
        </div>
      </div>
    )
  }

  const allowed = (item: { operatorOnly?: boolean; superOnly?: boolean; v2Only?: boolean }) =>
    (!item.operatorOnly || canOperate) && (!item.superOnly || canManageOperators) && (!item.v2Only || engine === 'v2')
  const subviews = (activeView === 'quality' ? [] : SUBVIEWS[activeView]).filter(allowed)
  const sub = subs[activeView] && subviews.some((s) => s.key === subs[activeView]) ? subs[activeView] : subviews[0]?.key
  const stageIndex = STAGES.findIndex((s) => s.key === activeView)
  const stage = STAGES[stageIndex]
  const nextStage = stageIndex >= 0 ? STAGES[stageIndex + 1] : undefined

  return (
    <div className="cb-page space-y-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="cb-eyebrow flex items-center gap-1.5">
            <Workflow className="h-3.5 w-3.5" /> Source monitoring
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink">Funding source watch</h1>
          <p className="cb-hint mt-1 max-w-2xl">
            Funder websites go in on the left; published catalog calls come out on the right. Each step shows what is
            waiting there, and red means something needs fixing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="cb-btn-secondary cb-btn-sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          {engine === 'v2' && (
            <button className={`cb-btn-sm ${activeView === 'quality' ? 'cb-btn-primary' : 'cb-btn-secondary'}`} onClick={() => go('quality')}>
              <BarChart3 className="h-3.5 w-3.5" /> Quality
            </button>
          )}
          {(canManageOperators || engine === 'v2') && (
            <button className={`cb-btn-sm ${activeView === 'settings' ? 'cb-btn-primary' : 'cb-btn-secondary'}`} onClick={() => go('settings')}>
              <Settings2 className="h-3.5 w-3.5" /> Settings
            </button>
          )}
        </div>
      </header>

      <nav aria-label="Pipeline stages" className="cb-scroll-x -mx-1 overflow-x-auto px-1 pb-1">
        <ol className="grid min-w-[46rem] grid-cols-5 gap-0">
          {STAGES.map((def, i) => {
            const status = stageStatus(def.key, summary?.stages, engine, openCount)
            const active = activeView === def.key
            const Icon = def.icon
            return (
              <li key={def.key} className="relative flex items-stretch">
                <button
                  type="button"
                  onClick={() => go(def.key)}
                  aria-current={active ? 'step' : undefined}
                  className={`group relative flex w-full flex-col gap-1 rounded-xl border px-3.5 py-3 text-left transition ${
                    active
                      ? 'border-cobalt-500 bg-cobalt-50 shadow-[0_0_0_3px_rgba(29,78,216,0.12)]'
                      : 'border-hairline bg-ground hover:border-cobalt-200 hover:bg-nickel-25'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                        active ? 'bg-cobalt-600 text-white' : 'bg-nickel-100 text-nickel-600 group-hover:bg-cobalt-100 group-hover:text-cobalt-700'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-nickel-500">{def.step}</span>
                    <Icon className={`ml-auto h-4 w-4 ${active ? 'text-cobalt-600' : 'text-nickel-400'}`} aria-hidden />
                  </span>
                  <span className={`text-[15px] font-semibold ${active ? 'text-cobalt-800' : 'text-ink'}`}>{def.title}</span>
                  <span className={`flex items-center gap-1.5 text-[12.5px] font-medium ${TONE_TEXT[status.tone]}`}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} />
                    {status.line}
                  </span>
                  <span className="truncate text-[11.5px] text-nickel-500">{status.sub}</span>
                </button>
                {i < STAGES.length - 1 && (
                  <span className="z-10 -mx-2 flex w-4 shrink-0 items-center justify-center" aria-hidden>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-ground text-nickel-400">
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-cobalt-100 bg-cobalt-50 p-3 text-[13px] text-cobalt-700">{notice}</div>}

      <section className="cb-card space-y-5 p-5 sm:p-6" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="cb-eyebrow">{stage ? `Step ${stageIndex + 1} of 5 · ${stage.step}` : activeView === 'quality' ? 'Beside the pipeline' : 'Settings'}</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">
              {stage ? stage.title : activeView === 'quality' ? 'Quality' : 'Settings'}
            </h2>
            <p className="cb-hint mt-0.5">
              {stage
                ? stage.blurb
                : activeView === 'quality'
                  ? 'How well screening and discovery work, measured against human labels and verified announcements.'
                  : 'Who can operate Source Watch, and finds from the previous engine.'}
            </p>
          </div>
          {nextStage && (
            <button type="button" className="cb-btn-ghost cb-btn-sm" onClick={() => go(nextStage.key)}>
              Next: {nextStage.title} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {subviews.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-hairline pb-3" role="tablist">
            {subviews.map((item) => (
              <button
                key={item.key}
                role="tab"
                aria-selected={sub === item.key}
                className={`cb-tab ${sub === item.key ? 'cb-tab-active' : ''}`}
                onClick={() => go(activeView, item.key)}
              >
                {item.label}
                {item.key === 'watchpoints' && <span className="cb-badge">{sources.length}</span>}
              </button>
            ))}
          </div>
        )}

        {activeView === 'sources' && sub === 'import' && (
          <MonitorCatalogImport authedFetch={authedFetch} isSuperAdmin={canManageOperators} onAdded={() => void load()} />
        )}
        {activeView === 'sources' && sub === 'websites' && <MonitorSites authedFetch={authedFetch} canApprove={canManageOperators} onChanged={() => void load()} />}
        {activeView === 'sources' && sub === 'watchpoints' && (
          <MonitorSources sources={sources} busy={busy} onCheckNow={checkNow} onToggleStatus={toggleStatus} onDelete={deleteSource} />
        )}
        {activeView === 'sources' && sub === 'add' && (
          <MonitorAddSource
            authedFetch={authedFetch}
            onAdded={() => {
              go('sources', 'watchpoints')
              void load()
            }}
          />
        )}

        {activeView === 'crawl' && sub === 'tree' && <MonitorSiteTree authedFetch={authedFetch} canOperate={canOperate} />}
        {activeView === 'crawl' && sub === 'log' && <MonitorEvidence authedFetch={authedFetch} />}
        {activeView === 'crawl' && sub === 'health' && <MonitorHealth authedFetch={authedFetch} canOperate={canOperate} />}

        {activeView === 'screen' && (summary?.stages.screen.laptopMissingHosts.length ?? 0) > 0 && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
            <p className="font-semibold">The laptop has never analysed pages from {summary!.stages.screen.laptopMissingHosts.join(', ')}</p>
            <p className="mt-0.5">Their pages have waited for hours. Add these hosts to the laptop worker&apos;s allowed hosts (its broker configuration on the server); the site list here does not change that setting.</p>
          </div>
        )}
        {activeView === 'screen' && (
          <MonitorDiscoveries
            key="screen"
            authedFetch={authedFetch}
            canOperate={canOperate}
            canPublish={canPublish}
            lanes={[['WAITING_LOCAL', 'Waiting for laptop'], ['NEEDS_EVIDENCE', 'Needs evidence'], ['AUDIT', 'Screened out'], ['ALL', 'Everything seen']]}
            intro="Pages waiting for the laptop’s first-pass analysis, pages whose evidence is missing or unreadable, and what the AI judged not to be funding. If something real was screened out, mark it as a funding opportunity."
          />
        )}

        {activeView === 'review' && engine === 'v2' && (
          <MonitorDiscoveries
            key="review"
            authedFetch={authedFetch}
            canOperate={canOperate}
            canPublish={canPublish}
            lanes={[['PENDING', 'To review'], ['UPDATE_PROPOSED', 'Updates to existing calls'], ['SNOOZED', 'Snoozed'], ['REJECTED', 'Rejected']]}
            intro=""
          />
        )}
        {activeView === 'review' && engine === 'legacy' && renderLegacyQueue()}

        {activeView === 'publish' && (
          <MonitorDiscoveries
            key="publish"
            authedFetch={authedFetch}
            canOperate={canOperate}
            canPublish={canPublish}
            lanes={[['PUBLISHED', 'Published']]}
            intro="Calls that Source Watch found and a person published. Each links to its catalog entry."
          />
        )}

        {activeView === 'quality' && <MonitorQuality authedFetch={authedFetch} />}
        {activeView === 'settings' && sub === 'operators' && <MonitorOperators authedFetch={authedFetch} />}
        {activeView === 'settings' && sub === 'legacy' && renderLegacyQueue()}
        {activeView === 'settings' && !sub && <p className="cb-hint">Nothing to configure here for your role.</p>}
      </section>
    </div>
  )

  function renderLegacyQueue() {
    return (
      <div className="space-y-4">
        <div className="cb-scroll-x flex gap-1 overflow-x-auto">
          {QUEUE_STATES.map((state) => (
            <button
              key={state.key}
              className={`cb-chip ${queueState === state.key ? 'cb-chip-active' : ''}`}
              onClick={() => setQueueState(state.key)}
            >
              {state.label}
              {state.key === 'NEW' && openCount ? ` · ${openCount}` : ''}
            </button>
          ))}
        </div>
        <MonitorQueue changes={changes} busy={busy} onAction={actOnChange} />
      </div>
    )
  }
}
