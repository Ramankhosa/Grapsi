import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { CHECK_LIMITS } from '@/lib/monitor/checkSource'
import { requestCheckNow } from '@/lib/monitor/planner'
import type { SafeFetch } from '@/lib/monitor/safeFetch'
import { runSourceMonitorWorker } from '@/lib/monitor/worker'
import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

type Fixture = { body: string; etag?: string }
function network(pages: Record<string, Fixture>) {
  const calls: string[] = []
  const fetch: SafeFetch = async (url, options) => {
    calls.push(url)
    // Bound a faulty cyclic walk so the test itself cannot hang.
    if (calls.length > 12) throw new Error('Review fixture request bound exceeded')
    const page = pages[url]
    if (!page) throw new Error(`Missing fixture ${url}`)
    const notModified = Boolean(page.etag && options?.headers?.['if-none-match'] === page.etag)
    const body = Buffer.from(notModified ? '' : page.body)
    const headers: Record<string, string> = page.etag ? { etag: page.etag } : {}
    return {
      requestedUrl: url, finalUrl: url, status: notModified ? 304 : 200,
      headers, body, byteLength: body.length,
      truncated: false, contentType: 'text/html', contentKind: 'html',
      notModified, redirects: [], tlsExceptionUsed: false,
    }
  }
  return { fetch, calls }
}

async function source(host: string, extra: Record<string, unknown> = {}) {
  const site = await db.monitorSite.create({ data: { host, status: 'ACTIVE', min_delay_ms: 0 } })
  return db.monitoredSource.create({ data: {
    name: host, url: `https://${host}/calls`, site_id: site.id, fetch_mode: 'FETCH', ...extra,
  } })
}
async function check(id: string, fetch: SafeFetch) {
  await requestCheckNow(id)
  await runSourceMonitorWorker({ once: true, concurrency: 1, fetch, renderer: null, workerId: 'review-worker' })
  return db.monitorCheckRun.findFirstOrThrow({ where: { source_id: id }, orderBy: { check_generation: 'desc' } })
}
const listing = (title: string, next = '') => `<main><a href="/call/a">${title}</a>${next ? `<a rel="next" href="${next}">Next</a>` : ''}</main>`
const index = (...urls: string[]) => `<sitemapindex>${urls.map(url => `<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`
const urlset = (url: string) => `<urlset><url><loc>${url}</loc></url></urlset>`

beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })

describe('independent release review regressions', () => {
  it('accepts a Hindi-only opportunity listing', async () => {
    const s = await source('hindi-review.example')
    const { fetch } = network({ [s.url]: { body: listing('अनुसंधान अनुदान प्रस्ताव आमंत्रण') } })
    expect((await check(s.id, fetch)).status).toBe('COMPLETE')
  })

  it('rechecks page two even when page one has the same ETag', async () => {
    const s = await source('pagination-review.example')
    const p2 = `https://pagination-review.example/page2`
    const pages = { [s.url]: { body: listing('Research grant', p2), etag: 'head-v1' }, [p2]: { body: listing('Second grant') } }
    const { fetch, calls } = network(pages)
    await check(s.id, fetch)
    calls.length = 0
    pages[p2].body = '<main><a href="/call/new-round">New funding round</a></main>'
    await check(s.id, fetch)
    expect(calls).toContain(p2)
    expect(await db.monitorResource.count({ where: { canonical_url: 'https://pagination-review.example/call/new-round' } })).toBe(1)
  })

  it('does not turn an empty shell into a successful check through a 304', async () => {
    const s = await source('shell-review.example')
    const { fetch } = network({ [s.url]: { body: '<main id="root"></main>', etag: 'shell-v1' } })
    expect((await check(s.id, fetch)).status).toBe('PARTIAL')
    const second = await check(s.id, fetch)
    expect(second.complete).toBe(false)
    expect(second.status).toBe('PARTIAL')
  })

  it('retains sibling sitemaps after descending into a nested index', async () => {
    const s = await source('nested-review.example', { kind: 'SITEMAP' })
    const root = 'https://nested-review.example'
    const { fetch } = network({
      [s.url]: { body: index(`${root}/nested.xml`, `${root}/sibling.xml`) },
      [`${root}/nested.xml`]: { body: index(`${root}/leaf.xml`) },
      [`${root}/leaf.xml`]: { body: urlset(`${root}/call/first`) },
      [`${root}/sibling.xml`]: { body: urlset(`${root}/call/sibling`) },
    })
    await check(s.id, fetch)
    // A bounded pass may defer the sibling, but it must retain and eventually visit it.
    await check(s.id, fetch)
    expect(await db.monitorResource.count({ where: { canonical_url: `${root}/call/sibling` } })).toBe(1)
  })

  it('bounds requests for a cyclic sitemap index', async () => {
    const s = await source('cycle-review.example', { kind: 'SITEMAP' })
    const { fetch, calls } = network({ [s.url]: { body: index(s.url) } })
    await check(s.id, fetch)
    expect(calls.length).toBeLessThanOrEqual(CHECK_LIMITS.sitemapChildrenPerCheck)
  })

  it('does not mark known calls missing when a sitemap returns an HTML error with status 200', async () => {
    const s = await source('invalid-sitemap-review.example', { kind: 'SITEMAP' })
    const pages = { [s.url]: { body: urlset('https://invalid-sitemap-review.example/call/a') } }
    const { fetch } = network(pages)
    await check(s.id, fetch)
    await new Promise(resolve => setTimeout(resolve, 10))
    pages[s.url].body = '<html><body>Temporarily unavailable</body></html>'
    expect((await check(s.id, fetch)).complete).toBe(false)
    expect(await db.monitorObservation.count({ where: { source_id: s.id, missing_since: { not: null } } })).toBe(0)
  })
})
