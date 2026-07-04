export interface PatentNestMetadata {
  requestId: string
  durationMs: number
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

export interface PatentNestSearchRequest {
  query: string
  limit?: number
}

export interface PatentNestSearchData {
  query: string
  count: number
  results: IndianPatentRecord[]
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
