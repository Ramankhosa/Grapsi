import { prisma } from '@/lib/prisma'

import { EXECUTABLE_KINDS, executeTask } from './execute'
import { PRIORITY, claimNextTask, enqueueTask, operationKeys } from './queue'
import { defaultSafeFetch } from './safeFetch'
import { adaptiveCadenceDays, cadenceDays, nextCheckAt, startOfIstDay } from './schedule'
import { ensureSiteForUrl } from './sites'
import { utc } from './sqlTime'
import { recoverAttempts } from './budget'
import { reconcileHandoffs } from './handoff'
import { reconcileParkedSites } from './skipRules'

/**
 * Turning due watch points into queued checks.
 *
 * The planner only enqueues; the worker does the fetching. Each due source
 * advances its `check_generation` and `next_check_at` with a compare-and-set,
 * so two planners racing over the same source enqueue one occurrence, and the
 * check's operation key (`check:<source>:<generation>`) makes the enqueue
 * itself idempotent.
 */

export interface PlanCounts {
  due: number
  enqueued: number
  sitesAttached: number
  urlIndexQueued: boolean
}

export async function planDueChecks(now = new Date(), limit = 500): Promise<PlanCounts> {
  const counts: PlanCounts = { due: 0, enqueued: 0, sitesAttached: 0, urlIndexQueued: false }

  // Sources created while the legacy engine ran have no site yet.
  const orphans = await prisma.monitoredSource.findMany({ where: { site_id: null }, select: { id: true, url: true }, take: 200 })
  for (const orphan of orphans) {
    try {
      const site = await ensureSiteForUrl(orphan.url, null)
      await prisma.monitoredSource.update({ where: { id: orphan.id }, data: { site_id: site.id } })
      counts.sitesAttached += 1
    } catch (error) {
      console.error(`[monitor] could not attach a site to source ${orphan.id}:`, error instanceof Error ? error.message : error)
    }
  }

  const due = await prisma.monitoredSource.findMany({
    where: {
      status: 'ACTIVE',
      site: { status: 'ACTIVE' },
      OR: [{ next_check_at: null }, { next_check_at: { lte: now } }],
    },
    orderBy: { next_check_at: { sort: 'asc', nulls: 'first' } },
    select: { id: true, site_id: true, frequency_minutes: true, priority: true, quiet_streak: true },
    take: limit,
  })
  counts.due = due.length

  for (const source of due) {
    const next = nextCheckAt(now, adaptiveCadenceDays(cadenceDays(source.frequency_minutes), source.quiet_streak, source.priority), source.id)
    const enqueued = await prisma.$transaction(async (tx) => {
      const advanced = await tx.$queryRaw<Array<{ check_generation: number }>>`
        UPDATE "monitored_sources"
        SET "check_generation" = "check_generation" + 1, "next_check_at" = ${utc(next)}
        WHERE "id" = ${source.id} AND "status" = 'ACTIVE'
          AND ("next_check_at" IS NULL OR "next_check_at" <= ${utc(now)})
        RETURNING "check_generation"
      `
      if (advanced.length === 0) return false
      const generation = advanced[0].check_generation
      const result = await enqueueTask(tx, {
        kind: 'CHECK_SOURCE',
        operationKey: operationKeys.check(source.id, generation),
        payload: { sourceId: source.id, generation },
        priority: source.priority === 'HIGH' ? PRIORITY.NORMAL - 20 : source.priority === 'LOW' ? PRIORITY.BACKGROUND : PRIORITY.NORMAL,
        siteId: source.site_id,
        sourceId: source.id,
      })
      return result.created
    })
    if (enqueued) counts.enqueued += 1
  }

  // Don't-visit marks that expired: give back the visits they paused.
  await reconcileParkedSites(prisma, now)

  // Hourly URL-key refresh; one full re-read a day at 02:00 IST.
  const hourSlot = now.toISOString().slice(0, 13)
  const istHour = Math.floor((now.getTime() - startOfIstDay(now).getTime()) / 3_600_000)
  const index = await enqueueTask(prisma, {
    kind: 'REFRESH_URL_INDEX',
    operationKey: operationKeys.urlIndex(hourSlot),
    payload: { full: istHour === 2 },
    priority: PRIORITY.BACKGROUND,
    maxAttempts: 3,
  })
  counts.urlIndexQueued = index.created
  if (process.env.MONITOR_PIPELINE_ENABLED === 'true') {
    await recoverAttempts(now)
    await reconcileHandoffs()
    await prisma.monitorOpportunity.updateMany({ where: { review_state: 'SNOOZED', snoozed_until: { lte: now } }, data: { review_state: 'PENDING', snoozed_until: null, review_revision: { increment: 1 } } })
    const siteCursor = (await prisma.monitorSyncCursor.findUnique({ where: { name: 'discovery-planner' } }))?.cursor as { after?: string } | undefined
    const sites = await prisma.monitorSite.findMany({ where: { status: 'ACTIVE', ...(siteCursor?.after ? { id: { gt: siteCursor.after } } : {}) }, take: 500, orderBy: { id: 'asc' } })
    // One bounded exploration occurrence per site/week. Daily listing checks
    // remain independent, even on quiet sites.
    const week = Math.floor(now.getTime() / (7 * 86400_000))
    for (const site of sites) await enqueueTask(prisma, { kind: 'DISCOVER_SITE', operationKey: `discover-week:${site.id}:${week}`, siteId: site.id, payload: { siteId: site.id }, priority: 230 })
    await prisma.monitorSyncCursor.upsert({ where: { name: 'discovery-planner' }, create: { name: 'discovery-planner', cursor: { after: sites.length === 500 ? sites[499].id : '' } }, update: { cursor: { after: sites.length === 500 ? sites[499].id : '' } } })
    const resources = await prisma.monitorResource.findMany({ where: { site: { status: 'ACTIVE' }, revisit_policy: { not: 'NONE' }, next_revisit_at: { lte: now } }, take: 200, orderBy: { next_revisit_at: 'asc' } })
    for (const resource of resources) await prisma.$transaction(async tx => {
      const changed = await tx.monitorResource.updateMany({ where: { id: resource.id, revisit_generation: resource.revisit_generation }, data: { revisit_generation: { increment: 1 }, next_revisit_at: new Date(now.getTime() + 3 * 86400_000) } })
      if (changed.count) await enqueueTask(tx, { kind: 'REVISIT', operationKey: operationKeys.revisit(resource.id, resource.revisit_generation + 1), siteId: resource.site_id, resourceId: resource.id, payload: { resourceId: resource.id } })
    })
  }

  // Retention, once per IST day.
  const istDay = new Date(startOfIstDay(now).getTime() + 6 * 3_600_000).toISOString().slice(0, 10)
  await enqueueTask(prisma, {
    kind: 'HOUSEKEEPING',
    operationKey: operationKeys.housekeeping(istDay),
    payload: {},
    priority: PRIORITY.BACKGROUND,
    maxAttempts: 3,
  })
  return counts
}

/** "Check now": a new occurrence of the source, ahead of the scheduled ones. */
export async function requestCheckNow(sourceId: string): Promise<{ taskId: string | null; generation: number }> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.monitoredSource.findUnique({ where: { id: sourceId }, select: { id: true, url: true, site_id: true } })
    if (!source) throw new Error('Source not found')
    let siteId = source.site_id
    if (!siteId) {
      const site = await ensureSiteForUrl(source.url, null, tx)
      siteId = site.id
    }
    const updated = await tx.monitoredSource.update({
      where: { id: sourceId },
      data: { check_generation: { increment: 1 }, site_id: siteId },
      select: { check_generation: true },
    })
    const result = await enqueueTask(tx, {
      kind: 'CHECK_SOURCE',
      operationKey: operationKeys.check(sourceId, updated.check_generation),
      payload: { sourceId, generation: updated.check_generation, requested: true },
      priority: PRIORITY.CHECK_NOW,
      siteId,
      sourceId,
    })
    return { taskId: result.id, generation: updated.check_generation }
  })
}

/** Freshest worker heartbeat age in ms, or null when no worker ever beat. */
export async function freshestWorkerAgeMs(now = Date.now()): Promise<number | null> {
  const latest = await prisma.monitorWorkerHeartbeat.findFirst({ orderBy: { last_beat_at: 'desc' } })
  return latest ? now - latest.last_beat_at.getTime() : null
}

export const WORKER_STALE_MS = 15 * 60 * 1000

/**
 * Fallback when no worker is alive: drain plain-fetch checks inside the sweep
 * request, through the same claim and host reservations as the worker. It
 * never renders (no browser in the web process) and stops at its budget.
 */
export async function drainInline(options: { budgetMs: number; owner: string }): Promise<{ executed: number }> {
  const started = Date.now()
  let executed = 0
  while (Date.now() - started < options.budgetMs) {
    const lease = await claimNextTask({ owner: options.owner, kinds: EXECUTABLE_KINDS.filter((kind) => kind === 'CHECK_SOURCE') })
    if (!lease) break
    await executeTask(lease, { fetch: defaultSafeFetch(), renderer: null })
    executed += 1
  }
  return { executed }
}
