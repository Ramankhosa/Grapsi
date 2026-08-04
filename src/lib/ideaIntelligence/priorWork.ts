// Deterministic prior-work merge, coverage map and gap derivation across the
// sanctioned-award corpus and the patent corpus.
//
// Pure and dependency-free (like whitespace.ts and callSignals.ts) so it can be
// unit-tested without the server import graph. The LLM narrates what this module
// counts; it never produces its own counts.
//
// The design rule throughout: an award and a patent are two ways of saying
// "someone already did this", so they belong in ONE ranked list. What separates
// them is an attribute of the row, not a separate tab.

import type { FacetStatus } from '@/lib/ideaIntelligence/callSignals'

export type PriorWorkAwardInput = {
  id: string
  title: string
  fundingAgency: string | null
  sourceName: string | null
  sourceKey: string | null
  schemeName: string | null
  sanctionYear: number | null
  budgetAmount: number | null
  budgetCurrency: string | null
  primaryInstitutionName: string | null
  state: string | null
  relevanceScore: number
}

/**
 * The parts of an award record the search projection does not carry. Loaded by
 * the same detail query that already resolves completed-vs-ongoing status, so
 * this costs no extra round trip and no external API call.
 */
export type PriorWorkAwardExtras = {
  id: string
  durationMonths: number | null
  hasReportedOutput: boolean
  /** Patents the award itself reported. A direct link — never inferred. */
  patentCount: number
  publicationCount: number
  status: 'completed' | 'ongoing' | 'unknown'
}

export type PriorWorkPatentInput = {
  id: string
  title: string
  publicationNumber: string | null
  assignee: string | null
  inventor: string | null
  priorityDate: string | null
  filingDate: string | null
  publicationDate: string | null
  url: string | null
  source: string
}

export type FacetAssessedItem = {
  id: string
  facetAssessments: Array<{ facet: string; status: FacetStatus }>
}

export type PriorWorkRow = {
  /** Stable across re-renders; also the id the coverage map and gaps point at. */
  key: string
  kind: 'funded' | 'patented'
  title: string
  /** Institution for an award, assignee for a patent. */
  org: string | null
  year: number | null
  /** Which of the researcher's own facets this row touches. */
  facetsCovered: string[]
  matchBasis: string
  award: {
    id: string
    agencyName: string
    schemeName: string | null
    budgetAmount: number | null
    budgetCurrency: string | null
    durationMonths: number | null
    status: 'completed' | 'ongoing' | 'unknown'
    hasReportedOutput: boolean
    patentCount: number
    publicationCount: number
    relevanceScore: number
    /** Same award arriving from more than one source feed. */
    duplicateIds: string[]
  } | null
  patent: {
    id: string
    publicationNumber: string | null
    assignee: string | null
    date: string | null
    url: string | null
    source: string
    /** IN / US / WO / EP … collapsed from the family. */
    jurisdictions: string[]
    familySize: number
    familyIds: string[]
  } | null
}

export type CoverageCell = {
  status: FacetStatus
  rowKeys: string[]
}

export type CoverageRow = {
  facet: string
  funded: CoverageCell
  patented: CoverageCell
  /** True when neither corpus covers it — this is what becomes a gap. */
  open: boolean
}

export type GapReading = 'unexplored' | 'attempted_no_output' | 'blocked'

export type PriorWorkGap = {
  id: string
  facet: string
  reading: GapReading
  readingBasis: string
  blockingRowKeys: string[]
  attemptedRowKeys: string[]
  neighbourRowKeys: string[]
  effort: {
    medianBudget: number | null
    budgetCurrency: string | null
    medianDurationMonths: number | null
    sampleSize: number
  } | null
  latestActivityYear: number | null
  yearsSinceActivity: number | null
  stale: boolean
}

export type AgencyIpYield = {
  agencyName: string
  awardCount: number
  awardsWithPatents: number
  patentCount: number
}

/**
 * Organisations holding BOTH an award and a patent in this space. Stated at the
 * organisation level only — it says the org appears in both corpora, never that
 * a particular patent came out of a particular award.
 */
export type CrossHolder = {
  org: string
  awardRowKeys: string[]
  patentRowKeys: string[]
}

export type PriorWorkSummary = {
  totalRows: number
  fundedRows: number
  patentedRows: number
  duplicateAwardsCollapsed: number
  patentFamiliesCollapsed: number
}

export type PriorWork = {
  rows: PriorWorkRow[]
  coverage: CoverageRow[]
  gaps: PriorWorkGap[]
  agencyIpYield: AgencyIpYield[]
  crossHolders: CrossHolder[]
  summary: PriorWorkSummary
}

const STALE_AFTER_YEARS = 6
const ORG_STOPWORDS = new Set(['of', 'the', 'and', 'for', 'ltd', 'limited', 'pvt', 'private', 'inc', 'llc', 'india'])

export function normalizeKey(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function orgKey(value: string | null | undefined) {
  return normalizeKey(value)
    .split(' ')
    .filter((word) => word && !ORG_STOPWORDS.has(word))
    .join(' ')
}

/**
 * Patent numbers carry their jurisdiction as a two-letter prefix (IN 402318,
 * US 9,123,456, WO 2019/…). Reading it off the number is exact; guessing it
 * from the assignee's country would not be.
 */
export function jurisdictionOf(publicationNumber: string | null | undefined) {
  const match = String(publicationNumber || '').trim().toUpperCase().match(/^([A-Z]{2})/)
  return match ? match[1] : null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function yearOf(value: string | null | undefined) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

function coveredFacets(item: FacetAssessedItem | undefined) {
  if (!item) return []
  return item.facetAssessments
    .filter((cell) => cell.status === 'PRESENT' || cell.status === 'PARTIAL')
    .map((cell) => cell.facet)
}

function dominantCurrency(values: Array<string | null>) {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const value = raw || 'INR'
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [currency, count] of counts) {
    if (count > bestCount) { best = currency; bestCount = count }
  }
  return best
}

/**
 * Collapses the same award arriving from more than one source feed. Two records
 * are the same award when the title, the institution and the sanction year all
 * agree — matching on title alone merges genuinely distinct annual renewals.
 */
function buildAwardRows(
  awards: PriorWorkAwardInput[],
  extrasById: Map<string, PriorWorkAwardExtras>,
  assessedById: Map<string, FacetAssessedItem>
): { rows: PriorWorkRow[]; collapsed: number } {
  const byKey = new Map<string, PriorWorkRow>()
  let collapsed = 0

  for (const award of awards) {
    const extras = extrasById.get(award.id)
    const agencyName = String(award.fundingAgency || award.sourceName || award.sourceKey || '').trim() || 'Unattributed funder'
    const org = award.primaryInstitutionName?.trim() || null
    const dedupeKey = `award:${normalizeKey(award.title)}|${orgKey(org)}|${award.sanctionYear ?? ''}`
    const existing = byKey.get(dedupeKey)
    if (existing && existing.award) {
      collapsed += 1
      existing.award.duplicateIds.push(award.id)
      // Keep the strongest retrieval score of the duplicates so ordering is not
      // penalised by whichever copy happened to be indexed worse.
      existing.award.relevanceScore = Math.max(existing.award.relevanceScore, award.relevanceScore)
      continue
    }

    byKey.set(dedupeKey, {
      key: dedupeKey,
      kind: 'funded',
      title: award.title,
      org,
      year: award.sanctionYear,
      facetsCovered: coveredFacets(assessedById.get(award.id)),
      matchBasis: '',
      award: {
        id: award.id,
        agencyName,
        schemeName: award.schemeName,
        budgetAmount: award.budgetAmount,
        budgetCurrency: award.budgetCurrency,
        durationMonths: extras?.durationMonths ?? null,
        status: extras?.status ?? 'unknown',
        hasReportedOutput: Boolean(extras?.hasReportedOutput),
        patentCount: extras?.patentCount ?? 0,
        publicationCount: extras?.publicationCount ?? 0,
        relevanceScore: award.relevanceScore,
        duplicateIds: [],
      },
      patent: null,
    })
  }

  return { rows: [...byKey.values()], collapsed }
}

/**
 * Collapses a patent family (the IN, US and WO filings of one invention) into a
 * single row. Left uncollapsed, one invention counts three times and every
 * "patented" number on the screen is inflated.
 */
function buildPatentRows(
  patents: PriorWorkPatentInput[],
  assessedById: Map<string, FacetAssessedItem>
): { rows: PriorWorkRow[]; collapsed: number } {
  const byKey = new Map<string, PriorWorkRow>()
  let collapsed = 0

  for (const patent of patents) {
    const assignee = patent.assignee?.trim() || null
    const dedupeKey = `patent:${normalizeKey(patent.title)}|${orgKey(assignee)}`
    const date = patent.publicationDate || patent.filingDate || patent.priorityDate || null
    const jurisdiction = jurisdictionOf(patent.publicationNumber)
    const existing = byKey.get(dedupeKey)

    if (existing && existing.patent) {
      collapsed += 1
      existing.patent.familySize += 1
      existing.patent.familyIds.push(patent.id)
      if (jurisdiction && !existing.patent.jurisdictions.includes(jurisdiction)) {
        existing.patent.jurisdictions.push(jurisdiction)
      }
      // The family is dated by its earliest member — that is the priority date
      // that actually determines what it blocks.
      const existingYear = yearOf(existing.patent.date)
      const candidateYear = yearOf(date)
      if (candidateYear && (!existingYear || candidateYear < existingYear)) {
        existing.patent.date = date
        existing.year = candidateYear
      }
      // A family member may have been assessed against facets the first was not.
      for (const facet of coveredFacets(assessedById.get(patent.id))) {
        if (!existing.facetsCovered.includes(facet)) existing.facetsCovered.push(facet)
      }
      continue
    }

    byKey.set(dedupeKey, {
      key: dedupeKey,
      kind: 'patented',
      title: patent.title,
      org: assignee,
      year: yearOf(date),
      facetsCovered: coveredFacets(assessedById.get(patent.id)),
      matchBasis: '',
      award: null,
      patent: {
        id: patent.id,
        publicationNumber: patent.publicationNumber,
        assignee,
        date,
        url: patent.url,
        source: patent.source,
        jurisdictions: jurisdiction ? [jurisdiction] : [],
        familySize: 1,
        familyIds: [patent.id],
      },
    })
  }

  return { rows: [...byKey.values()], collapsed }
}

/**
 * Ranks awards and patents in one list. Deliberately ordered by how much of the
 * researcher's own idea each row touches rather than by a blended score: the
 * award corpus has a reranker score and the patent corpus does not, so any
 * single number spanning both would be invented.
 */
function rankRows(rows: PriorWorkRow[]): PriorWorkRow[] {
  return [...rows].sort((left, right) => (
    right.facetsCovered.length - left.facetsCovered.length
    || (right.award?.relevanceScore || 0) - (left.award?.relevanceScore || 0)
    || (right.year || 0) - (left.year || 0)
    || left.title.localeCompare(right.title)
  )).map((row) => ({ ...row, matchBasis: describeMatch(row) }))
}

function describeMatch(row: PriorWorkRow) {
  const facetPart = row.facetsCovered.length
    ? `Touches ${row.facetsCovered.length} of your aspects: ${row.facetsCovered.join(', ')}`
    : 'Retrieved as nearby work; no aspect of your idea was assessable against it'
  if (row.kind === 'funded' && row.award) {
    const parts = [
      row.award.status === 'ongoing' ? 'still running' : row.award.status === 'completed' ? 'completed' : null,
      row.award.patentCount ? `${row.award.patentCount} patent${row.award.patentCount === 1 ? '' : 's'} reported by this award` : null,
      row.award.status === 'completed' && !row.award.hasReportedOutput ? 'no output recorded' : null,
    ].filter(Boolean)
    return parts.length ? `${facetPart} · ${parts.join(' · ')}` : facetPart
  }
  if (row.patent) {
    const parts = [
      row.patent.jurisdictions.length ? row.patent.jurisdictions.join('/') : null,
      row.patent.familySize > 1 ? `${row.patent.familySize} family members` : null,
    ].filter(Boolean)
    return parts.length ? `${facetPart} · ${parts.join(' · ')}` : facetPart
  }
  return facetPart
}

function buildCoverage(
  signals: Array<{ facet: string; funded: FacetStatus; patented: FacetStatus }>,
  rows: PriorWorkRow[]
): CoverageRow[] {
  return signals.map((signal) => {
    const funded = rows.filter((row) => row.kind === 'funded' && row.facetsCovered.includes(signal.facet))
    const patented = rows.filter((row) => row.kind === 'patented' && row.facetsCovered.includes(signal.facet))
    return {
      facet: signal.facet,
      funded: { status: signal.funded, rowKeys: funded.map((row) => row.key) },
      patented: { status: signal.patented, rowKeys: patented.map((row) => row.key) },
      // Only an actively-assessed absence is an opening. UNASSESSED means the
      // sources were too thin to tell, which is not the same thing.
      open: signal.funded === 'ABSENT',
    }
  })
}

/**
 * Why a facet is open has three very different answers, and the researcher's
 * next move differs for each: pursue it, expect it to be hard, or design around
 * the patent. Each reading is backed by a record, never by the model's opinion.
 */
function buildGaps(coverage: CoverageRow[], rows: PriorWorkRow[], now: Date): PriorWorkGap[] {
  const rowByKey = new Map(rows.map((row) => [row.key, row]))
  const currentYear = now.getFullYear()
  // Awards touching any part of the idea are the nearest funded neighbours, and
  // they are what the effort band and the freshness read are computed from.
  const neighbours = rows.filter((row) => row.kind === 'funded' && row.facetsCovered.length > 0)

  return coverage.filter((entry) => entry.open).map((entry) => {
    const blocking = entry.patented.rowKeys
    const attempted = neighbours
      .filter((row) => row.award?.status === 'completed' && !row.award.hasReportedOutput && row.facetsCovered.includes(entry.facet))
      .map((row) => row.key)

    let reading: GapReading = 'unexplored'
    let readingBasis = 'No retrieved award and no retrieved patent covers this aspect.'
    if (blocking.length) {
      const first = rowByKey.get(blocking[0])
      const number = first?.patent?.publicationNumber
      reading = 'blocked'
      readingBasis = `Unfunded, but ${blocking.length} patent${blocking.length === 1 ? '' : 's'} already claim${blocking.length === 1 ? 's' : ''} this${number ? ` (${number})` : ''}. Needs a design-around, not just a proposal.`
    } else if (attempted.length) {
      reading = 'attempted_no_output'
      readingBasis = `${attempted.length} completed award${attempted.length === 1 ? '' : 's'} worked adjacent to this and recorded no output. Treat as hard, not empty.`
    }

    const neighbourKeys = neighbours.slice(0, 5).map((row) => row.key)
    const neighbourAwards = neighbours.map((row) => row.award).filter(Boolean) as NonNullable<PriorWorkRow['award']>[]
    const currency = dominantCurrency(neighbourAwards.map((award) => award.budgetCurrency))
    const budgets = neighbourAwards
      .filter((award) => award.budgetAmount !== null && (award.budgetCurrency || 'INR') === currency)
      .map((award) => Number(award.budgetAmount))
      .filter((value) => Number.isFinite(value) && value > 0)
    const durations = neighbourAwards
      .map((award) => award.durationMonths)
      .filter((value): value is number => typeof value === 'number' && value > 0)

    const activityYears = [
      ...neighbours.map((row) => row.year),
      ...blocking.map((key) => rowByKey.get(key)?.year ?? null),
    ].filter((year): year is number => typeof year === 'number')
    const latestActivityYear = activityYears.length ? Math.max(...activityYears) : null
    const yearsSinceActivity = latestActivityYear === null ? null : currentYear - latestActivityYear

    return {
      id: `gap:${normalizeKey(entry.facet).replace(/ /g, '-') || 'facet'}`,
      facet: entry.facet,
      reading,
      readingBasis,
      blockingRowKeys: blocking,
      attemptedRowKeys: attempted,
      neighbourRowKeys: neighbourKeys,
      effort: neighbourAwards.length
        ? {
            medianBudget: median(budgets),
            budgetCurrency: budgets.length ? currency : null,
            medianDurationMonths: median(durations),
            sampleSize: neighbourAwards.length,
          }
        : null,
      latestActivityYear,
      yearsSinceActivity,
      // A field whose newest neighbouring award is years old may be closed
      // rather than open, and the researcher should be told which it looks like.
      stale: yearsSinceActivity !== null && yearsSinceActivity > STALE_AFTER_YEARS,
    }
  })
}

/**
 * How often each funder's awards in this space produced patents. Read from the
 * awards' own records, so it answers "does this agency pay for translational
 * work" without inference.
 */
function buildAgencyIpYield(rows: PriorWorkRow[]): AgencyIpYield[] {
  const byAgency = new Map<string, AgencyIpYield>()
  for (const row of rows) {
    if (row.kind !== 'funded' || !row.award) continue
    const key = orgKey(row.award.agencyName) || row.award.agencyName
    const entry = byAgency.get(key) || {
      agencyName: row.award.agencyName,
      awardCount: 0,
      awardsWithPatents: 0,
      patentCount: 0,
    }
    entry.awardCount += 1
    if (row.award.patentCount > 0) {
      entry.awardsWithPatents += 1
      entry.patentCount += row.award.patentCount
    }
    byAgency.set(key, entry)
  }
  return [...byAgency.values()].sort((a, b) => b.awardsWithPatents - a.awardsWithPatents || b.awardCount - a.awardCount)
}

function buildCrossHolders(rows: PriorWorkRow[]): CrossHolder[] {
  const awardsByOrg = new Map<string, { label: string; keys: string[] }>()
  const patentsByOrg = new Map<string, string[]>()

  for (const row of rows) {
    const key = orgKey(row.org)
    if (!key) continue
    if (row.kind === 'funded') {
      const entry = awardsByOrg.get(key) || { label: row.org as string, keys: [] }
      entry.keys.push(row.key)
      awardsByOrg.set(key, entry)
    } else {
      patentsByOrg.set(key, [...(patentsByOrg.get(key) || []), row.key])
    }
  }

  const holders: CrossHolder[] = []
  for (const [key, awards] of awardsByOrg) {
    const patents = patentsByOrg.get(key)
    if (!patents?.length) continue
    holders.push({ org: awards.label, awardRowKeys: awards.keys, patentRowKeys: patents })
  }
  return holders.sort((a, b) => (b.awardRowKeys.length + b.patentRowKeys.length) - (a.awardRowKeys.length + a.patentRowKeys.length))
}

export function buildPriorWork(input: {
  awards: PriorWorkAwardInput[]
  awardExtras: PriorWorkAwardExtras[]
  patents: PriorWorkPatentInput[]
  awardAssessments: FacetAssessedItem[]
  patentAssessments: FacetAssessedItem[]
  signals: Array<{ facet: string; funded: FacetStatus; patented: FacetStatus }>
  now?: Date
}): PriorWork {
  const now = input.now || new Date()
  const extrasById = new Map(input.awardExtras.map((item) => [item.id, item]))
  const awardAssessedById = new Map(input.awardAssessments.map((item) => [item.id, item]))
  const patentAssessedById = new Map(input.patentAssessments.map((item) => [item.id, item]))

  const awardResult = buildAwardRows(input.awards, extrasById, awardAssessedById)
  const patentResult = buildPatentRows(input.patents, patentAssessedById)
  const rows = rankRows([...awardResult.rows, ...patentResult.rows])
  const coverage = buildCoverage(input.signals, rows)

  return {
    rows,
    coverage,
    gaps: buildGaps(coverage, rows, now),
    agencyIpYield: buildAgencyIpYield(rows),
    crossHolders: buildCrossHolders(rows),
    summary: {
      totalRows: rows.length,
      fundedRows: rows.filter((row) => row.kind === 'funded').length,
      patentedRows: rows.filter((row) => row.kind === 'patented').length,
      duplicateAwardsCollapsed: awardResult.collapsed,
      patentFamiliesCollapsed: patentResult.collapsed,
    },
  }
}
