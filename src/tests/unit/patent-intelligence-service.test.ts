import { ZodError } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PatentNestApiError } from '@/lib/patentnest/client'
import type { IndianPatentRecord, PatentNestResponse, PatentNestSearchData } from '@/lib/patentnest/types'
import {
  PATENT_RATE_LIMITS,
  createPatentIntelligenceService,
  enforcePatentRateLimit,
  patentErrorResponse,
  type PatentNestClientLike,
} from '@/lib/patentIntelligence/service'
import { __resetRateLimitWindowsForTests } from '@/lib/recommendations/rateLimit'

function envelope<T>(data: T, extraMeta: Record<string, unknown> = {}): PatentNestResponse<T> {
  return { data, meta: { requestId: 'req-1', durationMs: 42, ...extraMeta } } as PatentNestResponse<T>
}

function searchData(results: IndianPatentRecord[] = [{ publicationNumber: 'IN 1', title: 'One', country: 'IN' }]): PatentNestSearchData {
  return {
    query: 'q', count: results.length, results,
    coverage: { corpus: 'indian-patent-journal', description: 'Indian patent corpus', jurisdiction: 'IN', documents: 160000, semanticCoveragePercent: 99.2, searchMode: 'hybrid', embeddingModel: 'voyage' },
  }
}

function fakeClient(overrides: Partial<PatentNestClientLike> = {}) {
  const client: PatentNestClientLike = {
    searchPatents: vi.fn(async () => envelope(searchData(), { rateLimit: { limit: 30, remaining: 27, resetSeconds: 10, dailyRemaining: 1900, monthlyRemaining: 49000 } })),
    getPatent: vi.fn(async (publicationNumber: string) => envelope<IndianPatentRecord>({ publicationNumber, title: 'Detail' })),
    ...overrides,
  }
  return client
}

describe('createPatentIntelligenceService', () => {
  const originalFlag = process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER
    else process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER = originalFlag
    vi.restoreAllMocks()
  })

  it('normalizes results, facets, coverage and upstream remaining budget', async () => {
    const client = fakeClient()
    const service = createPatentIntelligenceService({ client: () => client })
    const result = await service.searchPatents({ query: '  solar   cell ', limit: 30 })
    expect(client.searchPatents).toHaveBeenCalledWith('solar cell', { limit: 30, jurisdictions: [] })
    expect(result.results[0]).toMatchObject({ publicationNumberKey: 'IN1', jurisdiction: 'IN', title: 'One' })
    expect(result.facets.jurisdictions).toEqual([{ value: 'IN', count: 1 }])
    expect(result.coverage).toEqual({ corpus: 'indian-patent-journal', description: 'Indian patent corpus', jurisdiction: 'IN', documents: 160000, semanticCoveragePercent: 99.2, searchMode: 'hybrid', embeddingModel: 'voyage' })
    expect(result.capped).toBe(false)
    expect(result.diagnostics).toEqual({ requestId: 'req-1', durationMs: 42, cached: false, jurisdictionFilterApplied: false, upstreamRemaining: { minute: 27, daily: 1900, monthly: 49000 } })
  })

  it('serves repeats from cache, honours the TTL, and never caches failures', async () => {
    let clock = 0
    const client = fakeClient()
    const service = createPatentIntelligenceService({ client: () => client, now: () => clock })
    const first = await service.searchPatents({ query: 'solar cell' })
    const second = await service.searchPatents({ query: 'Solar  cell' })
    expect(client.searchPatents).toHaveBeenCalledTimes(1)
    expect(first.diagnostics.cached).toBe(false)
    expect(second.diagnostics.cached).toBe(true)

    clock = 6 * 60 * 1000
    await service.searchPatents({ query: 'solar cell' })
    expect(client.searchPatents).toHaveBeenCalledTimes(2)

    const failing = fakeClient({ searchPatents: vi.fn()
      .mockRejectedValueOnce(new PatentNestApiError({ code: 'PATENTNEST_UNAVAILABLE', message: 'down', status: 503 }))
      .mockResolvedValue(envelope(searchData())) })
    const flaky = createPatentIntelligenceService({ client: () => failing })
    await expect(flaky.searchPatents({ query: 'battery' })).rejects.toBeInstanceOf(PatentNestApiError)
    await flaky.searchPatents({ query: 'battery' })
    expect(failing.searchPatents).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent identical searches and evicts the oldest key past 200 entries', async () => {
    let resolveSearch: (value: PatentNestResponse<PatentNestSearchData>) => void = () => undefined
    const pending = new Promise<PatentNestResponse<PatentNestSearchData>>((resolve) => { resolveSearch = resolve })
    const client = fakeClient({ searchPatents: vi.fn().mockReturnValueOnce(pending).mockResolvedValue(envelope(searchData())) })
    const service = createPatentIntelligenceService({ client: () => client })
    const a = service.searchPatents({ query: 'membrane' })
    const b = service.searchPatents({ query: 'membrane' })
    resolveSearch(envelope(searchData()))
    await Promise.all([a, b])
    expect(client.searchPatents).toHaveBeenCalledTimes(1)

    for (let index = 0; index < 200; index += 1) await service.searchPatents({ query: `query ${index}` })
    await service.searchPatents({ query: 'membrane' })
    // 1 (membrane) + 200 + 1 (membrane again, evicted) = 202 upstream calls
    expect(client.searchPatents).toHaveBeenCalledTimes(202)
  })

  it('forwards jurisdictions only when the env flag is on', async () => {
    const client = fakeClient()
    const service = createPatentIntelligenceService({ client: () => client })
    delete process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER
    await service.searchPatents({ query: 'pump', jurisdictions: ['in'] })
    expect(client.searchPatents).toHaveBeenLastCalledWith('pump', { limit: 30, jurisdictions: [] })

    process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER = 'true'
    const result = await service.searchPatents({ query: 'pump', jurisdictions: ['in', 'US', 'xx1'] })
    expect(client.searchPatents).toHaveBeenLastCalledWith('pump', { limit: 30, jurisdictions: ['IN', 'US'] })
    expect(result.diagnostics.jurisdictionFilterApplied).toBe(true)
  })

  it('rejects invalid queries before calling upstream and caches detail lookups by normalized key', async () => {
    const client = fakeClient()
    const service = createPatentIntelligenceService({ client: () => client })
    await expect(service.searchPatents({ query: 'x' })).rejects.toMatchObject({ code: 'INVALID_QUERY', status: 400 })
    expect(client.searchPatents).not.toHaveBeenCalled()

    const detail = await service.getPatent('IN 2028/2005 A')
    const again = await service.getPatent('in-2028-2005-a')
    expect(client.getPatent).toHaveBeenCalledTimes(1)
    expect(detail.patent.publicationNumberKey).toBe('IN20282005A')
    expect(again.diagnostics.cached).toBe(true)
    await expect(service.getPatent('   ')).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_NUMBER' })
  })
})

describe('enforcePatentRateLimit', () => {
  beforeEach(() => __resetRateLimitWindowsForTests())

  it('limits a single user per minute with Retry-After', async () => {
    for (let index = 0; index < PATENT_RATE_LIMITS.search; index += 1) {
      expect(enforcePatentRateLimit('user-1', 'search')).toBeNull()
    }
    const limited = enforcePatentRateLimit('user-1', 'search')
    expect(limited?.status).toBe(429)
    expect(Number(limited?.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    await expect(limited?.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' })
    // Other buckets are independent.
    expect(enforcePatentRateLimit('user-1', 'detail')).toBeNull()
  })

  it('applies a global search bucket across users', async () => {
    const perUser = PATENT_RATE_LIMITS.search
    const global = PATENT_RATE_LIMITS.searchGlobal
    const users = Math.ceil((global + 1) / perUser) + 1
    let limited: Response | null = null
    let calls = 0
    for (let user = 0; user < users && !limited; user += 1) {
      for (let index = 0; index < perUser && !limited; index += 1) {
        calls += 1
        limited = enforcePatentRateLimit(`user-${user}`, 'search')
      }
    }
    expect(limited?.status).toBe(429)
    expect(calls).toBe(global + 1)
    await expect(limited?.json()).resolves.toMatchObject({ code: 'RATE_LIMITED', error: expect.stringContaining('busy') })
  })
})

describe('patentErrorResponse', () => {
  const cases: Array<[PatentNestApiError, number, string]> = [
    [new PatentNestApiError({ code: 'PATENTNEST_NOT_CONFIGURED', message: 'nc', status: 503 }), 503, 'PATENT_SEARCH_NOT_CONFIGURED'],
    [new PatentNestApiError({ code: 'INVALID_QUERY', message: 'bad', status: 400 }), 400, 'INVALID_REQUEST'],
    [new PatentNestApiError({ code: 'UNAUTHORIZED', message: 'auth', status: 401, requestId: 'r-401' }), 502, 'PATENTNEST_UPSTREAM_AUTH'],
    [new PatentNestApiError({ code: 'FORBIDDEN', message: 'auth', status: 403 }), 502, 'PATENTNEST_UPSTREAM_AUTH'],
    [new PatentNestApiError({ code: 'NOT_FOUND', message: 'nf', status: 404 }), 404, 'PATENT_NOT_FOUND'],
    [new PatentNestApiError({ code: 'RATE_LIMITED', message: 'rl', status: 429, retryAfterSeconds: 7, upstreamCode: 'DAILY_QUOTA_EXCEEDED' }), 429, 'UPSTREAM_RATE_LIMITED'],
    [new PatentNestApiError({ code: 'PATENTNEST_TIMEOUT', message: 't', status: 503 }), 504, 'PATENTNEST_TIMEOUT'],
    [new PatentNestApiError({ code: 'PATENTNEST_UNAVAILABLE', message: 'u', status: 503, upstreamCode: 'CORPUS_NOT_READY' }), 503, 'PATENTNEST_UNAVAILABLE'],
    [new PatentNestApiError({ code: 'PATENTNEST_INTERNAL_ERROR', message: 'i', status: 500 }), 502, 'PATENTNEST_UPSTREAM_ERROR'],
  ]

  it.each(cases)('maps %s → %i %s', async (error, status, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = patentErrorResponse(error)
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body.code).toBe(code)
    expect(typeof body.error).toBe('string')
    if (error.requestId) {
      expect(response.headers.get('X-Request-ID')).toBe(error.requestId)
      expect(body.requestId).toBe(error.requestId)
    }
    if (error.retryAfterSeconds) {
      expect(response.headers.get('Retry-After')).toBe(String(error.retryAfterSeconds))
      expect(body.retryAfterSeconds).toBe(error.retryAfterSeconds)
    }
    if (error.upstreamCode) expect(body.upstreamCode).toBe(error.upstreamCode)
  })

  it('maps zod errors to 400 and hides internals for unknown errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const zod = patentErrorResponse(new ZodError([{ code: 'custom', message: 'query too short', path: ['query'] }]))
    expect(zod.status).toBe(400)
    await expect(zod.json()).resolves.toEqual({ error: 'query too short', code: 'INVALID_REQUEST' })

    const unknown = patentErrorResponse(new Error('connection string postgres://secret'))
    expect(unknown.status).toBe(500)
    const body = await unknown.json()
    expect(body).toEqual({ error: 'Unable to complete the patent request.', code: 'INTERNAL_ERROR' })
    expect(JSON.stringify(body)).not.toContain('secret')
  })
})
