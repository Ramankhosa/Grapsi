export type ProjectFacetItem = { value: string | number; count: number }

export type ProjectFacets = {
  sources: ProjectFacetItem[]
  years: ProjectFacetItem[]
  states: ProjectFacetItem[]
  schemes: ProjectFacetItem[]
  institutions: ProjectFacetItem[]
  disciplines: ProjectFacetItem[]
}

export type ProjectSearchItem = {
  id: string
  sourceKey: string
  sourceName: string
  sourceUrl: string | null
  detailUrl: string | null
  title: string
  abstractText: string | null
  executiveSummary: string | null
  primaryInvestigatorName: string | null
  primaryInstitutionName: string | null
  schemeName: string | null
  programName: string | null
  sanctionYear: number | null
  state: string | null
  budgetAmount: number | null
  budgetCurrency: string | null
  discipline: string | null
  areaName: string | null
  keywords: string[]
  semanticSimilarity: number
  textRank: number
  relevanceScore: number
}

export type ProjectSearchResponse = {
  query: string
  results: ProjectSearchItem[]
  totalResults: number
  approximateTotal: number
  sort: 'relevance' | 'newest' | 'largest_budget'
  degradedMode: 'full_text_only' | null
  facets: ProjectFacets
  diagnostics: {
    semanticCandidates: number
    keywordCandidates: number
    reranked: boolean
  }
}

export type ProjectFilters = {
  sourceKeys: string[]
  states: string[]
  schemes: string[]
  disciplines: string[]
  yearFrom?: number
  yearTo?: number
}

export type IdeaAnalysisSummary = {
  id: string
  title: string
  ideaText: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  currentStage: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
