export interface PatentNestRateLimitSnapshot {
  limit: number | null
  remaining: number | null
  resetSeconds: number | null
  dailyRemaining: number | null
  monthlyRemaining: number | null
}

export interface PatentNestMetadata {
  requestId: string
  durationMs: number
  /** Parsed from the RateLimit-* / X-RateLimit-* response headers; absent when none were sent. */
  rateLimit?: PatentNestRateLimitSnapshot
}

export interface PatentNestApplicant {
  name: string
  address?: string | null
  sequence?: number | null
}

export interface PatentNestSource {
  name: string
  document?: string | null
  page?: number | null
}

export interface PatentNestRelevance {
  score?: number | null
  semanticScore?: number | null
  textScore?: number | null
  matchedFields?: string[]
}

export interface IndianPatentRecord {
  publicationNumber?: string | null
  applicationNumber?: string | null
  kind?: string | null
  country?: string | null
  title?: string | null
  abstract?: string | null
  applicants?: PatentNestApplicant[]
  inventors?: string[]
  classifications?: string[]
  filingDate?: string | null
  publicationDate?: string | null
  numberOfPages?: number | null
  numberOfClaims?: number | null
  extractionConfidence?: number | null
  source?: PatentNestSource | null
  relevance?: PatentNestRelevance | null
}

/**
 * Coverage manifest returned with every search response: what corpus was
 * searched, how big it is, and how much of it is semantically indexed. The
 * numeric fields are null until PatentNest's background census has run.
 */
export interface PatentNestSearchCoverage {
  corpus?: string | null
  description?: string | null
  jurisdiction?: string | null
  documents?: number | null
  semanticCoveragePercent?: number | null
  searchMode?: string | null
  embeddingModel?: string | null
}

export interface PatentNestSearchRequest {
  query: string
  limit?: number
  /**
   * Not accepted by the public API v1.1 (any unknown field is a 400). Only sent
   * when PATENTNEST_SEARCH_JURISDICTION_FILTER=true, for the day the API grows it.
   */
  jurisdictions?: string[]
}

export interface PatentNestSearchData {
  query: string
  count: number
  results: IndianPatentRecord[]
  coverage?: PatentNestSearchCoverage | null
}

export interface PatentNestSuccessResponse<T> {
  data: T
  meta: PatentNestMetadata
}

export interface PatentNestErrorDetails {
  code: string
  message: string
  requestId?: string
}

export interface PatentNestErrorResponse {
  error: PatentNestErrorDetails
}

export type PatentNestSearchResponse = PatentNestSuccessResponse<PatentNestSearchData>
export type PatentNestPatentResponse = PatentNestSuccessResponse<IndianPatentRecord>

// Canonical client names plus compatibility aliases used by the authenticated UI.
export type SearchIndianPatentsData = PatentNestSearchData
export type PatentNestResponse<T> = PatentNestSuccessResponse<T>
export type PatentNestPatentRecord = IndianPatentRecord
export type PatentNestApiResponse<T> = PatentNestSuccessResponse<T>
