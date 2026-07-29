import { describe, expect, it } from 'vitest'

import {
  agencyMatches,
  buildFacetCoverage,
  buildFundedPortfolio,
  formatBudget,
  projectStatus,
  rankAgencyRecommendations,
  type PortfolioProject,
  type ProjectDelivery,
} from '@/lib/ideaIntelligence/whitespace'

const NOW = new Date('2026-07-24T00:00:00.000Z')

function fundedProject(overrides: Partial<PortfolioProject> = {}): PortfolioProject {
  return {
    id: 'project-1',
    title: 'A sanctioned project',
    fundingAgency: 'Department of Biotechnology',
    sourceName: 'PRISM',
    sourceKey: 'PRISM',
    schemeName: 'BioCARe',
    sanctionYear: 2023,
    budgetAmount: 4_800_000,
    budgetCurrency: 'INR',
    primaryInstitutionName: 'IIT Delhi',
    state: 'Delhi',
    ...overrides,
  }
}

describe('buildFundedPortfolio', () => {
  it('groups awards by funder with counts, years, and a median award size', () => {
    const portfolio = buildFundedPortfolio(
      [
        fundedProject(),
        fundedProject({ id: 'project-2', sanctionYear: 2021, budgetAmount: 2_000_000 }),
        fundedProject({ id: 'project-3', fundingAgency: 'ICMR', schemeName: 'Ad-hoc', sanctionYear: 2019, budgetAmount: 9_000_000 }),
      ],
      [],
      NOW
    )

    expect(portfolio.projectCount).toBe(3)
    expect(portfolio.agencies).toHaveLength(2)
    expect(portfolio.agencies[0].agencyName).toBe('Department of Biotechnology')
    expect(portfolio.agencies[0].projectCount).toBe(2)
    expect(portfolio.agencies[0].medianBudget).toBe(3_400_000)
    expect(portfolio.firstYear).toBe(2019)
    expect(portfolio.lastYear).toBe(2023)
  })

  it('separates completed awards from ones still running', () => {
    const deliveries: ProjectDelivery[] = [
      { id: 'project-1', endDate: '2024-03-31T00:00:00.000Z', durationMonths: 24, hasReportedOutput: false },
      { id: 'project-2', endDate: '2028-03-31T00:00:00.000Z', durationMonths: 36, hasReportedOutput: false },
    ]
    const portfolio = buildFundedPortfolio(
      [fundedProject(), fundedProject({ id: 'project-2', sanctionYear: 2025 })],
      deliveries,
      NOW
    )

    expect(portfolio.completedCount).toBe(1)
    expect(portfolio.ongoingCount).toBe(1)
  })

  it('falls back to the source name when the award carries no funder', () => {
    const portfolio = buildFundedPortfolio([fundedProject({ fundingAgency: null })], [], NOW)
    expect(portfolio.agencies[0].agencyName).toBe('PRISM')
  })
})

describe('projectStatus', () => {
  it('treats a reported output as completion regardless of dates', () => {
    expect(projectStatus({ id: 'p', endDate: '2030-01-01', durationMonths: null, hasReportedOutput: true }, 2029, NOW)).toBe('completed')
  })

  it('projects an end date from sanction year and duration when no end date exists', () => {
    expect(projectStatus({ id: 'p', endDate: null, durationMonths: 24, hasReportedOutput: false }, 2020, NOW)).toBe('completed')
    expect(projectStatus({ id: 'p', endDate: null, durationMonths: 36, hasReportedOutput: false }, 2025, NOW)).toBe('ongoing')
  })

  it('stays unknown when the record says nothing', () => {
    expect(projectStatus(undefined, 2023, NOW)).toBe('unknown')
  })
})

describe('buildFacetCoverage', () => {
  it('splits facets into covered, open, and unknown using funded evidence', () => {
    const coverage = buildFacetCoverage([
      { facet: 'On-device inference', funded: 'PRESENT', published: 'PRESENT', patented: 'ABSENT' },
      { facet: 'Rural PHC deployment', funded: 'ABSENT', published: 'ABSENT', patented: 'ABSENT' },
      { facet: 'Health-worker workflow', funded: 'UNASSESSED', published: 'UNASSESSED', patented: 'UNASSESSED' },
    ])

    expect(coverage.covered).toEqual(['On-device inference'])
    expect(coverage.open).toEqual(['Rural PHC deployment'])
    expect(coverage.unknown).toEqual(['Health-worker workflow'])
    expect(coverage.totalFacets).toBe(3)
  })

  it('downgrades an unfunded facet to partial when publications or patents cover it', () => {
    const coverage = buildFacetCoverage([
      { facet: 'Offline retinal capture', funded: 'ABSENT', published: 'PRESENT', patented: 'ABSENT' },
    ])

    expect(coverage.open).toEqual([])
    expect(coverage.partial).toEqual(['Offline retinal capture'])
  })
})

describe('rankAgencyRecommendations', () => {
  it('ranks by award evidence first and uses open calls as a tiebreaker', () => {
    const portfolio = buildFundedPortfolio(
      [
        fundedProject(),
        fundedProject({ id: 'project-2', sanctionYear: 2024 }),
        fundedProject({ id: 'project-3', sanctionYear: 2024 }),
        fundedProject({ id: 'project-4', fundingAgency: 'ICMR', sanctionYear: 2024 }),
      ],
      [],
      NOW
    )
    const ranked = rankAgencyRecommendations(portfolio, [
      { id: 'call-1', agencyName: 'ICMR', schemeTitle: 'Extramural', closeDate: null, isRolling: true },
    ])

    expect(ranked[0].agencyName).toBe('Department of Biotechnology')
    expect(ranked[0].role).toBe('primary')
    expect(ranked[0].fundedNearbyCount).toBe(3)
    expect(ranked[1].agencyName).toBe('ICMR')
    expect(ranked[1].openCallIds).toEqual(['call-1'])
    expect(ranked[0].evidenceBasis).toContain('3 comparable sanctioned projects')
  })

  it('ranks on the sanctioned record alone when no call was searched', () => {
    const portfolio = buildFundedPortfolio(
      [fundedProject(), fundedProject({ id: 'project-2', fundingAgency: 'ICMR', sanctionYear: 2024 })],
      [],
      NOW
    )
    const ranked = rankAgencyRecommendations(portfolio, [], 4, { openCallsSearched: false })

    expect(ranked).toHaveLength(2)
    expect(ranked.every((agency) => agency.openCallIds.length === 0)).toBe(true)
    // "no open call matched" would claim a search that never happened.
    expect(ranked[0].evidenceBasis).toContain('open calls not searched in this pass')
    expect(ranked[0].evidenceBasis).not.toContain('no open call matched')
  })

  it('still says "no open call matched" when calls were searched and none fit', () => {
    const portfolio = buildFundedPortfolio([fundedProject()], [], NOW)
    const ranked = rankAgencyRecommendations(portfolio, [
      { id: 'call-1', agencyName: 'SERB', schemeTitle: 'CRG', closeDate: null, isRolling: false },
    ])

    expect(ranked[0].evidenceBasis).toContain('no open call matched in this run')
  })

  it('says so plainly when only open calls are available as evidence', () => {
    const empty = buildFundedPortfolio([], [], NOW)
    const ranked = rankAgencyRecommendations(empty, [
      { id: 'call-1', agencyName: 'SERB', schemeTitle: 'CRG', closeDate: null, isRolling: false },
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0].fundedNearbyCount).toBe(0)
    expect(ranked[0].evidenceBasis).toContain('no comparable sanctioned project')
  })
})

describe('agencyMatches', () => {
  it('matches on normalized names and containment, not on unrelated funders', () => {
    expect(agencyMatches('Department of Biotechnology', 'Department of Biotechnology, Govt of India')).toBe(true)
    expect(agencyMatches('ICMR', 'icmr')).toBe(true)
    expect(agencyMatches('ICMR', 'SERB')).toBe(false)
    expect(agencyMatches(null, 'SERB')).toBe(false)
  })
})

describe('formatBudget', () => {
  it('renders Indian award sizes in lakh and crore', () => {
    expect(formatBudget(4_800_000, 'INR')).toBe('Rs 48 L')
    expect(formatBudget(25_000_000, 'INR')).toBe('Rs 2.5 Cr')
    expect(formatBudget(null, 'INR')).toBeNull()
  })
})
