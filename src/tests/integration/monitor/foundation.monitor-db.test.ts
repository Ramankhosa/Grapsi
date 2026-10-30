import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { CHECK_LIMITS } from '@/lib/monitor/checkSource'
import { MonitorFetchError } from '@/lib/monitor/errors'
import { databaseHostPacer } from '@/lib/monitor/hostPacing'
import { planDueChecks, requestCheckNow } from '@/lib/monitor/planner'
import {
  LeaseLostError,
  PRIORITY,
  claimNextTask,
  completeTask,
  enqueueTask,
  heartbeat,
  operationKeys,
  withFence,
} from '@/lib/monitor/queue'
import type { SafeFetch, SafeFetchOptions, SafeFetchResult } from '@/lib/monitor/safeFetch'
import { findOwnersByKeys } from '@/lib/monitor/urlKeys'
import { identifyUrl } from '@/lib/monitor/urlIdentity'
import { runSourceMonitorWorker } from '@/lib/monitor/worker'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/**
 * Source Watch foundation, against a real database. Named after the exit
 * gates in the plan; the network is a fixture fetcher, never localhost.
 */

type Page = string | { status?: number; body?: string; etag?: string; contentType?: string; throws?: Error }

function fakeFetch(pages: Record<string, Page>) {
  const calls: Array<{ url: string; options?: SafeFetchOptions }> = []
  const fetch: SafeFetch = async (url, options) => {
    calls.push({ url, options })
    const page = pages[url]
    if (page === undefined) throw new MonitorFetchError('HTTP_STATUS', `404 ${url}`, { httpStatus: 404 })
    const spec = typeof page === 'string' ? { body: page } : page
    if (spec.throws) throw spec.throws
    const ifNoneMatch = options?.headers?.['if-none-match']
    if (spec.etag && ifNoneMatch === spec.etag) {
      return result(url, { status: 304, body: Buffer.alloc(0), contentType: '', notModified: true, etag: spec.etag })
    }
    return result(url, {
      status: spec.status ?? 200,
      body: Buffer.from(spec.body ?? ''),
      contentType: spec.contentType ?? 'text/html; charset=utf-8',
      notModified: false,
      etag: spec.etag,
    })
  }
  return { fetch, calls }
}

function result(
  url: string,
  r: { status: number; body: Buffer; contentType: string; notModified: boolean; etag?: string }
): SafeFetchResult {
  const kind = r.contentType.includes('xml') ? 'xml' : r.contentType.includes('html') ? 'html' : 'binary'
  return {
    requestedUrl: url,
    finalUrl: url,
    status: r.status,
    headers: { 'content-type': r.contentType, ...(r.etag ? { etag: r.etag } : {}) },
    body: r.body,
    byteLength: r.body.length,
    truncated: false,
    contentType: r.contentType,
    contentKind: r.notModified ? 'binary' : kind,
    notModified: r.notModified,
    redirects: [],
    tlsExceptionUsed: false,
  }
}

function listing(items: Array<[string, string]>, next?: string, wrapperId = 'calls'): string {
  const rows = items.map(([href, text]) => `<li><a href="${href}">${text}</a> — last date 30/11/2026</li>`).join('')
  return `<html><body><main><ul id="${wrapperId}">${rows}</ul>${next ? `<a rel="next" href="${next}">Next</a>` : ''}</main></body></html>`
}

async function makeSource(host: string, path = '/calls', extra: Record<string, unknown> = {}) {
  const site = await db.monitorSite.create({ data: { host, status: 'ACTIVE', origin: 'MANUAL', min_delay_ms: 0 } })
  const source = await db.monitoredSource.create({
    data: {
      name: host,
      url: `https://${host}${path}`,
      site_id: site.id,
      next_check_at: new Date(Date.now() - 60_000),
      fetch_mode: 'FETCH',
      ...extra,
    },
  })
  return { site, source }
}

/** Run the real worker loop until nothing runnable is left. */
async function drain(fetch: SafeFetch) {
  return runSourceMonitorWorker({ once: true, concurrency: 1, fetch, renderer: null, workerId: 'test-worker' })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The DB pacer is exercised on its own below; checks here use a 0 ms delay.
const ORIGINAL_LIMITS = { ...CHECK_LIMITS }

beforeAll(async () => {
  await resetMonitorTables()
})

beforeEach(async () => {
  Object.assign(CHECK_LIMITS, ORIGINAL_LIMITS)
  await db.monitorTask.deleteMany()
  await db.monitorOperationTombstone.deleteMany()
})

afterAll(async () => {
  await resetMonitorTables()
  await db.$disconnect()
})

describe('occurrences and keys', () => {
  it('two unchanged scheduled checks both execute their fetch', async () => {
    const { source } = await makeSource('two-checks.example')
    const { fetch, calls } = fakeFetch({
      [source.url]: listing([
        ['/calls/a', 'Call A'],
        ['/calls/b', 'Call B'],
      ]),
    })

    expect((await planDueChecks()).enqueued).toBe(1)
    await drain(fetch)
    await db.monitoredSource.update({ where: { id: source.id }, data: { next_check_at: new Date(Date.now() - 1000) } })
    expect((await planDueChecks()).enqueued).toBe(1)
    await drain(fetch)

    expect(calls.filter((call) => call.url === source.url)).toHaveLength(2)
    const runs = await db.monitorCheckRun.findMany({ where: { source_id: source.id }, orderBy: { check_generation: 'asc' } })
    expect(runs.map((run) => [run.check_generation, run.status, run.new_resources])).toEqual([
      [1, 'COMPLETE', 2],
      [2, 'COMPLETE', 0],
    ])
  })

  it('two planners racing over one due source enqueue one occurrence', async () => {
    const { source } = await makeSource('race.example')
    const [a, b] = await Promise.all([planDueChecks(), planDueChecks()])
    expect(a.enqueued + b.enqueued).toBe(1)
    expect(await db.monitorTask.count({ where: { source_id: source.id } })).toBe(1)
  })

  it('an enqueue is idempotent, and a completed key stays done after its row is pruned', async () => {
    const input = { kind: 'REFRESH_URL_INDEX' as const, operationKey: 'url-index:test-slot', payload: {} }
    expect((await enqueueTask(db, input)).created).toBe(true)
    expect((await enqueueTask(db, input)).created).toBe(false)
    const lease = await claimNextTask({ owner: 'test' })
    expect(lease?.operationKey).toBe('url-index:test-slot')
    await completeTask(lease!, { ok: true })
    await db.monitorTask.deleteMany({ where: { operation_key: 'url-index:test-slot' } })
    expect((await enqueueTask(db, input)).created).toBe(false)
    expect(await db.monitorTask.count({ where: { operation_key: 'url-index:test-slot' } })).toBe(0)
  })
})

describe('leases and fencing', () => {
  it('a worker whose lease was reclaimed commits nothing', async () => {
    await enqueueTask(db, { kind: 'REFRESH_URL_INDEX', operationKey: 'url-index:fence', payload: {} })
    const stale = await claimNextTask({ owner: 'slow-worker', leaseMs: 1 })
    expect(stale).not.toBeNull()
    await sleep(30)
    const fresh = await claimNextTask({ owner: 'other-worker' })
    expect(fresh?.taskId).toBe(stale!.taskId)
    expect(fresh!.generation).toBe(stale!.generation + 1)

    await expect(
      withFence(stale!, async (tx) => {
        await tx.monitorSite.create({ data: { host: 'must-not-exist.example' } })
      })
    ).rejects.toBeInstanceOf(LeaseLostError)
    expect(await db.monitorSite.count({ where: { host: 'must-not-exist.example' } })).toBe(0)
    expect(await heartbeat(stale!)).toBe(false)
    await expect(completeTask(stale!, {})).rejects.toBeInstanceOf(LeaseLostError)

    await completeTask(fresh!, { ok: true })
    expect((await db.monitorTask.findUnique({ where: { id: fresh!.taskId } }))?.status).toBe('DONE')
  })

  it('runs one task per site at a time', async () => {
    const { site } = await makeSource('one-at-a-time.example')
    const other = await makeSource('other-site.example')
    for (const n of [1, 2]) {
      await enqueueTask(db, { kind: 'CHECK_SOURCE', operationKey: `check:x:${n}`, payload: {}, siteId: site.id })
    }
    await enqueueTask(db, { kind: 'CHECK_SOURCE', operationKey: 'check:y:1', payload: {}, siteId: other.site.id, priority: 150 })

    const first = await claimNextTask({ owner: 'w1' })
    const second = await claimNextTask({ owner: 'w2' })
    expect(first?.siteId).toBe(site.id)
    expect(second?.siteId).toBe(other.site.id)
    expect(await claimNextTask({ owner: 'w3' })).toBeNull()
  })

  it('automatic extraction runs ahead of an aged screening backlog', async () => {
    const { site } = await makeSource('aged-backlog.example')
    const other = await makeSource('extract-site.example')
    const aged = await enqueueTask(db, { kind: 'TRIAGE', operationKey: 'triage:aged', payload: {}, siteId: site.id, priority: 80 })
    const sevenHoursAgo = new Date(Date.now() - 7 * 3_600_000)
    await db.monitorTask.update({ where: { id: aged.id! }, data: { created_at: sevenHoursAgo, available_at: sevenHoursAgo } })
    await enqueueTask(db, { kind: 'EXTRACT', operationKey: 'extract:fresh', payload: {}, siteId: other.site.id, priority: PRIORITY.EXTRACT })
    expect((await claimNextTask({ owner: 'w1' }))?.kind).toBe('EXTRACT')
    expect((await claimNextTask({ owner: 'w2' }))?.kind).toBe('TRIAGE')
  })

  it('concurrent claimers never run two tasks of one site at once', async () => {
    for (let round = 0; round < 5; round += 1) {
      await db.monitorTask.deleteMany()
      const site = await db.monitorSite.create({ data: { host: `race-claim-${round}.example` } })
      for (let n = 0; n < 4; n += 1) {
        await enqueueTask(db, { kind: 'CHECK_SOURCE', operationKey: `check:race-${round}:${n}`, payload: {}, siteId: site.id })
      }
      const leases = await Promise.all(Array.from({ length: 6 }, (_, i) => claimNextTask({ owner: `w${i}` })))
      expect(leases.filter(Boolean)).toHaveLength(1)
      expect(await db.monitorTask.count({ where: { site_id: site.id, status: 'RUNNING' } })).toBe(1)
    }
  })

  it('housekeeping prunes old finished work but never pinned evidence or live keys', async () => {
    const { runHousekeeping } = await import('@/lib/monitor/housekeeping')
    const old = new Date(Date.now() - 60 * 86_400_000)
    await db.monitorTask.create({
      data: { kind: 'REFRESH_URL_INDEX', operation_key: 'old-done', payload: {}, status: 'DONE', finished_at: old },
    })
    await db.monitorOperationTombstone.create({ data: { operation_key: 'old-done', kind: 'REFRESH_URL_INDEX', completed_at: old } })
    const site = await db.monitorSite.create({ data: { host: 'retention.example' } })
    const resource = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'https://retention.example/a' } })
    for (let i = 0; i < 14; i += 1) {
      await db.monitorResourceVersion.create({
        data: { resource_id: resource.id, raw_hash: `h${i}`, meaningful_hash: `m${i}`, fetched_at: new Date(Date.now() - (20 - i) * 60_000), pin_refcount: i === 0 ? 1 : 0 },
      })
    }
    await enqueueTask(db, { kind: 'HOUSEKEEPING', operationKey: 'housekeeping:test', payload: {} })
    const lease = await claimNextTask({ owner: 'hk', kinds: ['HOUSEKEEPING'] })
    await runHousekeeping(lease!)

    expect(await db.monitorTask.count({ where: { operation_key: 'old-done' } })).toBe(0)
    // 60 days is inside the 180-day tombstone window: the key stays done.
    expect(await db.monitorOperationTombstone.count({ where: { operation_key: 'old-done' } })).toBe(1)
    const kept = await db.monitorResourceVersion.findMany({ where: { resource_id: resource.id } })
    expect(kept).toHaveLength(11) // newest 10 + the pinned oldest
    expect(kept.some((v) => v.raw_hash === 'h0')).toBe(true)
  })
})

describe('identity and observation', () => {
  it('two watch points that link one call share one resource, each with its own observation', async () => {
    const { site, source: calls } = await makeSource('shared.example', '/calls')
    const news = await db.monitoredSource.create({
      data: { name: 'news', url: 'https://shared.example/news', site_id: site.id, next_check_at: new Date(0), fetch_mode: 'FETCH' },
    })
    const { fetch } = fakeFetch({
      [calls.url]: listing([['/calls/shared-call?utm_source=calls', 'Shared call']]),
      [news.url]: listing([['https://shared.example/calls/shared-call', 'Shared call announced']]),
    })
    await planDueChecks()
    await drain(fetch)

    const key = identifyUrl('https://shared.example/calls/shared-call')!.dedupKey
    const resources = await db.monitorResource.findMany({ where: { site_id: site.id, dedup_key: key }, include: { observations: true } })
    expect(resources).toHaveLength(1)
    expect(resources[0].observations.map((obs) => obs.source_id).sort()).toEqual([calls.id, news.id].sort())
  })

  it('a 304 refreshes validation without a new version', async () => {
    const { source } = await makeSource('etag.example')
    const pages = { [source.url]: { body: listing([['/calls/a', 'Call for proposals A']]), etag: '"v1"' } }
    const { fetch } = fakeFetch(pages)
    await planDueChecks()
    await drain(fetch)
    await requestCheckNow(source.id)
    await drain(fetch)

    const runs = await db.monitorCheckRun.findMany({ where: { source_id: source.id }, orderBy: { check_generation: 'asc' } })
    expect(runs.map((run) => run.status)).toEqual(['COMPLETE', 'NOT_MODIFIED'])
    const listingResource = await db.monitorResource.findFirst({ where: { role: 'LISTING', canonical_url: source.url } })
    expect(listingResource?.last_validation_status).toBe('NOT_MODIFIED')
    expect(await db.monitorResourceVersion.count({ where: { resource_id: listingResource!.id } })).toBe(1)
  })
})

describe('coverage: limits defer, they never drop', () => {
  it('a paginated listing continues across checks, and only a complete pass marks absence', async () => {
    CHECK_LIMITS.pagesPerCheck = 3
    CHECK_LIMITS.headPages = 1
    const { source } = await makeSource('paged.example', '/list')
    const pageUrl = (n: number) => (n === 1 ? source.url : `https://paged.example/list?page=${n}`)
    const pages: Record<string, Page> = {}
    const build = (omit?: string) => {
      for (let n = 1; n <= 6; n += 1) {
        const items: Array<[string, string]> = [
          [`/calls/${n}-a`, `Call ${n}a`],
          [`/calls/${n}-b`, `Call ${n}b`],
        ]
        pages[pageUrl(n)] = listing(items.filter(([href]) => href !== omit), n < 6 ? pageUrl(n + 1) : undefined)
      }
    }
    build()
    const { fetch } = fakeFetch(pages)
    const check = async () => {
      await requestCheckNow(source.id)
      await drain(fetch)
      await sleep(5)
      return db.monitoredSource.findUnique({ where: { id: source.id } })
    }

    // Pass 1: p1-p3, then p1+p4+p5, then p1+p6 → complete.
    let state = await check()
    expect((state!.cursor as { nextUrl?: string })?.nextUrl).toBe(pageUrl(4))
    state = await check()
    expect((state!.cursor as { nextUrl?: string })?.nextUrl).toBe(pageUrl(6))
    state = await check()
    // The pass is over (no resume point) but the topology is remembered.
    expect(state!.cursor).toEqual({ headNextUrl: pageUrl(2) })
    expect(state!.last_complete_check_at).not.toBeNull()
    expect(await db.monitorObservation.count({ where: { source_id: source.id } })).toBe(12)

    // Item 2-b disappears. A partial pass must not call it gone…
    build('/calls/2-b')
    await check()
    const missingAfterPartial = await db.monitorObservation.count({ where: { source_id: source.id, missing_since: { not: null } } })
    expect(missingAfterPartial).toBe(0)

    // …the complete pass does.
    await check()
    await check()
    const missing = await db.monitorObservation.findMany({
      where: { source_id: source.id, missing_since: { not: null } },
      include: { resource: true },
    })
    expect(missing.map((obs) => obs.resource.canonical_url)).toEqual(['https://paged.example/calls/2-b'])

    const statuses = (await db.monitorCheckRun.findMany({ where: { source_id: source.id }, orderBy: { check_generation: 'asc' } })).map(
      (run) => run.status
    )
    expect(statuses).toEqual(['PARTIAL', 'PARTIAL', 'COMPLETE', 'PARTIAL', 'PARTIAL', 'COMPLETE'])
  })

  it('a sitemap index over the per-check cap reaches its later segments', async () => {
    CHECK_LIMITS.sitemapEntriesPerCheck = 4
    const { source } = await makeSource('sitemap.example', '/sitemap.xml', { kind: 'SITEMAP' })
    const child = (n: number) => `https://sitemap.example/sitemap-${n}.xml`
    const urlset = (n: number) =>
      `<urlset>${[1, 2, 3].map((i) => `<url><loc>https://sitemap.example/s${n}/page-${i}</loc></url>`).join('')}</urlset>`
    const { fetch } = fakeFetch({
      [source.url]: { body: `<sitemapindex><sitemap><loc>${child(1)}</loc></sitemap><sitemap><loc>${child(2)}</loc></sitemap></sitemapindex>`, contentType: 'application/xml' },
      [child(1)]: { body: urlset(1), contentType: 'application/xml' },
      [child(2)]: { body: urlset(2), contentType: 'application/xml' },
    })
    await requestCheckNow(source.id)
    await drain(fetch)
    let state = await db.monitoredSource.findUnique({ where: { id: source.id } })
    expect(state!.cursor).toMatchObject({ sitemapQueue: [child(2)], entryOffset: 1 })

    await requestCheckNow(source.id)
    await drain(fetch)
    state = await db.monitoredSource.findUnique({ where: { id: source.id } })
    expect(state!.cursor).toBeNull()
    const pages = await db.monitorResource.count({ where: { site_id: source.site_id!, canonical_url: { contains: '/page-' } } })
    expect(pages).toBe(6)
  })

  it('a listing that suddenly shows nothing (a script-built page) is flagged, never a clean pass', async () => {
    const { source } = await makeSource('spa.example', '/calls', { fetch_mode: 'AUTO' })
    const pages: Record<string, Page> = { [source.url]: listing([['/calls/a', 'Call A'], ['/calls/b', 'Call B']]) }
    const { fetch } = fakeFetch(pages)
    await requestCheckNow(source.id)
    await drain(fetch)
    pages[source.url] = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'
    await requestCheckNow(source.id)
    await drain(fetch)

    const runs = await db.monitorCheckRun.findMany({ where: { source_id: source.id }, orderBy: { check_generation: 'asc' } })
    expect(runs.map((run) => run.status)).toEqual(['COMPLETE', 'PARTIAL'])
    expect(runs[1]).toMatchObject({ complete: false, error_class: 'NEEDS_BROWSER' })
    expect(await db.monitorObservation.count({ where: { source_id: source.id, missing_since: { not: null } } })).toBe(0)
  })

  it('a selector that stops matching is reported, and nothing is marked missing', async () => {
    const { source } = await makeSource('selector.example', '/calls', { selector: '#calls' })
    const pages: Record<string, Page> = { [source.url]: listing([['/calls/a', 'A'], ['/calls/b', 'B']]) }
    const { fetch } = fakeFetch(pages)
    await requestCheckNow(source.id)
    await drain(fetch)
    pages[source.url] = listing([['/calls/a', 'A']], undefined, 'renamed')
    await requestCheckNow(source.id)
    await drain(fetch)

    const runs = await db.monitorCheckRun.findMany({ where: { source_id: source.id }, orderBy: { check_generation: 'asc' } })
    expect(runs[1]).toMatchObject({ status: 'PARTIAL', complete: false, error_class: 'SELECTOR_NOT_MATCHED' })
    expect(await db.monitorObservation.count({ where: { source_id: source.id, missing_since: { not: null } } })).toBe(0)
    expect((await db.monitoredSource.findUnique({ where: { id: source.id } }))?.last_error).toContain('no longer matches')
  })
})

describe('failures and deferrals', () => {
  it('a deferral spends no attempt and never counts against the site', async () => {
    const { site, source } = await makeSource('cooldown.example')
    const retryAt = new Date(Date.now() + 60 * 60 * 1000)
    const { fetch } = fakeFetch({
      [source.url]: { throws: new MonitorFetchError('HOST_COOLDOWN', 'cooling down', { retryable: true, retryAt }) },
    })
    await requestCheckNow(source.id)
    await drain(fetch)

    const task = await db.monitorTask.findFirst({ where: { source_id: source.id } })
    expect(task).toMatchObject({ status: 'QUEUED', attempts: 0 })
    expect(Math.abs(task!.available_at.getTime() - retryAt.getTime())).toBeLessThan(1000)
    expect((await db.monitorCheckRun.findFirst({ where: { source_id: source.id } }))?.status).toBe('DEFERRED')
    expect((await db.monitorSite.findUnique({ where: { id: site.id } }))?.consecutive_fetch_failures).toBe(0)
  })

  it('consecutive fetch failures pause the site once, with one alert event', async () => {
    const { site, source } = await makeSource('failing.example')
    await db.monitorSite.update({ where: { id: site.id }, data: { consecutive_fetch_failures: 6 } })
    const { fetch } = fakeFetch({
      [source.url]: { throws: new MonitorFetchError('HTTP_STATUS', 'HTTP 503', { retryable: true, httpStatus: 503 }) },
    })
    await requestCheckNow(source.id)
    await drain(fetch)

    const after = await db.monitorSite.findUnique({ where: { id: site.id } })
    expect(after).toMatchObject({ status: 'PAUSED', consecutive_fetch_failures: 7 })
    expect(await db.monitorEvent.count({ where: { kind: 'SITE_PAUSED' } })).toBe(1)
    const task = await db.monitorTask.findFirst({ where: { source_id: source.id } })
    expect(task?.status).toBe('QUEUED') // retried with backoff, but the site is paused so it waits
    expect(await claimNextTask({ owner: 'w' })).toBeNull()
  })
})

describe('shared write guarantees', () => {
  it('the revision trigger bumps every update, so compare-and-set cannot be skipped or forged', async () => {
    const call = await db.fundingCall.create({
      data: { title: 'CAS test call', visibility: 'GLOBAL_PUBLISHED', createdByUserId: 'monitor-test', updatedByUserId: 'monitor-test' },
    })
    expect(call.revision).toBe(0)
    await db.fundingCall.update({ where: { id: call.id }, data: { title: 'Edited' } })
    expect((await db.fundingCall.findUnique({ where: { id: call.id } }))?.revision).toBe(1)

    const stale = await db.fundingCall.updateMany({ where: { id: call.id, revision: 0 }, data: { title: 'Stale write' } })
    expect(stale.count).toBe(0)
    const current = await db.fundingCall.updateMany({ where: { id: call.id, revision: 1 }, data: { title: 'Fresh write' } })
    expect(current.count).toBe(1)

    await db.fundingCall.update({ where: { id: call.id }, data: { revision: 99 } })
    expect((await db.fundingCall.findUnique({ where: { id: call.id } }))?.revision).toBe(3)
  })

  it('allows one open EXACT claim per scheme round', async () => {
    const site = await db.monitorSite.create({ data: { host: 'claims.example' } })
    const base = { site_id: site.id, scheme_key: 'dst:wos-a', round_key: '2026', match_confidence: 'EXACT', review_state: 'PENDING' }
    const first = await db.monitorOpportunity.create({ data: base })
    await expect(db.monitorOpportunity.create({ data: base })).rejects.toThrow()
    await db.monitorOpportunity.create({ data: { ...base, match_confidence: 'AMBIGUOUS' } })
    await db.monitorOpportunity.update({ where: { id: first.id }, data: { review_state: 'REJECTED' } })
    await expect(db.monitorOpportunity.create({ data: base })).resolves.toBeDefined()
  })

  it('host pacing is shared and atomic; a cooldown blocks the host', async () => {
    await databaseHostPacer.acquire('pace.example', 400)
    const started = Date.now()
    await databaseHostPacer.acquire('pace.example', 400)
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)

    await databaseHostPacer.cooldown('pace.example', new Date(Date.now() + 60_000), 'HTTP 429')
    await expect(databaseHostPacer.acquire('pace.example', 0)).rejects.toMatchObject({ code: 'HOST_COOLDOWN' })
  })

  it('the URL-key index follows catalog calls, including URLs a call drops', async () => {
    const call = await db.fundingCall.create({
      data: {
        title: 'Indexed call',
        visibility: 'GLOBAL_PUBLISHED',
        createdByUserId: 'monitor-test',
        updatedByUserId: 'monitor-test',
        source_url: 'https://dst.gov.in/callforproposals/nest?utm_source=x',
        official_urls: ['https://dst.gov.in/sites/default/files/NEST.pdf', 'https://onlinedst.gov.in/'],
      },
    })
    await enqueueTask(db, { kind: 'REFRESH_URL_INDEX', operationKey: operationKeys.urlIndex('test-a'), payload: { full: true } })
    await drain(fakeFetch({}).fetch)
    const nestKey = identifyUrl('https://dst.gov.in/callforproposals/nest')!.dedupKey
    const portalKey = identifyUrl('https://onlinedst.gov.in/')!.dedupKey
    expect((await findOwnersByKeys([nestKey])).map((o) => o.funding_call_id)).toEqual([call.id])
    expect(await findOwnersByKeys([portalKey])).toHaveLength(1)

    await db.fundingCall.update({ where: { id: call.id }, data: { official_urls: ['https://dst.gov.in/sites/default/files/NEST.pdf'] } })
    await enqueueTask(db, { kind: 'REFRESH_URL_INDEX', operationKey: operationKeys.urlIndex('test-b'), payload: {} })
    await drain(fakeFetch({}).fetch)
    expect(await findOwnersByKeys([portalKey])).toHaveLength(0)
    expect(await findOwnersByKeys([nestKey])).toHaveLength(1)
  })
})
