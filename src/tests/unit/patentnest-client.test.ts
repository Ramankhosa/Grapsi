import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { PatentNestApiError, PatentNestClient } from '@/lib/patentnest/client'

const API_KEY = 'pn_live_test-key'

function successResponse(data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({
    data,
    meta: { requestId: 'request-1', durationMs: 12 },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': 'request-1',
      ...headers,
    },
  })
}

describe('PatentNestClient', () => {
  const originalFlag = process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER
  const originalBase = process.env.PATENTNEST_API_BASE_URL

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalFlag === undefined) delete process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER
    else process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER = originalFlag
    if (originalBase === undefined) delete process.env.PATENTNEST_API_BASE_URL
    else process.env.PATENTNEST_API_BASE_URL = originalBase
  })

  it('searches the fixed API origin with server-side bearer authentication', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse({
      query: 'battery cooling',
      count: 0,
      results: [],
    }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })

    await client.searchIndianPatents('  battery cooling  ', 12)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://patentnest.ai/api/v1/patents/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ query: 'battery cooling', limit: 12, jurisdictions: ['IN'] }),
        cache: 'no-store',
      }),
    )
  })

  it('validates configuration, query, and limit before making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>()

    expect(() => new PatentNestClient({ apiKey: '', fetchImplementation: fetchMock })).toThrow('not configured')
    expect(() => new PatentNestClient({ apiKey: 'wrong-prefix', fetchImplementation: fetchMock })).toThrow('invalid')

    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })
    await expect(client.searchIndianPatents('x')).rejects.toThrow('2 and 2,000')
    await expect(client.searchIndianPatents('valid query', 51)).rejects.toThrow('1 and 50')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retrieves a patent using an encoded publication number', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse({
      publicationNumber: 'IN 2028/2005 A',
    }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })

    await client.getIndianPatent('IN 2028/2005 A')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://patentnest.ai/api/v1/patents/IN%202028%2F2005%20A',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('does not include upstream response bodies or the API key in errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { message: `Rejected ${API_KEY}` },
    }), {
      status: 401,
      headers: { 'x-request-id': 'request-3' },
    }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })

    const error = await client.searchIndianPatents('battery cooling').catch((caught) => caught)

    expect(error).toBeInstanceOf(PatentNestApiError)
    expect(error).toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      requestId: 'request-3',
      message: 'PatentNest authentication failed.',
    })
    expect(error.message).not.toContain(API_KEY)
    expect(error).not.toHaveProperty('response')
    expect(error.upstreamCode).toBeUndefined()
  })

  it('passes the coverage manifest through and parses rate-limit headers into meta', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse(
      { query: 'q', count: 0, results: [], coverage: { corpus: 'indian-patent-journal', jurisdiction: 'IN', documents: null } },
      { 'RateLimit-Limit': '30', 'RateLimit-Remaining': '27', 'RateLimit-Reset': '12', 'X-RateLimit-Daily-Remaining': '1999', 'X-RateLimit-Monthly-Remaining': 'abc' },
    ))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })

    const response = await client.searchPatents('battery cooling', { limit: 5 })

    expect(response.data.coverage).toEqual({ corpus: 'indian-patent-journal', jurisdiction: 'IN', documents: null })
    expect(response.meta.rateLimit).toEqual({ limit: 30, remaining: 27, resetSeconds: 12, dailyRemaining: 1999, monthlyRemaining: null })
  })

  it('omits meta.rateLimit when no headers are present', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse({ query: 'q', count: 0, results: [] }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })
    const response = await client.searchPatents('battery cooling')
    expect(response.meta.rateLimit).toBeUndefined()
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ query: 'battery cooling', limit: 20 })
  })

  it('honours a base URL override from options or PATENTNEST_API_BASE_URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => successResponse({ query: 'q', count: 0, results: [] }))
    await new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock, baseUrl: 'https://staging.patentnest.ai/' }).searchPatents('battery cooling')
    expect(fetchMock).toHaveBeenLastCalledWith('https://staging.patentnest.ai/api/v1/patents/search', expect.anything())

    process.env.PATENTNEST_API_BASE_URL = 'http://localhost:4010'
    await new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock }).searchPatents('battery cooling')
    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:4010/api/v1/patents/search', expect.anything())
  })

  it('sends normalized jurisdictions by default and refuses to silently drop restrictions on legacy origins', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => successResponse({ query: 'q', count: 0, results: [] }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })

    delete process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER
    await client.searchPatents('battery cooling', { limit: 10, jurisdictions: ['in', 'US'] })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ query: 'battery cooling', limit: 10, jurisdictions: ['IN', 'US'] })

    process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER = 'true'
    await client.searchPatents('battery cooling', { limit: 10, jurisdictions: ['in', 'US', 'in'] })
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ query: 'battery cooling', limit: 10, jurisdictions: ['IN', 'US'] })
    process.env.PATENTNEST_SEARCH_JURISDICTION_FILTER = 'false'
    await expect(client.searchPatents('battery cooling', { jurisdictions: ['US'] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await client.searchIndianPatents('battery cooling')
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual({ query: 'battery cooling', limit: 20 })
  })

  it('sends filter-only structured searches, paging, sorting, selected fields and worldwide scope', async () => {
    const pagination = { offset: 25, limit: 25, hasMore: true, nextOffset: 50 }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse({ query: '', count: 1, results: [{ publicationNumber: 'US1', source: { name: 'Google Patents Public Data' }, grantDate: null }], mode: 'structured', pagination }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })
    const request = { mode: 'structured', filters: { applicants: ['Example University'], grantDateFrom: '2024-02-29', grantDateTo: '2024-02-29' }, fields: ['title', 'grantDate'], jurisdictions: ['*'], sort: 'grantDateDesc', limit: 25, offset: 25 } as const
    const response = await client.searchPatents({ ...request, fields: [...request.fields], jurisdictions: [...request.jurisdictions], filters: { ...request.filters, applicants: [...request.filters.applicants] } })
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(request)
    expect(response.data.pagination).toEqual(pagination)
    expect(response.data.results[0].grantDate).toBeNull()
  })

  it('supports selected fields on encoded detail lookups', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse({ publicationNumber: 'IN 1/A', source: { name: 'IP India' } }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })
    await client.getPatent('IN 1/A', { fields: ['title', 'grantDate', 'title'] })
    expect(fetchMock).toHaveBeenCalledWith('https://patentnest.ai/api/v1/patents/IN%201%2FA?fields=title%2CgrantDate', expect.objectContaining({ method: 'GET' }))
  })

  it('lifts the upstream machine code into the error while keeping our own message', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      error: { code: 'CORPUS_NOT_READY', message: 'internal detail that must not leak' },
    }), { status: 503, headers: { 'x-request-id': 'request-5' } }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock, sleep: async () => undefined })

    const error = await client.searchPatents('battery cooling').catch((caught) => caught)

    expect(fetchMock).toHaveBeenCalledTimes(3) // 503 is retried twice
    expect(error).toMatchObject({ status: 503, code: 'PATENTNEST_UNAVAILABLE', upstreamCode: 'CORPUS_NOT_READY', requestId: 'request-5' })
    expect(error.message).toBe('PatentNest is temporarily unavailable.')
    expect(error.message).not.toContain('internal detail')
  })

  it('lets interactive callers cap retries and retry pauses', async () => {
    const sleeps: number[] = []
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    }), { status: 429, headers: { 'retry-after': '20' } }))
    const client = new PatentNestClient({
      apiKey: API_KEY, fetchImplementation: fetchMock, maxRetries: 1, maxRetryDelayMs: 2_000,
      sleep: async (ms) => { sleeps.push(ms) },
    })

    const error = await client.searchPatents('battery cooling').catch((caught) => caught)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([2_000])
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 20, upstreamCode: 'RATE_LIMIT_EXCEEDED' })

    const noRetry = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock, maxRetries: 0, sleep: async () => undefined })
    fetchMock.mockClear()
    await noRetry.searchPatents('battery cooling').catch(() => undefined)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed upstream codes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'not a code <script>' },
    }), { status: 404 }))
    const client = new PatentNestClient({ apiKey: API_KEY, fetchImplementation: fetchMock })
    const error = await client.getPatent('IN 1').catch((caught) => caught)
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'The requested patent was not found.' })
    expect(error.upstreamCode).toBeUndefined()
  })
})
