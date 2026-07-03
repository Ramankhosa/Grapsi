import { describe, expect, it } from 'vitest'

import { calculateLandscapeSignals } from '@/lib/ideaIntelligence/service'
import { isPublicProjectCandidateDisplayable } from '@/lib/publicProjects/searchService'
import type { PublicProjectSearchItem } from '@/lib/publicProjects/searchService'

function project(overrides: Partial<PublicProjectSearchItem> = {}): PublicProjectSearchItem {
  return {
    id: 'project-1', sourceKey: 'PRISM', sourceName: 'PRISM', sourceUrl: null, detailUrl: null,
    title: 'A funded project', abstractText: 'Detailed evidence', executiveSummary: null,
    primaryInvestigatorName: null, primaryInstitutionName: null, schemeName: null, programName: null,
    sanctionYear: 2024, state: null, budgetAmount: null, budgetCurrency: 'INR', discipline: null,
    areaName: null, keywords: [], semanticSimilarity: 0.7, textRank: 0, relevanceScore: 0.8,
    ...overrides,
  }
}

describe('funding intelligence landscape signals', () => {
  it('computes overlap and white-space only from assessed evidence', () => {
    const projects = [project(), project({ id: 'project-2', sourceKey: 'CSIR', sanctionYear: 2020 })]
    const analysis = {
      items: [
        {
          projectId: 'project-1', summary: '',
          facetAssessments: [
            { facet: 'Facet A', status: 'PRESENT' as const, evidence: 'Evidence', reason: '' },
            { facet: 'Facet B', status: 'ABSENT' as const, evidence: 'Evidence', reason: '' },
            { facet: 'Facet C', status: 'UNASSESSED' as const, evidence: '', reason: '' },
          ],
        },
        {
          projectId: 'project-2', summary: '',
          facetAssessments: [
            { facet: 'Facet A', status: 'PARTIAL' as const, evidence: 'Evidence', reason: '' },
            { facet: 'Facet B', status: 'ABSENT' as const, evidence: 'Evidence', reason: '' },
          ],
        },
      ],
      strongestOverlap: [], whiteSpace: [], cautions: [],
    }

    const scores = calculateLandscapeSignals(projects, analysis)
    expect(scores.saturation).toBe(38)
    expect(scores.whiteSpace).toBe(50)
    expect(scores.evidenceConfidence).toBe(25)
    expect(scores.methodology).toContain('not a prediction')
  })

  it('returns zero confidence when no evidence was assessed', () => {
    const scores = calculateLandscapeSignals([], { items: [], strongestOverlap: [], whiteSpace: [], cautions: [] })
    expect(scores.evidenceConfidence).toBe(0)
    expect(scores.landscapePositioning).toBe(0)
  })

  it('adds cross-corpus triangulation from publications and patents', () => {
    const projects = [project()]
    const analysis = {
      items: [
        {
          projectId: 'project-1', summary: '',
          facetAssessments: [
            { facet: 'Facet A', status: 'ABSENT' as const, evidence: 'Not addressed', reason: '' },
          ],
        },
      ],
      publicationItems: [
        {
          sourceType: 'publication' as const, evidenceId: 'pub-1', title: 'Paper', summary: '',
          facetAssessments: [
            { facet: 'Facet A', status: 'PRESENT' as const, evidence: 'Studied', reason: '' },
          ],
        },
      ],
      patentItems: [
        {
          sourceType: 'patent' as const, evidenceId: 'pat-1', title: 'Patent', summary: '',
          facetAssessments: [
            { facet: 'Facet A', status: 'UNASSESSED' as const, evidence: '', reason: '' },
          ],
        },
      ],
      webItems: [],
      strongestOverlap: [], whiteSpace: [], cautions: [],
    }

    const scores = calculateLandscapeSignals(projects, analysis, {
      publications: [{ id: 'pub-1', title: 'Paper', authors: [], year: 2024, venue: null, abstract: null, doi: null, url: null, citationCount: 25, source: 'semantic_scholar' }],
      patents: [],
      webResults: [],
    })

    expect(scores.evidencePublications).toBe(1)
    expect(scores.crossCorpusFacets[0]?.signal).toBe('translation_gap')
  })
})

describe('public project result quality gate', () => {
  it('requires a meaningful reranker score', () => {
    expect(isPublicProjectCandidateDisplayable({ relevanceScore: 0.41, semanticSimilarity: 0.9, textRank: 0 }, true)).toBe(false)
    expect(isPublicProjectCandidateDisplayable({ relevanceScore: 0.42, semanticSimilarity: 0.1, textRank: 0 }, true)).toBe(true)
  })

  it('supports semantic or keyword evidence when reranking is unavailable', () => {
    expect(isPublicProjectCandidateDisplayable({ relevanceScore: 0, semanticSimilarity: 0.28, textRank: 0 }, false)).toBe(true)
    expect(isPublicProjectCandidateDisplayable({ relevanceScore: 0, semanticSimilarity: 0.1, textRank: 0.025 }, false)).toBe(true)
    expect(isPublicProjectCandidateDisplayable({ relevanceScore: 0, semanticSimilarity: 0.1, textRank: 0.01 }, false)).toBe(false)
  })
})
