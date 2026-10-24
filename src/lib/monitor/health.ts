import { prisma } from '@/lib/prisma'

import { browserTierEnabled, monitorEngine } from './engine'
import { WORKER_STALE_MS } from './planner'

/**
 * Everything the Health strip shows, in one read: is the worker alive, is the
 * queue moving, what failed, and is paid work allowed. A billing failure or a
 * dead worker must be visible here, not only in a log line.
 */
export async function monitorHealthSnapshot(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const [workers, queueGroups, oldestQueued, deadLetters, checkGroups, siteGroups, providers, budget, jobRuns] = await Promise.all([
    prisma.monitorWorkerHeartbeat.findMany({ orderBy: { last_beat_at: 'desc' }, take: 10 }),
    prisma.monitorTask.groupBy({ by: ['status', 'kind'], _count: { _all: true } }),
    prisma.monitorTask.findFirst({
      where: { status: 'QUEUED', available_at: { lte: now } },
      orderBy: { available_at: 'asc' },
      select: { available_at: true, kind: true },
    }),
    prisma.monitorTask.findMany({
      where: { status: { in: ['DEAD', 'FAILED_PERMANENT'] } },
      orderBy: { updated_at: 'desc' },
      take: 10,
      select: { id: true, kind: true, status: true, last_error: true, terminal_reason: true, updated_at: true, source_id: true, attempts: true },
    }),
    prisma.monitorCheckRun.groupBy({ by: ['status'], where: { started_at: { gte: dayAgo } }, _count: { _all: true } }),
    prisma.monitorSite.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.monitorProviderHealth.findMany({ orderBy: { updated_at: 'desc' } }),
    prisma.monitorBudgetLedger.findMany({ where: { day: today } }),
    prisma.jobRun.findMany({
      where: { job_key: { in: ['funding.monitor.sweep', 'funding.monitor.liveness'] } },
      orderBy: { started_at: 'desc' },
      take: 6,
      select: { job_key: true, status: true, started_at: true, finished_at: true, error_message: true },
    }),
  ])

  const freshest = workers[0]?.last_beat_at ?? null
  const workerAgeMs = freshest ? now.getTime() - freshest.getTime() : null

  const queue: Record<string, Record<string, number>> = {}
  for (const group of queueGroups) {
    queue[group.status] = queue[group.status] ?? {}
    queue[group.status][group.kind] = group._count._all
  }

  return {
    engine: monitorEngine(),
    browserEnabled: process.env.MONITOR_BROWSER_ENABLED === 'true',
    browserInThisProcess: browserTierEnabled(),
    worker: {
      alive: workerAgeMs !== null && workerAgeMs < WORKER_STALE_MS,
      lastBeatAt: freshest,
      ageSeconds: workerAgeMs === null ? null : Math.round(workerAgeMs / 1000),
      instances: workers.map((w) => ({
        workerId: w.worker_id,
        state: w.state,
        lastBeatAt: w.last_beat_at,
        ageSeconds: Math.round((now.getTime() - w.last_beat_at.getTime()) / 1000),
        currentTaskId: w.current_task_id,
      })),
    },
    queue,
    oldestRunnable: oldestQueued
      ? { kind: oldestQueued.kind, ageSeconds: Math.max(0, Math.round((now.getTime() - oldestQueued.available_at.getTime()) / 1000)) }
      : null,
    deadLetters,
    checksLast24h: Object.fromEntries(checkGroups.map((g) => [g.status, g._count._all])),
    sites: Object.fromEntries(siteGroups.map((g) => [g.status, g._count._all])),
    providers: providers.map((p) => ({
      account: p.provider_account,
      state: p.state,
      reason: p.reason,
      openedAt: p.opened_at,
      nextProbeAt: p.next_probe_at,
      lastError: p.last_error,
    })),
    budgetToday: budget.map((b) => ({
      scope: b.scope,
      limitMicros: b.limit_micros.toString(),
      reservedMicros: b.reserved_micros.toString(),
      settledMicros: b.settled_micros.toString(),
    })),
    jobRuns,
  }
}
