/**
 * Patent Search (Funding Intelligence) — shared, client-safe types.
 *
 * Everything here is plain data that crosses the API boundary between the
 * App Router routes under /api/patent-intelligence and the React pages under
 * /funding/intelligence/patents. No imports from server modules.
 */

export type PatentApplicant = { name: string; address: string | null }

export type PatentRelevance = {
  score: number | null
  semanticScore: number | null
  textScore: number | null
  matchedFields: string[]
}

export type PatentSourceRef = { name: string; document: string | null; page: number | null }

export type PatentSearchItem = {
  /** Stable id for React keys and the shortlist — equals publicationNumberKey. */
  id: string
  publicationNumber: string
  /** Upper-cased alphanumerics only, e.g. "IN20282005A". */
  publicationNumberKey: string
  applicationNumber: string | null
  kind: string | null
  /** Country as PatentNest reported it (already "IN" for the Indian corpus). */
  country: string | null
  /** Two-letter jurisdiction: `country` when it is ISO-2, else the number prefix. */
  jurisdiction: string | null
  title: string
  abstract: string | null
  applicants: PatentApplicant[]
  inventors: string[]
  classifications: string[]
  /** Distinct 4-character IPC/CPC prefixes, e.g. ["A61K", "C07D"]. */
  classificationGroups: string[]
  filingDate: string | null
  publicationDate: string | null
  filingYear: number | null
  publicationYear: number | null
  numberOfPages: number | null
  numberOfClaims: number | null
  extractionConfidence: number | null
  source: PatentSourceRef | null
  relevance: PatentRelevance | null
}

export type PatentFacetItem = { value: string; count: number }

export type PatentFacets = {
  jurisdictions: PatentFacetItem[]
  applicants: PatentFacetItem[]
  years: PatentFacetItem[]
  classifications: PatentFacetItem[]
  kinds: PatentFacetItem[]
}

export type PatentFilters = {
  jurisdictions: string[]
  applicants: string[]
  years: string[]
  classifications: string[]
  kinds: string[]
}

export type PatentSort = 'relevance' | 'newest' | 'oldest'

export type PatentSearchCoverage = {
  corpus: string | null
  description: string | null
  jurisdiction: string | null
  documents: number | null
  semanticCoveragePercent: number | null
  searchMode: string | null
  embeddingModel: string | null
}

export type PatentUpstreamRemaining = {
  minute: number | null
  daily: number | null
  monthly: number | null
}

export type PatentSearchDiagnostics = {
  requestId: string | null
  durationMs: number | null
  cached: boolean
  jurisdictionFilterApplied: boolean
  upstreamRemaining: PatentUpstreamRemaining | null
}

export type PatentSearchResponse = {
  query: string
  limit: number
  results: PatentSearchItem[]
  facets: PatentFacets
  coverage: PatentSearchCoverage | null
  /** True when PatentNest returned as many records as we asked for (it never pages past 50). */
  capped: boolean
  diagnostics: PatentSearchDiagnostics
}

export type PatentDetailResponse = {
  patent: PatentSearchItem
  diagnostics: { requestId: string | null; cached: boolean }
}

export type PatentShortlistItemDto = {
  id: string
  publicationNumber: string
  publicationNumberKey: string
  title: string
  note: string | null
  ideaRunId: string | null
  record: PatentSearchItem
  createdAt: string
  updatedAt: string
}

export type PatentApiErrorBody = {
  error: string
  code: string
  requestId?: string
  retryAfterSeconds?: number
  resetAt?: string
  upstreamCode?: string
}
