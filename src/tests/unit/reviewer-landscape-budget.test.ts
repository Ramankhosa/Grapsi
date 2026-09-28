import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The landscape used to race the whole build against one 75s timer, so a slow
// tagging call threw away searches that had already come back — the report
// then said "no comparable patents were retrieved". These tests hang a step
// and check the rest of the landscape survives.

const aux = vi.fn()
const searchProjects = vi.fn()
const searchPatents = vi.fn()

vi.mock('@/lib/reviewer/auxLlm', () => ({ runReviewerAuxiliaryText: (...args: any[]) => aux(...args) }))
vi.mock('@/lib/reviewer/usage', () => ({
  resolveReviewerCallOwner: vi.fn(async () => ({ tenantId: 't1', userId: 'u1' })),
}))
vi.mock('@/lib/publicProjects/searchService', () => ({
  publicProjectSearchService: { search: (...args: any[]) => searchProjects(...args) },
}))
vi.mock('@/lib/ideaIntelligence/evidenceSources', () => ({
  retrievePatentnestPatents: (...args: any[]) => searchPatents(...args),
}))
vi.mock('@/lib/ideaIntelligence/projectRecords', () => ({ loadProjectRecords: vi.fn(async () => ({ extras: [] })) }))
vi.mock('@/lib/recommendations/conversationUtils', () => ({ extractJsonObject: (text: string) => JSON.parse(text) }))

import { buildReviewerLandscape } from '@/lib/reviewer/landscape'

const DISTILLED = JSON.stringify({
  facets: ['soil moisture sensing', 'irrigation scheduling', 'low-cost telemetry'],
  keywords: ['irrigation'],
  semanticQuery: 'low-cost soil moisture sensing for irrigation scheduling',
})

function project(id: string) {
  return {
    id, title: `Project ${id}`, abstractText: 'Sensors in fields.', executiveSummary: null, fundingAgency: 'DST',
    sourceName: null, sourceKey: 'DST', schemeName: null, sanctionYear: 2022, budgetAmount: null, budgetCurrency: null,
    primaryInstitutionName: `Inst ${id}`, state: null, relevanceScore: 0.8,
  }
}

function patentEvidence(id: string) {
  return {
    id, title: `Patent ${id}`, abstract: 'A moisture probe.', publicationNumber: `IN2025${id}A`, assignee: `Co ${id}`,
    inventor: null, priorityDate: null, filingDate: null, publicationDate: '2025-02-01', url: null, source: 'patentnest',
  }
}

const INPUT = {
  callId: 'call-1',
  projectTitle: 'Smart irrigation',
  parsedContext: { call_summary: 'Agritech call' },
  modelType: 'G' as const,
  sections: [{ title: 'Methodology', contextSummary: 'Deploy soil moisture sensors with LoRa telemetry.', userInput: '' }],
}

beforeEach(() => {
  vi.useFakeTimers()
  aux.mockReset()
  searchProjects.mockReset()
  searchPatents.mockReset()
  searchProjects.mockResolvedValue({ results: [project('a1'), project('a2')], degradedMode: null })
  searchPatents.mockResolvedValue({ results: [patentEvidence('p1'), patentEvidence('p2')], status: 'ok' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('buildReviewerLandscape time budgets', () => {
  it('keeps the retrieved rows when the tagging call hangs', async () => {
    aux.mockImplementation(async ({ stageCode }: { stageCode: string }) => (
      stageCode === 'GRANT_REVIEWER_LANDSCAPE_DISTILL' ? DISTILLED : new Promise(() => {})
    ))

    const pending = buildReviewerLandscape(INPUT)
    await vi.advanceTimersByTimeAsync(80_000)
    const landscape = await pending

    expect(landscape).not.toBeNull()
    expect(landscape!.status).toBe('ok')
    expect(landscape!.priorWork.rows.filter((row) => row.kind === 'patented')).toHaveLength(2)
    expect(landscape!.priorWork.rows.filter((row) => row.kind === 'funded')).toHaveLength(2)
    expect(landscape!.assessmentSource).toBe('fallback')
    expect(landscape!.notes?.join(' ')).toMatch(/timed out/)
  })

  it('falls back to a text query when the distill call hangs, and still searches', async () => {
    aux.mockImplementation(async ({ stageCode }: { stageCode: string }) => (
      stageCode === 'GRANT_REVIEWER_LANDSCAPE_DISTILL' ? new Promise(() => {}) : JSON.stringify({ items: [], patentItems: [] })
    ))

    const pending = buildReviewerLandscape(INPUT)
    await vi.advanceTimersByTimeAsync(80_000)
    const landscape = await pending

    expect(searchPatents).toHaveBeenCalledTimes(1)
    expect(landscape!.facetSource).toBe('fallback')
    expect(landscape!.priorWork.rows).toHaveLength(4)
  })

  it('records a hung patent search as a failed source instead of losing the projects', async () => {
    aux.mockImplementation(async ({ stageCode }: { stageCode: string }) => (
      stageCode === 'GRANT_REVIEWER_LANDSCAPE_DISTILL' ? DISTILLED : JSON.stringify({ items: [], patentItems: [] })
    ))
    searchPatents.mockReturnValue(new Promise(() => {}))

    const pending = buildReviewerLandscape(INPUT)
    await vi.advanceTimersByTimeAsync(80_000)
    const landscape = await pending

    expect(landscape!.status).toBe('partial')
    expect(landscape!.sources.patents.status).toBe('error')
    expect(landscape!.sources.patents.error).toMatch(/timed out/)
    expect(landscape!.priorWork.rows.filter((row) => row.kind === 'funded')).toHaveLength(2)
  })

  it('passes bounded retry options to the patent client', async () => {
    aux.mockImplementation(async () => DISTILLED)
    const pending = buildReviewerLandscape(INPUT)
    await vi.advanceTimersByTimeAsync(80_000)
    await pending
    const options = searchPatents.mock.calls[0][2]
    expect(options.maxRetries).toBe(1)
    expect(options.maxRetryDelayMs).toBeLessThanOrEqual(5_000)
  })
})
