import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { approveImportRequest, importWebsites, type ImportRequest, type ImportWebsite } from '@/lib/monitor/catalogImport'
import { queueCandidates, triageCandidates, UNCHANGED_NEGATIVE_PREFIX } from '@/lib/monitor/candidates'
import { MonitorFetchError } from '@/lib/monitor/errors'
import { planDueChecks } from '@/lib/monitor/planner'
import { claimNextTask } from '@/lib/monitor/queue'
import type { SafeFetch } from '@/lib/monitor/safeFetch'
import { reconcileParkedSites, reconcileSkipRules, skipRuleKey } from '@/lib/monitor/skipRules'
import { runSourceMonitorWorker } from '@/lib/monitor/worker'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/**
 * The fixes from the 27 Oct 2026 design review of the pipeline UI, against a
 * real database: import approval, "don't visit" pause and restore, skips on
 * every scheduled fetch, and not re-analysing unchanged non-funding pages.
 */

let operator = ''
let admin = ''
beforeEach(async () => {
  await resetMonitorTables()
  // Watched pages record a real owner; these users exist only in the test database.
  const user = (email: string) => db.user.upsert({ where: { email }, create: { email }, update: {} })
  operator = (await user('review-operator@monitor.invalid')).id
  admin = (await user('review-admin@monitor.invalid')).id
})
afterAll(async () => {
  await resetMonitorTables()
  await db.$disconnect()
})

function html(body: string): SafeFetch {
  return async (url) => ({ requestedUrl: url, finalUrl: url, status: 200, headers: {}, body: Buffer.from(body), byteLength: Buffer.byteLength(body), truncated: false, contentKind: 'html', contentType: 'text/html', notModified: false, redirects: [], tlsExceptionUsed: false })
}

function pages(map: Record<string, string>) {
  const calls: string[] = []
  const fetch: SafeFetch = async (url) => {
    calls.push(url)
    const body = map[url]
    if (body === undefined) throw new MonitorFetchError('HTTP_STATUS', `404 ${url}`, { httpStatus: 404 })
    return { requestedUrl: url, finalUrl: url, status: 200, headers: {}, body: Buffer.from(body), byteLength: Buffer.byteLength(body), truncated: false, contentKind: 'html', contentType: 'text/html', notModified: false, redirects: [], tlsExceptionUsed: false }
  }
  return { fetch, calls }
}

const listing = (items: string[], next?: string) =>
  `<html><body><main><ul id="calls">${items.map((href) => `<li><a href="${href}">Research grant ${href}</a> — last date 30/11/2026</li>`).join('')}</ul>${next ? `<a rel="next" href="${next}">Next</a>` : ''}</main></body></html>`

function website(host: string, extra: Partial<ImportWebsite> = {}): ImportWebsite {
  return {
    host, watchUrl: `https://${host}/calls`, pageKind: 'PAGE', funderIds: [], officialWebsite: false, frequencyMinutes: 1440, priority: 'HIGH',
    relatedHosts: ['portal.other.invalid'], documentHosts: ['cdn.other.invalid'], keywords: '', excludeKeywords: '', fetchMode: 'AUTO', dailyBudgetUsd: 5, note: null,
    ...extra,
  }
}

describe('catalogue import approval', () => {
  it('a delegated operator brings a new site in as a request: nothing active, scope and budget untouched', async () => {
    const funder = await db.funder.create({ data: { name: 'Fixture Funder', normalized_name: 'fixture funder' } })
    const [result] = await importWebsites([website('new.invalid', { funderIds: [funder.id], officialWebsite: true })], { userId: operator, superAdmin: false })

    expect(result.status).toBe('PENDING_APPROVAL')
    const site = await db.monitorSite.findUniqueOrThrow({ where: { host: 'new.invalid' } })
    expect(site).toMatchObject({ status: 'SUGGESTED', related_hosts: [], attachment_hosts: [], daily_budget_micros: null, priority: 'NORMAL' })
    expect(site.pending_scope).toMatchObject({ relatedHosts: ['portal.other.invalid'], dailyBudgetUsd: 5, requestedBy: operator })
    expect((await db.monitorSiteFunder.findFirstOrThrow()).status).toBe('SUGGESTED')
    expect((await db.funder.findUniqueOrThrow({ where: { id: funder.id } })).website_url).toBeNull()
    expect(await db.monitorTask.count({ where: { kind: 'DISCOVER_SITE' } })).toBe(0)
    // The planner never schedules a check on a site that is not ACTIVE.
    expect((await planDueChecks(new Date())).due).toBe(0)
  })

  it('a delegated operator cannot reactivate a paused site or widen its scope', async () => {
    await db.monitorSite.create({ data: { host: 'paused.invalid', status: 'PAUSED', related_hosts: [], min_delay_ms: 0 } })
    await importWebsites([website('paused.invalid')], { userId: operator, superAdmin: false })
    const site = await db.monitorSite.findUniqueOrThrow({ where: { host: 'paused.invalid' } })
    expect(site).toMatchObject({ status: 'PAUSED', related_hosts: [], daily_budget_micros: null })
    expect(site.pending_scope).not.toBeNull()
  })

  it('a super admin approval applies the request once and clears it', async () => {
    const funder = await db.funder.create({ data: { name: 'Fixture Funder', normalized_name: 'fixture funder' } })
    await importWebsites([website('approve.invalid', { funderIds: [funder.id], officialWebsite: true })], { userId: operator, superAdmin: false })
    const pending = await db.monitorSite.findUniqueOrThrow({ where: { host: 'approve.invalid' } })
    await db.$transaction((tx) => approveImportRequest(tx, pending.id, pending.pending_scope as unknown as ImportRequest, admin))

    const site = await db.monitorSite.findUniqueOrThrow({ where: { id: pending.id } })
    expect(site).toMatchObject({ status: 'ACTIVE', priority: 'HIGH', related_hosts: ['portal.other.invalid'], attachment_hosts: ['cdn.other.invalid'], daily_budget_micros: 5_000_000n, pending_scope: null })
    expect((await db.monitorSiteFunder.findFirstOrThrow()).status).toBe('CONFIRMED')
    expect((await db.funder.findUniqueOrThrow({ where: { id: funder.id } })).website_url).toBe('https://approve.invalid/')
    expect(await db.monitorTask.count({ where: { kind: 'DISCOVER_SITE' } })).toBe(1)
  })

  it('a super admin import keeps the current budget unless one is asked for', async () => {
    await db.monitorSite.create({ data: { host: 'budget.invalid', status: 'ACTIVE', daily_budget_micros: 2_000_000n, min_delay_ms: 0 } })
    await importWebsites([website('budget.invalid', { dailyBudgetUsd: null })], { userId: admin, superAdmin: true })
    expect((await db.monitorSite.findUniqueOrThrow({ where: { host: 'budget.invalid' } })).daily_budget_micros).toBe(2_000_000n)
  })
})

describe("don't-visit marks pause and restore exactly what they stopped", () => {
  async function fixture() {
    const site = await db.monitorSite.create({ data: { host: 'marks.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
    const call = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'https://marks.invalid/archive/call', canonical_url: 'https://marks.invalid/archive/call', revisit_policy: 'LONG_TERM', next_revisit_at: new Date(Date.now() + 86400_000) } })
    // Stopped for an unrelated reason: a mark must never revive it.
    const retired = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'https://marks.invalid/archive/old', canonical_url: 'https://marks.invalid/archive/old', revisit_policy: 'NONE' } })
    return { site, call, retired }
  }
  const folder = (siteId: string, expires_at: Date | null = null) =>
    db.monitorSkipRule.create({ data: { site_id: siteId, url: 'https://marks.invalid/archive/', dedup_key: skipRuleKey('https://marks.invalid/archive/', 'FOLDER')!.dedupKey, match: 'FOLDER', expires_at } })

  it('removing the last mark restores the paused revisit with its original policy', async () => {
    const { site, call, retired } = await fixture()
    const rule = await folder(site.id)
    await reconcileSkipRules(db, site.id)
    expect(await db.monitorResource.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ revisit_policy: 'NONE', next_revisit_at: null, skip_paused_policy: 'LONG_TERM' })

    await db.monitorSkipRule.delete({ where: { id: rule.id } })
    const result = await reconcileSkipRules(db, site.id)
    expect(result.revisitsRestored).toBe(1)
    const restored = await db.monitorResource.findUniqueOrThrow({ where: { id: call.id } })
    expect(restored).toMatchObject({ revisit_policy: 'LONG_TERM', skip_paused_policy: null })
    expect(restored.next_revisit_at).not.toBeNull()
    expect(await db.monitorResource.findUniqueOrThrow({ where: { id: retired.id } })).toMatchObject({ revisit_policy: 'NONE', next_revisit_at: null, skip_paused_policy: null })
  })

  it('an expired mark is lifted by the planner pass, a still-active overlapping mark keeps the pause', async () => {
    const { site, call } = await fixture()
    const expiring = await folder(site.id, new Date(Date.now() + 1000))
    await db.monitorSkipRule.create({ data: { site_id: site.id, url: 'https://marks.invalid/archive/call', dedup_key: skipRuleKey('https://marks.invalid/archive/call', 'PAGE')!.dedupKey, match: 'PAGE' } })
    await reconcileSkipRules(db, site.id)
    await db.monitorSkipRule.update({ where: { id: expiring.id }, data: { expires_at: new Date(Date.now() - 1000) } })
    await reconcileParkedSites(db)
    expect((await db.monitorResource.findUniqueOrThrow({ where: { id: call.id } })).skip_paused_policy).toBe('LONG_TERM')

    await db.monitorSkipRule.deleteMany({ where: { match: 'PAGE' } })
    await reconcileParkedSites(db)
    expect((await db.monitorResource.findUniqueOrThrow({ where: { id: call.id } })).revisit_policy).toBe('LONG_TERM')
  })
})

describe('scheduled checks never fetch a marked page', () => {
  async function source(path: string) {
    const site = await db.monitorSite.create({ data: { host: 'checks.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
    const watch = await db.monitoredSource.create({ data: { name: 'checks', url: `https://checks.invalid${path}`, site_id: site.id, next_check_at: new Date(Date.now() - 60_000), fetch_mode: 'FETCH' } })
    return { site, watch }
  }
  const drain = (fetch: SafeFetch) => runSourceMonitorWorker({ once: true, concurrency: 1, fetch, renderer: null, workerId: 'review-worker' })

  it('records a SKIPPED run without a request or a failure when the watched page is marked', async () => {
    const { site, watch } = await source('/archive/calls')
    await db.monitorSkipRule.create({ data: { site_id: site.id, url: 'https://checks.invalid/archive/', dedup_key: skipRuleKey('https://checks.invalid/archive/', 'FOLDER')!.dedupKey, match: 'FOLDER' } })
    const { fetch, calls } = pages({})
    await planDueChecks(new Date())
    await drain(fetch)
    expect(calls).toEqual([])
    expect((await db.monitorCheckRun.findFirstOrThrow({ where: { source_id: watch.id } })).status).toBe('SKIPPED')
    expect((await db.monitoredSource.findUniqueOrThrow({ where: { id: watch.id } })).fail_count).toBe(0)
  })

  it('stops pagination at a marked page and never treats the pass as complete', async () => {
    const { site, watch } = await source('/calls')
    await db.monitorSkipRule.create({ data: { site_id: site.id, url: 'https://checks.invalid/calls/archive/', dedup_key: skipRuleKey('https://checks.invalid/calls/archive/', 'FOLDER')!.dedupKey, match: 'FOLDER' } })
    const { fetch, calls } = pages({
      'https://checks.invalid/calls': listing(['/calls/a', '/calls/b'], '/calls/archive/page-2'),
      'https://checks.invalid/calls/archive/page-2': listing(['/calls/c']),
    })
    await planDueChecks(new Date())
    await drain(fetch)
    expect(calls).toEqual(['https://checks.invalid/calls'])
    const run = await db.monitorCheckRun.findFirstOrThrow({ where: { source_id: watch.id } })
    expect(run).toMatchObject({ status: 'PARTIAL', complete: false })
  })

  it('a quiet listing builds a streak, and the planner stretches its interval', async () => {
    const { watch } = await source('/calls')
    const { fetch } = pages({ 'https://checks.invalid/calls': listing(['/calls/a', '/calls/b']) })
    for (let n = 0; n < 2; n += 1) {
      await db.monitoredSource.update({ where: { id: watch.id }, data: { next_check_at: new Date(Date.now() - 60_000) } })
      await planDueChecks(new Date())
      await drain(fetch)
    }
    expect((await db.monitoredSource.findUniqueOrThrow({ where: { id: watch.id } })).quiet_streak).toBe(1)

    await db.monitoredSource.update({ where: { id: watch.id }, data: { quiet_streak: 10, next_check_at: new Date(Date.now() - 60_000) } })
    const now = new Date()
    await planDueChecks(now)
    const next = (await db.monitoredSource.findUniqueOrThrow({ where: { id: watch.id } })).next_check_at!
    expect((next.getTime() - now.getTime()) / 86400_000).toBeGreaterThan(2.5)
  })
})

describe('an unchanged non-funding page is not analysed again', () => {
  const page = '<main><h1>Annual report</h1><p>The council published its annual report on research outputs, staff news and the new building opening, with thanks to partners.</p></main>'
  const paid = (verdict: string, confidence: number) =>
    vi.fn(async () => ({ text: JSON.stringify({ items: [{ id: 'RID', verdict, confidence, reason: 'Annual report; not a call', type: 'news' }] }).replace('RID', resourceId), model: 'fixture', actualMicros: 1n, attemptId: 'fixture', attemptNo: 1 }))
  let resourceId = ''

  async function triage(key: string, fetch: SafeFetch, model: ReturnType<typeof paid>) {
    const site = await db.monitorSite.findFirstOrThrow()
    await queueCandidates(db, site.id, [resourceId], false, key)
    const lease = await claimNextTask({ owner: 'review', kinds: ['TRIAGE'] })
    await triageCandidates(lease!, { fetch, paid: model })
  }

  it('skips every analysis while the text and title stay the same, and screens again after a change', async () => {
    const site = await db.monitorSite.create({ data: { host: 'report.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
    resourceId = (await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'https://report.invalid/report', canonical_url: 'https://report.invalid/report', title: 'Annual report' } })).id

    // Below the 0.9 confidence the older negative cache needs: only the new gate can skip it.
    const first = paid('NOT_FUNDING', 0.7)
    await triage('first', html(page), first)
    expect(first).toHaveBeenCalledTimes(1)

    const second = paid('NOT_FUNDING', 0.7)
    await triage('second', html(page), second)
    expect(second).not.toHaveBeenCalled()
    const gated = await db.monitorOpportunity.findFirstOrThrow()
    expect(gated.processing_state).toBe('DONE')
    expect(gated.triage_reason?.startsWith(UNCHANGED_NEGATIVE_PREFIX)).toBe(true)
    expect(await db.monitorLocalAnalysisJob.count()).toBe(0)

    const third = paid('NOT_FUNDING', 0.7)
    await triage('changed', html(page.replace('annual report', 'annual report and a new research grant call')), third)
    expect(third).toHaveBeenCalledTimes(1)
  })

  it('a page screened as not funding is revisited monthly, not every three days', async () => {
    const site = await db.monitorSite.create({ data: { host: 'report.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
    resourceId = (await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'https://report.invalid/report', canonical_url: 'https://report.invalid/report', title: 'Annual report' } })).id
    await triage('first', html(page), paid('NOT_FUNDING', 0.95))
    const resource = await db.monitorResource.findUniqueOrThrow({ where: { id: resourceId } })
    expect(resource.revisit_policy).toBe('LONG_TERM')
    expect((resource.next_revisit_at!.getTime() - Date.now()) / 86400_000).toBeGreaterThan(29)
  })
})
