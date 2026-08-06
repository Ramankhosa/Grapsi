import { describe, expect, it } from 'vitest'

import {
  buildPriorWork,
  jurisdictionOf,
  orgKey,
  type PriorWorkAwardExtras,
  type PriorWorkAwardInput,
  type PriorWorkPatentInput,
} from '@/lib/ideaIntelligence/priorWork'

const NOW = new Date('2026-07-31T00:00:00Z')

function award(overrides: Partial<PriorWorkAwardInput> = {}): PriorWorkAwardInput {
  return {
    id: 'award-1',
    title: 'Point of care diagnostic platform',
    abstract: 'A portable diagnostic platform for rural primary health centres.',
    fundingAgency: 'BIRAC',
    sourceName: 'PRISM',
    sourceKey: 'PRISM',
    schemeName: 'BIG',
    sanctionYear: 2023,
    budgetAmount: 5_000_000,
    budgetCurrency: 'INR',
    primaryInstitutionName: 'IIT Bombay',
    state: 'Maharashtra',
    relevanceScore: 0.8,
    ...overrides,
  }
}

function extras(overrides: Partial<PriorWorkAwardExtras> = {}): PriorWorkAwardExtras {
  return {
    id: 'award-1',
    durationMonths: 24,
    hasReportedOutput: true,
    patentCount: 0,
    publicationCount: 0,
    status: 'completed',
    ...overrides,
  }
}

function patent(overrides: Partial<PriorWorkPatentInput> = {}): PriorWorkPatentInput {
  return {
    id: 'patent-1',
    title: 'Serially chambered reaction cartridge',
    abstract: 'A cartridge with serially arranged reaction chambers for point-of-care assays.',
    publicationNumber: 'IN402318',
    assignee: 'Sun Pharma Ltd',
    inventor: null,
    priorityDate: '2019-04-01',
    filingDate: '2019-04-01',
    publicationDate: '2021-06-01',
    url: 'https://patents.example/IN402318',
    source: 'patentnest',
    ...overrides,
  }
}

describe('prior work normalisation', () => {
  it('reads the jurisdiction off the publication number', () => {
    expect(jurisdictionOf('IN402318')).toBe('IN')
    expect(jurisdictionOf('us 9,123,456')).toBe('US')
    expect(jurisdictionOf('')).toBeNull()
    expect(jurisdictionOf(null)).toBeNull()
  })

  it('ignores corporate suffixes when keying an organisation', () => {
    expect(orgKey('Sun Pharma Ltd')).toBe(orgKey('Sun Pharma Private Limited'))
    expect(orgKey('IIT Bombay')).not.toBe(orgKey('IIT Madras'))
  })
})

describe('buildPriorWork', () => {
  it('collapses the same award arriving from two source feeds', () => {
    const result = buildPriorWork({
      awards: [
        award({ id: 'a1', sourceKey: 'PRISM', relevanceScore: 0.6 }),
        award({ id: 'a2', sourceKey: 'CSIR', relevanceScore: 0.9 }),
      ],
      awardExtras: [extras({ id: 'a1' }), extras({ id: 'a2' })],
      patents: [],
      awardAssessments: [],
      patentAssessments: [],
      signals: [],
      now: NOW,
    })

    expect(result.summary.fundedRows).toBe(1)
    expect(result.summary.duplicateAwardsCollapsed).toBe(1)
    expect(result.rows[0].award?.duplicateIds).toEqual(['a2'])
    // The better-indexed copy must not be penalised by the merge.
    expect(result.rows[0].award?.relevanceScore).toBe(0.9)
  })

  it('keeps distinct awards from the same institution in different years', () => {
    const result = buildPriorWork({
      awards: [award({ id: 'a1', sanctionYear: 2021 }), award({ id: 'a2', sanctionYear: 2024 })],
      awardExtras: [extras({ id: 'a1' }), extras({ id: 'a2' })],
      patents: [],
      awardAssessments: [],
      patentAssessments: [],
      signals: [],
      now: NOW,
    })
    expect(result.summary.fundedRows).toBe(2)
  })

  it('collapses a patent family into one row and dates it by the earliest member', () => {
    const result = buildPriorWork({
      awards: [],
      awardExtras: [],
      patents: [
        patent({ id: 'p-in', publicationNumber: 'IN402318', publicationDate: '2021-06-01' }),
        patent({ id: 'p-us', publicationNumber: 'US9123456', publicationDate: '2020-02-01' }),
        patent({ id: 'p-wo', publicationNumber: 'WO2019123', publicationDate: '2019-09-01' }),
      ],
      awardAssessments: [],
      patentAssessments: [],
      signals: [],
      now: NOW,
    })

    expect(result.summary.patentedRows).toBe(1)
    expect(result.summary.patentFamiliesCollapsed).toBe(2)
    expect(result.rows[0].patent?.familySize).toBe(3)
    expect(result.rows[0].patent?.jurisdictions.sort()).toEqual(['IN', 'US', 'WO'])
    expect(result.rows[0].year).toBe(2019)
  })

  it('unions the facets assessed across family members', () => {
    const result = buildPriorWork({
      awards: [],
      awardExtras: [],
      patents: [patent({ id: 'p-in' }), patent({ id: 'p-us', publicationNumber: 'US912' })],
      awardAssessments: [],
      patentAssessments: [
        { id: 'p-in', facetAssessments: [{ facet: 'cartridge design', status: 'PRESENT' }] },
        { id: 'p-us', facetAssessments: [{ facet: 'assay chemistry', status: 'PARTIAL' }] },
      ],
      signals: [],
      now: NOW,
    })
    expect(result.rows[0].facetsCovered.sort()).toEqual(['assay chemistry', 'cartridge design'])
  })

  it('ranks by how much of the idea each row touches, across both corpora', () => {
    const result = buildPriorWork({
      awards: [award({ id: 'a1', relevanceScore: 0.99 })],
      awardExtras: [extras({ id: 'a1' })],
      patents: [patent({ id: 'p1' })],
      awardAssessments: [{ id: 'a1', facetAssessments: [{ facet: 'f1', status: 'PRESENT' }] }],
      patentAssessments: [{
        id: 'p1',
        facetAssessments: [
          { facet: 'f1', status: 'PRESENT' },
          { facet: 'f2', status: 'PRESENT' },
        ],
      }],
      signals: [],
      now: NOW,
    })
    // The patent touches two facets, the award one — coverage wins over the
    // award's retrieval score, which the patent corpus has no equivalent of.
    expect(result.rows[0].kind).toBe('patented')
  })
})

describe('gap readings', () => {
  const signals = [{ facet: 'rural calibration', funded: 'ABSENT' as const, patented: 'ABSENT' as const }]

  it('marks an unfunded, unpatented facet as unexplored', () => {
    const result = buildPriorWork({
      awards: [award({ id: 'a1' })],
      awardExtras: [extras({ id: 'a1' })],
      patents: [],
      awardAssessments: [{ id: 'a1', facetAssessments: [{ facet: 'assay chemistry', status: 'PRESENT' }] }],
      patentAssessments: [],
      signals: [...signals, { facet: 'assay chemistry', funded: 'PRESENT', patented: 'ABSENT' }],
      now: NOW,
    })
    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0].reading).toBe('unexplored')
  })

  it('marks a facet claimed by a patent as blocked and names the number', () => {
    const result = buildPriorWork({
      awards: [],
      awardExtras: [],
      patents: [patent({ id: 'p1' })],
      awardAssessments: [],
      patentAssessments: [{ id: 'p1', facetAssessments: [{ facet: 'rural calibration', status: 'PRESENT' }] }],
      signals: [{ facet: 'rural calibration', funded: 'ABSENT', patented: 'PRESENT' }],
      now: NOW,
    })
    expect(result.gaps[0].reading).toBe('blocked')
    expect(result.gaps[0].readingBasis).toContain('IN402318')
    expect(result.gaps[0].blockingRowKeys).toHaveLength(1)
  })

  it('marks a facet a completed award touched without recording output as attempted', () => {
    const result = buildPriorWork({
      awards: [award({ id: 'a1' })],
      awardExtras: [extras({ id: 'a1', status: 'completed', hasReportedOutput: false })],
      patents: [],
      awardAssessments: [{ id: 'a1', facetAssessments: [{ facet: 'rural calibration', status: 'PARTIAL' }] }],
      patentAssessments: [],
      signals,
      now: NOW,
    })
    expect(result.gaps[0].reading).toBe('attempted_no_output')
    expect(result.gaps[0].attemptedRowKeys).toHaveLength(1)
  })

  it('does not raise a gap for a facet the sources could not assess', () => {
    const result = buildPriorWork({
      awards: [],
      awardExtras: [],
      patents: [],
      awardAssessments: [],
      patentAssessments: [],
      signals: [{ facet: 'unknown ground', funded: 'UNASSESSED', patented: 'UNASSESSED' }],
      now: NOW,
    })
    expect(result.gaps).toHaveLength(0)
  })

  it('reports the effort band and freshness from the nearest funded neighbours', () => {
    const result = buildPriorWork({
      awards: [
        award({ id: 'a1', budgetAmount: 4_000_000, sanctionYear: 2016 }),
        award({ id: 'a2', title: 'Another platform', budgetAmount: 6_000_000, sanctionYear: 2017 }),
      ],
      awardExtras: [
        extras({ id: 'a1', durationMonths: 24 }),
        extras({ id: 'a2', durationMonths: 36 }),
      ],
      patents: [],
      awardAssessments: [
        { id: 'a1', facetAssessments: [{ facet: 'assay chemistry', status: 'PRESENT' }] },
        { id: 'a2', facetAssessments: [{ facet: 'assay chemistry', status: 'PRESENT' }] },
      ],
      patentAssessments: [],
      signals,
      now: NOW,
    })

    const gap = result.gaps[0]
    expect(gap.effort).toEqual({
      medianBudget: 5_000_000,
      budgetCurrency: 'INR',
      medianDurationMonths: 30,
      sampleSize: 2,
    })
    expect(gap.latestActivityYear).toBe(2017)
    expect(gap.yearsSinceActivity).toBe(9)
    // Nine years since the newest neighbouring award reads as a closed field,
    // not an opening, and the researcher has to be told which it looks like.
    expect(gap.stale).toBe(true)
  })
})

describe('funder signals', () => {
  it('counts how often each funder\'s awards reported patents', () => {
    const result = buildPriorWork({
      awards: [
        award({ id: 'a1', fundingAgency: 'BIRAC' }),
        award({ id: 'a2', fundingAgency: 'BIRAC', title: 'Second platform' }),
        award({ id: 'a3', fundingAgency: 'ICMR', title: 'Third platform' }),
      ],
      awardExtras: [
        extras({ id: 'a1', patentCount: 2 }),
        extras({ id: 'a2', patentCount: 1 }),
        extras({ id: 'a3', patentCount: 0 }),
      ],
      patents: [],
      awardAssessments: [],
      patentAssessments: [],
      signals: [],
      now: NOW,
    })

    expect(result.agencyIpYield[0]).toEqual({
      agencyName: 'BIRAC', awardCount: 2, awardsWithPatents: 2, patentCount: 3,
    })
    expect(result.agencyIpYield[1]).toEqual({
      agencyName: 'ICMR', awardCount: 1, awardsWithPatents: 0, patentCount: 0,
    })
  })

  it('surfaces organisations holding both an award and a patent here', () => {
    const result = buildPriorWork({
      awards: [award({ id: 'a1', primaryInstitutionName: 'IIT Bombay' })],
      awardExtras: [extras({ id: 'a1' })],
      patents: [patent({ id: 'p1', assignee: 'IIT Bombay' })],
      awardAssessments: [],
      patentAssessments: [],
      signals: [],
      now: NOW,
    })
    expect(result.crossHolders).toHaveLength(1)
    expect(result.crossHolders[0].org).toBe('IIT Bombay')
  })
})
