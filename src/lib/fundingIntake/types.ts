import type { FundingFieldKey } from './constants';

export type FundingCallStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
export type FundingIntakeJobStatus =
  | 'queued'
  | 'fetching'
  | 'extracting'
  | 'needs_review'
  | 'draft_created'
  | 'failed'
  | 'canceled';
export type FundingInputType = 'url' | 'text' | 'pdf';
export type FundingDuplicateMatchType =
  | 'same_source_url'
  | 'exact_fingerprint'
  | 'fuzzy_title_agency'
  | 'same_deadline_cluster';
export type FundingDuplicateResolution =
  | 'pending'
  | 'merged_to_existing'
  | 'ignored'
  | 'create_new_anyway';
export type FundingDuplicateStatus =
  | 'none'
  | 'candidate_found'
  | 'exact_match_found'
  | 'resolved';

export type FundingExtractionFieldStatus =
  | 'supported'
  | 'unsupported'
  | 'ambiguous';

export interface FundingEvidenceAnchor {
  sourceType: 'segment';
  segmentId: string;
  quote: string;
  heading?: string | null;
}

export interface StructuredFieldValue<T = unknown> {
  value: T | null;
  status: FundingExtractionFieldStatus;
  confidence: number;
  evidence: FundingEvidenceAnchor[];
}

export type ExtractionFieldMap = Record<FundingFieldKey, StructuredFieldValue>;

export interface FundingExtractionValidationIssue {
  code: string;
  fieldKey?: FundingFieldKey | string | null;
  message: string;
  retryable?: boolean;
}

export interface FundingSourceSegment {
  id: string;
  text: string;
  heading: string | null;
}

export interface FundingExtractionPayload {
  fields: ExtractionFieldMap;
  warnings: string[];
  summarySegments?: string[];
}

export interface FundingDraftValues {
  agency_name: string;
  scheme_title: string;
  description: string;
  open_date: string | null;
  close_date: string | null;
  is_rolling: boolean;
  geography_scope: string;
  eligible_countries: string[];
  eligible_regions: string[];
  host_countries: string[];
  funder_country: string;
  funding_kinds: string[];
  institution_types: string[];
  career_stages: string[];
  citizenship_requirements: string[];
  residency_requirements: string[];
  application_languages: string[];
  disciplines: string[];
  amount_min: number | null;
  amount_max: number | null;
  currency: string;
  project_duration_min_months: number | null;
  project_duration_max_months: number | null;
  project_duration_text: string;
  eligibility_text: string;
  expected_deliverables_text: string;
  official_urls: string[];
  contact_info: string;
  sponsor_type: string;
}

export interface IntakeDuplicateResolutionInput {
  duplicateId: string;
  resolution: FundingDuplicateResolution;
}

export interface IntakeSubmitInput {
  inputType: FundingInputType;
  sourceUrl?: string;
  sourceText?: string;
  sourceFile?: {
    originalName: string;
    mimeType: string;
    size: number;
    tempFilePath: string;
    checksum: string;
  };
  operatorNotes?: string;
}

export interface IntakeOperator {
  userId: string;
  email: string;
  role: 'ADMIN' | 'CURATOR' | 'USER';
  tenantId?: string | null;
}

export interface IntakeJobSummary {
  id: string;
  input_type: FundingInputType;
  source_url: string | null;
  status: FundingIntakeJobStatus;
  duplicate_status: FundingDuplicateStatus;
  linked_funding_call_id: string | null;
  linked_call_status?: FundingCallStatus | null;
  created_at: Date;
  updated_at: Date;
  submitted_by: {
    id: string;
    email: string;
    name: string | null;
  } | null;
}

export interface DuplicateCandidateSummary {
  id: string;
  candidate_funding_call_id: string;
  match_type: FundingDuplicateMatchType;
  match_score: number;
  resolution: FundingDuplicateResolution;
  resolved_by_user_id: string | null;
  resolved_at: Date | null;
  candidate: {
    id: string;
    agency_name: string | null;
    scheme_title: string | null;
    status: string;
    source_url: string | null;
    official_urls?: string[];
    close_date: Date | null;
  } | null;
}

export interface DomainDuplicateCandidateSummary {
  candidate_funding_call_id: string;
  match_type: 'same_source_domain';
  match_score: number;
  source_domain: string;
  matched_url: string | null;
  title_similarity: number;
  agency_similarity: number;
  deadline_similarity: number;
  strong_similarity: boolean;
  candidate: {
    id: string;
    agency_name: string | null;
    scheme_title: string | null;
    status: string;
    source_url: string | null;
    official_urls: string[];
    close_date: Date | null;
  };
}
