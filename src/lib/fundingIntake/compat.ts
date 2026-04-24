import type { FundingDraftValues, FundingInputType, FundingIntakeJobStatus } from '@/lib/fundingIntake/types'
import type { FundingCallDetail, FundingCallSummary, FundingImportJobView, FundingIntakeLlmExtraction } from '@/types/funding'

type CallCatalogStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED' | 'FAILED'

type FundingCallLike = {
  id: string
  title?: string | null
  scheme_title?: string | null
  agency_name?: string | null
  agencyName?: string | null
  eligibility_text?: string | null
  expected_deliverables_text?: string | null
  amount_min?: number | null
  amount_max?: number | null
  currency?: string | null
  project_duration_text?: string | null
  official_urls?: string[] | null
  disciplines?: string[] | null
  institution_types?: string[] | null
  citizenship_requirements?: string[] | null
  application_languages?: string[] | null
  contact_info?: string | null
  programIdentifier?: string | null
  source_url?: string | null
  sourceUrl?: string | null
  description?: string | null
  summary?: string | null
  visibility?: FundingCallSummary['visibility'] | null
  status?: string | null
  catalog_status?: CallCatalogStatus | null
  close_date?: Date | string | null
  deadlineAt?: Date | string | null
  publishedAt?: Date | string | null
  archivedAt?: Date | string | null
  updatedAt?: Date | string | null
  updated_at?: Date | string | null
  sourceDomain?: string | null
  source_domain?: string | null
  sourceFingerprint?: string | null
  source_text_hash?: string | null
  extracted_json?: unknown
  metadata?: unknown
  normalizedMetadata?: unknown
}

type ExtractionRecordLike = {
  extractor_model?: string | null
  extractor_version?: string | null
  prompt_version?: string | null
  extracted_json?: unknown
  confidence_json?: unknown
  evidence_json?: unknown
  missing_fields_json?: unknown
}

type CompatExtractionPayload = {
  fields?: Record<string, { value?: unknown }>
  warnings?: string[]
}

type DuplicateCandidateLike = {
  candidate_funding_call_id: string
  match_type?: string | null
  match_score: number
  candidate?: {
    id: string
    agency_name?: string | null
    scheme_title?: string | null
    status?: string | null
    catalog_status?: string | null
    source_url?: string | null
    official_urls?: string[]
    close_date?: Date | null
  } | null
}

type IntakeJobDetailsLike = {
  job: {
    id: string
    input_type: FundingInputType
    source_url?: string | null
    status: FundingIntakeJobStatus
    duplicate_status?: 'none' | 'candidate_found' | 'exact_match_found' | 'resolved' | null
    linked_funding_call_id?: string | null
    source_file_path?: string | null
    raw_text?: string | null
    normalized_text?: string | null
    fetch_metadata_json?: unknown
    created_at: Date
    updated_at: Date
    error_code?: string | null
    error_message?: string | null
    started_at?: Date | string | null
    completed_at?: Date | string | null
  }
  extraction?: ExtractionRecordLike | null
  draftValues?: Partial<FundingDraftValues> | null
  call?: FundingCallLike | null
  duplicates?: DuplicateCandidateLike[] | null
}

function buildDerivedAssets(details: IntakeJobDetailsLike): FundingImportJobView['assets'] {
  const createdAt = details.job.created_at.toISOString()
  const fetchMetadata =
    details.job.fetch_metadata_json && typeof details.job.fetch_metadata_json === 'object' && !Array.isArray(details.job.fetch_metadata_json)
      ? (details.job.fetch_metadata_json as Record<string, unknown>)
      : {}
  const assets: FundingImportJobView['assets'] = []

  if (details.job.input_type === 'pdf' && details.job.source_file_path) {
    const fileName = details.job.source_file_path.split(/[\\/]/).pop() || 'upload.pdf'
    assets.push({
      id: `${details.job.id}:uploaded-file`,
      kind: 'UPLOADED_FILE',
      fileName: String(fetchMetadata.original_name || fileName),
      mimeType: String(fetchMetadata.mime || 'application/pdf'),
      byteSize: typeof fetchMetadata.bytes === 'number' ? fetchMetadata.bytes : null,
      storagePath: details.job.source_file_path,
      textPreview: null,
      createdAt,
    })
  }

  if (details.job.input_type === 'url' && details.job.source_url) {
    assets.push({
      id: `${details.job.id}:fetched-source`,
      kind: 'FETCHED_SOURCE',
      fileName: null,
      mimeType: typeof fetchMetadata.contentType === 'string' ? fetchMetadata.contentType : null,
      byteSize: null,
      storagePath: details.job.source_url,
      textPreview: details.job.raw_text?.slice(0, 400) || null,
      createdAt,
    })
  }

  if (details.job.input_type === 'text' && details.job.raw_text) {
    assets.push({
      id: `${details.job.id}:raw-text`,
      kind: 'RAW_TEXT',
      fileName: null,
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(details.job.raw_text, 'utf8'),
      storagePath: null,
      textPreview: details.job.raw_text.slice(0, 400),
      createdAt,
    })
  }

  if (details.job.input_type === 'pdf' && details.job.raw_text) {
    assets.push({
      id: `${details.job.id}:extracted-text`,
      kind: 'EXTRACTED_TEXT',
      fileName: null,
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(details.job.raw_text, 'utf8'),
      storagePath: null,
      textPreview: details.job.raw_text.slice(0, 400),
      createdAt,
    })
  }

  if (details.job.normalized_text) {
    assets.push({
      id: `${details.job.id}:normalized-text`,
      kind: 'NORMALIZED_TEXT',
      fileName: null,
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(details.job.normalized_text, 'utf8'),
      storagePath: null,
      textPreview: details.job.normalized_text.slice(0, 400),
      createdAt,
    })
  }

  return assets
}

function mapOutcome(details: IntakeJobDetailsLike): FundingImportJobView['outcome'] {
  if (details.job.status === 'failed' || details.job.status === 'canceled') {
    return 'FAILED'
  }

  if (details.job.linked_funding_call_id) {
    const reusedExisting = (details.duplicates || []).some((duplicate) => duplicate.candidate_funding_call_id === details.job.linked_funding_call_id)
    return reusedExisting ? 'REUSED_EXISTING' : 'CREATED'
  }

  if (details.job.duplicate_status === 'candidate_found' || details.job.duplicate_status === 'exact_match_found') {
    return 'DUPLICATE_BLOCKED'
  }

  return null
}

function serializeDate(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function mapInputType(inputType: FundingInputType | null | undefined): FundingImportJobView['inputType'] {
  if (inputType === 'pdf') {
    return 'file'
  }

  return inputType === 'text' ? 'text' : 'url'
}

function mapJobStatus(status: FundingIntakeJobStatus | null | undefined): FundingImportJobView['status'] {
  switch (status) {
    case 'queued':
    case 'fetching':
    case 'extracting':
      return 'PROCESSING'
    case 'needs_review':
      return 'NEEDS_REVIEW'
    case 'draft_created':
      return 'COMPLETED'
    case 'failed':
    case 'canceled':
      return 'FAILED'
    default:
      return 'PENDING'
  }
}

function mapCallStatus(status: string | null | undefined): FundingCallSummary['status'] {
  switch (status) {
    case 'PUBLISHED':
      return 'PUBLISHED'
    case 'ARCHIVED':
      return 'ARCHIVED'
    case 'REJECTED':
    case 'FAILED':
      return 'FAILED'
    default:
      return 'READY_FOR_REVIEW'
  }
}

function mapDuplicateReason(matchType: string | null | undefined) {
  switch (matchType) {
    case 'same_source_url':
    case 'exact_fingerprint':
      return 'exact_url' as const
    case 'same_deadline_cluster':
    case 'fuzzy_title_agency':
    default:
      return 'title_agency_deadline' as const
  }
}

function buildLlmExtraction(
  extraction: ExtractionRecordLike | null | undefined,
  draftValues: Partial<FundingDraftValues> | null | undefined
): FundingIntakeLlmExtraction | null {
  if (!extraction) {
    return null
  }

  return {
    payload:
      extraction.extracted_json &&
      typeof extraction.extracted_json === 'object' &&
      !Array.isArray(extraction.extracted_json)
        ? (extraction.extracted_json as CompatExtractionPayload as FundingIntakeLlmExtraction['payload'])
        : { fields: {}, warnings: [] },
    draftValues: draftValues || {},
    extractorModel: extraction.extractor_model || '',
    extractorVersion: extraction.extractor_version || '',
    promptVersion: extraction.prompt_version || '',
    confidenceByField:
      extraction.confidence_json && typeof extraction.confidence_json === 'object' && !Array.isArray(extraction.confidence_json)
        ? (extraction.confidence_json as Record<string, number>)
        : {},
    evidenceByField:
      extraction.evidence_json && typeof extraction.evidence_json === 'object' && !Array.isArray(extraction.evidence_json)
        ? (extraction.evidence_json as FundingIntakeLlmExtraction['evidenceByField'])
        : {},
    missingFieldKeys: Array.isArray(extraction.missing_fields_json)
      ? extraction.missing_fields_json.map((value) => String(value || '')).filter(Boolean)
      : [],
  }
}

export function toFundingImportJobView(details: IntakeJobDetailsLike | null): FundingImportJobView {
  if (!details) {
    throw new Error('Funding import job details are required')
  }

  const extractedPayload =
    details.extraction?.extracted_json &&
    typeof details.extraction.extracted_json === 'object' &&
    !Array.isArray(details.extraction.extracted_json)
      ? (details.extraction.extracted_json as CompatExtractionPayload)
      : null
  const titleField = extractedPayload?.fields?.scheme_title?.value
  const agencyField = extractedPayload?.fields?.agency_name?.value
  const deadlineField = extractedPayload?.fields?.close_date?.value
  const summaryField = extractedPayload?.fields?.description?.value
  const sourceUrl = details.job.source_url || null

  return {
    id: details.job.id,
    inputType: mapInputType(details.job.input_type),
    sourceLocator: sourceUrl,
    visibility: details.call?.visibility || 'TENANT_PRIVATE',
    status: mapJobStatus(details.job.status),
    outcome: mapOutcome(details),
    errorCode: details.job.error_code || null,
    errorMessage: details.job.error_message || null,
    startedAt: serializeDate(details.job.started_at),
    completedAt: serializeDate(details.job.completed_at),
    resultFundingCallId: details.job.linked_funding_call_id || null,
    normalizedFacts: extractedPayload
      ? {
          title:
            typeof titleField === 'string' && titleField.trim()
              ? titleField
              : details.draftValues?.scheme_title || 'Untitled',
          agencyName:
            typeof agencyField === 'string' && agencyField.trim()
              ? agencyField
              : details.draftValues?.agency_name || null,
          programIdentifier: null,
          deadlineAt: typeof deadlineField === 'string' ? deadlineField : null,
          summary:
            typeof summaryField === 'string' && summaryField.trim()
              ? summaryField
              : details.draftValues?.description || null,
          keywords: [],
          sourceUrl,
          sourceDomain: null,
        }
      : null,
    llmExtraction: buildLlmExtraction(details.extraction, details.draftValues),
    duplicateCandidates: (details.duplicates || []).map((duplicate) => ({
      fundingCallId: duplicate.candidate_funding_call_id,
      title: duplicate.candidate?.scheme_title || 'Untitled',
      agencyName: duplicate.candidate?.agency_name || null,
      sourceUrl: duplicate.candidate?.source_url || null,
      programIdentifier: null,
      deadlineAt: serializeDate(duplicate.candidate?.close_date),
      score: duplicate.match_score || 0,
      reason: mapDuplicateReason(duplicate.match_type),
    })),
    assets: buildDerivedAssets(details),
    createdAt: details.job.created_at.toISOString(),
    updatedAt: details.job.updated_at.toISOString(),
  }
}

export function toFundingCallSummary(call: FundingCallLike): FundingCallSummary {
  return {
    id: call.id,
    title: call.title || call.scheme_title || 'Untitled funding call',
    agencyName: call.agency_name || call.agencyName || null,
    programIdentifier: call.programIdentifier || null,
    sourceUrl: call.source_url || call.sourceUrl || null,
    summary: call.description || call.summary || null,
    visibility: call.visibility || 'TENANT_PRIVATE',
    status: mapCallStatus(call.catalog_status || call.status || null),
    deadlineAt: serializeDate(call.close_date || call.deadlineAt || null),
    publishedAt: serializeDate(call.publishedAt),
    archivedAt: serializeDate(call.archivedAt),
    updatedAt: serializeDate(call.updatedAt || call.updated_at) || new Date().toISOString(),
  }
}

export function toFundingCallDetail(
  call: FundingCallLike,
  options?: { recentJobs?: FundingImportJobView[] }
): FundingCallDetail {
  const summary = toFundingCallSummary(call)
  const recentJobAssets = (options?.recentJobs || []).flatMap((job) => job.assets || [])
  const assets = recentJobAssets.filter(
    (asset, index, list) => list.findIndex((candidate) => candidate.id === asset.id) === index
  )

  return {
    ...summary,
    sourceDomain: call.sourceDomain || call.source_domain || null,
    sourceFingerprint: call.sourceFingerprint || call.source_text_hash || null,
    extractedFacts: call.extracted_json
      ? {
          title: call.scheme_title || call.title || 'Untitled funding call',
          agencyName: call.agency_name || call.agencyName || null,
          programIdentifier: call.programIdentifier || null,
          deadlineAt: serializeDate(call.close_date),
          summary: call.description || call.summary || null,
          keywords: [],
          sourceUrl: call.source_url || call.sourceUrl || null,
          sourceDomain: call.sourceDomain || call.source_domain || null,
        }
      : null,
    normalizedMetadata:
      (call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
        ? (call.metadata as Record<string, unknown>)
        : null) ||
      (call.normalizedMetadata &&
      typeof call.normalizedMetadata === 'object' &&
      !Array.isArray(call.normalizedMetadata)
        ? (call.normalizedMetadata as Record<string, unknown>)
        : null),
    llmExtraction: null,
    description: call.description || call.summary || null,
    eligibilityText: call.eligibility_text || null,
    expectedDeliverablesText: call.expected_deliverables_text || null,
    amountMin: typeof call.amount_min === 'number' ? call.amount_min : null,
    amountMax: typeof call.amount_max === 'number' ? call.amount_max : null,
    currency: call.currency || null,
    projectDurationText: call.project_duration_text || null,
    officialUrls: Array.isArray(call.official_urls) ? call.official_urls.filter(Boolean) : [],
    disciplines: Array.isArray(call.disciplines) ? call.disciplines.filter(Boolean) : [],
    institutionTypes: Array.isArray(call.institution_types) ? call.institution_types.filter(Boolean) : [],
    citizenshipRequirements: Array.isArray(call.citizenship_requirements)
      ? call.citizenship_requirements.filter(Boolean)
      : [],
    applicationLanguages: Array.isArray(call.application_languages)
      ? call.application_languages.filter(Boolean)
      : [],
    contactInfo:
      typeof call.contact_info === 'string' && call.contact_info.trim().length > 0
        ? call.contact_info
        : null,
    assets,
    recentJobs: options?.recentJobs || [],
  }
}
