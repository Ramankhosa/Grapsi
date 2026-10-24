import { randomUUID } from 'node:crypto'
import os from 'node:os'

import { prisma } from '@/lib/prisma'

import { createBrowserRenderer, type Renderer } from './browser'
import { browserTierEnabled, isV2Engine, EngineDisabledError } from './engine'
import { dispatchPendingEvents } from './events'
import { EXECUTABLE_KINDS, executeTask } from './execute'
import { DEFAULT_LEASE_MS, claimNextTask, heartbeat, type Lease } from './queue'
import { defaultSafeFetch, type SafeFetch } from './safeFetch'

/**
 * The Source Watch worker: a long-running process (PM2 `grapsi-monitor-worker`)
 * that claims tasks and runs them.
 *
 * - Its heartbeat row is written on a timer, independent of task activity, so
 *   an idle worker looks alive and a dead one is noticed within minutes.
 * - Each running task has a lease watchdog: the lease is extended every 30 s,
 *   and if extension fails (the task was reclaimed) the task's AbortSignal
 *   fires, so a fetch, parse or render in flight stops instead of finishing
 *   work that can no longer commit.
 * - The browser is created lazily and only when MONITOR_BROWSER_ENABLED=true.
 */

export interface WorkerOptions {
  once?: boolean
  concurrency?: number
  pollMs?: number
  workerId?: string
  /** Test seam. */
  fetch?: SafeFetch
  renderer?: Renderer | null
}

const HEARTBEAT_MS = 30_000
const LEASE_EXTEND_MS = 30_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runSourceMonitorWorker(options: WorkerOptions = {}): Promise<{ executed: number }> {
  if (!options.fetch && !isV2Engine()) throw new EngineDisabledError('Source Watch worker')
  const workerId = options.workerId ?? `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  const concurrency = Math.max(1, options.concurrency ?? Number(process.env.MONITOR_WORKER_CONCURRENCY ?? 4))
  const pollMs = Math.max(1000, options.pollMs ?? 10_000)
  const fetch = options.fetch ?? defaultSafeFetch()

  let renderer: Renderer | null | undefined = options.renderer
  const getRenderer = async (): Promise<Renderer | null> => {
    if (renderer !== undefined) return renderer
    renderer = browserTierEnabled() ? await createBrowserRenderer({ maxConcurrent: Number(process.env.MONITOR_BROWSER_CONCURRENCY ?? 1) }) : null
    return renderer
  }

  let stopping = false
  const running = new Map<string, Lease>()
  let executed = 0

  const beat = async () => {
    try {
      await prisma.monitorWorkerHeartbeat.upsert({
        where: { worker_id: workerId },
        create: {
          worker_id: workerId,
          hostname: os.hostname(),
          pid: process.pid,
          version: process.env.npm_package_version ?? null,
          state: stopping ? 'STOPPING' : running.size > 0 ? 'BUSY' : 'IDLE',
          current_task_id: [...running.keys()][0] ?? null,
        },
        update: {
          last_beat_at: new Date(),
          state: stopping ? 'STOPPING' : running.size > 0 ? 'BUSY' : 'IDLE',
          current_task_id: [...running.keys()][0] ?? null,
        },
      })
    } catch (error) {
      console.error('[monitor-worker] heartbeat failed:', error instanceof Error ? error.message : error)
    }
  }
  await beat()
  const heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_MS)

  const stop = () => {
    stopping = true
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  async function runOne(lease: Lease) {
    const controller = new AbortController()
    running.set(lease.taskId, lease)
    const watchdog = setInterval(() => {
      void heartbeat(lease, DEFAULT_LEASE_MS).then((held) => {
        if (!held) controller.abort()
      })
    }, LEASE_EXTEND_MS)
    try {
      await executeTask(lease, { fetch, renderer: await getRenderer(), signal: controller.signal })
      executed += 1
    } catch (error) {
      console.error(`[monitor-worker] task ${lease.taskId} (${lease.kind}) crashed:`, error)
    } finally {
      clearInterval(watchdog)
      running.delete(lease.taskId)
    }
  }

  async function slot(index: number) {
    let idleRounds = 0
    while (!stopping) {
      let lease: Lease | null = null
      try {
        const kinds = !options.fetch && process.env.MONITOR_PIPELINE_ENABLED !== 'true' ? EXECUTABLE_KINDS.filter(k => ['CHECK_SOURCE', 'REFRESH_URL_INDEX', 'HOUSEKEEPING', 'DISCOVER_SITE'].includes(k)) : EXECUTABLE_KINDS
        lease = await claimNextTask({ owner: `${workerId}#${index}`, kinds })
      } catch (error) {
        console.error('[monitor-worker] claim failed:', error instanceof Error ? error.message : error)
      }
      if (!lease) {
        if (options.once) return
        idleRounds += 1
        // Idle time is when queued alerts go out.
        if (index === 0 && idleRounds % 6 === 1) await dispatchPendingEvents().catch(() => undefined)
        await sleep(pollMs)
        continue
      }
      idleRounds = 0
      await runOne(lease)
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, (_, index) => slot(index)))
  } finally {
    stopping = true
    clearInterval(heartbeatTimer)
    await beat()
    if (renderer) await renderer.close()
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
  return { executed }
}
