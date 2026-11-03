import type { z } from 'zod'
import type { PATENTNEST_FIELDS, patentNestFiltersSchema, patentNestSearchSchema } from './searchContract'

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
  license?: string | null
  attribution?: string | null
}

export interface PatentNestRelevance {
  score?: number | null
  semanticScore?: number | null
  textScore?: number | null
  matchedFields?: string[]
  matchedViaFamilyMember?: string | null
}

export interface IndianPatentRecord {
  publicationNumber?: string | null
  applicationNumber?: string | null
  kind?: string | null
  country?: string | null
  familyId?: string | null
  title?: string | null
  abstract?: string | null
  applicants?: PatentNestApplicant[]
  inventors?: string[]
  classifications?: string[]
  filingDate?: string | null
  publicationDate?: string | null
  /** Explicit recorded grant date only; never inferred from publication date or kind. */
  grantDate?: string | null
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
  jurisdictions?: string[]
  sources?: PatentNestCoverageSource[]
  limitations?: string[]
}

export interface PatentNestCoverageSource {
  corpus?: string | null
  description?: string | null
  jurisdiction?: string | null
  documents?: number | null
  semanticCoveragePercent?: number | null
  semanticUnit?: string | null
  license?: string | null
  attribution?: string | null
}

export type PatentNestField = typeof PATENTNEST_FIELDS[number]
export type PatentNestSearchFilters = z.infer<typeof patentNestFiltersSchema>
export type PatentNestSearchRequest = z.input<typeof patentNestSearchSchema>
export type PatentNestSearchMode = 'hybrid' | 'structured'
export type PatentNestSearchSort = NonNullable<PatentNestSearchRequest['sort']>
export interface PatentNestPagination {
  offset: number
  limit: number
  hasMore: boolean
  nextOffset: number | null
}

export interface PatentNestSearchData {
  query: string
  count: number
  results: IndianPatentRecord[]
  coverage?: PatentNestSearchCoverage | null
  mode?: PatentNestSearchMode
  pagination?: PatentNestPagination
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
