import { describe, expect, it } from 'vitest'

import {
  collectNoveltyReferences,
  computeEvidenceCoverage,
  fallbackNoveltyAssessment,
  normalizeNoveltyAssessment,
} from '@/lib/reviewer/noveltyCore'

const NOW = new Date('2026-08-22T00:00:00Z')

function landscape(overrides: Partial<{ projects: number; patentsOk: boolean; rows: any[] }> = {}) {
  const rows = overrides.rows ?? []
  return {
    sources: {
      projects: { searched: true, count: overrides.projects ?? 0, degradedMode: null },
      patents: { searched: Boolean(overrides.patentsOk), status: overrides.patentsOk ? 'ok' : 'not_configured', count: 0 },
    },
    priorWork: { rows },
  } as any
}

const FUNDED_ROW = { key: 'a1', kind: 'funded', title: 'IoT yield forecasting', facetsCovered: ['sensors'], award: { id: 'proj-1', duplicateIds: ['proj-1b'] }, patent: null }
const PATENT_ROW = { key: 'p1', kind: 'patented', title: 'Irrigation sensor', facetsCovered: [], award: null, patent: { familyIds: ['pat-1'], publicationNumber: 'IN412337' } }

describe('computeEvidenceCoverage', () => {
  it('is thin with no landscape or nearly no projects', () => {
    expect(computeEvidenceCoverage(null)).toBe('thin')
    expect(computeEvidenceCoverage(landscape({ projects: 1 }))).toBe('thin')
  })
  it('is partial with a few projects or a patent search that found rows', () => {
    expect(computeEvidenceCoverage(landscape({ projects: 3 }))).toBe('partial')
    expect(computeEvidenceCoverage(landscape({ projects: 0, patentsOk: true, rows: [PATENT_ROW, PATENT_ROW] }))).toBe('partial')
  })
  it('is strong only when both corpora answered well', () => {
    const rows = Array.from({ length: 6 }, () => FUNDED_ROW)
    expect(computeEvidenceCoverage(landscape({ projects: 8, patentsOk: true, rows }))).toBe('strong')
    expect(computeEvidenceCoverage(landscape({ projects: 8, patentsOk: false, rows }))).toBe('partial')
  })
})

describe('collectNoveltyReferences', () => {
  it('collects award ids, duplicates, patent family ids and publication numbers', () => {
    const refs = collectNoveltyReferences(landscape({ rows: [FUNDED_ROW, PATENT_ROW] }))
    expect(refs.map((r) => r.ref)).toEqual(['proj-1', 'proj-1b', 'pat-1', 'IN412337'])
  })
})

describe('normalizeNoveltyAssessment', () => {
  const references = collectNoveltyReferences(landscape({ rows: [FUNDED_ROW, PATENT_ROW] }))

  it('passes a well-formed verdict through and keeps only known refs', () => {
    const result = normalizeNoveltyAssessment({
      verdict: 'incremental',
      confidence: 'medium',
      positioning_summary: 'Sensor-fed yield models are established.',
      already_done: [
        { ref: 'proj-1', overlap: 'sensor network', leaves_open: 'pest-driven loss' },
        { ref: 'made-up', overlap: 'x', leaves_open: 'y' },
      ],
      generic_signals: ['no crop named'],
      what_would_make_it_distinctive: [{ change: 'Pick one crop', why: 'specificity', effort: 'quick', section: 'Objectives' }],
    }, { references, evidenceCoverage: 'partial', now: NOW })

    expect(result.verdict).toBe('incremental')
    expect(result.confidence).toBe('medium')
    expect(result.already_done).toHaveLength(1)
    expect(result.already_done[0]).toMatchObject({ ref: 'proj-1', kind: 'funded', title: 'IoT yield forecasting' })
    expect(result.what_would_make_it_distinctive[0].effort).toBe('quick')
    expect(result.source).toBe('llm')
  })

  it('downgrades incremental without a valid citation', () => {
    const result = normalizeNoveltyAssessment(
      { verdict: 'incremental', confidence: 'high', already_done: [{ ref: 'nope' }] },
      { references, evidenceCoverage: 'strong', now: NOW }
    )
    expect(result.verdict).toBe('unassessed')
    expect(result.confidence).toBe('low')
  })

  it('downgrades generic without any listed signal', () => {
    const result = normalizeNoveltyAssessment(
      { verdict: 'generic', confidence: 'high' },
      { references, evidenceCoverage: 'strong', now: NOW }
    )
    expect(result.verdict).toBe('unassessed')
  })

  it('caps confidence and forbids novelty on thin evidence', () => {
    const novel = normalizeNoveltyAssessment(
      { verdict: 'novel_within_evidence', confidence: 'high', distinctive_claims: ['x'] },
      { references, evidenceCoverage: 'thin', now: NOW }
    )
    expect(novel.verdict).toBe('unassessed')
    expect(novel.confidence).toBe('low')

    const generic = normalizeNoveltyAssessment(
      { verdict: 'generic', confidence: 'high', generic_signals: ['restates the call'] },
      { references, evidenceCoverage: 'thin', now: NOW }
    )
    expect(generic.verdict).toBe('generic')
    expect(generic.confidence).toBe('low')
  })

  it('coerces unknown verdicts and null input to the fallback shape', () => {
    expect(normalizeNoveltyAssessment({ verdict: 'amazing' }, { references, evidenceCoverage: 'partial', now: NOW }).verdict).toBe('unassessed')
    expect(normalizeNoveltyAssessment(null, { references, evidenceCoverage: 'partial', now: NOW })).toEqual(fallbackNoveltyAssessment('partial', NOW))
  })
})
