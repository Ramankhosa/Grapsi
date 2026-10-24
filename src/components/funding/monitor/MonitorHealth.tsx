'use client'

import { Activity, AlertTriangle, CheckCircle2, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { HealthSnapshot } from './types'
import { ageLabel, timeAgo } from './types'

const STATUS_ORDER = ['QUEUED', 'RUNNING', 'DEFERRED_BUDGET', 'PAUSED_PROVIDER', 'DONE', 'DEAD', 'FAILED_PERMANENT', 'CANCELED']

function Stat({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-hairline bg-inset px-3 py-2">
      <div className="cb-eyebrow">{label}</div>
      <div
        className={`mt-0.5 font-mono text-[15px] tabular-nums ${
          tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

export default function MonitorHealth({
  authedFetch,
  canOperate,
}: {
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>
  canOperate: boolean
}) {
  const [health, setHealth] = useState<HealthSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [replaying, setReplaying] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await authedFetch('/api/funding/monitor/health')
      if (!response.ok) throw new Error('Could not load Source Watch health.')
      setHealth(await response.json())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Source Watch health.')
    } finally {
      setLoading(false)
    }
  }, [authedFetch])

  useEffect(() => {
    void load()
  }, [load])

  async function replay(taskId: string) {
    const reason = window.prompt('Why replay this task? (recorded with the task)')
    if (!reason || reason.trim().length < 3) return
    setReplaying(taskId)
    setNotice(null)
    try {
      const response = await authedFetch(`/api/funding/monitor/tasks/${taskId}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'replay', reason: reason.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Replay failed')
      setNotice(data.mode === 'reset' ? 'Task reset and queued again.' : 'Replay queued as a new occurrence.')
      await load()
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Replay failed')
    } finally {
      setReplaying(null)
    }
  }

  if (loading && !health) return <p className="cb-hint">Loading health…</p>
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>
  if (!health) return null

  const kinds = Array.from(new Set(Object.values(health.queue).flatMap((byKind) => Object.keys(byKind)))).sort()
  const statuses = STATUS_ORDER.filter((status) => health.queue[status])
  const v2 = health.engine === 'v2'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Activity className="h-4 w-4 text-cobalt-700" />
          Engine <span className={v2 ? 'cb-badge-cobalt' : 'cb-badge'}>{health.engine}</span>
          <span className="cb-badge">browser {health.browserEnabled ? 'on' : 'off'}</span>
        </div>
        <button className="cb-btn-secondary cb-btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {!v2 && (
        <div className="rounded-lg border border-hairline bg-inset p-3 text-[13px] text-ink-soft">
          The legacy one-page checker is running. Queue, worker and evidence figures below fill in once the v2 worker is
          started and <span className="font-mono">MONITOR_ENGINE=v2</span> is set.
        </div>
      )}

      {notice && <div className="rounded-lg border border-cobalt-100 bg-cobalt-50 p-3 text-[13px] text-cobalt-700">{notice}</div>}

      <div className="cb-card p-4">
        <div className="flex items-center gap-2">
          {health.worker.alive ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-600" />
          )}
          <span className="font-medium text-ink">
            {health.worker.alive ? 'Worker alive' : v2 ? 'Worker offline — sites are not being checked' : 'No worker running'}
          </span>
          <span className="text-[12px] text-muted">last heartbeat {ageLabel(health.worker.ageSeconds)} ago</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Oldest runnable" value={health.oldestRunnable ? ageLabel(health.oldestRunnable.ageSeconds) : '—'} />
          <Stat label="Dead letters" value={health.deadLetters.length} tone={health.deadLetters.length > 0 ? 'bad' : 'good'} />
          <Stat label="Checks complete (24h)" value={health.checksLast24h.COMPLETE ?? 0} />
          <Stat
            label="Checks failed (24h)"
            value={health.checksLast24h.FAILED ?? 0}
            tone={(health.checksLast24h.FAILED ?? 0) > 0 ? 'bad' : 'default'}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Partial (24h)" value={health.checksLast24h.PARTIAL ?? 0} />
          <Stat label="Not modified (24h)" value={health.checksLast24h.NOT_MODIFIED ?? 0} />
          <Stat label="Deferred (24h)" value={health.checksLast24h.DEFERRED ?? 0} />
          <Stat label="Active sites" value={health.sites.ACTIVE ?? 0} />
        </div>
      </div>

      <div className="cb-card p-4">
        <p className="cb-eyebrow">Paid AI work</p>
        {health.providers.length === 0 ? (
          <p className="cb-hint mt-1">
            No provider has been used yet. Triage and extraction arrive in the next phase, behind spend reservations and a
            circuit breaker; a billing failure will show here, not as a silent “needs review”.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-[13px]">
            {health.providers.map((provider) => (
              <li key={provider.account} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{provider.account}</span>
                <span className={provider.state === 'CLOSED' ? 'cb-badge' : 'cb-badge-cobalt'}>{provider.state}</span>
                {provider.reason && <span className="text-red-600">{provider.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {statuses.length > 0 && (
        <div className="cb-card cb-scroll-x overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline bg-inset text-left">
                <th className="cb-eyebrow px-4 py-2.5">Status</th>
                {kinds.map((kind) => (
                  <th key={kind} className="cb-eyebrow px-4 py-2.5">
                    {kind.replace(/_/g, ' ').toLowerCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statuses.map((status) => (
                <tr key={status} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2 font-mono text-[12px]">{status}</td>
                  {kinds.map((kind) => (
                    <td key={kind} className="px-4 py-2 tabular-nums text-ink-soft">
                      {health.queue[status]?.[kind] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {health.deadLetters.length > 0 && (
        <div className="cb-card p-4">
          <p className="cb-eyebrow">Dead letters</p>
          <ul className="mt-2 divide-y divide-hairline">
            {health.deadLetters.map((task) => (
              <li key={task.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[13px]">
                <div className="min-w-0">
                  <div className="font-mono text-[12px] text-ink">
                    {task.kind} · {task.status} · {task.attempts} attempts · {timeAgo(task.updated_at)}
                  </div>
                  <div className="text-ink-soft">{task.last_error ?? task.terminal_reason}</div>
                </div>
                {canOperate && (
                  <button
                    className="cb-btn-secondary cb-btn-xs"
                    disabled={replaying === task.id}
                    onClick={() => void replay(task.id)}
                  >
                    <RotateCcw className="h-3 w-3" /> Replay
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {health.jobRuns.length > 0 && (
        <div className="cb-card p-4">
          <p className="cb-eyebrow">Scheduled runs</p>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-soft">
            {health.jobRuns.map((run, index) => (
              <li key={`${run.job_key}-${index}`}>
                <span className="font-mono text-[12px]">{run.job_key}</span> — {run.status}, {timeAgo(run.started_at)}
                {run.error_message ? <span className="text-red-600"> — {run.error_message}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
