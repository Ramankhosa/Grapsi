import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => { const { testPrisma } = await import('../helpers/monitorTestPrisma'); return { prisma: testPrisma, default: testPrisma } })
import { discoverSite, DISCOVERY_LIMITS } from '@/lib/monitor/discovery'
import { claimNextTask, enqueueTask } from '@/lib/monitor/queue'
import type { SafeFetch } from '@/lib/monitor/safeFetch'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'
beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })
describe('bounded site discovery', () => {
  it('finds funding listings and sitemap hints from a single seed without following traps or unapproved hosts', async () => {
    const site = await db.monitorSite.create({ data: { host: 'discovery.example', min_delay_ms: 0 } })
    await db.monitoredSource.create({ data: { site_id: site.id, name: 'Seed', url: 'https://discovery.example/about' } })
    const calls: string[] = []
    const pages: Record<string, string> = {
      'https://discovery.example/robots.txt': 'User-agent: *\nSitemap: https://discovery.example/sitemap.xml',
      'https://discovery.example/': '<main><a href="/about">About us</a><a href="/funding">Funding calls</a><a href="/calendar?year=2026">Calendar</a><a href="https://unapproved.example/">Other portal</a></main>',
      'https://discovery.example/about': '<main>About the research institute.</main>',
      'https://discovery.example/funding': '<main><h1>Research funding</h1><a href="/call/a">Research grant A</a><a href="/call/b">Research grant B</a></main>',
      'https://discovery.example/call/a': '<main>Funding call A.</main>',
      'https://discovery.example/call/b': '<main>Funding call B.</main>',
    }
    const fetch: SafeFetch = async url => {
      calls.push(url)
      if (!(url in pages)) throw new Error('Unexpected crawl target: ' + url)
      const body = Buffer.from(pages[url])
      return { requestedUrl: url, finalUrl: url, status: 200, headers: {}, body, byteLength: body.length, contentType: 'text/html', contentKind: 'html', notModified: false, truncated: false, redirects: [], tlsExceptionUsed: false }
    }
    for (let i = 0; i < 4; i++) {
      const before = calls.length
      await enqueueTask(db, { kind: 'DISCOVER_SITE', operationKey: `discover-fixture:${i}`, siteId: site.id, payload: { siteId: site.id } })
      const lease = await claimNextTask({ owner: 'fixture', kinds: ['DISCOVER_SITE'] })
      await discoverSite(lease!, fetch)
      expect(calls.length - before).toBeLessThanOrEqual(DISCOVERY_LIMITS.requests)
    }
    expect(await db.monitoredSource.count({ where: { site_id: site.id, url: 'https://discovery.example/funding', kind: 'PAGE' } })).toBe(1)
    expect(await db.monitoredSource.count({ where: { site_id: site.id, kind: 'SITEMAP' } })).toBe(1)
    expect(calls.every(url => !url.includes('unapproved') && !url.includes('calendar'))).toBe(true)
  })
  it('never fetches a catalog-suggested site before admin activation', async () => {
    const site = await db.monitorSite.create({ data: { host: 'suggested.example', status: 'ACTIVE' } })
    await enqueueTask(db, { kind: 'DISCOVER_SITE', operationKey: 'suggestion', siteId: site.id, payload: {} })
    const lease = await claimNextTask({ owner: 'fixture', kinds: ['DISCOVER_SITE'] })
    await db.monitorSite.update({ where: { id: site.id }, data: { status: 'SUGGESTED' } })
    const fetch = vi.fn()
    await discoverSite(lease!, fetch)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('resumes a long page beyond the first link batch instead of silently losing the tail', async () => {
    const site = await db.monitorSite.create({ data: { host: 'long-list.example', min_delay_ms: 0 } })
    const root = 'https://long-list.example/'
    const html = Array.from({ length: 155 }, (_, i) => `<a href="/page/${i}">Page ${i}</a>`).join('')
    const fetch: SafeFetch = async url => {
      const body = Buffer.from(url.endsWith('/robots.txt') ? 'User-agent: *' : html)
      return { requestedUrl: url, finalUrl: url, status: 200, headers: {}, body, byteLength: body.length, contentType: 'text/html', contentKind: 'html', notModified: false, truncated: false, redirects: [], tlsExceptionUsed: false }
    }
    for (let i = 0; i < 2; i++) {
      if (i) {
        await db.monitorCrawlFrontier.updateMany({ where: { site_id: site.id, url: { not: root } }, data: { next_visit_at: new Date(Date.now() + 86400000) } })
        await db.monitorCrawlFrontier.updateMany({ where: { site_id: site.id, url: root }, data: { next_visit_at: new Date(0) } })
      }
      await enqueueTask(db, { kind: 'DISCOVER_SITE', operationKey: `long-list:${i}`, siteId: site.id, priority: 1, payload: {} })
      await discoverSite((await claimNextTask({ owner: 'fixture', kinds: ['DISCOVER_SITE'] }))!, fetch)
    }
    expect(await db.monitorCrawlFrontier.count({ where: { site_id: site.id } })).toBe(156)
    expect((await db.monitorCrawlFrontier.findFirstOrThrow({ where: { site_id: site.id, url: root } })).state).toBe('VISITED')
  })
})
