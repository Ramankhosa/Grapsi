import type { FundingStatus as GrantFundingStatus, FundingVisibility as GrantFundingVisibility } from './grant'

export type FundingVisibility = GrantFundingVisibility
export type FundingStatus = GrantFundingStatus

export type FundingImportInputType = 'url' | 'file' | 'text'

export type FundingImportOutcome =
  | 'CREATED'
  | 'UPDATED'
  | 'REUSED_EXISTING'
  | 'DUPLICATE_BLOCKED'
  | 'FAILED'

export type FundingImportJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'NEEDS_REVIEW'
  | 'COMPLETED'
  | 'FAILED'

export type FundingImportAssetKind =
  | 'UPLOADED_FILE'
  | 'FETCHED_SOURCE'
  | 'RAW_TEXT'
  | 'NORMALIZED_TEXT'
  | 'EXTRACTED_TEXT'

export interface DuplicateCandidate {
  fundingCallId: string
  title: string
  agencyName?: string | null
  sourceUrl?: string | null
  programIdentifier?: string | null
  deadlineAt?: string | null
  score: number
  reason: 'exact_url' | 'program_identifier' | 'title_agency_deadline'
}

export interface NormalizedFundingFacts {
  title: string
  agencyName?: string | null
  programIdentifier?: string | null
  deadlineAt?: string | null
  summary?: string | null
  keywords: string[]
  sourceUrl?: string | null
  sourceDomain?: string | null
}

export interface FundingIntakeStructuredFieldValue<T = unknown> {
  value: T | null
  confidence: number
  evidence: string | null
  is_missing: boolean
  is_uncertain: boolean
}

export interface FundingIntakeExtractionPayload {
  fields: Record<string, FundingIntakeStructuredFieldValue>
  warnings: string[]
}

export interface FundingIntakeLlmExtraction {
  payload: FundingIntakeExtractionPayload
  draftValues: Record<string, unknown>
  extractorModel: string
  extractorVersion: string
  promptVersion: string
  confidenceByField: Record<string, number>
  evidenceByField: Record<string, string | null>
  missingFieldKeys: string[]
}

export interface FundingImportRequest {
  inputType: FundingImportInputType
  visibility: FundingVisibility
  sourceUrl?: string
  rawText?: string
}

export interface FundingImportAssetView {
  id: string
  kind: FundingImportAssetKind
  fileName?: string | null
  mimeType?: string | null
  byteSize?: number | null
  storagePath?: string | null
  textPreview?: string | null
  createdAt: string
}

export interface FundingCallSummary {
  id: string
  title: string
  agencyName?: string | null
  programIdentifier?: string | null
  sourceUrl?: string | null
  summary?: string | null
  visibility: FundingVisibility
  status: FundingStatus
  deadlineAt?: string | null
  publishedAt?: string | null
  archivedAt?: string | null
  updatedAt: string
}

export interface FundingCallDetail extends FundingCallSummary {
  sourceDomain?: string | null
  sourceFingerprint?: string | null
  extractedFacts?: NormalizedFundingFacts | null
  normalizedMetadata?: Record<string, unknown> | null
  llmExtraction?: FundingIntakeLlmExtraction | null
  description?: string | null
  eligibilityText?: string | null
  expectedDeliverablesText?: string | null
  amountMin?: number | null
  amountMax?: number | null
  currency?: string | null
  projectDurationText?: string | null
  officialUrls?: string[]
  disciplines?: string[]
  institutionTypes?: string[]
  citizenshipRequirements?: string[]
  applicationLanguages?: string[]
  contactInfo?: string | null
  assets: FundingImportAssetView[]
  recentJobs: FundingImportJobView[]
}

export interface FundingImportJobView {
  id: string
  inputType: FundingImportInputType
  sourceLocator?: string | null
  visibility: FundingVisibility
  status: FundingImportJobStatus
  outcome?: FundingImportOutcome | null
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
  resultFundingCallId?: string | null
  normalizedFacts?: NormalizedFundingFacts | null
  llmExtraction?: FundingIntakeLlmExtraction | null
  duplicateCandidates: DuplicateCandidate[]
  assets: FundingImportAssetView[]
  createdAt: string
  updatedAt: string
}
