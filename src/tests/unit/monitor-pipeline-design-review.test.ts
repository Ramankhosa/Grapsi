import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const db: any = {
    monitorSkipRule: { findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    monitorCrawlFrontier: { findMany: vi.fn(), updateMany: vi.fn() },
    monitorResource: { findMany: vi.fn(), updateMany: vi.fn() },
    monitoredSource: { findUnique: vi.fn() },
    monitorCheckRun: { upsert: vi.fn() },
  }
  db.$transaction = (fn: any) => fn(db)
  return { db, auth: vi.fn(), importWebsites: vi.fn() }
})
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/fundingIntake/routeAuth', () => ({ requireFundingOperatorRequest: mocks.auth, requireFundingReadOperatorRequest: mocks.auth }))
vi.mock('@/lib/monitor/catalogImport', () => ({ importWebsites: mocks.importWebsites, searchCatalogWebsites: vi.fn() }))
vi.mock('@/lib/monitor/checker', () => ({ MIN_FREQUENCY_MINUTES: 60 }))
vi.mock('@/lib/monitor/candidates', () => ({ queueCandidates: vi.fn() }))
vi.mock('@/lib/monitor/queue', () => ({ withFence: (_lease: any, fn: any) => fn(mocks.db), completeTaskInTx: vi.fn() }))

import { buildSiteTree, type TreeInput } from '@/lib/monitor/siteTree'
import { skipRuleFor, skipRuleKey } from '@/lib/monitor/skipRules'
import { POST as importSites } from '@/app/api/funding/monitor/catalog-import/route'
import { DELETE as removeSkip } from '@/app/api/funding/monitor/skip-rules/route'
import { runSourceCheck } from '@/lib/monitor/checkSource'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ operator: { userId: 'operator', role: 'REVIEWER' }, actor: { roles: ['PLATFORM_STAFF'], platformPermissions: ['funding.operations.write'] } })
  mocks.importWebsites.mockResolvedValue([])
})

const at = new Date('2026-10-27T00:00:00Z')
function tree(processing_state: string): TreeInput {
  return {
    sources: [], observations: [], evidence: [], frontier: [], skipRules: [],
    resources: [{ id: 'r', kind: 'PAGE', role: 'UNKNOWN', canonical_url: 'https://funder.example/call', title: 'Possible grant', last_observed_at: at, last_validation_status: 'OK' }],
    opportunities: [{ id: 'o', primary_resource_id: 'r', title: 'Possible grant', review_state: 'PENDING', processing_state, triage_verdict: null, relevance_outcome: 'UNCERTAIN', funding_call_id: null, created_at: at }],
  }
}

describe('current pipeline requirements missing from the proposed UI patch', () => {
  it('does not claim funding was found while a pending page awaits renewed laptop screening', () => {
    const node = buildSiteTree(tree('SCORED'), at).find(n => n.id === 'resource:r')!
    expect(node.outcome).not.toBe('IN_REVIEW')
  })

  it('keeps a readable page with missing application evidence distinct from an unreadable page', () => {
    const node = buildSiteTree(tree('NEEDS_EVIDENCE'), at).find(n => n.id === 'resource:r')!
    expect(node.outcome).not.toBe('UNREADABLE')
  })

  // The review allowed either refusing a delegated operator's import or saving
  // it as a request pending super-admin approval. The second keeps operators
  // useful: the route hands the import over as a non-super-admin, and the
  // service (see catalog-import-approval.monitor-db.test.ts) stores the scope,
  // budget and activation as a request instead of applying them.
  it('imports from a delegated operator only as a request pending super-admin approval', async () => {
    const response = await importSites(new NextRequest('http://localhost/api/funding/monitor/catalog-import', {
      method: 'POST', body: JSON.stringify({ websites: [{ host: 'funder.example', watchUrl: 'https://funder.example/calls', relatedHosts: ['other.example'] }] }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.importWebsites).toHaveBeenCalledWith(expect.any(Array), { userId: 'operator', superAdmin: false })
  })

  it('restores a stopped resource revisit when its final skip rule is removed', async () => {
    mocks.auth.mockResolvedValue({ operator: { userId: 'admin' }, actor: { roles: ['SUPER_ADMIN'] } })
    mocks.db.monitorSkipRule.findUnique.mockResolvedValue({ id: 'skip', site_id: 'site' })
    mocks.db.monitorSkipRule.delete.mockResolvedValue({})
    mocks.db.monitorSkipRule.findMany.mockResolvedValue([])
    mocks.db.monitorCrawlFrontier.findMany.mockResolvedValue([])
    const stopped = { id: 'resource', canonical_url: 'https://funder.example/call', revisit_policy: 'NONE', next_revisit_at: null }
    mocks.db.monitorResource.findMany.mockImplementation(async ({ where }: any) => where.next_revisit_at?.not === null ? [] : [stopped])
    mocks.db.monitorResource.updateMany.mockResolvedValue({ count: 1 })
    const response = await removeSkip(new NextRequest('http://localhost/api/funding/monitor/skip-rules?id=skip', { method: 'DELETE' }))
    expect(response.status).toBe(200)
    expect(mocks.db.monitorResource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revisit_policy: 'ACTIVE', next_revisit_at: expect.any(Date) }) }))
  })

  it('honours the same www alias skip decision in production and the laptop broker', () => {
    const rule = { dedup_key: skipRuleKey('https://www.funder.example/news', 'PAGE')!.dedupKey, match: 'PAGE', expires_at: null }
    const url = 'https://funder.example/news'
    expect(skipRuleFor([rule], url)).not.toBeNull()
    const policy = require('../../../tools/local-worker/policy.cjs')
    expect(policy.skipped(skipRuleKey(url, 'PAGE')!.dedupKey, [rule])).toBe(true)
  })

  it('does not fetch a watched listing inside a folder marked do not visit', async () => {
    const url = 'https://funder.example/archive/calls'
    const rule = { dedup_key: skipRuleKey('https://funder.example/archive/', 'FOLDER')!.dedupKey, match: 'FOLDER', expires_at: null }
    mocks.db.monitorSkipRule.findMany.mockResolvedValue([rule])
    mocks.db.monitoredSource.findUnique.mockResolvedValue({
      id: 'source', site_id: 'site', url, kind: 'PAGE', status: 'ACTIVE', fetch_mode: 'FETCH', cursor: null, ignoreRules: [],
      site: { id: 'site', host: 'funder.example', status: 'ACTIVE', related_hosts: [], attachment_hosts: [], query_rules: {}, min_delay_ms: 0 },
    })
    const sentinel = new Error('Test stopped a prohibited request before network access')
    const fetch = vi.fn(async () => { throw sentinel })
    try { await runSourceCheck({ payload: { sourceId: 'source', generation: 1 }, sourceId: 'source' } as any, { fetch, renderer: null, now: () => at }) }
    catch (error) { if (error !== sentinel) throw error }
    expect(fetch).not.toHaveBeenCalled()
  })
})
