import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for the 2 November 2026 matching audit
 * (docs/funding-matching-reporting-review-20261102.md). Each case started life
 * as a probe that reproduced a defect; these assert the corrected behaviour.
 * Everything is synthetic and mocked: no database, model or email is touched.
 */
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), rerank: vi.fn(), fingerprint: vi.fn() }))
vi.mock('@/lib/prisma', () => {
  const db = {
    $queryRaw: m.query, $executeRaw: m.execute,
    $transaction: async (fn: any) => fn(db),
    researcherSavedResearchArea: { findMany: async () => [] },
    researcherProfile: { findUnique: async () => ({ research_areas: ['quantum sensing'], keywords: [] }) },
    fundingCallAlert: { findMany: async () => [] },
  }
  return { default: db, prisma: db }
})
vi.mock('@/lib/services/embeddingService', () => ({ EmbeddingService: class {
  getHealth() { return { provider: 'voyage', outputDimensionality: 1024 } }
} }))
vi.mock('@/lib/services/voyageRerankService', () => ({ voyageRerankService: {
  isConfigured: () => true, getModelName: () => 'synthetic-reranker', rerank: m.rerank,
} }))
vi.mock('@/lib/fundingDept/callMatchFingerprint', () => ({ callFingerprint: m.fingerprint }))
vi.mock('@/lib/tenant/locale', () => ({ getTenantTimeZone: async () => 'Asia/Kolkata' }))
vi.mock('@/lib/funding/llmRouting', () => ({ runFundingGatewayText: vi.fn() }))
vi.mock('@/lib/fundingDocuments/evidence', () => ({ enrichRecommendationResultsWithDocumentEvidence: vi.fn() }))

import { CensusIncompleteError, researcherSearchService } from '@/lib/services/researcherSearchService'
import {
  censusSupportsConclusion, previewMatchWidths, refreshCallMatches, staleCallIds, type CallMatchState,
} from '@/lib/fundingDept/callMatchCensus'

const BRANCHES = ['searchProfileVectors', 'searchSavedAreaVectors', 'searchPublicationVectors', 'searchText']

const person = {
  userId: 'person', displayName: 'Synthetic Researcher', countryOfResidence: 'India', institutionName: 'Synthetic University',
  institutionType: 'University', department: 'Physics', careerStage: 'Professor', researchSummary: 'quantum sensing',
  researchAreas: ['quantum sensing'], keywords: [], matchedText: 'quantum sensing', matchedTitle: null, matchedDetail: null,
  source: 'profile', semanticSimilarity: .34, textRank: 0,
}
const healthy = { embedding: 'ok', profile: 'ok', research_area: 'ok', publication: 'ok', text: 'ok' } as const
const zeroSearch = { query: 'quantum sensing', fundingCallId: 'call', callEligibility: null, totalResults: 0,
  totalCandidates: 0, scoreBasis: 'rerank' as const, results: [], degradedMode: null, retrieval: healthy, truncated: false }

beforeEach(() => {
  vi.clearAllMocks()
  m.query.mockResolvedValue([])
  m.execute.mockResolvedValue(0)
  m.fingerprint.mockResolvedValue('stable')
  m.rerank.mockResolvedValue([])
})
afterEach(() => { vi.restoreAllMocks() })

function configureSearch() {
  const service = researcherSearchService as any
  vi.spyOn(service, 'resolveSearchText').mockResolvedValue('quantum sensing')
  vi.spyOn(service, 'buildQueryVectorLiteral').mockResolvedValue('[0.1]')
  for (const method of BRANCHES) vi.spyOn(service, method).mockResolvedValue([])
  return service
}

const writes = () => m.execute.mock.calls.map(([sql]) => sql.sql as string)

describe('census failure safety', () => {
  it('a census whose retrieval branches all fail throws instead of returning a confident zero', async () => {
    const service = configureSearch()
    for (const method of BRANCHES) service[method].mockRejectedValue(new Error('synthetic outage'))
    await expect(researcherSearchService.search({ query: 'quantum sensing', census: true })).rejects.toBeInstanceOf(CensusIncompleteError)
  })

  it('a single failed branch is enough to stop a census, and is reported on live search', async () => {
    const service = configureSearch()
    service.searchPublicationVectors.mockRejectedValue(new Error('index missing'))
    await expect(researcherSearchService.search({ query: 'quantum sensing', census: true })).rejects.toThrow(/could not be read/)
    const live = await researcherSearchService.search({ query: 'quantum sensing' })
    expect(live.degradedMode).toBe('partial')
    expect(live.retrieval).toMatchObject({ publication: 'failed', profile: 'ok', text: 'ok' })
  })

  it('a failed census keeps the stored matches and records a retryable failure', async () => {
    vi.spyOn(researcherSearchService, 'search').mockRejectedValue(new CensusIncompleteError('synthetic outage'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(refreshCallMatches('tenant', 'outage-call')).rejects.toThrow('synthetic outage')
    const sql = writes().join('\n')
    expect(sql).not.toContain('SET is_current = false')
    expect(sql).not.toContain('INSERT INTO funding_opportunity_matches')
    expect(sql).toContain("'failed'")
    expect(sql).toContain('failure_count = dsr_call_match_state.failure_count + 1')
    // The last success is left alone: only failure fields are updated on conflict.
    expect(sql.split('DO UPDATE SET')[1]).not.toContain('refreshed_at')
  })

  it('a genuine, successful zero still replaces the previous census', async () => {
    vi.spyOn(researcherSearchService, 'search').mockResolvedValue(zeroSearch as any)
    await refreshCallMatches('tenant', 'empty-call')
    const sql = writes().join('\n')
    expect(sql).toContain('UPDATE funding_opportunity_matches SET is_current = false')
    expect(sql).toContain("status = 'ok'")
  })

  it('inputs that change mid-census abort the write inside the transaction', async () => {
    m.fingerprint.mockResolvedValueOnce('before').mockResolvedValue('after')
    vi.spyOn(researcherSearchService, 'search').mockResolvedValue(zeroSearch as any)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(refreshCallMatches('tenant', 'moving-call')).rejects.toThrow(/inputs changed/)
    expect(writes().join('\n')).not.toContain('SET is_current = false')
  })

  it('only a successful census is reused from the cache', async () => {
    m.query.mockResolvedValueOnce([])
    const search = vi.spyOn(researcherSearchService, 'search').mockResolvedValue(zeroSearch as any)
    await refreshCallMatches('tenant', 'retry-call')
    expect(m.query.mock.calls[0][0].sql).toContain("status = 'ok'")
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('stale-call selection waits out a failed call backoff and puts due retries first', async () => {
    await staleCallIds('tenant', 5)
    const sql = m.query.mock.calls[0][0].sql as string
    expect(sql).toContain("WHEN s.status = 'failed' THEN s.retry_at IS NULL OR s.retry_at <=")
    expect(sql).toContain("ORDER BY (s.status = 'failed') DESC")
  })
})

describe('census scoring', () => {
  it('a census flags that it reached the merge ceiling', async () => {
    const service = configureSearch()
    BRANCHES.forEach((method, branch) => service[method].mockResolvedValue(Array.from({ length: 2000 }, (_, index) => ({
      ...person, userId: `branch-${branch}-person-${index}`, semanticSimilarity: .9,
    }))))
    m.rerank.mockImplementation(async ({ documents }: { documents: string[] }) => documents.map((_, index) => ({ index, relevanceScore: .9 })))
    const result = await researcherSearchService.search({ query: 'quantum sensing', census: true })
    expect(result.totalCandidates).toBe(4000)
    expect(result.truncated).toBe(true)
  })

  it('partial reranker coverage fails the census instead of storing retrieval scores', async () => {
    const service = configureSearch()
    service.searchProfileVectors.mockResolvedValue([person, { ...person, userId: 'second' }])
    m.rerank.mockResolvedValue([{ index: 0, relevanceScore: .7 }])
    await expect(researcherSearchService.search({ query: 'quantum sensing', census: true })).rejects.toThrow(/scored 1 of 2/)
  })
})

describe('what a stored census can conclude', () => {
  const base: CallMatchState = { fresh: true, refreshedAt: new Date(), basis: 'rerank', matched: 0, candidates: 10,
    status: 'ok', truncated: false, lastAttemptAt: new Date(), lastError: null }

  it('only a complete, successful, reranked census supports "no matching researcher"', () => {
    expect(censusSupportsConclusion(base)).toBe(true)
    expect(censusSupportsConclusion(undefined)).toBe(false)
    expect(censusSupportsConclusion({ ...base, status: 'failed' })).toBe(false)
    expect(censusSupportsConclusion({ ...base, status: 'missing', refreshedAt: null })).toBe(false)
    expect(censusSupportsConclusion({ ...base, truncated: true })).toBe(false)
    expect(censusSupportsConclusion({ ...base, basis: 'vector' })).toBe(false)
  })
})

describe('match-width preview', () => {
  it('counts the same active, current-tenant population as the reports', async () => {
    await previewMatchWidths('tenant')
    const sql = m.query.mock.calls[0][0].sql as string
    expect(sql).toContain('current_match_user')
    expect(sql).toContain("current_match_user.status = 'ACTIVE'")
  })
})

describe('census fingerprint', () => {
  async function fingerprintSql() {
    const actual = await vi.importActual<typeof import('@/lib/fundingDept/callMatchFingerprint')>('@/lib/fundingDept/callMatchFingerprint')
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ fingerprint: 'x' }]) }
    await actual.callFingerprint('tenant', 'call', db as any)
    return { sql: db.$queryRaw.mock.calls[0][0], identity: actual.rerankerIdentity() }
  }

  it('ignores sign-ins but follows the reranker that scored it', async () => {
    const { sql, identity } = await fingerprintSql()
    expect(sql.sql).not.toContain('u."updatedAt"')
    expect(sql.sql).not.toContain('u.xmin')
    expect(identity).toBe('voyage:synthetic-reranker')
    expect(sql.values).toContain('voyage:synthetic-reranker')
  })
})
