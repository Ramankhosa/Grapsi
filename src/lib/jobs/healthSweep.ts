/**
 * Telling somebody when a scheduled job has gone quiet.
 *
 * Every sweep in this codebase records its own runs, and nothing has ever read
 * those records back except a human opening the console. That is how production
 * ran for months with a scheduler that had never started: the evidence existed,
 * and no one was looking at it.
 *
 * This closes half of that. The console's own staleness badge closes the other
 * half, and the two are deliberately separate because they catch different
 * failures: the badge needs nothing to be running, so it shows a scheduler that
 * never started; this sweep needs the scheduler alive, so it catches one job
 * failing while the rest are fine. Neither alone is enough.
 *
 * Rate-limited by looking for its own earlier notice rather than by a new table.
 * A stale job stays stale, and an hourly sweep must not say so hourly.
 */
import { notifyQuietly } from '@/lib/notifications/notificationService'
import prisma from '@/lib/prisma'

import { JOB_REGISTRY, jobHealth, type JobHealth } from './registry'

/** Prefix on every notice this writes, which is also how it finds its own. */
export const JOB_HEALTH_NOTICE_PREFIX = 'Scheduled job'

/** How long a notice about one job suppresses the next about that same job. */
const QUIET_HOURS = 24

export interface JobHealthResult {
  checked: number
  ok: number
  stale: number
  never: number
  noticesSent: number
  suppressed: number
  /** Job keys currently unhealthy, for the sweep's own response body. */
  unhealthy: string[]
}

function noticeTitle(label: string, health: JobHealth) {
  return `${JOB_HEALTH_NOTICE_PREFIX} ${health === 'never' ? 'has never run' : 'is overdue'}: ${label}`
}

/**
 * Who hears about a dead job.
 *
 * Platform administrators, not the tenant. A sweep stopping is a platform
 * failure even when its symptoms show up inside one tenant, and telling a
 * university's admin that a cron job is late would be noise they cannot act on.
 */
async function platformRecipients(): Promise<Array<{ id: string; tenantId: string }>> {
  const users = await prisma.user.findMany({
    where: { roles: { hasSome: ['SUPER_ADMIN'] }, tenantId: { not: null } },
    select: { id: true, tenantId: true },
    take: 20,
  })
  return users.flatMap((user) => (user.tenantId ? [{ id: user.id, tenantId: user.tenantId }] : []))
}

export async function sweepJobHealth(
  options: { now?: Date } = {}
): Promise<JobHealthResult> {
  const now = options.now ?? new Date()
  const result: JobHealthResult = {
    checked: 0,
    ok: 0,
    stale: 0,
    never: 0,
    noticesSent: 0,
    suppressed: 0,
    unhealthy: [],
  }

  const quietSince = new Date(now.getTime() - QUIET_HOURS * 3600_000)
  let recipients: Array<{ id: string; tenantId: string }> | null = null

  for (const job of JOB_REGISTRY) {
    result.checked += 1

    const lastSuccess = await prisma.jobRun.findFirst({
      where: { job_key: job.jobKey, status: 'succeeded' },
      orderBy: { started_at: 'desc' },
      select: { started_at: true },
    })

    const health = jobHealth(job, lastSuccess?.started_at ?? null)
    if (health === 'ok') {
      result.ok += 1
      continue
    }
    result[health] += 1
    result.unhealthy.push(job.jobKey)

    const title = noticeTitle(job.label, health)
    const alreadySaid = await prisma.notification.findFirst({
      where: { title, created_at: { gte: quietSince } },
      select: { id: true },
    })
    if (alreadySaid) {
      result.suppressed += 1
      continue
    }

    // Resolved once, and only if something is actually wrong — the healthy path
    // should cost nothing beyond the run lookups.
    if (!recipients) recipients = await platformRecipients()
    if (recipients.length === 0) continue

    const lastWord = lastSuccess
      ? `Last succeeded ${new Date(lastSuccess.started_at).toISOString().slice(0, 16).replace('T', ' ')}.`
      : 'There is no record of it ever succeeding.'

    // Grouped by tenant because Notification is tenant-scoped, and a platform
    // account may sit in any of them.
    const byTenant = new Map<string, string[]>()
    for (const person of recipients) {
      const existing = byTenant.get(person.tenantId)
      if (existing) existing.push(person.id)
      else byTenant.set(person.tenantId, [person.id])
    }

    for (const [tenantId, userIds] of byTenant) {
      try {
        await notifyQuietly({
          tenantId,
          userIds,
          title,
          body: `${job.description}\n\n${lastWord} Expected about every ${job.expectedIntervalMinutes} minutes (${job.cadence}). Check that the scheduler process is running.`,
          category: 'ANNOUNCEMENT',
          linkUrl: '/super-admin/jobs',
        })
        result.noticesSent += 1
      } catch (error) {
        console.warn(`[JOB-HEALTH] notice for ${job.jobKey} failed`, error)
      }
    }
  }

  return result
}
