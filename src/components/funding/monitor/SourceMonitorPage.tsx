'use client'

import { Radar, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

import MonitorAddSource from './MonitorAddSource'
import MonitorOperators from './MonitorOperators'
import MonitorQueue from './MonitorQueue'
import MonitorSources from './MonitorSources'
import type { MonitorChange, MonitorSource } from './types'

type Tab = 'queue' | 'sources' | 'add' | 'operators'

const QUEUE_STATES = [
  { key: 'NEW', label: 'Open' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'DISMISSED', label: 'Dismissed' },
  { key: 'SNOOZED', label: 'Snoozed' },
]

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

  const [tab, setTab] = useState<Tab>('queue')
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load monitoring data.')
    } finally {
      setLoading(false)
    }
  }, [authLoading, authedFetch, queueState, token])

  useEffect(() => {
    void load()
  }, [load])

  const openCount = useMemo(
    () => (queueState === 'NEW' ? changes.length : null),
    [changes.length, queueState]
  )

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
    await load()
    if (data.status === 'baseline') return 'Baseline saved — future checks compare against it.'
    if (data.status === 'unchanged') return 'No change since the last check.'
    if (data.status === 'changed') return 'Change detected — see the queue.'
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

  return (
    <div className="cb-page space-y-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="cb-eyebrow flex items-center gap-1.5">
            <Radar className="h-3.5 w-3.5" /> Source monitoring
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink">
            Funding source watch
          </h1>
          <p className="cb-hint mt-1 max-w-2xl">
            Moni checks each funder page once a day, tells a genuinely new call apart from a
            reworded banner, and queues what it finds. Confirming a find hands it to funding
            intake, which turns it into a draft call in the catalog.
          </p>
        </div>
        <button className="cb-btn-secondary cb-btn-sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-cobalt-100 bg-cobalt-50 p-3 text-[13px] text-cobalt-700">
          {notice}
        </div>
      )}

      <div className="cb-scroll-x flex items-center gap-1 overflow-x-auto">
        <button
          className={`cb-tab ${tab === 'queue' ? 'cb-tab-active' : ''}`}
          onClick={() => setTab('queue')}
        >
          Review queue
          {openCount ? (
            <span className="rounded-full bg-cobalt-600 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white">
              {openCount}
            </span>
          ) : null}
        </button>
        <button
          className={`cb-tab ${tab === 'sources' ? 'cb-tab-active' : ''}`}
          onClick={() => setTab('sources')}
        >
          Sources <span className="cb-badge">{sources.length}</span>
        </button>
        {canOperate && (
          <button
            className={`cb-tab ${tab === 'add' ? 'cb-tab-active' : ''}`}
            onClick={() => setTab('add')}
          >
            Add sources
          </button>
        )}
        {canManageOperators && (
          <button
            className={`cb-tab ${tab === 'operators' ? 'cb-tab-active' : ''}`}
            onClick={() => setTab('operators')}
          >
            Operators
          </button>
        )}
      </div>

      {tab === 'queue' && (
        <div className="space-y-4">
          <div className="cb-scroll-x flex gap-1 overflow-x-auto">
            {QUEUE_STATES.map((state) => (
              <button
                key={state.key}
                className={`cb-chip ${queueState === state.key ? 'cb-chip-active' : ''}`}
                onClick={() => setQueueState(state.key)}
              >
                {state.label}
              </button>
            ))}
          </div>
          <MonitorQueue changes={changes} busy={busy} onAction={actOnChange} />
        </div>
      )}

      {tab === 'sources' && (
        <MonitorSources
          sources={sources}
          busy={busy}
          onCheckNow={checkNow}
          onToggleStatus={toggleStatus}
          onDelete={deleteSource}
        />
      )}

      {tab === 'operators' && canManageOperators && (
        <MonitorOperators authedFetch={authedFetch} />
      )}

      {tab === 'add' && canOperate && (
        <MonitorAddSource
          authedFetch={authedFetch}
          onAdded={() => {
            setTab('sources')
            void load()
          }}
        />
      )}
    </div>
  )
}
