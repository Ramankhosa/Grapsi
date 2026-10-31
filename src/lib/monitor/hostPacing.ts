import { prisma } from '@/lib/prisma'

import { MonitorFetchError } from './errors'
import { NOW_UTC, msInterval, utc } from './sqlTime'

/**
 * Politeness per DESTINATION host. Every request — listing pages, documents on
 * a CDN, a redirect hop to a related portal, a browser navigation — takes a
 * slot here first, and the slot lives in the database so the worker and the
 * sweep fallback share one rate per server.
 */
export interface HostPacer {
  /** Wait for this host's next slot, or throw HOST_BUSY / HOST_COOLDOWN. */
  acquire(host: string, minDelayMs: number, signal?: AbortSignal): Promise<void>
  /** Honour Retry-After / 429 / robots crawl-delay: nothing to `host` before `until`. */
  cooldown(host: string, until: Date, reason: string): Promise<void>
}

/** Longest a fetch will sit waiting for its slot before deferring the task. */
const MAX_WAIT_MS = 15_000
/** A cooldown can never be pushed further than this by one response. */
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new MonitorFetchError('ABORTED', 'Aborted while waiting for a host slot'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new MonitorFetchError('ABORTED', 'Aborted while waiting for a host slot'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export const databaseHostPacer: HostPacer = {
  async acquire(host, minDelayMs, signal) {
    const key = host.toLowerCase()
    const delay = Math.max(0, Math.round(minDelayMs))

    // Look before reserving: a host already booked far ahead defers the task
    // instead of piling another reservation onto the queue.
    const current = await prisma.monitorHostPacing.findUnique({ where: { host: key } })
    const now = Date.now()
    if (current?.cooldown_until && current.cooldown_until.getTime() > now) {
      throw new MonitorFetchError('HOST_COOLDOWN', `${key} asked us to wait (${current.cooldown_reason ?? 'cooldown'})`, {
        retryable: true,
        retryAt: current.cooldown_until,
      })
    }
    if (current && current.next_allowed_at.getTime() - now > MAX_WAIT_MS) {
      throw new MonitorFetchError('HOST_BUSY', `${key} is booked until ${current.next_allowed_at.toISOString()}`, {
        retryable: true,
        retryAt: current.next_allowed_at,
      })
    }

    // Atomic reservation: this request's slot starts at the later of now and
    // the host's next free slot, and the next slot moves `delay` past it.
    const rows = await prisma.$queryRaw<Array<{ slot_at: Date }>>`
      INSERT INTO "monitor_host_pacing" ("host", "next_allowed_at", "updated_at")
      VALUES (${key}, ${NOW_UTC} + ${msInterval(delay)}, ${NOW_UTC})
      ON CONFLICT ("host") DO UPDATE
        SET "next_allowed_at" = GREATEST("monitor_host_pacing"."next_allowed_at", ${NOW_UTC}) + ${msInterval(delay)},
            "updated_at" = ${NOW_UTC}
      RETURNING "next_allowed_at" - ${msInterval(delay)} AS slot_at
    `
    const slotAt = rows[0]?.slot_at?.getTime() ?? now
    const wait = slotAt - Date.now()
    if (wait > 0) await sleep(Math.min(wait, MAX_WAIT_MS), signal)
  },

  async cooldown(host, until, reason) {
    const key = host.toLowerCase()
    const capped = new Date(Math.min(until.getTime(), Date.now() + MAX_COOLDOWN_MS))
    await prisma.$executeRaw`
      INSERT INTO "monitor_host_pacing" ("host", "next_allowed_at", "cooldown_until", "cooldown_reason", "updated_at")
      VALUES (${key}, ${NOW_UTC}, ${utc(capped)}, ${reason}, ${NOW_UTC})
      ON CONFLICT ("host") DO UPDATE
        SET "cooldown_until" = GREATEST(COALESCE("monitor_host_pacing"."cooldown_until", ${utc(capped)}), ${utc(capped)}),
            "cooldown_reason" = ${reason},
            "updated_at" = ${NOW_UTC}
    `
  },
}

/** Parse Retry-After (seconds or HTTP date). Null when absent or unparsable. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return new Date(now + Number(trimmed) * 1000)
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? null : new Date(date)
}
