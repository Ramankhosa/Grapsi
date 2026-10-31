import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => {
  const { testPrisma } = await import('../helpers/monitorTestPrisma')
  return { prisma: testPrisma, default: testPrisma }
})

import { siteStorageLimit } from '@/lib/monitor/capacity'
import { deleteDuplicateVersions } from '@/lib/monitor/prune'

import { resetMonitorTables, testPrisma as db } from '../helpers/monitorTestPrisma'

/** 29 Oct 2026: duplicate stored copies filled nine sites' evidence allowance. */

beforeEach(async () => { await resetMonitorTables() })
afterEach(() => { delete process.env.MONITOR_SITE_STORAGE_LIMIT_BYTES })
afterAll(async () => { await resetMonitorTables(); await db.$disconnect() })

let tick = 0
async function copy(resourceId: string, meaning: string, extra: Record<string, unknown> = {}) {
  tick += 1
  return db.monitorResourceVersion.create({ data: { resource_id: resourceId, raw_hash: `raw-${tick}`, meaningful_hash: meaning, text: meaning, byte_length: 1000,
    created_at: new Date(Date.UTC(2026, 9, 1, 0, tick)), ...extra } })
}

describe('duplicate page copies', () => {
  it('deletes only copies whose text a kept copy repeats and that nothing uses', async () => {
    const site = await db.monitorSite.create({ data: { host: 'prune.invalid', status: 'ACTIVE' } })
    const page = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'https://prune.invalid/a', canonical_url: 'https://prune.invalid/a' } })
    const dupOld = await copy(page.id, 'A')           // repeated by newer copies, unused -> deleted
    const dupMid = await copy(page.id, 'A')           // repeated by the current copy, unused -> deleted
    const other = await copy(page.id, 'B')            // different text -> kept
    const usedByResult = await copy(page.id, 'A')     // a laptop result points at it -> kept
    const evidence = await copy(page.id, 'A')         // review evidence -> kept
    const pinned = await copy(page.id, 'A', { pin_refcount: 1 })
    const document = await copy(page.id, 'A', { file_path: '/evidence/x.pdf' })
    const drafted = await copy(page.id, 'A')          // a draft's source -> kept
    const current = await copy(page.id, 'A')          // current copy -> kept
    await db.monitorResource.update({ where: { id: page.id }, data: { current_version_id: current.id } })

    const P = require('../../../../tools/local-worker/policy.cjs')
    const worker = await db.monitorLocalWorker.create({ data: { id: crypto.randomUUID(), display_name: 'fixture', app_version: P.APP_VERSION, model_sha256: P.MODEL.sha256 } })
    const job = await db.monitorLocalAnalysisJob.create({ data: { id: crypto.randomUUID(), resource_id: page.id, version_id: usedByResult.id, policy_hash: P.POLICY_HASH, input_hash: 'x', payload: {}, state: 'DONE' } })
    await db.monitorLocalAnalysisResult.create({ data: { job_id: job.id, resource_id: page.id, version_id: usedByResult.id, worker_id: worker.id, input_hash: 'x', policy_hash: P.POLICY_HASH, model_sha256: P.MODEL.sha256, decision: 'GENERAL', elapsed_ms: 1 } })
    // A laptop job superseded before it ran does not keep its copy; it goes with it.
    await db.monitorLocalAnalysisJob.create({ data: { id: crypto.randomUUID(), resource_id: page.id, version_id: dupOld.id, policy_hash: P.POLICY_HASH, input_hash: 'y', payload: {}, state: 'SUPERSEDED' } })
    const opportunity = await db.monitorOpportunity.create({ data: { site_id: site.id, primary_resource_id: page.id, drafted_from_version_ids: [drafted.id] } })
    await db.monitorOpportunityEvidence.create({ data: { opportunity_id: opportunity.id, resource_id: page.id, version_id: evidence.id, role: 'CALL_NOTICE' } })

    const done = await deleteDuplicateVersions(db)
    expect(done).toEqual({ copies: 2, bytes: 2000n })
    const left = new Set((await db.monitorResourceVersion.findMany({ select: { id: true } })).map(v => v.id))
    for (const kept of [other, usedByResult, evidence, pinned, document, drafted, current]) expect(left.has(kept.id)).toBe(true)
    expect(left.has(dupOld.id) || left.has(dupMid.id)).toBe(false)
    expect(await db.monitorLocalAnalysisJob.count({ where: { state: 'SUPERSEDED' } })).toBe(0)
    expect(await db.monitorLocalAnalysisResult.count()).toBe(1)
    // Running again finds nothing more.
    expect(await deleteDuplicateVersions(db)).toEqual({ copies: 0, bytes: 0n })
  })

  it('keeps the newest copy of a text even when it is not the current copy', async () => {
    const site = await db.monitorSite.create({ data: { host: 'prune2.invalid', status: 'ACTIVE' } })
    const page = await db.monitorResource.create({ data: { site_id: site.id, dedup_key: 'https://prune2.invalid/a', canonical_url: 'https://prune2.invalid/a' } })
    const older = await copy(page.id, 'A'), newer = await copy(page.id, 'A'), current = await copy(page.id, 'B')
    await db.monitorResource.update({ where: { id: page.id }, data: { current_version_id: current.id } })
    await deleteDuplicateVersions(db)
    const left = (await db.monitorResourceVersion.findMany({ select: { id: true } })).map(v => v.id).sort()
    expect(left).toEqual([newer.id, current.id].sort())
    expect(left).not.toContain(older.id)
  })
})

describe('site evidence allowance', () => {
  it('is 1 GB by default, configurable, and a site quota wins', () => {
    expect(siteStorageLimit(null)).toBe(1_000_000_000n)
    process.env.MONITOR_SITE_STORAGE_LIMIT_BYTES = '2000000000'
    expect(siteStorageLimit(null)).toBe(2_000_000_000n)
    expect(siteStorageLimit(300_000_000n)).toBe(300_000_000n)
  })
})
