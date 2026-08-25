import { describe, expect, it } from 'vitest'

import { buildPriorWork, type PriorWorkPatentInput } from '@/lib/ideaIntelligence/priorWork'
import {
  assembleLandscape,
  buildFallbackDistillation,
  deriveFacetSignals,
  normalizeDistillation,
  normalizeFacetMap,
  type LandscapeDistillation,
  type LandscapeSourceOutcomes,
} from '@/lib/reviewer/landscapeCore'

const NOW = new Date('2026-08-21T00:00:00Z')

const FACETS = ['Portable biosensor design', 'On-device ML classification', 'Rural deployment model']

function distillation(overrides: Partial<LandscapeDistillation> = {}): LandscapeDistillation {
  return {
    facets: FACETS,
    keywords: ['biosensor', 'classification'],
    semanticQuery: 'portable biosensor with on-device machine learning for rural clinics',
    source: 'llm',
    ...overrides,
  }
}

function emptyPriorWork() {
  return buildPriorWork({
    awards: [], awardExtras: [], patents: [], awardAssessments: [], patentAssessments: [], signals: [],
  })
}

describe('buildFallbackDistillation', () => {
  it('produces at least three facets and a searchable query from real sections', () => {
    const result = buildFallbackDistillation({
      projectTitle: 'Portable biosensor platform for rural diagnostics',
      callDescription: 'Call for translational healthcare devices.',
      sectionDigests: [
        { title: 'Objectives', text: 'Develop a low-cost biosensor; validate on-device classification models; deploy in rural primary health centres.' },
        { title: 'Methodology', text: 'Electrochemical sensing combined with embedded machine learning inference.' },
      ],
    })
    expect(result.source).toBe('fallback')
    expect(result.facets.length).toBeGreaterThanOrEqual(3)
    expect(result.facets.length).toBeLessThanOrEqual(7)
    expect(result.semanticQuery.length).toBeGreaterThanOrEqual(2)
    expect(result.semanticQuery.length).toBeLessThanOrEqual(500)
  })

  it('pads degenerate input with generic facets and still yields a valid query', () => {
    const result = buildFallbackDistillation({ projectTitle: '', callDescription: '', sectionDigests: [] })
    expect(result.facets.length).toBeGreaterThanOrEqual(3)
    expect(result.semanticQuery.length).toBeGreaterThanOrEqual(2)
  })
})

describe('normalizeDistillation', () => {
  it('passes a well-formed model response through', () => {
    const fallback = distillation({ source: 'fallback' })
    const result = normalizeDistillation(
      { facets: FACETS, keywords: ['biosensor'], semanticQuery: 'biosensor rural ML' },
      fallback
    )
    expect(result.source).toBe('llm')
    expect(result.facets).toEqual(FACETS)
    expect(result.semanticQuery).toBe('biosensor rural ML')
  })

  it('falls back when the model returns too few facets or no query', () => {
    const fallback = distillation({ source: 'fallback' })
    expect(normalizeDistillation({ facets: ['only one'], semanticQuery: 'q' }, fallback)).toBe(fallback)
    expect(normalizeDistillation(null, fallback)).toBe(fallback)
    expect(normalizeDistillation({ facets: FACETS, semanticQuery: '' }, fallback)).toBe(fallback)
  })

  it('clips oversize facet text and caps the facet count at seven', () => {
    const fallback = distillation({ source: 'fallback' })
    const longFacet = 'x'.repeat(400)
    const result = normalizeDistillation(
      { facets: [longFacet, ...FACETS, 'a4', 'a5', 'a6', 'a7', 'a8'], semanticQuery: 'valid query' },
      fallback
    )
    expect(result.facets.length).toBeLessThanOrEqual(7)
    expect(result.facets[0].length).toBeLessThanOrEqual(180)
  })
})

describe('normalizeFacetMap', () => {
  const ids = { projectIds: ['p1', 'p2'], patentIds: ['pt1'], facets: FACETS }

  it('keeps only known ids and canonical facets, coercing statuses', () => {
    const result = normalizeFacetMap({
      items: [
        { projectId: 'p1', facetAssessments: [{ facet: FACETS[0].toUpperCase(), status: 'present' }] },
        { projectId: 'hallucinated', facetAssessments: [{ facet: FACETS[0], status: 'PRESENT' }] },
      ],
      patentItems: [
        { evidenceId: 'pt1', facetAssessments: [{ facet: 'made-up facet', status: 'PRESENT' }, { facet: FACETS[1], status: 'garbage' }] },
      ],
    }, ids)

    expect(result.assessed).toBe(true)
    expect(result.awardAssessments).toHaveLength(1)
    expect(result.awardAssessments[0].id).toBe('p1')
    expect(result.awardAssessments[0].facetAssessments).toEqual([{ facet: FACETS[0], status: 'PRESENT' }])
    // Unknown facet dropped; junk status coerced to UNASSESSED.
    expect(result.patentAssessments[0].facetAssessments).toEqual([{ facet: FACETS[1], status: 'UNASSESSED' }])
  })

  it('reports assessed:false on a null or empty response', () => {
    expect(normalizeFacetMap(null, ids).assessed).toBe(false)
    expect(normalizeFacetMap({}, ids).assessed).toBe(false)
    expect(normalizeFacetMap({ items: [], patentItems: [] }, ids).assessed).toBe(false)
  })
})

describe('deriveFacetSignals', () => {
  it('applies PRESENT > PARTIAL > ABSENT precedence independently per corpus', () => {
    const signals = deriveFacetSignals(
      FACETS,
      [
        { id: 'p1', facetAssessments: [{ facet: FACETS[0], status: 'PARTIAL' }, { facet: FACETS[1], status: 'ABSENT' }] },
        { id: 'p2', facetAssessments: [{ facet: FACETS[0], status: 'PRESENT' }] },
      ],
      [
        { id: 'pt1', facetAssessments: [{ facet: FACETS[1], status: 'PARTIAL' }] },
      ]
    )
    expect(signals[0]).toEqual({ facet: FACETS[0], funded: 'PRESENT', patented: 'UNASSESSED' })
    expect(signals[1]).toEqual({ facet: FACETS[1], funded: 'ABSENT', patented: 'PARTIAL' })
    expect(signals[2]).toEqual({ facet: FACETS[2], funded: 'UNASSESSED', patented: 'UNASSESSED' })
  })
})

describe('assembleLandscape status matrix', () => {
  const okSources = (): LandscapeSourceOutcomes => ({
    projects: { searched: true, count: 1, degradedMode: null },
    patents: { searched: true, status: 'ok', count: 1 },
  })

  function landscapeWith(sources: LandscapeSourceOutcomes, priorWork = emptyPriorWork(), error?: string) {
    return assembleLandscape({
      priorWork,
      distillation: distillation(),
      assessmentSource: 'llm',
      sources,
      now: NOW,
      error,
    })
  }

  function priorWorkWithOneRow() {
    return buildPriorWork({
      awards: [{
        id: 'p1', title: 'Funded biosensor project', abstract: null, fundingAgency: 'DBT',
        sourceName: 'DBT', sourceKey: 'DBT', schemeName: null, sanctionYear: 2024,
        budgetAmount: null, budgetCurrency: null, primaryInstitutionName: 'IISc', state: null,
        relevanceScore: 0.7,
      }],
      awardExtras: [], patents: [], awardAssessments: [], patentAssessments: [], signals: [],
    })
  }

  it('is error when an explicit error is passed', () => {
    expect(landscapeWith(okSources(), emptyPriorWork(), 'boom').status).toBe('error')
  })

  it('is error when both retrievals failed', () => {
    const sources = okSources()
    sources.projects.error = 'db down'
    sources.patents.status = 'error'
    expect(landscapeWith(sources).status).toBe('error')
  })

  it('is partial when one source errored but rows exist', () => {
    const sources = okSources()
    sources.patents.status = 'error'
    expect(landscapeWith(sources, priorWorkWithOneRow()).status).toBe('partial')
  })

  it('is ok when patents are merely not configured and rows exist', () => {
    const sources = okSources()
    sources.patents.status = 'not_configured'
    sources.patents.searched = false
    sources.patents.count = 0
    expect(landscapeWith(sources, priorWorkWithOneRow()).status).toBe('ok')
  })

  it('is empty when searches ran cleanly and returned nothing', () => {
    const sources = okSources()
    sources.projects.count = 0
    sources.patents.count = 0
    expect(landscapeWith(sources).status).toBe('empty')
  })
})

describe('end-to-end pure assembly', () => {
  it('carries facet tags through buildPriorWork into the persisted rows', () => {
    const patents: PriorWorkPatentInput[] = [{
      id: 'pt1', title: 'Biosensor cartridge', abstract: 'A biosensor cartridge.',
      publicationNumber: 'IN500001', assignee: 'Acme Diagnostics', inventor: null,
      priorityDate: '2022-01-01', filingDate: '2022-01-01', publicationDate: '2023-05-01',
      url: null, source: 'patentnest',
    }]
    const awardAssessments = [{ id: 'p1', facetAssessments: [{ facet: FACETS[0], status: 'PRESENT' as const }] }]
    const patentAssessments = [{ id: 'pt1', facetAssessments: [{ facet: FACETS[1], status: 'PARTIAL' as const }] }]

    const priorWork = buildPriorWork({
      awards: [{
        id: 'p1', title: 'Funded biosensor project', abstract: 'Portable biosensor for clinics.',
        fundingAgency: 'DBT', sourceName: 'DBT', sourceKey: 'DBT', schemeName: 'BioCARe',
        sanctionYear: 2024, budgetAmount: 2_000_000, budgetCurrency: 'INR',
        primaryInstitutionName: 'IISc', state: 'Karnataka', relevanceScore: 0.7,
      }],
      awardExtras: [{ id: 'p1', durationMonths: 36, hasReportedOutput: false, patentCount: 1, publicationCount: 2, status: 'ongoing' }],
      patents,
      awardAssessments,
      patentAssessments,
      signals: deriveFacetSignals(FACETS, awardAssessments, patentAssessments),
    })

    const landscape = assembleLandscape({
      priorWork,
      distillation: distillation(),
      assessmentSource: 'llm',
      sources: {
        projects: { searched: true, count: 1, degradedMode: null },
        patents: { searched: true, status: 'ok', count: 1 },
      },
      now: NOW,
    })

    expect(landscape.status).toBe('ok')
    expect(landscape.priorWork.summary.totalRows).toBe(2)
    expect(landscape.priorWork.summary.fundedRows).toBe(1)
    expect(landscape.priorWork.summary.patentedRows).toBe(1)
    const fundedRow = landscape.priorWork.rows.find((row) => row.kind === 'funded')
    const patentRow = landscape.priorWork.rows.find((row) => row.kind === 'patented')
    expect(fundedRow?.facetsCovered).toEqual([FACETS[0]])
    expect(fundedRow?.award?.status).toBe('ongoing')
    expect(patentRow?.facetsCovered).toEqual([FACETS[1]])
    expect(patentRow?.patent?.publicationNumber).toBe('IN500001')
    expect(landscape.generated_at).toBe(NOW.toISOString())
  })
})
