import { afterEach, describe, expect, it, vi } from 'vitest'
import { PatentNestClient } from '@/lib/patentnest/client'
import { searchRequestSchema, patentSearchItemSchema } from '@/lib/patentIntelligence/schemas'
import { createPatentIntelligenceService, patentErrorResponse } from '@/lib/patentIntelligence/service'
import { PatentNestApiError } from '@/lib/patentnest/client'
import { buildShortlistCsv, formatPatentCitation, toPatentSearchItem } from '@/lib/patentIntelligence/searchCore'
import { readAdvancedPatentSearch, writeAdvancedPatentSearch, readPatentOffset } from '@/lib/patentIntelligence/advancedSearch'
import type { PatentNestSearchOptions } from '@/lib/patentnest/client'
import type { PatentShortlistItemDto } from '@/lib/patentIntelligence/types'

afterEach(() => vi.unstubAllEnvs())

describe('PatentNest v1.3 boundary validation', () => {
  it.each([
    {}, { filters: {} }, { filters: { owner: 'Org' } }, { query: 'ok', unexpected: true },
    { mode: 'hybrid', filters: { title: 'battery' } }, { query: 'battery', offset: 1 },
    { query: 'battery', sort: 'filingDateDesc' }, { mode: 'structured', query: 'battery', sort: 'relevance' },
    { filters: { filingDateFrom: '2025-02-29' } }, { filters: { grantDateTo: '2024-13-01' } },
    { filters: { publicationDateFrom: '2025-02-01', publicationDateTo: '2024-01-01' } },
    { filters: { title: 'battery' }, offset: 10001 }, { filters: { title: 'battery' }, limit: 51 },
    { filters: { title: 'battery' }, fields: ['claims'] }, { filters: { title: 'battery' }, jurisdictions: ['USA'] },
    { filters: { applicants: [] } }, { filters: { applicationNumber: ' / ' } },
    { query: 'battery', jurisdictions: ['*', 'US'] }, { query: 'battery', jurisdictions: ['*', '*'] },
  ])('rejects invalid requests without issuing an upstream call: %j', async input => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = new PatentNestClient({ apiKey: 'pn_live_test', fetchImplementation: fetchMock })
    expect(searchRequestSchema.safeParse(input).success).toBe(false)
    await expect(client.searchPatents(input as never)).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts inclusive exact dates, filter-only mode and the maximum offset', () => {
    expect(searchRequestSchema.parse({ filters: { grantDateFrom: '2024-02-29', grantDateTo: '2024-02-29' }, offset: 10000, limit: 50, jurisdictions: ['*'], fields: ['grantDate'] })).toMatchObject({ offset: 10000, limit: 50, jurisdictions: ['*'] })
  })
})

describe('structured search service', () => {
  function setup() {
    const searchPatents = vi.fn(async (_query: string, options?: PatentNestSearchOptions) => ({
      data: { query: '', count: 1, results: [{ publicationNumber: 'US1', title: 'Battery', grantDate: null }], mode: 'structured' as const,
        pagination: { offset: options?.offset || 0, limit: options?.limit || 30, hasMore: true, nextOffset: (options?.offset || 0) + (options?.limit || 30) },
        coverage: { corpus: 'worldwide', jurisdictions: ['US'], sources: [{ corpus: 'google-patents', license: 'CC-BY-4.0', attribution: 'Provider attribution' }], limitations: ['Quarterly updates'] },
      }, meta: { requestId: 'r-13', durationMs: 20 },
    }))
    return { searchPatents, service: createPatentIntelligenceService({ client: () => ({ searchPatents, getPatent: vi.fn() }) }) }
  }

  it('forwards filter-only requests and preserves pagination and worldwide coverage', async () => {
    vi.stubEnv('PATENTNEST_SEARCH_JURISDICTION_FILTER', 'true')
    const { service, searchPatents } = setup()
    const result = await service.searchPatents({ filters: { title: 'battery' }, jurisdictions: ['us'], limit: 1, offset: 0 })
    expect(searchPatents).toHaveBeenCalledWith('', { filters: { title: 'battery' }, jurisdictions: ['US'], limit: 1, offset: 0 })
    expect(result).toMatchObject({ mode: 'structured', capped: false, pagination: { offset: 0, hasMore: true, nextOffset: 1 } })
    expect(result.coverage).toMatchObject({ jurisdictions: ['US'], sources: [{ license: 'CC-BY-4.0', attribution: 'Provider attribution' }], limitations: ['Quarterly updates'] })
  })

  it('isolates cached pages, fields, filters, modes, offices and sorts', async () => {
    vi.stubEnv('PATENTNEST_SEARCH_JURISDICTION_FILTER', 'true')
    const { service, searchPatents } = setup()
    const request = { mode: 'structured' as const, query: 'battery', filters: { title: 'battery' }, limit: 5 }
    await service.searchPatents(request)
    expect((await service.searchPatents(request)).diagnostics.cached).toBe(true)
    for (const change of [{ offset: 5 }, { fields: ['title'] as const }, { filters: { title: 'solar' } }, { mode: 'hybrid' as const }, { jurisdictions: ['US'] }, { sort: 'titleAsc' as const }]) {
      await service.searchPatents({ ...request, ...change } as never)
    }
    expect(searchPatents).toHaveBeenCalledTimes(7)
  })

  it('keeps literal structured query spacing distinct in requests and cache keys', async () => {
    const { service, searchPatents } = setup()
    await service.searchPatents({ mode: 'structured', query: 'solar  cell' })
    await service.searchPatents({ mode: 'structured', query: 'solar cell' })
    expect(searchPatents).toHaveBeenCalledTimes(2)
    expect(searchPatents.mock.calls[0][0]).toBe('solar  cell')
  })

  it('surfaces a malformed upstream page as an error instead of an empty result', async () => {
    const service = createPatentIntelligenceService({ client: () => ({ searchPatents: vi.fn(async () => ({ data: { query: '', count: 0, results: [] }, meta: { requestId: 'broken', durationMs: 1 } })), getPatent: vi.fn() }) })
    await expect(service.searchPatents({ filters: { title: 'battery' } })).rejects.toMatchObject({ code: 'PATENTNEST_INVALID_RESPONSE', status: 502 })
  })

  it('maps unavailable offices as a correctable search choice', async () => {
    const response = patentErrorResponse(new PatentNestApiError({ code: 'FORBIDDEN', upstreamCode: 'JURISDICTION_NOT_AVAILABLE', status: 403, message: 'denied' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'JURISDICTION_NOT_AVAILABLE' })
  })

  it('isolates selected-field lookup caches from complete patent records', async () => {
    const getPatent = vi.fn(async (_publication: string, options?: { fields?: string[] }) => ({
      data: { publicationNumber: 'US1', title: options?.fields ? 'Selected' : 'Complete', source: { name: 'Google Patents Public Data' } }, meta: { requestId: 'detail-13', durationMs: 1 },
    }))
    const service = createPatentIntelligenceService({ client: () => ({ searchPatents: vi.fn(), getPatent }) })
    expect((await service.getPatent('US1', { fields: ['title'] })).patent.title).toBe('Selected')
    expect((await service.getPatent('US1')).patent.title).toBe('Complete')
    expect((await service.getPatent('US1', { fields: ['title'] })).diagnostics.cached).toBe(true)
    expect(getPatent).toHaveBeenCalledTimes(2)
    expect(getPatent).toHaveBeenNthCalledWith(1, 'US1', { fields: ['title'] })
  })
})

describe('v1.3 records and URL state', () => {
  it('preserves recorded dates, family matches and licence attribution through saves and exports', () => {
    const record = toPatentSearchItem({ publicationNumber: 'IN1B', title: 'Battery', publicationDate: '2020-01-01', grantDate: '2024-03-03', familyId: 'family-1', source: { name: 'Google Patents Public Data', license: 'CC-BY-4.0', attribution: 'Provider attribution' }, relevance: { matchedViaFamilyMember: 'US1B2' } })!
    const saved = patentSearchItemSchema.parse(record)
    expect(saved).toMatchObject({ grantDate: '2024-03-03', familyId: 'family-1', source: { attribution: 'Provider attribution' }, relevance: { matchedViaFamilyMember: 'US1B2' } })
    const citation = formatPatentCitation(record)
    expect(citation).toContain('granted 2024-03-03')
    expect(citation).toContain('CC-BY-4.0')
    expect(citation).toContain('Provider attribution')
    expect(citation).toContain('US1B2')
    const csv = buildShortlistCsv([{ record, note: null, createdAt: '2026-11-03' } as PatentShortlistItemDto])
    expect(csv).toContain('2024-03-03,family-1,US1B2,CC-BY-4.0,Provider attribution')
    expect(toPatentSearchItem({ publicationNumber: 'US1B2', kind: 'B2', publicationDate: '2024-03-03' })?.grantDate).toBeNull()
  })

  it('round-trips applicant names with commas and resets pagination on a new search', () => {
    const params = new URLSearchParams('runId=idea-1&offset=20')
    const advanced = { mode: 'structured' as const, sort: 'grantDateDesc' as const, jurisdictions: ['IN', 'US'], filters: { applicants: ['Institute, Delhi', 'Acme'], grantDateFrom: '2024-01-01' } }
    writeAdvancedPatentSearch(params, advanced)
    expect(readAdvancedPatentSearch(key => params.get(key))).toEqual(advanced)
    expect(params.get('runId')).toBe('idea-1')
    expect(params.has('offset')).toBe(false)
    expect(readPatentOffset('10000')).toBe(10000)
    expect(readPatentOffset('-1')).toBe(0)
  })
})
