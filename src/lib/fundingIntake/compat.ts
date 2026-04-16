import type { FundingCallDetail, FundingCallSummary, FundingImportJobView } from '@/types/funding'

function mapInputType(inputType: string | null | undefined): 'url' | 'file' | 'text' {
  if (inputType === 'pdf') {
    return 'file'
  }

  return inputType === 'text' ? 'text' : 'url'
}

function mapJobStatus(status: string | null | undefined): FundingImportJobView['status'] {
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
      return 'title_agency_deadline' as const
    default:
      return 'title_agency_deadline' as const
  }
}

export function toFundingImportJobView(details: any): FundingImportJobView {
  const extraction = details?.extraction
  const extractedPayload = extraction?.extracted_json || null
  const titleField = extractedPayload?.fields?.scheme_title?.value
  const agencyField = extractedPayload?.fields?.agency_name?.value
  const deadlineField = extractedPayload?.fields?.close_date?.value
  const summaryField = extractedPayload?.fields?.description?.value
  const sourceUrl = details?.job?.source_url || null

  return {
    id: details.job.id,
    inputType: mapInputType(details.job.input_type),
    sourceLocator: sourceUrl,
    visibility: details.call?.visibility || 'TENANT_PRIVATE',
    status: mapJobStatus(details.job.status),
    outcome: details.job.linked_funding_call_id ? 'CREATED' : null,
    errorCode: details.job.error_code || null,
    errorMessage: details.job.error_message || null,
    startedAt: details.job.started_at ? new Date(details.job.started_at).toISOString() : null,
    completedAt: details.job.completed_at ? new Date(details.job.completed_at).toISOString() : null,
    resultFundingCallId: details.job.linked_funding_call_id || null,
    normalizedFacts: extractedPayload
      ? {
          title: typeof titleField === 'string' && titleField.trim() ? titleField : details.draftValues?.scheme_title || 'Untitled',
          agencyName: typeof agencyField === 'string' ? agencyField : details.draftValues?.agency_name || null,
          programIdentifier: null,
          deadlineAt: typeof deadlineField === 'string' ? deadlineField : null,
          summary: typeof summaryField === 'string' ? summaryField : details.draftValues?.description || null,
          keywords: [],
          sourceUrl,
          sourceDomain: null,
        }
      : null,
    llmExtraction: extraction
      ? {
          payload: extractedPayload,
          draftValues: details.draftValues || {},
          extractorModel: extraction.extractor_model || '',
          extractorVersion: extraction.extractor_version || '',
          promptVersion: extraction.prompt_version || '',
          confidenceByField: extraction.confidence_json || {},
          evidenceByField: extraction.evidence_json || {},
          missingFieldKeys: extraction.missing_fields_json || [],
        }
      : null,
    duplicateCandidates: Array.isArray(details.duplicates)
      ? details.duplicates.map((duplicate: any) => ({
          fundingCallId: duplicate.candidate_funding_call_id,
          title: duplicate.candidate?.scheme_title || 'Untitled',
          agencyName: duplicate.candidate?.agency_name || null,
          sourceUrl: duplicate.candidate?.source_url || null,
          programIdentifier: null,
          deadlineAt: duplicate.candidate?.close_date ? new Date(duplicate.candidate.close_date).toISOString() : null,
          score: duplicate.match_score || 0,
          reason: mapDuplicateReason(duplicate.match_type),
        }))
      : [],
    assets: [],
    createdAt: new Date(details.job.created_at).toISOString(),
    updatedAt: new Date(details.job.updated_at).toISOString(),
  }
}

export function toFundingCallSummary(call: any): FundingCallSummary {
  return {
    id: call.id,
    title: call.title || call.scheme_title || 'Untitled funding call',
    agencyName: call.agency_name || call.agencyName || null,
    programIdentifier: call.programIdentifier || null,
    sourceUrl: call.source_url || call.sourceUrl || null,
    summary: call.description || call.summary || null,
    visibility: call.visibility || 'TENANT_PRIVATE',
    status: mapCallStatus(call.catalog_status || call.status || null),
    deadlineAt: call.close_date
      ? new Date(call.close_date).toISOString()
      : call.deadlineAt
        ? new Date(call.deadlineAt).toISOString()
        : null,
    publishedAt: call.publishedAt ? new Date(call.publishedAt).toISOString() : null,
    archivedAt: call.archivedAt ? new Date(call.archivedAt).toISOString() : null,
    updatedAt: new Date(call.updatedAt || call.updated_at || Date.now()).toISOString(),
  }
}

export function toFundingCallDetail(call: any, options?: { recentJobs?: FundingImportJobView[] }): FundingCallDetail {
  const summary = toFundingCallSummary(call)

  return {
    ...summary,
    sourceDomain: call.sourceDomain || call.source_domain || null,
    sourceFingerprint: call.sourceFingerprint || call.source_text_hash || null,
    extractedFacts: call.extracted_json
      ? {
          title: call.scheme_title || call.title || 'Untitled funding call',
          agencyName: call.agency_name || call.agencyName || null,
          programIdentifier: call.programIdentifier || null,
          deadlineAt: call.close_date ? new Date(call.close_date).toISOString() : null,
          summary: call.description || call.summary || null,
          keywords: [],
          sourceUrl: call.source_url || call.sourceUrl || null,
          sourceDomain: call.sourceDomain || call.source_domain || null,
        }
      : null,
    normalizedMetadata: call.metadata || call.normalizedMetadata || null,
    llmExtraction: null,
    assets: [],
    recentJobs: options?.recentJobs || [],
  }
}
