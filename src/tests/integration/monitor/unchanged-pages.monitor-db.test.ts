import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { queueCandidates } from '@/lib/monitor/candidates'
import { readResource } from '@/lib/monitor/content'
import { claimNextTask } from '@/lib/monitor/queue'
import type { SafeFetch, SafeFetchResult } from '@/lib/monitor/safeFetch'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/**
 * 29 Oct 2026: 78% of new page versions on production carried the same
 * meaningful text as the version before; each one re-queued the page for the
 * laptop and stored another copy. An unchanged page must keep its version.
 */

beforeEach(async () => { await resetMonitorTables() })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })

const URL = 'https://same.invalid/calls/ocean'
const CALL = `<p>${'Applications are invited for the Ocean Data Fellowship from early career researchers. '.repeat(6)}</p><p>Deadline: 30 April 2027, 17:00 CET</p>`
const page = (extra: string, etag: string): SafeFetchResult => {
  const body = Buffer.from(`<html><body><main>${CALL}${extra}</main></body></html>`)
  return { requestedUrl: URL, finalUrl: URL, status: 200, headers: { etag }, body, byteLength: body.length, truncated: false, contentKind: 'html', contentType: 'text/html', notModified: false, redirects: [], tlsExceptionUsed: false }
}

async function setup() {
  const site = await db.monitorSite.create({ data: { host: 'same.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
  await db.monitorResource.create({ data: { site_id: site.id, dedup_key: URL, canonical_url: URL, title: 'Call' } })
  const resource = await db.monitorResource.findFirstOrThrow({ where: { site_id: site.id } })
  await queueCandidates(db, site.id, [resource.id], false, 'same:1')
  const lease = (await claimNextTask({ owner: 'unchanged-pages', kinds: ['TRIAGE'] }))!
  return { site, lease }
}

async function readAs(answer: SafeFetchResult, ctx: Awaited<ReturnType<typeof setup>>) {
  const resource = await db.monitorResource.findFirstOrThrow({ where: { site_id: ctx.site.id } })
  const fetch: SafeFetch = async () => answer
  return readResource(resource, ctx.site, ctx.lease, fetch)
}
const state = async (siteId: string) => {
  const r = await db.monitorResource.findFirstOrThrow({ where: { site_id: siteId } })
  return { versionId: r.current_version_id, etag: r.etag, versions: await db.monitorResourceVersion.count({ where: { resource_id: r.id } }) }
}

describe('unchanged evidence pages', () => {
  it('keeps the current version when only the bytes change', async () => {
    const ctx = await setup()
    expect((await readAs(page('<!-- token a1 -->', '"v1"'), ctx)).changed).toBe(true)
    const first = await state(ctx.site.id)
    const again = await readAs(page('<!-- token b2 --><script>var t=2</script>', '"v2"'), ctx)
    expect(again.changed).toBe(false)
    const second = await state(ctx.site.id)
    expect(second.versionId).toBe(first.versionId)
    expect(second.versions).toBe(1)
    // The fresh validators are kept, so the next visit can ask "not modified?".
    expect(second.etag).toBe('"v2"')
  })

  it('ignores the page clock', async () => {
    const ctx = await setup()
    await readAs(page('<p>Messages at time of print 29 October 2026, 02:30 CET</p>', '"a"'), ctx)
    const first = await state(ctx.site.id)
    expect((await readAs(page('<p>Messages at time of print 29 October 2026, 03:24 CET</p>', '"b"'), ctx)).changed).toBe(false)
    expect((await state(ctx.site.id)).versionId).toBe(first.versionId)
  })

  it('treats a stored version as unchanged under newly ignored lines', async () => {
    const ctx = await setup()
    await readAs(page('<p>Messages at time of print 29 October 2026, 02:30 CET</p>', '"a"'), ctx)
    // A version stored before the clock line was ignored has a hash that includes it.
    const r = await db.monitorResource.findFirstOrThrow({ where: { site_id: ctx.site.id } })
    await db.monitorResourceVersion.update({ where: { id: r.current_version_id! }, data: { meaningful_hash: 'stored-under-older-rules' } })
    expect((await readAs(page('<p>Messages at time of print 29 October 2026, 04:10 CET</p>', '"c"'), ctx)).changed).toBe(false)
    expect((await state(ctx.site.id)).versions).toBe(1)
  })

  it('still records a real change', async () => {
    const ctx = await setup()
    await readAs(page('', '"a"'), ctx)
    const first = await state(ctx.site.id)
    const changed = await readAs(page('<p>The deadline is extended to 31 May 2027.</p>', '"b"'), ctx)
    expect(changed.changed).toBe(true)
    const second = await state(ctx.site.id)
    expect(second.versionId).not.toBe(first.versionId)
    expect(second.versions).toBe(2)
  })
})
