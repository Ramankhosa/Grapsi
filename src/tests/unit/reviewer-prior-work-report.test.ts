import { describe, expect, it, vi } from 'vitest'

// usage.ts reaches prisma and the usage tracker; only the pure id helper is
// under test here.
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }))
vi.mock('@/lib/service-usage-tracker', () => ({
  releaseReservedServiceUsage: vi.fn(),
  reserveServiceUsage: vi.fn(),
  trackServiceUsage: vi.fn(),
  ServiceQuotaExceededError: class ServiceQuotaExceededError extends Error {},
}))

import { buildPriorWork, type PriorWorkAwardInput, type PriorWorkPatentInput } from '@/lib/ideaIntelligence/priorWork'
import { resolveReportSections } from '@/lib/reviewer/finalReport'
import { assembleLandscape, describeLandscapeRun, summarizeLandscape } from '@/lib/reviewer/landscapeCore'
import { landscapeSupportsNovelty } from '@/lib/reviewer/noveltyCore'
import { buildPriorWorkFlags } from '@/lib/reviewer/priorWorkFlags'
import { reviewerSectionOperationId } from '@/lib/reviewer/usage'

const NOW = new Date('2026-09-28T00:00:00Z')

function award(index: number, overrides: Partial<PriorWorkAwardInput> = {}): PriorWorkAwardInput {
  return {
    id: `a${index}`,
    title: `Funded project ${index}`,
    abstract: null,
    fundingAgency: 'DST',
    sourceName: null,
    sourceKey: null,
    schemeName: null,
    sanctionYear: 2021,
    budgetAmount: null,
    budgetCurrency: null,
    primaryInstitutionName: `Institute ${index}`,
    state: null,
    relevanceScore: 0.9 - index * 0.01,
    ...overrides,
  }
}

function patent(index: number, overrides: Partial<PriorWorkPatentInput> = {}): PriorWorkPatentInput {
  return {
    id: `p${index}`,
    title: `Patent ${index}`,
    abstract: 'A device.',
    publicationNumber: `IN20254100${index}A`,
    assignee: `Company ${index}`,
    inventor: null,
    priorityDate: null,
    filingDate: null,
    publicationDate: '2025-01-01',
    url: null,
    source: 'patentnest',
    ...overrides,
  }
}

const FACETS = ['sensor array', 'field calibration', 'yield model']

function priorWork(options: { tagged: boolean }) {
  const awards = Array.from({ length: 20 }, (_, index) => award(index))
  const patents = Array.from({ length: 10 }, (_, index) => patent(index))
  return buildPriorWork({
    awards,
    awardExtras: [],
    patents,
    awardAssessments: options.tagged
      ? awards.slice(0, 12).map((item) => ({ id: item.id, facetAssessments: [{ facet: 'yield model', status: 'PRESENT' as const }] }))
      : [],
    patentAssessments: options.tagged
      ? patents.map((item) => ({ id: item.id, facetAssessments: [{ facet: 'sensor array', status: 'PRESENT' as const }] }))
      : [],
    signals: FACETS.map((facet) => ({ facet, funded: 'UNASSESSED' as const, patented: 'UNASSESSED' as const })),
    now: NOW,
  })
}

describe('prior-work ranking across both corpora', () => {
  // Ties used to break on the award reranker score, which patents do not
  // have — so every award outranked every patent and a 12-row list showed
  // none of them.
  it('interleaves equally-covering awards and patents by their own retrieval order', () => {
    for (const tagged of [false, true]) {
      const rows = priorWork({ tagged }).rows
      const firstTwelve = rows.slice(0, 12)
      expect(firstTwelve.filter((row) => row.kind === 'patented').length).toBeGreaterThanOrEqual(5)
      expect(rows.slice(0, 2).map((row) => row.kind).sort()).toEqual(['funded', 'patented'])
    }
  })

  it('keeps the award reranker order among awards and the search order among patents', () => {
    const rows = priorWork({ tagged: false }).rows
    const awardIds = rows.filter((row) => row.kind === 'funded').map((row) => row.award!.id)
    const patentIds = rows.filter((row) => row.kind === 'patented').map((row) => row.patent!.id)
    expect(awardIds.slice(0, 3)).toEqual(['a0', 'a1', 'a2'])
    expect(patentIds.slice(0, 3)).toEqual(['p0', 'p1', 'p2'])
  })
})

function landscapeFrom(pw: ReturnType<typeof priorWork>, overrides: Record<string, any> = {}) {
  return {
    ...assembleLandscape({
      priorWork: pw,
      distillation: { facets: FACETS, keywords: [], semanticQuery: 'q', source: 'llm' },
      assessmentSource: 'llm',
      sources: {
        projects: { searched: true, count: 20, degradedMode: null },
        patents: { searched: true, status: 'ok', count: 10 },
      },
      now: NOW,
    }),
    ...overrides,
  }
}

describe('describeLandscapeRun', () => {
  it('says nothing about a clean run', () => {
    expect(describeLandscapeRun(landscapeFrom(priorWork({ tagged: true })))).toEqual([])
  })

  it('never lets a failed search read as an open field', () => {
    const failed = {
      status: 'error',
      priorWork: { rows: [] },
      sources: {
        projects: { searched: true, count: 0, degradedMode: null },
        patents: { searched: false, status: 'error', count: 0, error: 'PatentNest authentication failed.' },
      },
    } as any
    const notices = describeLandscapeRun(failed)
    expect(notices[0].tone).toBe('error')
    expect(notices[0].text).toContain('does not mean the field is open')
    expect(notices.some((notice) => notice.text.includes('PatentNest authentication failed'))).toBe(true)
  })

  it('names the failed source on a partial run and passes step notes through', () => {
    const partial = {
      status: 'partial',
      priorWork: { rows: [{ kind: 'funded' }] },
      sources: {
        projects: { searched: true, count: 3, degradedMode: null },
        patents: { searched: false, status: 'error', count: 0, error: 'Patent search timed out' },
      },
      notes: ['Matching timed out.'],
    } as any
    const texts = describeLandscapeRun(partial).map((notice) => notice.text)
    expect(texts[0]).toContain('Indian patent search failed for this run (Patent search timed out)')
    expect(texts).toContain('Matching timed out.')
  })
})

describe('summarizeLandscape', () => {
  it('counts both corpora and lists patented aspects, unfunded first in meaning', () => {
    const summary = summarizeLandscape(landscapeFrom(priorWork({ tagged: true })))!
    expect(summary.fundedCount).toBe(20)
    expect(summary.patentCount).toBe(10)
    expect(summary.patentedAspects).toHaveLength(1)
    expect(summary.patentedAspects[0].facet).toBe('sensor array')
    expect(summary.patentedAspects[0].unfunded).toBe(true)
    expect(summary.patentedAspects[0].numbers.length).toBeGreaterThan(0)
    expect(summary.searchFailed).toBe(false)
  })

  it('is null without a landscape', () => {
    expect(summarizeLandscape(null)).toBeNull()
  })
})

describe('buildPriorWorkFlags', () => {
  const landscape = landscapeFrom(priorWork({ tagged: true }))

  it('flags a panel that calls the idea novel when the check found it incremental', () => {
    const flags = buildPriorWorkFlags({
      overall: { executive_summary: 'The proposal is well argued. Its approach is highly innovative and timely.' },
      novelty: {
        verdict: 'incremental',
        already_done: [{ ref: 'IN202541000A', kind: 'patent', title: 'Patent 0', overlap: 'x', leaves_open: 'y' }],
        generic_signals: [],
      },
      landscape,
    })
    const conflict = flags.find((flag) => flag.kind === 'novelty_claim_conflict')!
    expect(conflict.issue).toContain('highly innovative')
    expect(conflict.issue).toContain('incremental')
    expect(conflict.refs).toEqual(['IN202541000A'])
  })

  it('stays quiet when the panel makes no novelty claim or the verdict supports it', () => {
    const quiet = buildPriorWorkFlags({
      overall: { executive_summary: 'A feasible plan with a clear budget.' },
      novelty: { verdict: 'incremental', already_done: [] },
      landscape: null,
    })
    expect(quiet).toEqual([])
    const supported = buildPriorWorkFlags({
      overall: { executive_summary: 'A novel sensor design.' },
      novelty: { verdict: 'differentiated' },
      landscape: null,
    })
    expect(supported).toEqual([])
  })

  it('flags aspects already patented, but only from assessed rows', () => {
    const flags = buildPriorWorkFlags({ overall: {}, novelty: null, landscape })
    const patented = flags.filter((flag) => flag.kind === 'patented_aspect')
    expect(patented).toHaveLength(1)
    expect(patented[0].severity).toBe('medium')
    expect(patented[0].issue).toContain('sensor array')
    const untagged = buildPriorWorkFlags({ overall: {}, novelty: null, landscape: { ...landscape, assessmentSource: 'fallback' } })
    expect(untagged).toEqual([])
  })
})

describe('landscapeSupportsNovelty', () => {
  it('runs novelty when one source failed but the other searched cleanly', () => {
    expect(landscapeSupportsNovelty({
      status: 'error',
      sources: {
        projects: { searched: true, count: 0, degradedMode: null },
        patents: { searched: false, status: 'error', count: 0 },
      },
    } as any)).toBe(true)
  })

  it('skips novelty when the whole step failed or nothing was searched', () => {
    expect(landscapeSupportsNovelty(null)).toBe(false)
    expect(landscapeSupportsNovelty({ status: 'error', error: 'timed out', sources: {} } as any)).toBe(false)
    expect(landscapeSupportsNovelty({
      status: 'error',
      sources: { projects: { searched: false, count: 0, degradedMode: null }, patents: { searched: false, status: 'error', count: 0 } },
    } as any)).toBe(false)
  })
})

describe('resolveReportSections', () => {
  const row = (title: string, version: number, status = 'reviewed') => ({ id: `${title}-${version}`, section_title: title, version, status })

  it('returns the scored version of each title and leaves out excluded ones', () => {
    const sections = [row('Objectives', 1), row('Objectives', 2), row('Budget', 1), row('Methods', 1)]
    const overall = {
      score_basis: { scoredVersions: { Objectives: 1, Methods: 1 }, excludedTitles: ['Budget'] },
    }
    expect(resolveReportSections(sections, overall).map((section) => section.id).sort()).toEqual(['Methods-1', 'Objectives-1'])
  })

  it('leaves out a section reviewed after the report was written', () => {
    const overall = { score_basis: { scoredVersions: { Objectives: 1 } } }
    expect(resolveReportSections([row('Objectives', 1), row('Impact', 1)], overall).map((section) => section.id)).toEqual(['Objectives-1'])
  })

  it('falls back to the newest reviewed version for reports without score_basis', () => {
    const sections = [row('Objectives', 1), row('Objectives', 2), row('Objectives', 3, 'draft')]
    expect(resolveReportSections(sections, {}).map((section) => section.id)).toEqual(['Objectives-2'])
  })
})

describe('reviewerSectionOperationId', () => {
  it('keeps the historical id for a first review or an unchanged re-run', () => {
    expect(reviewerSectionOperationId('s1', 2)).toBe('reviewer-section:s1:v2')
    expect(reviewerSectionOperationId('s1', 2, null)).toBe('reviewer-section:s1:v2')
  })

  it('makes an in-place edit a new, separately counted run', () => {
    expect(reviewerSectionOperationId('s1', 2, 'abc-1f')).toBe('reviewer-section:s1:v2:abc-1f')
  })
})
