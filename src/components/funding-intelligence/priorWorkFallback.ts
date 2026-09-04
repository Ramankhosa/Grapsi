import type { PriorWork, PriorWorkRow } from '@/lib/ideaIntelligence/priorWork'

/** The subset of a retrieved project this fallback reads. */
export interface RetrievedProject {
  id: string
  title: string
  abstractText?: string | null
  primaryInstitutionName?: string | null
  sanctionYear?: number | null
  fundingAgency?: string | null
  /** Always present on a retrieved project; it is the agency fallback. */
  sourceKey: string
  schemeName?: string | null
  budgetAmount?: number | null
  budgetCurrency?: string | null
  relevanceScore?: number
}

/**
 * Runs made before the prior-work pass existed have no merged list stored. Show
 * their retrieved awards rather than an empty screen — with no coverage map or
 * gap readings, which those runs genuinely never computed.
 */
export function fallbackPriorWork(projects: RetrievedProject[]): PriorWork {
  const rows: PriorWorkRow[] = (projects || []).map((project) => ({
    key: `legacy:${project.id}`,
    kind: 'funded' as const,
    title: project.title,
    org: project.primaryInstitutionName ?? null,
    year: project.sanctionYear ?? null,
    facetsCovered: [],
    matchBasis: 'Retrieved for this idea before aspect-level coverage was recorded.',
    award: {
      id: project.id,
      abstract: project.abstractText && project.abstractText.toUpperCase() !== 'NA' ? project.abstractText : null,
      agencyName: project.fundingAgency || project.sourceKey,
      schemeName: project.schemeName ?? null,
      budgetAmount: project.budgetAmount ?? null,
      budgetCurrency: project.budgetCurrency ?? null,
      durationMonths: null,
      status: 'unknown' as const,
      hasReportedOutput: false,
      patentCount: 0,
      publicationCount: 0,
      relevanceScore: project.relevanceScore ?? 0,
      duplicateIds: [],
    },
    patent: null,
  }))
  return {
    rows,
    coverage: [],
    gaps: [],
    agencyIpYield: [],
    crossHolders: [],
    summary: {
      totalRows: rows.length,
      fundedRows: rows.length,
      patentedRows: 0,
      duplicateAwardsCollapsed: 0,
      patentFamiliesCollapsed: 0,
    },
  }
}
