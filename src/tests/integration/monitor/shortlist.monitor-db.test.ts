import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { queueCandidates, triageCandidates } from '@/lib/monitor/candidates'
import { claimNextTask } from '@/lib/monitor/queue'
import type { SafeFetch } from '@/lib/monitor/safeFetch'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/** 29 Oct 2026: pages that plainly are not funding are closed without being read or sent to the laptop. */

beforeEach(async () => { await resetMonitorTables(); process.env.MONITOR_LOCAL_SCREENING_REQUIRED = 'true' })
afterEach(() => { delete process.env.MONITOR_LOCAL_SCREENING_REQUIRED })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })

const html = '<main><h1>Page</h1><p>' + 'Information about this programme for researchers. '.repeat(8) + '</p></main>'
function spyFetch() {
  const calls: string[] = []
  const fetch: SafeFetch = async (url) => {
    calls.push(url)
    const body = Buffer.from(html)
    return { requestedUrl: url, finalUrl: url, status: 200, headers: {}, body, byteLength: body.length, truncated: false, contentKind: 'html', contentType: 'text/html', notModified: false, redirects: [], tlsExceptionUsed: false }
  }
  return { fetch, calls }
}

async function page(kind: 'SITEMAP' | 'PAGE', url: string, title: string) {
  const site = await db.monitorSite.create({ data: { host: 'www.nsf.invalid', status: 'ACTIVE', min_delay_ms: 0 } })
  const source = await db.monitoredSource.create({ data: { site_id: site.id, name: kind, url: `https://www.nsf.invalid/${kind === 'SITEMAP' ? 'sitemap.xml' : 'funding'}`, kind } })
  const resource = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: url, canonical_url: url, title } })
  await db.monitorObservation.create({ data: { source_id: source.id, resource_id: resource.id, site_id: site.id, anchor_text: title, context_hash: 'x' } })
  await queueCandidates(db, site.id, [resource.id], false, `shortlist:${url}`)
  const lease = (await claimNextTask({ owner: 'shortlist', kinds: ['TRIAGE'] }))!
  return { resource, lease }
}

describe('tightened shortlist', () => {
  it('closes a sitemap-only event page without reading it or queuing the laptop', async () => {
    const { resource, lease } = await page('SITEMAP', 'https://www.nsf.invalid/events/dms-virtual-office-hours-14/2021-05-14', '2021 05 14')
    const { fetch, calls } = spyFetch()
    await triageCandidates(lease, { fetch, paid: vi.fn() })
    expect(calls).toEqual([])
    expect(await db.monitorLocalAnalysisJob.count()).toBe(0)
    const o = await db.monitorOpportunity.findFirstOrThrow({ where: { primary_resource_id: resource.id } })
    expect(o).toMatchObject({ processing_state: 'DONE', triage_verdict: 'NOT_FUNDING', relevance_outcome: 'STRONG_NEGATIVE' })
    expect(o.triage_reason).toContain('no funding word')
  })

  it('sends a strong funding match to the front of the laptop queue', async () => {
    const { lease } = await page('PAGE', 'https://www.nsf.invalid/funding/opportunities/graduate-research-fellowship', 'Graduate Research Fellowship')
    const { fetch, calls } = spyFetch()
    await triageCandidates(lease, { fetch, paid: vi.fn() })
    expect(calls.length).toBe(1)
    const job = await db.monitorLocalAnalysisJob.findFirstOrThrow()
    expect((job.payload as { queuePriority: number }).queuePriority).toBe(20)
  })
})
