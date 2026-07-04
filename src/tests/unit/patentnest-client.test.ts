import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { PatentNestApiError, PatentNestClient } from '@/lib/patentnest/client'

const API_KEY = 'pn_live_test-key'

function successResponse(data: unknown) {
  return new Response(JSON.stringify({
    data,
    meta: { requestId: 'request-1', durationMs: 12 },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': 'request-1',
    },
  })
}

describe('PatentNestClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
        body: JSON.stringify({ query: 'battery cooling', limit: 12 }),
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
  })
})
