'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { useAuth } from '@/lib/auth-context'

interface JobRunRow {
  id: string
  trigger: string
  status: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  httpStatus: number | null
  counts: unknown
  errorMessage: string | null
  triggeredBy: string | null
}

interface JobEntry {
  jobKey: string
  lastSuccessAt: string | null
  runs: JobRunRow[]
}

/**
 * The registry mirrors the jobKeys the cron routes record via withJobRun and
 * the cadences in scripts/funding-scheduler.js / the scheduler runbook.
 * Run-now POSTs the endpoints directly — they accept interactive
 * funding-operator auth, so no proxy is needed.
 */
const JOBS: Array<{
  jobKey: string
  label: string
  description: string
  cadence: string
  endpoint: string
  body?: Record<string, unknown>
}> = [
  {
    jobKey: 'reminders-sweep',
    label: 'Reminder sweep',
    description: 'Due follow-up reminders plus the D30/D14/D7/D1 and no-acknowledgement nudge ladder.',
    cadence: 'Hourly at :05',
    endpoint: '/api/funding-dept/reminders/sweep',
  },
  {
    jobKey: 'alerts-dispatch',
    label: 'Alert dispatch',
    description: 'Healing sweep: funding-match alerts for published calls never dispatched.',
    cadence: 'Hourly at :20',
    endpoint: '/api/funding/alerts/dispatch',
  },
  {
    jobKey: 'alerts-digest-daily',
    label: 'Daily alert digest',
    description: 'Bundles queued alerts into one email per user on a daily frequency.',
    cadence: 'Daily at digest hour :35',
    endpoint: '/api/funding/alerts/digest',
    body: { frequency: 'daily' },
  },
  {
    jobKey: 'alerts-digest-weekly',
    label: 'Weekly alert digest',
    description: 'Bundles queued alerts for users on a weekly frequency.',
    cadence: 'Mondays at digest hour :35',
    endpoint: '/api/funding/alerts/digest',
    body: { frequency: 'weekly' },
  },
  {
    jobKey: 'reports-weekly',
    label: 'Department weekly reports',
    description: 'Worklist digest to each funding-department member and the rollup to the head.',
    cadence: 'Mondays at digest hour :35',
    endpoint: '/api/funding-dept/reports/weekly',
  },
  {
    jobKey: 'event-user-expiry',
    label: 'Event-user expiry',
    description: 'Suspends EVENT/workshop users past their access window and revokes refresh tokens.',
    cadence: 'Daily at digest hour :50',
    endpoint: '/api/platform/users/expire-event-access',
  },
]

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

/** One human line out of each job's stored response body. */
function summarizeCounts(jobKey: string, counts: unknown): string {
  if (!counts || typeof counts !== 'object') return '—'
  const c = counts as Record<string, unknown>
  try {
    switch (jobKey) {
      case 'reminders-sweep': {
        const r = (c.reminders ?? {}) as Record<string, unknown>
        const e = (c.escalations ?? {}) as Record<string, unknown>
        const reminders = num(r.sentToFaculty) + num(r.sentToMember)
        const nudges = num(e.deadlineNudges) + num(e.noResponseNudges) + num(e.milestoneNudges)
        return `${reminders} reminders, ${nudges} nudges`
      }
      case 'alerts-dispatch': {
        if (c.mode === 'single') {
          const r = (c.result ?? {}) as Record<string, unknown>
          return `1 call, ${num(r.alerted)} alerted`
        }
        const results = Array.isArray(c.results) ? (c.results as Array<Record<string, unknown>>) : []
        const alerted = results.reduce((sum, r) => sum + num(r.alerted), 0)
        return `${num(c.scanned)} calls scanned, ${alerted} alerted`
      }
      case 'alerts-digest-daily':
      case 'alerts-digest-weekly':
        return `${num(c.usersConsidered)} users, ${num(c.emailsSent)} emails`
      case 'reports-weekly':
        return `${num(c.memberDigestsSent)} member + ${num(c.headDigestsSent)} head digests`
      case 'event-user-expiry':
        return `${num(c.considered)} considered, ${num(c.suspended)} suspended`
      default:
        return '—'
    }
  } catch {
    return '—'
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString()
}

const STATUS_PILL: Record<string, string> = {
  succeeded: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700',
  failed: 'bg-red-900/50 text-red-300 border border-red-700',
  running: 'bg-cyan-900/50 text-cyan-300 border border-cyan-700',
}

export default function SuperAdminJobsPage() {
  noStore()

  const { user, isLoading: authLoading, logout } = useAuth()
  const [jobs, setJobs] = useState<JobEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
  })

  const fetchJobs = useCallback(async () => {
    const response = await fetch('/api/super-admin/jobs', { headers: authHeaders() })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to load job runs')
    }
    const result = await response.json()
    setJobs(result.jobs || [])
    return (result.jobs || []) as JobEntry[]
  }, [])

  useEffect(() => {
    // Wait for the auth context to finish bootstrapping before deciding —
    // user is always null on the very first render of a direct page load.
    if (authLoading) {
      return
    }
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!user.roles?.some((role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      window.location.href = '/dashboard'
      return
    }

    setLoading(true)
    fetchJobs()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load job runs'))
      .finally(() => setLoading(false))

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [authLoading, user, fetchJobs])

  const pollUntilSettled = useCallback(
    (jobKey: string, deadline: number) => {
      pollTimer.current = setTimeout(async () => {
        try {
          const latest = await fetchJobs()
          const entry = latest.find((j) => j.jobKey === jobKey)
          const newest = entry?.runs[0]
          if (newest && newest.status !== 'running') {
            setRunningKey(null)
            return
          }
        } catch {
          // keep polling — a transient fetch failure shouldn't strand the button
        }
        if (Date.now() < deadline) {
          pollUntilSettled(jobKey, deadline)
        } else {
          setRunningKey(null)
        }
      }, 3000)
    },
    [fetchJobs]
  )

  const runNow = async (job: (typeof JOBS)[number]) => {
    setError(null)
    setRunningKey(job.jobKey)
    try {
      // Fire without awaiting completion — these endpoints can run for minutes.
      void fetch(job.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(job.body ?? {}),
      }).then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          setError(`${job.label}: ${body.message || body.error || `failed (${response.status})`}`)
        }
      })
      pollUntilSettled(job.jobKey, Date.now() + 5 * 60 * 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start job')
      setRunningKey(null)
    }
  }

  if (!user) {
    return null
  }

  const isViewer = user.roles?.includes('SUPER_ADMIN_VIEWER') && !user.roles?.includes('SUPER_ADMIN')
  const byKey = new Map(jobs.map((j) => [j.jobKey, j]))

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="bg-slate-800 border-b border-slate-700 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">⏱️ Jobs &amp; Schedules</h1>
            <p className="text-slate-400 text-sm mt-1">
              Run history for the funding scheduler&apos;s cron jobs — a stale &quot;last success&quot; means the scheduler is down
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-slate-400">
              {isViewer ? '👁️ Viewer' : '⚡ Admin'}: {user.email}
            </span>
            <button
              onClick={() => logout()}
              className="px-4 py-2 text-sm font-medium rounded-md text-slate-300 bg-slate-700 hover:bg-slate-600 border border-slate-600"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="float-right text-red-400 hover:text-red-200">
              ×
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {JOBS.map((job) => {
              const entry = byKey.get(job.jobKey)
              const newest = entry?.runs[0]
              const isPending = runningKey === job.jobKey || newest?.status === 'running'
              return (
                <div key={job.jobKey} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-lg font-semibold text-cyan-400">{job.label}</h2>
                        {newest && (
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                              STATUS_PILL[newest.status] ?? STATUS_PILL.running
                            }`}
                          >
                            {newest.status}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400 mt-2 max-w-3xl">{job.description}</p>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                        <span>Cadence: {job.cadence}</span>
                        <span>
                          Last success:{' '}
                          <span className={entry?.lastSuccessAt ? 'text-slate-300' : 'text-amber-300'}>
                            {formatWhen(entry?.lastSuccessAt ?? null)}
                          </span>
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => runNow(job)}
                      disabled={isViewer || isPending}
                      className="shrink-0 px-4 py-2 text-sm font-semibold rounded-md text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isPending ? 'Running…' : 'Run now'}
                    </button>
                  </div>

                  {entry && entry.runs.length > 0 ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-700">
                            <th className="py-2 pr-4">Started</th>
                            <th className="py-2 pr-4">Trigger</th>
                            <th className="py-2 pr-4">Status</th>
                            <th className="py-2 pr-4">Duration</th>
                            <th className="py-2 pr-4">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.runs.map((run) => (
                            <tr key={run.id} className="border-b border-slate-700/60 last:border-b-0">
                              <td className="py-2 pr-4 whitespace-nowrap text-slate-300">
                                {formatWhen(run.startedAt)}
                              </td>
                              <td className="py-2 pr-4 text-slate-400">
                                {run.trigger}
                                {run.triggeredBy ? ` · ${run.triggeredBy}` : ''}
                              </td>
                              <td className="py-2 pr-4">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    STATUS_PILL[run.status] ?? STATUS_PILL.running
                                  }`}
                                >
                                  {run.status}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-slate-400">{formatDuration(run.durationMs)}</td>
                              <td className="py-2 pr-4 text-slate-400">
                                {run.status === 'failed' && run.errorMessage
                                  ? run.errorMessage
                                  : summarizeCounts(job.jobKey, run.counts)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">
                      No runs recorded yet — the scheduler has not fired this job since observability was added.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
