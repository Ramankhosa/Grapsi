import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ rerank: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: m.query } }))
vi.mock('@/lib/services/embeddingService', () => ({ EmbeddingService: class { getHealth() { return { provider: 'voyage', outputDimensionality: 1024 } } } }))
vi.mock('@/lib/services/voyageRerankService', () => ({ voyageRerankService: { isConfigured: () => true, getModelName: () => 'test', rerank: m.rerank } }))
import { ResearcherSearchService } from '@/lib/services/researcherSearchService'

beforeEach(() => { vi.clearAllMocks(); m.rerank.mockResolvedValue([{ index: 0, relevanceScore: .8 }]) })
describe('discovery scores the research evidence that retrieved the person', () => {
  it('includes both publications and saved interests and invalidates a changed evidence cache key', async () => {
    const service = new ResearcherSearchService() as any
    const person = { userId: 'p', displayName: 'Person', researchSummary: 'General science', researchAreas: [], keywords: [],
      evidence: [{ source: 'publication', title: 'Cancer AI paper', snippet: 'Novel cancer biosensors' }, { source: 'research_area', title: 'Microfluidics', snippet: 'Point of care diagnostics' }] }
    await service.rerankCensus('diagnostics', [person])
    expect(m.rerank.mock.calls[0][0].documents[0]).toContain('Cancer AI paper')
    expect(m.rerank.mock.calls[0][0].documents[0]).toContain('Point of care diagnostics')
    const lookup = vi.fn().mockResolvedValue(new Map([['p', .8]])), cache = { lookup, store: vi.fn() }
    await service.rerankCensus('diagnostics', [person], cache)
    person.evidence[0].snippet = 'Changed research evidence'
    await service.rerankCensus('diagnostics', [person], cache)
    expect(lookup.mock.calls[0][0][0].inputHash).not.toBe(lookup.mock.calls[1][0][0].inputHash)
  })
  it('excludes inactive accounts before retrieval rather than after a bounded result list', async () => {
    m.query.mockResolvedValue([])
    const service = new ResearcherSearchService() as any
    vi.spyOn(service, 'buildQueryVectorLiteral').mockResolvedValue('[0]')
    await service.search({ query: 'biosensors', requesterTenantId: 'tenant', filters: { tenantOnly: true }, recordRun: false })
    for (const [sql] of m.query.mock.calls) expect(sql.sql).toContain("u.status = 'ACTIVE'")
  })
})
