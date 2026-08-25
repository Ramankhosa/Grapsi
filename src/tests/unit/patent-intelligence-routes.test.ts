import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PatentNestApiError } from '@/lib/patentnest/client'
import type { PatentSearchItem, PatentSearchResponse } from '@/lib/patentIntelligence/types'

/**
 * Route-level contract tests for /api/patent-intelligence/*: auth passthrough,
 * validation, feature gate, rate-limit short-circuit, envelopes, error mapping.
 */

const mocks = vi.hoisted(() => ({
  requireFundingActor: vi.fn(),
  isPatentSearchEnabled: vi.fn(),
  enforcePatentRateLimit: vi.fn(),
  service: { searchPatents: vi.fn(), getPatent: vi.fn() },
  shortlist: {
    listShortlist: vi.fn(),
    saveToShortlist: vi.fn(),
    assertIdeaRunOwnership: vi.fn(),
    updateShortlistNote: vi.fn(),
    removeFromShortlist: vi.fn(),
  },
}))

vi.mock('@/lib/funding/access', () => ({ requireFundingActor: mocks.requireFundingActor }))

vi.mock('@/lib/patentIntelligence/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/patentIntelligence/service')>()
  return {
    ...actual,
    isPatentSearchEnabled: mocks.isPatentSearchEnabled,
    enforcePatentRateLimit: mocks.enforcePatentRateLimit,
    patentIntelligenceService: mocks.service,
  }
})

vi.mock('@/lib/patentIntelligence/shortlist', () => mocks.shortlist)

const ACTOR = { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false }

const ITEM: PatentSearchItem = {
  id: 'IN1', publicationNumber: 'IN 1', publicationNumberKey: 'IN1', applicationNumber: null, kind: 'A', country: 'IN', jurisdiction: 'IN',
  title: 'One', abstract: 'Abstract', applicants: [{ name: 'Org', address: null }], inventors: ['X'], classifications: ['A61K 31/00'],
  classificationGroups: ['A61K'], filingDate: '2020-01-01', publicationDate: '2021-01-01', filingYear: 2020, publicationYear: 2021,
  numberOfPages: 3, numberOfClaims: 4, extractionConfidence: 0.9, source: { name: 'IP India', document: null, page: null },
  relevance: { score: 0.8, semanticScore: 0.8, textScore: 0.2, matchedFields: ['title'] },
}

const SEARCH: PatentSearchResponse = {
  query: 'solar cell', limit: 30, results: [ITEM], facets: { jurisdictions: [], applicants: [], years: [], classifications: [], kinds: [] },
  coverage: null, capped: false,
  diagnostics: { requestId: 'req-9', durationMs: 10, cached: false, jurisdictionFilterApplied: false, upstreamRemaining: null },
}

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

function getRequest(url: string, method = 'GET') {
  return new NextRequest(`http://localhost${url}`, { method })
}

describe('patent-intelligence routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireFundingActor.mockResolvedValue({ actor: ACTOR, user: { id: 'user-1' } })
    mocks.isPatentSearchEnabled.mockReturnValue(true)
    mocks.enforcePatentRateLimit.mockReturnValue(null)
    mocks.service.searchPatents.mockResolvedValue(SEARCH)
    mocks.service.getPatent.mockResolvedValue({ patent: ITEM, diagnostics: { requestId: null, cached: false } })
    mocks.shortlist.listShortlist.mockResolvedValue([])
    mocks.shortlist.assertIdeaRunOwnership.mockResolvedValue(true)
  })

  describe('POST /api/patent-intelligence/search', () => {
    it('passes through the auth failure response', async () => {
      mocks.requireFundingActor.mockResolvedValue({ response: NextResponse.json({ error: 'nope' }, { status: 401 }) })
      const { POST } = await import('@/app/api/patent-intelligence/search/route')
      const response = await POST(jsonRequest('/api/patent-intelligence/search', { query: 'solar cell' }))
      expect(response.status).toBe(401)
      expect(mocks.service.searchPatents).not.toHaveBeenCalled()
    })

    it('returns 503 PATENT_SEARCH_NOT_CONFIGURED when no key is set', async () => {
      mocks.isPatentSearchEnabled.mockReturnValue(false)
      const { POST } = await import('@/app/api/patent-intelligence/search/route')
      const response = await POST(jsonRequest('/api/patent-intelligence/search', { query: 'solar cell' }))
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({ code: 'PATENT_SEARCH_NOT_CONFIGURED' })
    })

    it('short-circuits on the rate limiter and validates the body', async () => {
      const { POST } = await import('@/app/api/patent-intelligence/search/route')
      mocks.enforcePatentRateLimit.mockReturnValueOnce(NextResponse.json({ code: 'RATE_LIMITED' }, { status: 429 }))
      expect((await POST(jsonRequest('/api/patent-intelligence/search', { query: 'solar cell' }))).status).toBe(429)

      const bad = await POST(jsonRequest('/api/patent-intelligence/search', { query: 'x' }))
      expect(bad.status).toBe(400)
      await expect(bad.json()).resolves.toMatchObject({ code: 'INVALID_REQUEST' })
      expect(mocks.service.searchPatents).not.toHaveBeenCalled()
    })

    it('returns the search envelope with the upstream request id header', async () => {
      const { POST } = await import('@/app/api/patent-intelligence/search/route')
      const response = await POST(jsonRequest('/api/patent-intelligence/search', { query: 'solar cell', limit: 30 }))
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Request-ID')).toBe('req-9')
      expect(mocks.service.searchPatents).toHaveBeenCalledWith({ query: 'solar cell', limit: 30 })
      const body = await response.json()
      expect(body.results).toHaveLength(1)
      expect(body.diagnostics.requestId).toBe('req-9')
    })

    it('maps upstream failures through patentErrorResponse', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.service.searchPatents.mockRejectedValue(new PatentNestApiError({ code: 'RATE_LIMITED', message: 'rl', status: 429, retryAfterSeconds: 5 }))
      const { POST } = await import('@/app/api/patent-intelligence/search/route')
      const response = await POST(jsonRequest('/api/patent-intelligence/search', { query: 'solar cell' }))
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('5')
      await expect(response.json()).resolves.toMatchObject({ code: 'UPSTREAM_RATE_LIMITED', retryAfterSeconds: 5 })
    })
  })

  describe('GET /api/patent-intelligence/patents/[publicationNumber]', () => {
    it('decodes the number and returns the patent', async () => {
      const { GET } = await import('@/app/api/patent-intelligence/patents/[publicationNumber]/route')
      const response = await GET(getRequest('/api/patent-intelligence/patents/IN%202028%2F2005%20A'), { params: { publicationNumber: 'IN%202028%2F2005%20A' } })
      expect(response.status).toBe(200)
      expect(mocks.service.getPatent).toHaveBeenCalledWith('IN 2028/2005 A')
      await expect(response.json()).resolves.toMatchObject({ patent: { publicationNumberKey: 'IN1' } })
    })

    it('maps a missing patent to 404 PATENT_NOT_FOUND', async () => {
      mocks.service.getPatent.mockRejectedValue(new PatentNestApiError({ code: 'NOT_FOUND', message: 'nf', status: 404, requestId: 'r-404' }))
      const { GET } = await import('@/app/api/patent-intelligence/patents/[publicationNumber]/route')
      const response = await GET(getRequest('/api/patent-intelligence/patents/IN9'), { params: { publicationNumber: 'IN9' } })
      expect(response.status).toBe(404)
      expect(response.headers.get('X-Request-ID')).toBe('r-404')
      await expect(response.json()).resolves.toMatchObject({ code: 'PATENT_NOT_FOUND' })
    })
  })

  describe('shortlist routes', () => {
    const dto = { id: 's1', publicationNumber: 'IN 1', publicationNumberKey: 'IN1', title: 'One', note: null, ideaRunId: null, record: ITEM, createdAt: 'a', updatedAt: 'b' }

    it('lists the user shortlist, scoped by runId', async () => {
      mocks.shortlist.listShortlist.mockResolvedValue([dto])
      const { GET } = await import('@/app/api/patent-intelligence/shortlist/route')
      const response = await GET(getRequest('/api/patent-intelligence/shortlist?runId=run-1'))
      expect(mocks.shortlist.listShortlist).toHaveBeenCalledWith('user-1', { ideaRunId: 'run-1' })
      await expect(response.json()).resolves.toEqual({ items: [dto] })
    })

    it('rejects a foreign ideaRunId and is idempotent on save', async () => {
      const { POST } = await import('@/app/api/patent-intelligence/shortlist/route')
      mocks.shortlist.assertIdeaRunOwnership.mockResolvedValueOnce(false)
      const foreign = await POST(jsonRequest('/api/patent-intelligence/shortlist', { record: ITEM, ideaRunId: 'someone-elses' }))
      expect(foreign.status).toBe(404)
      expect(mocks.shortlist.saveToShortlist).not.toHaveBeenCalled()

      mocks.shortlist.saveToShortlist.mockResolvedValueOnce({ item: dto, created: true }).mockResolvedValueOnce({ item: dto, created: false })
      const first = await POST(jsonRequest('/api/patent-intelligence/shortlist', { record: ITEM, note: 'cite' }))
      const second = await POST(jsonRequest('/api/patent-intelligence/shortlist', { record: ITEM }))
      expect(first.status).toBe(201)
      expect(second.status).toBe(200)
      expect(mocks.shortlist.saveToShortlist).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1', note: 'cite' }))
    })

    it('rejects malformed records', async () => {
      const { POST } = await import('@/app/api/patent-intelligence/shortlist/route')
      const response = await POST(jsonRequest('/api/patent-intelligence/shortlist', { record: { title: 'no number' } }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_REQUEST' })
    })

    it('returns 404 for PATCH/DELETE on rows the user does not own', async () => {
      mocks.shortlist.updateShortlistNote.mockResolvedValue(null)
      mocks.shortlist.removeFromShortlist.mockResolvedValue(false)
      const { PATCH, DELETE } = await import('@/app/api/patent-intelligence/shortlist/[id]/route')
      expect((await PATCH(jsonRequest('/api/patent-intelligence/shortlist/s9', { note: 'x' }, 'PATCH'), { params: { id: 's9' } })).status).toBe(404)
      expect((await DELETE(getRequest('/api/patent-intelligence/shortlist/s9', 'DELETE'), { params: { id: 's9' } })).status).toBe(404)
      expect(mocks.shortlist.removeFromShortlist).toHaveBeenCalledWith('user-1', 's9')

      mocks.shortlist.removeFromShortlist.mockResolvedValue(true)
      const ok = await DELETE(getRequest('/api/patent-intelligence/shortlist/s1', 'DELETE'), { params: { id: 's1' } })
      await expect(ok.json()).resolves.toEqual({ ok: true })
    })

    it('exports CSV and Markdown as downloads', async () => {
      mocks.shortlist.listShortlist.mockResolvedValue([dto])
      const { GET } = await import('@/app/api/patent-intelligence/shortlist/export/route')
      const csv = await GET(getRequest('/api/patent-intelligence/shortlist/export?format=csv'))
      expect(csv.status).toBe(200)
      expect(csv.headers.get('Content-Type')).toContain('text/csv')
      expect(csv.headers.get('Content-Disposition')).toMatch(/attachment; filename="patent-shortlist-\d{8}\.csv"/)
      expect(await csv.text()).toContain('publication_number,title')

      const md = await GET(getRequest('/api/patent-intelligence/shortlist/export?format=md&runId=run-1'))
      expect(md.headers.get('Content-Type')).toContain('text/markdown')
      expect(mocks.shortlist.listShortlist).toHaveBeenLastCalledWith('user-1', { ideaRunId: 'run-1' })
      expect(await md.text()).toContain('## Related patents')

      const bad = await GET(getRequest('/api/patent-intelligence/shortlist/export?format=pdf'))
      expect(bad.status).toBe(400)
    })
  })
})
