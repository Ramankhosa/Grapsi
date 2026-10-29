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

describe('call score v1 (shadow)', () => {
  it('stores the score and its signals on the page once per version', async () => {
    const callHtml = '<main><h1>Early Career Research Grant</h1><p>Applications are invited from researchers within five years of their PhD.</p><p>Eligibility: applicants must be based at an Indian institution.</p><p>Funding of up to Rs. 50 lakh per year.</p><p>Last date for submission: 15/12/2026.</p></main>'
    const fetch: SafeFetch = async (url) => {
      const body = Buffer.from(callHtml)
      return { requestedUrl: url, finalUrl: url, status: 200, headers: {}, body, byteLength: body.length, truncated: false, contentKind: 'html', contentType: 'text/html', notModified: false, redirects: [], tlsExceptionUsed: false }
    }
    const { resource, lease } = await page('PAGE', 'https://www.nsf.invalid/funding/early-career-research-grant', 'Early Career Research Grant')
    await triageCandidates(lease, { fetch, paid: vi.fn() })
    const scored = await db.monitorResource.findUniqueOrThrow({ where: { id: resource.id } })
    expect(scored.call_band).toBe('LIKELY')
    expect(scored.call_score).toBeGreaterThanOrEqual(7)
    expect(scored.call_signals).toEqual(expect.arrayContaining(['Invites applications', 'Eligibility rules', 'Amount on offer']))
    expect(scored.call_scored_version_id).toBe(scored.current_version_id)
    // Shadow mode: the laptop job keeps the priority the keyword check gave it.
    const job = await db.monitorLocalAnalysisJob.findFirstOrThrow({ where: { resource_id: resource.id } })
    expect((job.payload as { queuePriority: number }).queuePriority).toBe(20)
    // The same stored copy is not scored again.
    const at = scored.call_scored_at
    await queueCandidates(db, scored.site_id, [resource.id], false, 'call-score:again')
    const again = (await claimNextTask({ owner: 'shortlist', kinds: ['TRIAGE'] }))!
    await triageCandidates(again, { fetch, paid: vi.fn() })
    expect((await db.monitorResource.findUniqueOrThrow({ where: { id: resource.id } })).call_scored_at).toEqual(at)
  })
})

describe('back to screening after the laptop', () => {
  it('re-queues a page parked for the laptop once the laptop has judged it, and only once', async () => {
    const { resource, lease } = await page('PAGE', 'https://www.nsf.invalid/funding/graduate-research-fellowship', 'Graduate Research Fellowship')
    const { fetch } = spyFetch()
    await triageCandidates(lease, { fetch, paid: vi.fn() })
    expect((await db.monitorOpportunity.findFirstOrThrow({ where: { primary_resource_id: resource.id } })).triage_reason).toMatch(/^Waiting for laptop/)
    const { resumeAfterLaptop } = await import('@/lib/monitor/planner')
    expect(await resumeAfterLaptop()).toBe(0)
    const P = require('../../../../tools/local-worker/policy.cjs')
    const job = await db.monitorLocalAnalysisJob.findFirstOrThrow({ where: { resource_id: resource.id } })
    const worker = await db.monitorLocalWorker.create({ data: { id: crypto.randomUUID(), display_name: 'fixture', app_version: P.APP_VERSION, model_sha256: P.MODEL.sha256 } })
    await db.monitorLocalAnalysisResult.create({ data: { job_id: job.id, resource_id: resource.id, version_id: job.version_id, worker_id: worker.id, input_hash: job.input_hash, policy_hash: P.POLICY_HASH, model_sha256: P.MODEL.sha256, decision: 'CALL', elapsed_ms: 1, details: { schemaVersion: 2, candidates: [], multipleCalls: false, needsMoreEvidence: false, warnings: [] } } })
    // The screening task finished and parked the page; the laptop's result sends it back, once.
    expect(await db.monitorTask.count({ where: { kind: 'TRIAGE', status: { in: ['QUEUED', 'RUNNING'] } } })).toBe(0)
    expect(await resumeAfterLaptop()).toBe(1)
    expect(await db.monitorTask.count({ where: { kind: 'TRIAGE', status: 'QUEUED' } })).toBe(1)
    await db.monitorTask.updateMany({ where: { kind: 'TRIAGE', status: 'QUEUED' }, data: { status: 'DONE' } })
    await resumeAfterLaptop()
    expect(await db.monitorTask.count({ where: { kind: 'TRIAGE', status: 'QUEUED' } })).toBe(0)
  })
})
