import path from 'path'

import type { FundingCall, FundingImportAsset, FundingImportJob, FundingSourceType, Prisma } from '@/lib/prisma-generated'

import { prisma } from '@/lib/prisma'
import { extractCanonicalTextFromPdf, extractFundingOpportunity } from '@/lib/fundingIntake/extractor'
import type { FundingDraftValues, FundingExtractionPayload } from '@/lib/fundingIntake/types'
import {
  buildDraftValuesFromExtraction,
  extractConfidenceMap,
  extractEvidenceMap,
  extractMissingFieldKeys,
  fetchReadableUrlContent,
  normalizeMultilineText,
} from '@/lib/fundingIntake/utils'
import type {
  DuplicateCandidate,
  FundingCallDetail,
  FundingCallSummary,
  FundingImportAssetView,
  FundingImportInputType,
  FundingImportJobView,
  FundingIntakeLlmExtraction,
  FundingImportRequest,
  FundingVisibility,
  NormalizedFundingFacts,
} from '@/types/funding'

import type { FundingActor } from './access'
import {
  buildFundingFingerprint,
  canonicalizeSourceUrl,
  extractFundingFacts,
  extractFundingSourceText,
  getSourceDomain,
  normalizeWhitespace,
} from './normalization'
import { readFundingAssetBuffer, writeFundingBufferAsset } from './storage'

const JOB_ASSET_PREVIEW_LENGTH = 220

type FundingImportJobWithAssets = Prisma.FundingImportJobGetPayload<{
  include: {
    assets: true
  }
}>

type FundingCallWithDetails = Prisma.FundingCallGetPayload<{
  include: {
    assets: true
    importJobs: {
      include: {
        assets: true
      }
    }
  }
}>

export class FundingImportError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'FUNDING_IMPORT_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

function sourceTypeFromInputType(inputType: FundingImportInputType): FundingSourceType {
  switch (inputType) {
    case 'url':
      return 'URL'
    case 'file':
      return 'FILE'
    case 'text':
      return 'TEXT'
    default:
      return 'TEXT'
  }
}

function inputTypeFromSourceType(sourceType: FundingSourceType): FundingImportInputType {
  switch (sourceType) {
    case 'URL':
      return 'url'
    case 'FILE':
      return 'file'
    case 'TEXT':
    case 'MANUAL':
    default:
      return 'text'
  }
}

function hasSuperAdminRead(actor: FundingActor) {
  return actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('SUPER_ADMIN_VIEWER')
}

function hasSuperAdminWrite(actor: FundingActor) {
  return actor.roles.includes('SUPER_ADMIN')
}

function coerceFacts(value: Prisma.JsonValue | null | undefined) {
  return (value || null) as NormalizedFundingFacts | null
}

function coerceLlmExtraction(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const llmExtraction = (value as Record<string, unknown>).llmExtraction
  if (!llmExtraction || typeof llmExtraction !== 'object' || Array.isArray(llmExtraction)) {
    return null
  }

  return llmExtraction as FundingIntakeLlmExtraction
}

function coerceDuplicateCandidates(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? (value as unknown as DuplicateCandidate[]) : []
}

function trimPreview(text?: string | null) {
  if (!text) {
    return null
  }

  const normalized = normalizeWhitespace(text)
  if (normalized.length <= JOB_ASSET_PREVIEW_LENGTH) {
    return normalized
  }

  return `${normalized.slice(0, JOB_ASSET_PREVIEW_LENGTH - 3).trimEnd()}...`
}

function serializeAsset(asset: FundingImportAsset): FundingImportAssetView {
  return {
    id: asset.id,
    kind: asset.kind,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    storagePath: asset.storagePath,
    textPreview: trimPreview(asset.textContent),
    createdAt: asset.createdAt.toISOString(),
  }
}

function serializeJob(job: FundingImportJobWithAssets): FundingImportJobView {
  return {
    id: job.id,
    inputType: inputTypeFromSourceType(job.sourceType),
    sourceLocator: job.sourceLocator,
    visibility: job.visibility as FundingVisibility,
    status: job.status,
    outcome: job.outcome,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() || null,
    completedAt: job.completedAt?.toISOString() || null,
    resultFundingCallId: job.fundingCallId,
    normalizedFacts: coerceFacts(job.normalizedFactsJson),
    llmExtraction: coerceLlmExtraction(job.importMetadata),
    duplicateCandidates: coerceDuplicateCandidates(job.duplicateCandidatesJson),
    assets: job.assets.map(serializeAsset),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  }
}

function serializeCallSummary(call: FundingCall): FundingCallSummary {
  const facts = coerceFacts(call.extractedFacts)

  return {
    id: call.id,
    title: call.title,
    agencyName: call.agencyName,
    programIdentifier: call.programIdentifier,
    sourceUrl: call.sourceUrl,
    summary: call.summary || facts?.summary || null,
    visibility: call.visibility as FundingVisibility,
    status: call.status,
    deadlineAt: call.deadlineAt?.toISOString() || facts?.deadlineAt || null,
    publishedAt: call.publishedAt?.toISOString() || null,
    archivedAt: call.archivedAt?.toISOString() || null,
    updatedAt: call.updatedAt.toISOString(),
  }
}

function visibleFundingCallWhere(actor: FundingActor): Prisma.FundingCallWhereInput {
  if (hasSuperAdminRead(actor)) {
    return {}
  }

  if (!actor.tenantId) {
    return {
      visibility: 'GLOBAL_PUBLISHED',
      status: 'PUBLISHED',
      tenantId: null,
    } as Prisma.FundingCallWhereInput
  }

  return {
    OR: [
      { tenantId: actor.tenantId },
      { tenantId: null, visibility: 'GLOBAL_PUBLISHED', status: 'PUBLISHED' },
    ],
  } as Prisma.FundingCallWhereInput
}

function visibleFundingImportJobWhere(actor: FundingActor): Prisma.FundingImportJobWhereInput {
  if (hasSuperAdminRead(actor)) {
    return {}
  }

  if (!actor.tenantId) {
    return {
      visibility: 'GLOBAL_PUBLISHED',
      tenantId: null,
    } as Prisma.FundingImportJobWhereInput
  }

  return {
    tenantId: actor.tenantId,
  } as Prisma.FundingImportJobWhereInput
}

function duplicateCandidateWhere(actor: FundingActor, visibility: FundingVisibility): Prisma.FundingCallWhereInput {
  if (visibility === 'GLOBAL_PUBLISHED') {
    return {
      tenantId: null,
      status: { not: 'FAILED' as const },
    } as Prisma.FundingCallWhereInput
  }

  if (actor.tenantId) {
    return {
      OR: [
        { tenantId: actor.tenantId, status: { not: 'FAILED' as const } },
        { tenantId: null, visibility: 'GLOBAL_PUBLISHED' as const, status: { not: 'FAILED' as const } },
      ],
    } as Prisma.FundingCallWhereInput
  }

  return {
    tenantId: null,
    visibility: 'GLOBAL_PUBLISHED' as const,
    status: { not: 'FAILED' as const },
  } as Prisma.FundingCallWhereInput
}

function normalizeComparable(value?: string | null) {
  return (value || '').trim().toLowerCase()
}

function sameCalendarDate(a?: string | Date | null, b?: string | Date | null) {
  if (!a || !b) {
    return false
  }

  const left = typeof a === 'string' ? a : a.toISOString()
  const right = typeof b === 'string' ? b : b.toISOString()
  return left.slice(0, 10) === right.slice(0, 10)
}

function buildLlmExtractionRecord(payload: FundingExtractionPayload, draftValues: FundingDraftValues, metadata: {
  extractorModel: string
  extractorVersion: string
  promptVersion: string
}): FundingIntakeLlmExtraction {
  return {
    payload: payload as unknown as FundingIntakeLlmExtraction['payload'],
    draftValues: draftValues as unknown as Record<string, unknown>,
    extractorModel: metadata.extractorModel,
    extractorVersion: metadata.extractorVersion,
    promptVersion: metadata.promptVersion,
    confidenceByField: extractConfidenceMap(payload),
    evidenceByField: extractEvidenceMap(payload),
    missingFieldKeys: extractMissingFieldKeys(payload),
  }
}

function buildFactsFromDraftValues(params: {
  draftValues: FundingDraftValues
  fallbackFacts: NormalizedFundingFacts
  sourceUrl?: string | null
}): NormalizedFundingFacts {
  const sourceUrl = canonicalizeSourceUrl(params.sourceUrl || params.fallbackFacts.sourceUrl)
  const keywords = uniqueStrings([
    ...(params.draftValues.disciplines || []),
    ...(params.draftValues.funding_kinds || []),
    ...(params.draftValues.institution_types || []),
    ...(params.draftValues.eligible_regions || []),
    ...(params.draftValues.eligible_countries || []),
    ...(params.fallbackFacts.keywords || []),
  ]).slice(0, 12)

  const closeDateIso = params.draftValues.close_date
    ? new Date(`${params.draftValues.close_date}T00:00:00.000Z`).toISOString()
    : params.fallbackFacts.deadlineAt || null

  return {
    title: params.draftValues.scheme_title || params.fallbackFacts.title || 'Untitled funding opportunity',
    agencyName: params.draftValues.agency_name || params.fallbackFacts.agencyName || null,
    programIdentifier: params.fallbackFacts.programIdentifier || null,
    deadlineAt: closeDateIso,
    summary: params.draftValues.description || params.fallbackFacts.summary || null,
    keywords,
    sourceUrl,
    sourceDomain: getSourceDomain(sourceUrl),
  }
}

async function createAsset(params: {
  jobId: string
  kind: FundingImportAsset['kind']
  fileName?: string | null
  mimeType?: string | null
  byteSize?: number | null
  storagePath?: string | null
  textContent?: string | null
  fundingCallId?: string | null
  metadata?: Prisma.InputJsonValue
}) {
  return prisma.fundingImportAsset.create({
    data: {
      jobId: params.jobId,
      kind: params.kind,
      fileName: params.fileName || null,
      mimeType: params.mimeType || null,
      byteSize: params.byteSize ?? null,
      storagePath: params.storagePath || null,
      textContent: params.textContent || null,
      metadata: params.metadata,
      fundingCallId: params.fundingCallId || null,
    },
  })
}

async function prepareJobSource(job: FundingImportJobWithAssets) {
  if (job.sourceType === 'FILE') {
    const uploadedAsset = job.assets.find((asset) => asset.kind === 'UPLOADED_FILE')
    if (!uploadedAsset?.storagePath) {
      throw new FundingImportError('Uploaded file asset not found for this import job', 500, 'SOURCE_ASSET_MISSING')
    }

    const isPdf = (uploadedAsset.mimeType || '').toLowerCase().includes('pdf')

    if (isPdf) {
      const extracted = await extractCanonicalTextFromPdf(uploadedAsset.storagePath)
      await createAsset({
        jobId: job.id,
        kind: 'EXTRACTED_TEXT',
        mimeType: 'text/plain',
        textContent: extracted.rawText,
      })

      await createAsset({
        jobId: job.id,
        kind: 'NORMALIZED_TEXT',
        mimeType: 'text/plain',
        textContent: extracted.normalizedText,
        metadata: {
          extractorModel: extracted.extractorModel,
          warnings: extracted.warnings,
        },
      })

      return {
        normalizedText: extracted.normalizedText,
        sourceUrl: null,
        sourceMimeType: uploadedAsset.mimeType || 'application/pdf',
        fallbackFacts: extractFundingFacts({
          text: extracted.normalizedText,
        }),
        normalizationMetadata: {
          assetKinds: job.assets.map((asset) => asset.kind),
          sourceMimeType: uploadedAsset.mimeType || 'application/pdf',
          pdfTranscriptionWarnings: extracted.warnings,
          pdfExtractorModel: extracted.extractorModel,
        },
      }
    }

    const buffer = await readFundingAssetBuffer(uploadedAsset.storagePath)
    const extracted = await extractFundingSourceText({
      buffer,
      fileName: uploadedAsset.fileName || path.basename(uploadedAsset.storagePath),
      mimeType: uploadedAsset.mimeType,
    })

    if (extracted.extractedText) {
      await createAsset({
        jobId: job.id,
        kind: 'EXTRACTED_TEXT',
        mimeType: 'text/plain',
        textContent: extracted.extractedText,
      })
    }

    await createAsset({
      jobId: job.id,
      kind: 'NORMALIZED_TEXT',
      mimeType: 'text/plain',
      textContent: extracted.normalizedText,
    })

    return {
      normalizedText: extracted.normalizedText,
      sourceUrl: null,
      sourceMimeType: uploadedAsset.mimeType || extracted.mimeType,
      fallbackFacts: extractFundingFacts({
        text: extracted.normalizedText,
        titleHint: extracted.titleHint,
      }),
      normalizationMetadata: {
        assetKinds: job.assets.map((asset) => asset.kind),
        sourceMimeType: uploadedAsset.mimeType || extracted.mimeType,
      },
    }
  }

  if (job.sourceType === 'TEXT') {
    const rawText = typeof (job.rawPayload as any)?.rawText === 'string' ? String((job.rawPayload as any).rawText) : ''
    if (!rawText.trim()) {
      throw new FundingImportError('Raw text import is empty', 400, 'EMPTY_TEXT_IMPORT')
    }

    const existingRawAsset = job.assets.find((asset) => asset.kind === 'RAW_TEXT')
    if (!existingRawAsset) {
      await createAsset({
        jobId: job.id,
        kind: 'RAW_TEXT',
        mimeType: 'text/plain',
        textContent: rawText,
      })
    }

    const normalizedText = normalizeMultilineText(rawText)
    await createAsset({
      jobId: job.id,
      kind: 'NORMALIZED_TEXT',
      mimeType: 'text/plain',
      textContent: normalizedText,
    })

    return {
      normalizedText,
      sourceUrl: null,
      sourceMimeType: 'text/plain',
      fallbackFacts: extractFundingFacts({ text: normalizedText }),
      normalizationMetadata: {
        characterCount: normalizedText.length,
        sourceMimeType: 'text/plain',
      },
    }
  }

  const sourceUrl = canonicalizeSourceUrl(typeof (job.rawPayload as any)?.sourceUrl === 'string'
    ? String((job.rawPayload as any).sourceUrl)
    : job.sourceLocator)
  if (!sourceUrl) {
    throw new FundingImportError('Source URL missing for funding import job', 400, 'SOURCE_URL_MISSING')
  }

  const sourceFileName = path.basename(new URL(sourceUrl).pathname || 'source')
  const fetched = await fetchReadableUrlContent(sourceUrl)

  await createAsset({
    jobId: job.id,
    kind: 'FETCHED_SOURCE',
    fileName: sourceFileName || null,
    mimeType: String(fetched.fetchMetadata.contentType || 'text/html'),
    textContent: fetched.rawText,
    byteSize: Number(fetched.fetchMetadata.contentLength || 0) || null,
    metadata: fetched.fetchMetadata as Prisma.InputJsonValue,
  })

  await createAsset({
    jobId: job.id,
    kind: 'NORMALIZED_TEXT',
    mimeType: 'text/plain',
    textContent: fetched.normalizedText,
  })

  return {
    normalizedText: fetched.normalizedText,
    sourceUrl,
    sourceMimeType: String(fetched.fetchMetadata.contentType || 'text/html'),
    fallbackFacts: extractFundingFacts({
      text: fetched.normalizedText,
      sourceUrl,
    }),
    normalizationMetadata: {
      ...fetched.fetchMetadata,
      sourceMimeType: String(fetched.fetchMetadata.contentType || 'text/html'),
    },
  }
}

function rankDuplicateCandidate(existing: FundingCall, facts: NormalizedFundingFacts): DuplicateCandidate | null {
  const existingUrl = canonicalizeSourceUrl(existing.sourceUrl)
  const incomingUrl = canonicalizeSourceUrl(facts.sourceUrl)

  if (existingUrl && incomingUrl && existingUrl === incomingUrl) {
    return {
      fundingCallId: existing.id,
      title: existing.title,
      agencyName: existing.agencyName,
      sourceUrl: existing.sourceUrl,
      programIdentifier: existing.programIdentifier,
      deadlineAt: existing.deadlineAt?.toISOString() || null,
      score: 100,
      reason: 'exact_url',
    }
  }

  if (
    normalizeComparable(existing.agencyName) &&
    normalizeComparable(existing.agencyName) === normalizeComparable(facts.agencyName) &&
    normalizeComparable(existing.programIdentifier) &&
    normalizeComparable(existing.programIdentifier) === normalizeComparable(facts.programIdentifier)
  ) {
    return {
      fundingCallId: existing.id,
      title: existing.title,
      agencyName: existing.agencyName,
      sourceUrl: existing.sourceUrl,
      programIdentifier: existing.programIdentifier,
      deadlineAt: existing.deadlineAt?.toISOString() || null,
      score: 98,
      reason: 'program_identifier',
    }
  }

  if (
    normalizeComparable(existing.title) &&
    normalizeComparable(existing.title) === normalizeComparable(facts.title) &&
    normalizeComparable(existing.agencyName) &&
    normalizeComparable(existing.agencyName) === normalizeComparable(facts.agencyName) &&
    sameCalendarDate(existing.deadlineAt, facts.deadlineAt)
  ) {
    return {
      fundingCallId: existing.id,
      title: existing.title,
      agencyName: existing.agencyName,
      sourceUrl: existing.sourceUrl,
      programIdentifier: existing.programIdentifier,
      deadlineAt: existing.deadlineAt?.toISOString() || null,
      score: 90,
      reason: 'title_agency_deadline',
    }
  }

  return null
}

async function findDuplicateCandidates(actor: FundingActor, visibility: FundingVisibility, facts: NormalizedFundingFacts) {
  const candidates = await prisma.fundingCall.findMany({
    where: duplicateCandidateWhere(actor, visibility),
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  return candidates
    .map((candidate) => rankDuplicateCandidate(candidate, facts))
    .filter((candidate): candidate is DuplicateCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score)
}

async function attachJobAssetsToCall(jobId: string, fundingCallId: string) {
  await prisma.fundingImportAsset.updateMany({
    where: { jobId },
    data: { fundingCallId },
  })
}

async function createFundingCallFromFacts(params: {
  actor: FundingActor
  visibility: FundingVisibility
  sourceType: FundingSourceType
  facts: NormalizedFundingFacts
  jobId: string
  metadata?: Prisma.InputJsonValue
}) {
  const isGlobal = params.visibility === 'GLOBAL_PUBLISHED'
  const status = isGlobal ? 'READY_FOR_REVIEW' : 'PUBLISHED'
  const now = new Date()
  const sourceUrl = canonicalizeSourceUrl(params.facts.sourceUrl)

  const fundingCall = await prisma.fundingCall.create({
    data: {
      tenantId: isGlobal ? null : params.actor.tenantId,
      visibility: params.visibility,
      status,
      title: params.facts.title,
      agencyName: params.facts.agencyName,
      sourceUrl,
      sourceFingerprint: buildFundingFingerprint(params.facts),
      sourceDomain: getSourceDomain(sourceUrl),
      programIdentifier: params.facts.programIdentifier,
      summary: params.facts.summary,
      sourceType: params.sourceType,
      deadlineAt: params.facts.deadlineAt ? new Date(params.facts.deadlineAt) : null,
      publishedAt: status === 'PUBLISHED' ? now : null,
      archivedAt: null,
      extractedFacts: params.facts as unknown as Prisma.InputJsonValue,
      normalizedMetadata: {
        ...(params.metadata && typeof params.metadata === 'object' ? params.metadata : {}),
        importJobId: params.jobId,
      } as Prisma.InputJsonValue,
      createdByUserId: params.actor.id,
      updatedByUserId: params.actor.id,
    },
  })

  await attachJobAssetsToCall(params.jobId, fundingCall.id)
  return fundingCall
}

function createJobCompletionMetadata(params: {
  sourceMimeType: string
  normalizationMetadata: Record<string, unknown>
  facts: NormalizedFundingFacts
  llmExtraction?: FundingIntakeLlmExtraction | null
}) {
  return {
    sourceMimeType: params.sourceMimeType,
    normalizedTitle: normalizeComparable(params.facts.title),
    sourceDomain: params.facts.sourceDomain || null,
    keywordCount: params.facts.keywords.length,
    llmExtraction: params.llmExtraction || null,
    ...params.normalizationMetadata,
  }
}

async function completeWithExistingCall(
  jobId: string,
  actor: FundingActor,
  fundingCallId: string,
  duplicates: DuplicateCandidate[],
  facts: NormalizedFundingFacts,
  importMetadata?: Prisma.InputJsonValue
) {
  await prisma.fundingImportJob.update({
    where: { id: jobId },
    data: {
      fundingCallId,
      status: 'COMPLETED',
      outcome: 'REUSED_EXISTING',
      normalizedFactsJson: facts as unknown as Prisma.InputJsonValue,
      duplicateCandidatesJson: duplicates as unknown as Prisma.InputJsonValue,
      importMetadata: importMetadata ?? undefined,
      errorCode: null,
      errorMessage: null,
      completedAt: new Date(),
      updatedByUserId: actor.id,
    },
  })

  await attachJobAssetsToCall(jobId, fundingCallId)
}

async function markJobNeedsReview(jobId: string, actor: FundingActor, duplicates: DuplicateCandidate[], facts: NormalizedFundingFacts, importMetadata: Prisma.InputJsonValue) {
  await prisma.fundingImportJob.update({
    where: { id: jobId },
    data: {
      status: 'NEEDS_REVIEW',
      outcome: 'DUPLICATE_BLOCKED',
      normalizedFactsJson: facts as unknown as Prisma.InputJsonValue,
      duplicateCandidatesJson: duplicates as unknown as Prisma.InputJsonValue,
      importMetadata,
      errorCode: 'DUPLICATE_REVIEW_REQUIRED',
      errorMessage: 'Potential duplicate funding calls require review before import can be finalized.',
      completedAt: new Date(),
      updatedByUserId: actor.id,
    },
  })
}

async function markJobFailed(jobId: string, actor: FundingActor, error: unknown) {
  const message = error instanceof Error ? error.message : 'Funding import failed'
  const code = error instanceof FundingImportError ? error.code : 'FUNDING_IMPORT_FAILED'

  await prisma.fundingImportJob.updateMany({
    where: { id: jobId },
    data: {
      status: 'FAILED',
      outcome: 'FAILED',
      errorCode: code,
      errorMessage: message,
      completedAt: new Date(),
      updatedByUserId: actor.id,
    },
  })
}

export async function createAndProcessFundingImport(actor: FundingActor, input: FundingImportRequest & { file?: File | null }) {
  if (input.inputType === 'url' && !input.sourceUrl?.trim()) {
    throw new FundingImportError('sourceUrl is required for URL imports', 400, 'SOURCE_URL_REQUIRED')
  }

  if (input.inputType === 'text' && !input.rawText?.trim()) {
    throw new FundingImportError('rawText is required for text imports', 400, 'RAW_TEXT_REQUIRED')
  }

  if (input.inputType === 'file' && !input.file) {
    throw new FundingImportError('file is required for file imports', 400, 'FILE_REQUIRED')
  }

  const sourceLocator =
    input.inputType === 'url'
      ? canonicalizeSourceUrl(input.sourceUrl) || input.sourceUrl || null
      : input.inputType === 'file'
        ? input.file?.name || null
        : 'Pasted text'

  const job = await prisma.fundingImportJob.create({
    data: {
      tenantId: input.visibility === 'TENANT_PRIVATE' ? actor.tenantId : null,
      visibility: input.visibility,
      sourceType: sourceTypeFromInputType(input.inputType),
      sourceLocator,
      status: 'PENDING',
      rawPayload:
        input.inputType === 'url'
          ? { sourceUrl: canonicalizeSourceUrl(input.sourceUrl), visibility: input.visibility }
          : input.inputType === 'text'
            ? { rawText: input.rawText, visibility: input.visibility }
            : {
                visibility: input.visibility,
                fileName: input.file?.name || null,
                mimeType: input.file?.type || null,
              },
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
    },
    include: {
      assets: true,
    },
  })

  if (input.inputType === 'file' && input.file) {
    const buffer = Buffer.from(await input.file.arrayBuffer())
    const stored = await writeFundingBufferAsset({
      jobId: job.id,
      fileName: input.file.name,
      buffer,
    })
    await createAsset({
      jobId: job.id,
      kind: 'UPLOADED_FILE',
      fileName: input.file.name,
      mimeType: input.file.type || null,
      storagePath: stored.storagePath,
      byteSize: stored.byteSize,
    })
  }

  return processFundingImportJob(job.id, actor)
}

export async function processFundingImportJob(jobId: string, actor: FundingActor) {
  await prisma.fundingImportJob.update({
    where: { id: jobId },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      updatedByUserId: actor.id,
    },
  })

  try {
    const job = await prisma.fundingImportJob.findUnique({
      where: { id: jobId },
      include: {
        assets: true,
      },
    })

    if (!job) {
      throw new FundingImportError('Funding import job not found', 404, 'IMPORT_JOB_NOT_FOUND')
    }

    const prepared = await prepareJobSource(job)
    const extraction = await extractFundingOpportunity(prepared.normalizedText)
    const draftValues = buildDraftValuesFromExtraction(extraction.payload)
    const llmExtraction = buildLlmExtractionRecord(extraction.payload, draftValues, {
      extractorModel: extraction.extractorModel,
      extractorVersion: extraction.extractorVersion,
      promptVersion: extraction.promptVersion,
    })
    const facts = buildFactsFromDraftValues({
      draftValues,
      fallbackFacts: prepared.fallbackFacts,
      sourceUrl: prepared.sourceUrl,
    })

    const duplicates = await findDuplicateCandidates(actor, job.visibility as FundingVisibility, facts)
    const exactDuplicate = duplicates.find((candidate) => candidate.reason === 'exact_url' || candidate.reason === 'program_identifier')
    const ambiguousDuplicate = duplicates.find((candidate) => candidate.reason === 'title_agency_deadline')
    const importMetadata = createJobCompletionMetadata({
      sourceMimeType: prepared.sourceMimeType,
      normalizationMetadata: prepared.normalizationMetadata,
      facts,
      llmExtraction,
    }) as Prisma.InputJsonValue

    if (exactDuplicate) {
      await completeWithExistingCall(job.id, actor, exactDuplicate.fundingCallId, duplicates, facts, importMetadata)
    } else if (ambiguousDuplicate) {
      await markJobNeedsReview(job.id, actor, duplicates, facts, importMetadata)
    } else {
      const fundingCall = await createFundingCallFromFacts({
        actor,
        visibility: job.visibility as FundingVisibility,
        sourceType: job.sourceType,
        facts,
        jobId: job.id,
        metadata: importMetadata,
      })

      await prisma.fundingImportJob.update({
        where: { id: job.id },
        data: {
          fundingCallId: fundingCall.id,
          status: 'COMPLETED',
          outcome: 'CREATED',
          normalizedFactsJson: facts as unknown as Prisma.InputJsonValue,
          duplicateCandidatesJson: [] as unknown as Prisma.InputJsonValue,
          importMetadata,
          errorCode: null,
          errorMessage: null,
          completedAt: new Date(),
          updatedByUserId: actor.id,
        },
      })
    }
  } catch (error) {
    await markJobFailed(jobId, actor, error)
  }

  const refreshed = await prisma.fundingImportJob.findUnique({
    where: { id: jobId },
    include: {
      assets: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!refreshed) {
    throw new FundingImportError('Funding import job not found after processing', 404, 'IMPORT_JOB_NOT_FOUND')
  }

  return serializeJob(refreshed)
}

async function assertJobAccess(jobId: string, actor: FundingActor): Promise<FundingImportJobWithAssets> {
  const job = await prisma.fundingImportJob.findFirst({
    where: {
      id: jobId,
      ...visibleFundingImportJobWhere(actor),
    },
    include: {
      assets: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!job) {
    throw new FundingImportError('Funding import job not found', 404, 'IMPORT_JOB_NOT_FOUND')
  }

  return job
}

export async function retryFundingImportJob(jobId: string, actor: FundingActor) {
  const job = await assertJobAccess(jobId, actor)

  if (!['FAILED', 'NEEDS_REVIEW'].includes(job.status)) {
    throw new FundingImportError('Only failed or review-required jobs can be retried', 409, 'IMPORT_RETRY_NOT_ALLOWED')
  }

  return processFundingImportJob(job.id, actor)
}

export async function resolveFundingImportDuplicate(params: {
  jobId: string
  actor: FundingActor
  resolution: 'reuse_existing' | 'create_new'
  fundingCallId?: string
}) {
  const job = await assertJobAccess(params.jobId, params.actor)

  if (job.status !== 'NEEDS_REVIEW') {
    throw new FundingImportError('Only review-required jobs can be resolved', 409, 'DUPLICATE_RESOLUTION_NOT_ALLOWED')
  }

  const facts = coerceFacts(job.normalizedFactsJson)
  if (!facts) {
    throw new FundingImportError('Normalized funding facts are missing from the import job', 500, 'NORMALIZED_FACTS_MISSING')
  }

  const duplicates = coerceDuplicateCandidates(job.duplicateCandidatesJson)

  if (params.resolution === 'reuse_existing') {
    if (!params.fundingCallId) {
      throw new FundingImportError('fundingCallId is required to reuse an existing call', 400, 'FUNDING_CALL_ID_REQUIRED')
    }

    const matched = duplicates.find((candidate) => candidate.fundingCallId === params.fundingCallId)
    if (!matched) {
      throw new FundingImportError('Selected funding call is not a valid duplicate candidate', 400, 'INVALID_DUPLICATE_SELECTION')
    }

    await completeWithExistingCall(job.id, params.actor, params.fundingCallId, duplicates, facts, (job.importMetadata || undefined) as Prisma.InputJsonValue | undefined)
  } else {
    const fundingCall = await createFundingCallFromFacts({
      actor: params.actor,
      visibility: job.visibility as FundingVisibility,
      sourceType: job.sourceType,
      facts,
      jobId: job.id,
      metadata: (job.importMetadata || {}) as Prisma.InputJsonValue,
    })

    await prisma.fundingImportJob.update({
      where: { id: job.id },
      data: {
        fundingCallId: fundingCall.id,
        status: 'COMPLETED',
        outcome: 'CREATED',
        errorCode: null,
        errorMessage: null,
        completedAt: new Date(),
        updatedByUserId: params.actor.id,
      },
    })
  }

  const refreshed = await prisma.fundingImportJob.findUnique({
    where: { id: job.id },
    include: {
      assets: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!refreshed) {
    throw new FundingImportError('Funding import job not found after duplicate resolution', 404, 'IMPORT_JOB_NOT_FOUND')
  }

  return serializeJob(refreshed)
}

export async function listFundingImportJobs(actor: FundingActor) {
  const jobs = await prisma.fundingImportJob.findMany({
    where: visibleFundingImportJobWhere(actor),
    include: {
      assets: {
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  return jobs.map(serializeJob)
}

export async function getFundingImportJobDetail(jobId: string, actor: FundingActor) {
  const job = await assertJobAccess(jobId, actor)
  return serializeJob(job)
}

export async function listFundingCalls(actor: FundingActor) {
  const calls = await prisma.fundingCall.findMany({
    where: visibleFundingCallWhere(actor),
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  return calls.map(serializeCallSummary)
}

export async function getFundingCallDetail(callId: string, actor: FundingActor): Promise<FundingCallDetail> {
  const fundingCall = await prisma.fundingCall.findFirst({
    where: {
      id: callId,
      ...visibleFundingCallWhere(actor),
    },
    include: {
      assets: {
        orderBy: { createdAt: 'asc' },
      },
      importJobs: {
        include: {
          assets: {
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      },
    },
  })

  if (!fundingCall) {
    throw new FundingImportError('Funding call not found', 404, 'FUNDING_CALL_NOT_FOUND')
  }

  const detail = fundingCall as FundingCallWithDetails

  return {
    ...serializeCallSummary(detail),
    sourceDomain: detail.sourceDomain,
    sourceFingerprint: detail.sourceFingerprint,
    extractedFacts: coerceFacts(detail.extractedFacts),
    normalizedMetadata: (detail.normalizedMetadata || null) as Record<string, unknown> | null,
    llmExtraction: coerceLlmExtraction(detail.normalizedMetadata),
    assets: detail.assets.map(serializeAsset),
    recentJobs: detail.importJobs.map(serializeJob),
  }
}

export async function publishGlobalFundingCall(callId: string, actor: FundingActor) {
  if (!hasSuperAdminWrite(actor)) {
    throw new FundingImportError('Super admin write access required', 403, 'SUPER_ADMIN_REQUIRED')
  }

  const fundingCall = await prisma.fundingCall.findUnique({ where: { id: callId } })
  if (!fundingCall || fundingCall.tenantId) {
    throw new FundingImportError('Global funding call not found', 404, 'FUNDING_CALL_NOT_FOUND')
  }

  const updated = await prisma.fundingCall.update({
    where: { id: callId },
    data: {
      status: 'PUBLISHED',
      publishedAt: fundingCall.publishedAt || new Date(),
      archivedAt: null,
      updatedByUserId: actor.id,
    },
  })

  return serializeCallSummary(updated)
}

export async function archiveFundingCall(callId: string, actor: FundingActor) {
  if (!hasSuperAdminWrite(actor)) {
    throw new FundingImportError('Super admin write access required', 403, 'SUPER_ADMIN_REQUIRED')
  }

  const fundingCall = await prisma.fundingCall.findUnique({ where: { id: callId } })
  if (!fundingCall || fundingCall.tenantId) {
    throw new FundingImportError('Global funding call not found', 404, 'FUNDING_CALL_NOT_FOUND')
  }

  const updated = await prisma.fundingCall.update({
    where: { id: callId },
    data: {
      status: 'ARCHIVED',
      archivedAt: new Date(),
      updatedByUserId: actor.id,
    },
  })

  return serializeCallSummary(updated)
}
