// Deterministic whitespace + agency math over the sanctioned-project corpus.
// Pure and dependency-free (like callSignals.ts) so it can be unit-tested without
// the server import graph. The LLM narrates these numbers; it never invents them.

import type { FacetStatus } from '@/lib/ideaIntelligence/callSignals'

export type PortfolioProject = {
  id: string
  title: string
  fundingAgency: string | null
  sourceName: string
  sourceKey: string
  schemeName: string | null
  sanctionYear: number | null
  budgetAmount: number | null
  budgetCurrency: string | null
  primaryInstitutionName: string | null
  state: string | null
}

// Delivery status is read from the award record, not inferred by the model:
// it is what separates "already done" from "sanctioned but still running".
export type ProjectDelivery = {
  id: string
  endDate: string | null
  durationMonths: number | null
  hasReportedOutput: boolean
}

export type ProjectStatus = 'completed' | 'ongoing' | 'unknown'

export type PortfolioAgency = {
  agencyName: string
  projectCount: number
  completedCount: number
  ongoingCount: number
  schemes: string[]
  firstYear: number | null
  lastYear: number | null
  recentShare: number
  medianBudget: number | null
  budgetCurrency: string | null
  topInstitutions: string[]
  states: string[]
  exampleProjectIds: string[]
}

export type FundedPortfolio = {
  projectCount: number
  completedCount: number
  ongoingCount: number
  firstYear: number | null
  lastYear: number | null
  medianBudget: number | null
  budgetCurrency: string | null
  agencies: PortfolioAgency[]
}

export type FacetCoverage = {
  covered: string[]
  partial: string[]
  open: string[]
  unknown: string[]
  coveredCount: number
  openCount: number
  totalFacets: number
}

export type OpenCallSummary = {
  id: string
  agencyName: string
  schemeTitle: string
  closeDate: string | null
  isRolling: boolean
}

export type AgencyRecommendation = {
  agencyName: string
  role: 'primary' | 'alternate'
  matchScore: number
  fundedNearbyCount: number
  ongoingNearbyCount: number
  activeYears: string | null
  typicalBudget: number | null
  budgetCurrency: string | null
  schemes: string[]
  exampleProjectIds: string[]
  openCallIds: string[]
  evidenceBasis: string
  whyThisAgency: string
}

const RECENT_WINDOW_YEARS = 5
const AGENCY_STOPWORDS = new Set(['of', 'the', 'and', 'for', 'india', 'govt', 'government'])

export function agencyKey(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word && !AGENCY_STOPWORDS.has(word))
    .join(' ')
    .trim()
}

// "DBT" vs "Department of Biotechnology" will not collapse without an agency
// entity table; containment is the honest amount of matching we can do here.
export function agencyMatches(left: string | null | undefined, right: string | null | undefined) {
  const a = agencyKey(left)
  const b = agencyKey(right)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

export function projectStatus(delivery: ProjectDelivery | undefined, sanctionYear: number | null, now = new Date()): ProjectStatus {
  if (delivery?.hasReportedOutput) return 'completed'
  if (delivery?.endDate) {
    const end = new Date(delivery.endDate)
    if (!Number.isNaN(end.getTime())) return end.getTime() < now.getTime() ? 'completed' : 'ongoing'
  }
  if (typeof sanctionYear === 'number' && typeof delivery?.durationMonths === 'number' && delivery.durationMonths > 0) {
    const projectedEnd = new Date(sanctionYear, 0, 1)
    projectedEnd.setMonth(projectedEnd.getMonth() + delivery.durationMonths)
    return projectedEnd.getTime() < now.getTime() ? 'completed' : 'ongoing'
  }
  return 'unknown'
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function dominantCurrency(projects: PortfolioProject[]) {
  const counts = new Map<string, number>()
  for (const project of projects) {
    if (project.budgetAmount === null) continue
    const currency = project.budgetCurrency || 'INR'
    counts.set(currency, (counts.get(currency) || 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [currency, count] of counts) {
    if (count > bestCount) { best = currency; bestCount = count }
  }
  return best
}

function budgetsIn(projects: PortfolioProject[], currency: string | null) {
  if (!currency) return []
  return projects
    .filter((project) => project.budgetAmount !== null && (project.budgetCurrency || 'INR') === currency)
    .map((project) => Number(project.budgetAmount))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function topValues(values: Array<string | null>, limit: number) {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const value = String(raw || '').trim()
    if (!value) continue
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value)
}

function displayAgencyName(project: PortfolioProject) {
  return String(project.fundingAgency || project.sourceName || project.sourceKey || '').trim() || 'Unattributed funder'
}

/**
 * Groups the retrieved sanctioned projects into an agency-level ledger — the
 * "what has already been funded here, by whom, at what size" evidence base.
 */
export function buildFundedPortfolio(
  projects: PortfolioProject[],
  deliveries: ProjectDelivery[] = [],
  now = new Date()
): FundedPortfolio {
  const deliveryById = new Map(deliveries.map((item) => [item.id, item]))
  const statusById = new Map(projects.map((project) => [
    project.id,
    projectStatus(deliveryById.get(project.id), project.sanctionYear, now),
  ]))

  const byAgency = new Map<string, PortfolioProject[]>()
  for (const project of projects) {
    const key = agencyKey(displayAgencyName(project)) || displayAgencyName(project)
    const bucket = byAgency.get(key)
    if (bucket) bucket.push(project)
    else byAgency.set(key, [project])
  }

  const currentYear = now.getFullYear()
  const agencies: PortfolioAgency[] = [...byAgency.values()].map((bucket) => {
    const years = bucket.map((project) => project.sanctionYear).filter((year): year is number => typeof year === 'number')
    const recent = years.filter((year) => year >= currentYear - RECENT_WINDOW_YEARS).length
    const currency = dominantCurrency(bucket)
    return {
      agencyName: displayAgencyName(bucket[0]),
      projectCount: bucket.length,
      completedCount: bucket.filter((project) => statusById.get(project.id) === 'completed').length,
      ongoingCount: bucket.filter((project) => statusById.get(project.id) === 'ongoing').length,
      schemes: topValues(bucket.map((project) => project.schemeName), 4),
      firstYear: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
      recentShare: years.length ? recent / years.length : 0,
      medianBudget: median(budgetsIn(bucket, currency)),
      budgetCurrency: currency,
      topInstitutions: topValues(bucket.map((project) => project.primaryInstitutionName), 3),
      states: topValues(bucket.map((project) => project.state), 3),
      exampleProjectIds: bucket.slice(0, 3).map((project) => project.id),
    }
  }).sort((a, b) => b.projectCount - a.projectCount || (b.lastYear || 0) - (a.lastYear || 0))

  const allYears = projects.map((project) => project.sanctionYear).filter((year): year is number => typeof year === 'number')
  const overallCurrency = dominantCurrency(projects)
  return {
    projectCount: projects.length,
    completedCount: [...statusById.values()].filter((status) => status === 'completed').length,
    ongoingCount: [...statusById.values()].filter((status) => status === 'ongoing').length,
    firstYear: allYears.length ? Math.min(...allYears) : null,
    lastYear: allYears.length ? Math.max(...allYears) : null,
    medianBudget: median(budgetsIn(projects, overallCurrency)),
    budgetCurrency: overallCurrency,
    agencies,
  }
}

/**
 * Splits idea facets into what the sanctioned corpus already covers and what it
 * leaves open. Funded evidence decides coverage; publications and patents only
 * downgrade an otherwise-open facet to "partial" so prior art is not ignored.
 */
export function buildFacetCoverage(
  rows: Array<{ facet: string; funded: FacetStatus; published: FacetStatus; patented: FacetStatus }>
): FacetCoverage {
  const covered: string[] = []
  const partial: string[] = []
  const open: string[] = []
  const unknown: string[] = []

  for (const row of rows) {
    if (row.funded === 'PRESENT') covered.push(row.facet)
    else if (row.funded === 'PARTIAL') partial.push(row.facet)
    else if (row.funded === 'ABSENT') {
      if (row.published === 'PRESENT' || row.patented === 'PRESENT') partial.push(row.facet)
      else open.push(row.facet)
    } else unknown.push(row.facet)
  }

  return {
    covered,
    partial,
    open,
    unknown,
    coveredCount: covered.length,
    openCount: open.length,
    totalFacets: rows.length,
  }
}

/**
 * Ranks funders from the sanctioned corpus first (who actually pays for work
 * like this) and uses currently-open calls as a tiebreaker, not as the basis.
 */
export function rankAgencyRecommendations(
  portfolio: FundedPortfolio,
  openCalls: OpenCallSummary[] = [],
  limit = 4,
  // The review pass no longer searches the call catalogue, so "no open call
  // matched" would be a lie. Say the calls were not looked at instead.
  options: { openCallsSearched?: boolean } = {}
): AgencyRecommendation[] {
  const openCallsSearched = options.openCallsSearched !== false
  if (!portfolio.agencies.length) {
    // No award evidence: fall back to open calls only, and say so.
    const seen = new Set<string>()
    return openCalls
      .filter((call) => {
        const key = agencyKey(call.agencyName)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, limit)
      .map((call, index): AgencyRecommendation => ({
        agencyName: call.agencyName,
        role: index === 0 ? 'primary' : 'alternate',
        matchScore: 0,
        fundedNearbyCount: 0,
        ongoingNearbyCount: 0,
        activeYears: null,
        typicalBudget: null,
        budgetCurrency: null,
        schemes: [call.schemeTitle].filter(Boolean),
        exampleProjectIds: [],
        openCallIds: [call.id],
        evidenceBasis: 'Open call match only — no comparable sanctioned project was retrieved for this funder.',
        whyThisAgency: '',
      }))
  }

  const maxCount = Math.max(...portfolio.agencies.map((agency) => agency.projectCount))
  const scored = portfolio.agencies.map((agency) => {
    const matchingCalls = openCalls.filter((call) => agencyMatches(call.agencyName, agency.agencyName))
    const score = 0.5 * (agency.projectCount / maxCount)
      + 0.25 * agency.recentShare
      + 0.25 * (matchingCalls.length ? 1 : 0)
    const activeYears = agency.firstYear && agency.lastYear
      ? (agency.firstYear === agency.lastYear ? String(agency.firstYear) : `${agency.firstYear}-${agency.lastYear}`)
      : null
    const basis = [
      `${agency.projectCount} comparable sanctioned project${agency.projectCount === 1 ? '' : 's'} retrieved`,
      activeYears ? `sanctioned ${activeYears}` : null,
      agency.ongoingCount ? `${agency.ongoingCount} still running` : null,
      matchingCalls.length
        ? `${matchingCalls.length} open call${matchingCalls.length === 1 ? '' : 's'} right now`
        : openCallsSearched
          ? 'no open call matched in this run'
          : 'open calls not searched in this pass',
    ].filter(Boolean).join(' · ')

    return {
      agencyName: agency.agencyName,
      role: 'alternate' as const,
      matchScore: Math.round(score * 100),
      fundedNearbyCount: agency.projectCount,
      ongoingNearbyCount: agency.ongoingCount,
      activeYears,
      typicalBudget: agency.medianBudget,
      budgetCurrency: agency.budgetCurrency,
      schemes: agency.schemes,
      exampleProjectIds: agency.exampleProjectIds,
      openCallIds: matchingCalls.map((call) => call.id),
      evidenceBasis: basis,
      whyThisAgency: '',
    }
  }).sort((a, b) => b.matchScore - a.matchScore || b.fundedNearbyCount - a.fundedNearbyCount)

  return scored.slice(0, limit).map((item, index) => ({ ...item, role: index === 0 ? 'primary' : 'alternate' }))
}

export function formatBudget(value: number | null, currency: string | null) {
  if (value === null || !Number.isFinite(value)) return null
  const code = currency || 'INR'
  if (code === 'INR') {
    if (value >= 10_000_000) return `Rs ${(value / 10_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Cr`
    if (value >= 100_000) return `Rs ${(value / 100_000).toFixed(value >= 1_000_000 ? 0 : 1)} L`
    return `Rs ${Math.round(value).toLocaleString('en-IN')}`
  }
  return `${code} ${Math.round(value).toLocaleString('en-US')}`
}
