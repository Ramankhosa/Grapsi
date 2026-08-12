// @ts-nocheck
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  FundingCallStatus,
  FundingDuplicateResolution,
  FundingDuplicateStatus,
  FundingInputType,
  FundingIntakeJobStatus,
} from '@prisma/client';
import prisma from '../prisma';
import { startExtractionHeartbeat } from '../funding/extractionRunLifecycle';
import { fundingGuidelineService } from '../fundingGuidelines/service';
import { fundingTemplateService } from '../fundingTemplates/service';
import { fundingCatalogService } from '../services/fundingCatalogService';
import {
  FUNDING_BATCH_SOURCE_KEYS,
  resolveBatchSourceAssignments,
  stampSourceDocumentKind,
} from './batchSourceMapping';
import {
  buildFundingIntakeJobStatusCounts,
  deriveFundingIntakeBatchStatus,
} from './batchStatus';
import {
  ACTIVE_IDEMPOTENT_STATUSES,
  DRAFT_MINIMUM_FIELDS,
} from './constants';
import { fundingDocumentService } from '../fundingDocuments/service';
import { extractDocxPlainText } from '../fundingDocuments/parser';
import { ingestFundingDocumentFromUrl } from './documentUrlIngestion';
import { extractCanonicalTextFromPdf, extractFundingOpportunity } from './extractor';
import {
  FUNDING_JSON_UPLOAD_EXTRACTOR_MODEL,
  FUNDING_JSON_UPLOAD_EXTRACTOR_VERSION,
  FUNDING_JSON_UPLOAD_PROMPT_VERSION,
  parseFundingJsonUpload,
  prepareFundingJsonIntake,
  readPreparedFundingJsonArtifacts,
} from './jsonIngestion';
import type {
  DuplicateCandidateSummary,
  DomainDuplicateCandidateSummary,
  FundingDraftValues,
  FundingExtractionPayload,
  BatchIntakeCreateInput,
  BatchIntakeJobInput,
  BatchIntakeSourceInput,
  IntakeDuplicateResolutionInput,
  IntakeBatchSummary,
  IntakeJobSummary,
  IntakeOperator,
  IntakeSubmitInput,
} from './types';
import {
  assertSafePublicHttpsUrl,
  buildDraftValuesFromExtraction,
  extractConfidenceMap,
  extractEvidenceMap,
  extractMissingFieldKeys,
  fetchReadableUrlContent,
  hashText,
  jaccardSimilarity,
  normalizeDraftInput,
  normalizeMultilineText,
  normalizeUrl,
  normalizeWhitespace,
} from './utils';

const ACTIVE_STATUSES = [...ACTIVE_IDEMPOTENT_STATUSES];
const INTAKE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'funding-intake');
const TEMPLATE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'funding-templates');
const BATCH_SOURCE_KEYS = FUNDING_BATCH_SOURCE_KEYS;
const QUEUE_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.FUNDING_INTAKE_QUEUE_CONCURRENCY || 3)));
const JOB_LOCK_STALE_MS = Math.max(60_000, Number(process.env.FUNDING_INTAKE_JOB_LOCK_STALE_MS || 10 * 60 * 1000));
const MAX_RATE_LIMIT_RETRIES = Math.max(0, Number(process.env.FUNDING_INTAKE_MAX_RATE_LIMIT_RETRIES || 3));
const WORKER_ID = `funding-intake-${process.pid}-${Math.random().toString(36).slice(2)}`;
// Ceiling on how long intake waits for a source document to parse/sectionize
// before letting it finish in the background (extraction then falls back to
// flat text for that run).
const INTAKE_DOCUMENT_PROCESS_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.FUNDING_INTAKE_DOCUMENT_PROCESS_TIMEOUT_MS || 5 * 60 * 1000)
);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let drainPromise: Promise<void> | null = null;

function mapCatalogStatusToFundingStatus(status: FundingCallStatus) {
  switch (status) {
    case 'PUBLISHED':
      return 'PUBLISHED';
    case 'ARCHIVED':
      return 'ARCHIVED';
    case 'REJECTED':
      return 'FAILED';
    default:
      return 'READY_FOR_REVIEW';
  }
}

function readCatalogStatus(call: { catalog_status?: FundingCallStatus | null; status?: string | null }) {
  if (call.catalog_status) {
    return call.catalog_status;
  }

  if (call.status === 'PUBLISHED' || call.status === 'ARCHIVED') {
    return call.status;
  }

  if (call.status === 'FAILED') {
    return 'REJECTED';
  }

  return 'DRAFT';
}

function deriveOperatorRoleFromUser(user: { roles?: string[] | null } | null | undefined): IntakeOperator['role'] {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (roles.includes('SUPER_ADMIN')) {
    return 'ADMIN';
  }

  if (roles.includes('SUPER_ADMIN_VIEWER')) {
    return 'CURATOR';
  }

  return 'USER';
}

class FundingIntakeDeleteError extends Error {
  code: 'cancel_before_delete' | 'must_unpublish_first';
  fundingCallId: string | null;

  constructor(code: 'cancel_before_delete' | 'must_unpublish_first', message: string, fundingCallId?: string | null) {
    super(message);
    this.name = 'FundingIntakeDeleteError';
    this.code = code;
    this.fundingCallId = fundingCallId || null;
  }
}

function allowedTransitionTarget(status: FundingIntakeJobStatus): boolean {
  return ['queued', 'fetching', 'extracting'].includes(status);
}

function normalizeAgency(input?: string | null): string {
  return normalizeWhitespace(input || '').toLowerCase();
}

function normalizeTitle(input?: string | null): string {
  return normalizeWhitespace(input || '').toLowerCase();
}

function normalizeHostname(input?: string | null): string | null {
  if (!input) return null;
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function collectSourceDomains(sourceUrl: string | null | undefined, officialUrls: string[] = []): string[] {
  return Array.from(
    new Set([sourceUrl, ...officialUrls].map((url) => normalizeHostname(url)).filter(Boolean) as string[])
  );
}

function collectSourceUrls(sourceUrl: string | null | undefined, officialUrls: string[] = []): string[] {
  return Array.from(new Set([sourceUrl, ...officialUrls].map((url) => (url || '').trim()).filter(Boolean)));
}

function duplicateVisibilityWhere(operator: IntakeOperator): Prisma.FundingCallWhereInput {
  if (operator.role === 'ADMIN' || operator.role === 'CURATOR') {
    return {};
  }

  return {
    OR: [
      {
        catalog_status: 'PUBLISHED',
        is_active: { not: false },
      },
      {
        catalog_status: 'DRAFT',
        uploaded_by: operator.email,
      },
    ],
  };
}

function deadlineSimilarity(sourceDate?: string | null, candidateDate?: string | Date | null): number {
  if (!sourceDate || !candidateDate) return 0;
  const sourceTime = new Date(sourceDate).getTime();
  const candidateTime = new Date(candidateDate).getTime();
  if (!Number.isFinite(sourceTime) || !Number.isFinite(candidateTime)) return 0;
  const dayDelta = Math.abs(sourceTime - candidateTime) / (1000 * 60 * 60 * 24);
  if (dayDelta === 0) return 1;
  if (dayDelta <= 14) return 0.8;
  if (dayDelta <= 30) return 0.5;
  return 0;
}

function buildDraftRequiredFields(values: FundingDraftValues): string[] {
  const missing = Array.from(DRAFT_MINIMUM_FIELDS as readonly string[]).filter(
    (key) => !String(((values as unknown) as Record<string, unknown>)[key] || '').trim()
  );
  if (!values.description.trim()) {
    missing.push('description');
  }
  return missing;
}

async function ensureIntakeUploadDir() {
  await fs.mkdir(INTAKE_UPLOAD_DIR, { recursive: true });
}

async function deleteManagedUploadIfPresent(storagePathValue?: string | null) {
  if (!storagePathValue) {
    return;
  }

  const resolvedStoragePath = path.resolve(
    path.isAbsolute(storagePathValue) ? storagePathValue : path.join(process.cwd(), storagePathValue)
  );
  const allowedRoots = [INTAKE_UPLOAD_DIR, TEMPLATE_UPLOAD_DIR].map((root) => path.resolve(root));

  if (!allowedRoots.some((root) => resolvedStoragePath.startsWith(root))) {
    return;
  }

  try {
    await fs.unlink(resolvedStoragePath);
  } catch {
    // Best-effort cleanup only.
  }
}

async function storeUploadedPdf(file: NonNullable<IntakeSubmitInput['sourceFile']>) {
  await ensureIntakeUploadDir();
  const sanitizedFileName = file.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destinationPath = path.join(INTAKE_UPLOAD_DIR, `${Date.now()}_${sanitizedFileName}`);
  let copied = false;
  try {
    await fs.copyFile(file.tempFilePath, destinationPath);
    copied = true;
    const storedBytes = await fs.readFile(destinationPath);
    const storedChecksum = crypto.createHash('sha256').update(storedBytes).digest('hex');
    if (storedChecksum !== file.checksum) {
      throw new Error('Funding intake PDF checksum verification failed after storage');
    }
    return destinationPath;
  } catch (error) {
    if (copied) await fs.unlink(destinationPath).catch(() => undefined);
    throw error;
  } finally {
    await fs.unlink(file.tempFilePath).catch(() => undefined);
  }
}

function readCatalogMetadata(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readFetchMetadata(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readFetchedUrl(value: Prisma.JsonValue | null | undefined): string | null {
  const fetchMetadata = readFetchMetadata(value);
  return typeof fetchMetadata.fetchedUrl === 'string' && fetchMetadata.fetchedUrl.trim().length > 0
    ? fetchMetadata.fetchedUrl
    : null;
}

function buildWorkingDraftTitle(job: {
  id: string;
  input_type: FundingInputType | string;
  source_url?: string | null;
}) {
  if (job.source_url) {
    const hostname = normalizeHostname(job.source_url);
    return `Funding intake from ${hostname || job.source_url}`;
  }

  switch (job.input_type) {
    case 'pdf':
      return `Funding intake PDF ${job.id}`;
    case 'json':
      return `Funding intake JSON ${job.id}`;
    case 'text':
      return `Funding intake text ${job.id}`;
    default:
      return `Funding intake ${job.id}`;
  }
}

function normalizeSourceKey(input: string | null | undefined): string {
  return String(input || '').trim();
}

function assertAllowedSourceKey(sourceKey: string) {
  if (!(BATCH_SOURCE_KEYS as readonly string[]).includes(sourceKey)) {
    throw new Error(`Invalid source key: ${sourceKey}`);
  }
}

function readBatchFlags(value: Prisma.JsonValue | null | undefined): { autoCreateDraft: boolean; extractAll: boolean; autoPublish: boolean } {
  const metadata = readFetchMetadata(value);
  const batch = metadata.batch_intake && typeof metadata.batch_intake === 'object' && !Array.isArray(metadata.batch_intake)
    ? metadata.batch_intake as Record<string, unknown>
    : {};
  return {
    autoCreateDraft: batch.auto_create_draft !== false,
    extractAll: batch.extract_all !== false,
    // Publishing is opt-in, unlike draft creation: older batches never carry it.
    autoPublish: batch.auto_publish === true,
  };
}

async function prepareJobSourceData(source: BatchIntakeSourceInput, sequenceNo: number) {
  const sourceKey = normalizeSourceKey(source.sourceKey || `source_${sequenceNo + 1}`);
  assertAllowedSourceKey(sourceKey);
  const kindMetadata = source.documentKind ? { document_kind: source.documentKind } : {};

  if (source.inputType === 'url') {
    if (!source.sourceUrl) {
      throw new Error(`${sourceKey}: sourceUrl is required for URL intake`);
    }
    const sourceUrl = normalizeUrl(source.sourceUrl);
    await assertSafePublicHttpsUrl(sourceUrl);
    return {
      source_key: sourceKey,
      sequence_no: sequenceNo,
      input_type: source.inputType,
      source_url: sourceUrl,
      source_text_hash: hashText(sourceUrl),
      source_file_path: null,
      raw_text: null,
      normalized_text: null,
      fetch_metadata_json: source.documentKind ? (kindMetadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      status: 'pending' as const,
    };
  }

  if (source.inputType === 'text') {
    if (!source.sourceText || normalizeWhitespace(source.sourceText).length < 80) {
      throw new Error(`${sourceKey}: sourceText must contain meaningful content`);
    }
    const normalizedText = normalizeMultilineText(source.sourceText);
    return {
      source_key: sourceKey,
      sequence_no: sequenceNo,
      input_type: source.inputType,
      source_url: null,
      source_text_hash: hashText(normalizedText),
      source_file_path: null,
      raw_text: source.sourceText,
      normalized_text: normalizedText,
      fetch_metadata_json: source.documentKind ? (kindMetadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      status: 'ready' as const,
    };
  }

  if (source.inputType === 'pdf') {
    if (!source.sourceFile) {
      throw new Error(`${sourceKey}: a PDF or DOCX file is required for file intake`);
    }
    const storedPdfPath = await storeUploadedPdf(source.sourceFile);
    return {
      source_key: sourceKey,
      sequence_no: sequenceNo,
      input_type: source.inputType,
      source_url: null,
      source_text_hash: source.sourceFile.checksum,
      source_file_path: storedPdfPath,
      raw_text: null,
      normalized_text: null,
      fetch_metadata_json: {
        original_name: source.sourceFile.originalName,
        mime: source.sourceFile.mimeType,
        bytes: source.sourceFile.size,
        checksum: source.sourceFile.checksum,
        ...kindMetadata,
      } as Prisma.InputJsonValue,
      status: 'pending' as const,
    };
  }

  if (!source.sourceJsonText || normalizeWhitespace(source.sourceJsonText).length < 2) {
    throw new Error(`${sourceKey}: JSON file is required for JSON intake`);
  }
  const parsedJsonUpload = parseFundingJsonUpload(source.sourceJsonText);
  const preparedJsonIntake = prepareFundingJsonIntake(parsedJsonUpload);
  const sourceHash = hashText(JSON.stringify(parsedJsonUpload));
  const normalizedText = normalizeMultilineText(preparedJsonIntake.sourceText || source.sourceJsonText);

  return {
    source_key: sourceKey,
    sequence_no: sequenceNo,
    input_type: source.inputType,
    source_url: null,
    source_text_hash: sourceHash,
    source_file_path: null,
    raw_text: source.sourceJsonText,
    normalized_text: normalizedText,
    fetch_metadata_json: {
      json_upload: {
        ...preparedJsonIntake.metadata,
        original_name: source.sourceJsonFile?.originalName || 'funding-intake.json',
        mime: source.sourceJsonFile?.mimeType || 'application/json',
        bytes: source.sourceJsonFile?.size || Buffer.byteLength(source.sourceJsonText || '', 'utf8'),
        checksum: sourceHash,
      },
      json_artifacts: {
        grant_template_json: preparedJsonIntake.template || null,
        guideline_pack_json: preparedJsonIntake.guidelinePack || null,
        document_urls: preparedJsonIntake.documentUrls || [],
      },
      ...kindMetadata,
    } as Prisma.InputJsonValue,
    status: 'ready' as const,
  };
}

function sourceToIntakeSource(input: IntakeSubmitInput): BatchIntakeSourceInput {
  return {
    sourceKey: 'source_1',
    inputType: input.inputType,
    sourceUrl: input.sourceUrl,
    sourceText: input.sourceText,
    sourceFile: input.sourceFile,
    sourceJsonText: input.sourceJsonText,
    sourceJsonFile: input.sourceJsonFile,
  };
}

function makeJobLikeFromSource(job: any, source: any) {
  return {
    ...job,
    input_type: source.input_type,
    source_url: source.source_url || null,
    source_file_path: source.source_file_path || null,
    source_text_hash: source.source_text_hash || null,
    raw_text: source.raw_text || null,
    normalized_text: source.normalized_text || null,
    fetch_metadata_json: source.fetch_metadata_json || null,
  };
}

function toTimestamp(value: unknown): number | null {
  if (!value) {
    return null;
  }

  const date = new Date(String(value));
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function latestTimestamp(...values: unknown[]): number | null {
  const timestamps = values
    .map((value) => toTimestamp(value))
    .filter((value): value is number => value !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

function hasNewerNeedsReviewRun(
  runs: Array<{ status?: string | null; created_at?: unknown; updated_at?: unknown }> | null | undefined,
  baselineTimestamp: number | null
) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return false;
  }

  return runs.some((run) => {
    if (run.status !== 'needs_review') {
      return false;
    }

    const runTimestamp = latestTimestamp(run.updated_at, run.created_at);
    if (!runTimestamp) {
      return true;
    }

    return baselineTimestamp === null ? true : runTimestamp > baselineTimestamp;
  });
}

function buildDraftingReadiness(call: { guideline_status?: string | null; template_status?: string | null } | null) {
  const guidelineApproved = call?.guideline_status === 'approved';
  const templateApproved = call?.template_status === 'approved';
  const issues: string[] = [];

  if (!guidelineApproved) {
    issues.push('Guidelines are not approved yet.');
  }

  if (!templateApproved) {
    issues.push('Template is not approved yet.');
  }

  return {
    ready: guidelineApproved && templateApproved,
    mode: guidelineApproved && templateApproved
      ? 'template_driven'
      : templateApproved
        ? 'template_only'
        : guidelineApproved
          ? 'guided_fallback'
          : 'lightweight',
    guidelineApproved,
    templateApproved,
    issues,
  };
}

function mapFundingSourceType(inputType: string) {
  switch (inputType) {
    case 'pdf':
      return 'FILE';
    case 'text':
      return 'TEXT';
    case 'json':
      return 'MANUAL';
    case 'url':
    default:
      return 'URL';
  }
}

function buildPublishWarnings(options: {
  call: { guideline_status?: string | null; template_status?: string | null; metadata?: Prisma.JsonValue | null } | null;
  guidelineBundle?: any;
  templateBundle?: any;
}) {
  const warnings: Array<{ code: string; message: string }> = [];
  const call = options.call;
  const guidelineBundle = options.guidelineBundle;
  const templateBundle = options.templateBundle;

  if (!call) {
    return warnings;
  }

  if (call.guideline_status !== 'approved') {
    warnings.push({
      code: 'guidelines_not_approved',
      message: 'Guidelines are not approved. Publishing is allowed, but downstream drafting will not use the approved guideline pack.',
    });
  }

  if (call.template_status !== 'approved') {
    warnings.push({
      code: 'template_not_approved',
      message: 'Template is not approved. Publishing is allowed, but downstream drafting will not use the approved template.',
    });
  }

  const guidelineEditedAt = latestTimestamp(
    guidelineBundle?.guideline?.last_edited_at,
    guidelineBundle?.guideline?.approved_at,
    guidelineBundle?.guideline?.updated_at
  );
  const templateEditedAt = latestTimestamp(
    templateBundle?.template?.last_edited_at,
    templateBundle?.template?.approved_at,
    templateBundle?.template?.updated_at
  );

  if (hasNewerNeedsReviewRun(guidelineBundle?.runs, guidelineEditedAt)) {
    warnings.push({
      code: 'guideline_run_unreviewed',
      message: 'There is at least one guideline extraction run awaiting review.',
    });
  }

  if (hasNewerNeedsReviewRun(templateBundle?.runs, templateEditedAt)) {
    warnings.push({
      code: 'template_run_unapplied',
      message: 'There is at least one template extraction run awaiting review or apply.',
    });
  }

  const templateConflicts = Array.isArray(templateBundle?.template?.compatibility_json?.conflicts)
    ? templateBundle.template.compatibility_json.conflicts
    : [];
  if (templateConflicts.length > 0) {
    warnings.push({
      code: 'template_conflicts_present',
      message: `Template extraction recorded ${templateConflicts.length} compatibility conflict${templateConflicts.length === 1 ? '' : 's'}.`,
    });
  }

  // Note: the previous "guidelines_stale" / "template_stale" warnings (comparing
  // last_catalog_update_at against the guideline/template edit time) were removed.
  // They only produced publish-time friction and never blocked publishing.

  return warnings;
}

async function recordJobEvent(
  jobId: string,
  nextStatus: string,
  eventType: string,
  options?: { actorUserId?: string | null; previousStatus?: string | null; message?: string | null }
) {
  await prisma.fundingIntakeJobEvent.create({
    data: {
      job_id: jobId,
      actor_user_id: options?.actorUserId || null,
      previous_status: options?.previousStatus || null,
      next_status: nextStatus,
      event_type: eventType,
      message: options?.message || null,
    },
  });
}

async function transitionJobStatus(
  jobId: string,
  nextStatus: FundingIntakeJobStatus,
  options?: {
    actorUserId?: string | null;
    message?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    duplicateStatus?: FundingDuplicateStatus;
    linkedFundingCallId?: string | null;
    processingPhase?: string | null;
    fetchMetadataJson?: Record<string, unknown> | null;
    rawText?: string | null;
    normalizedText?: string | null;
    nextAttemptAt?: Date | null;
    releaseLock?: boolean;
    incrementRetryCount?: boolean;
    expectedStatuses?: FundingIntakeJobStatus[];
  }
) {
  const existing = await prisma.fundingIntakeJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  const previousStatus = existing?.status || null;
  const hasOption = (key: string) => Boolean(options && Object.prototype.hasOwnProperty.call(options, key));

  const updated = await prisma.fundingIntakeJob.updateMany({
    where: {
      id: jobId,
      ...(options?.expectedStatuses ? { status: { in: options.expectedStatuses as any } } : {}),
    },
    data: {
      status: nextStatus,
      error_code: hasOption('errorCode') ? options?.errorCode : nextStatus === 'failed' ? undefined : null,
      error_message: hasOption('errorMessage') ? options?.errorMessage : nextStatus === 'failed' ? undefined : null,
      started_at: hasOption('startedAt') ? options?.startedAt : undefined,
      completed_at: hasOption('completedAt') ? options?.completedAt : undefined,
      duplicate_status: options?.duplicateStatus ?? undefined,
      linked_funding_call_id: options?.linkedFundingCallId ?? undefined,
      processing_phase: options?.processingPhase ?? undefined,
      locked_at: options?.releaseLock ? null : allowedTransitionTarget(nextStatus) ? undefined : null,
      locked_by: options?.releaseLock ? null : allowedTransitionTarget(nextStatus) ? undefined : null,
      next_attempt_at:
        hasOption('nextAttemptAt')
          ? options.nextAttemptAt
          : allowedTransitionTarget(nextStatus) ? undefined : null,
      retry_count: options?.incrementRetryCount ? { increment: 1 } : undefined,
      fetch_metadata_json:
        options?.fetchMetadataJson === null
          ? Prisma.JsonNull
          : (options?.fetchMetadataJson as Prisma.InputJsonValue | undefined),
      raw_text: options?.rawText ?? undefined,
      normalized_text: options?.normalizedText ?? undefined,
    },
  });

  if (updated.count !== 1) return false;

  await recordJobEvent(jobId, nextStatus, 'status_transition', {
    actorUserId: options?.actorUserId,
    previousStatus,
    message: options?.message,
  });
  return true;
}

async function createExtractionAttempt(
  jobId: string,
  payload: FundingExtractionPayload,
  metadata: { extractorModel: string; extractorVersion: string; promptVersion: string; validationErrors?: unknown[] }
) {
  await prisma.fundingIntakeExtraction.create({
    data: {
      job_id: jobId,
      extractor_model: metadata.extractorModel,
      extractor_version: metadata.extractorVersion,
      prompt_version: metadata.promptVersion,
      extracted_json: payload as any,
      confidence_json: extractConfidenceMap(payload) as any,
      evidence_json: extractEvidenceMap(payload) as any,
      missing_fields_json: extractMissingFieldKeys(payload) as any,
      validation_errors_json: (metadata.validationErrors || []) as any,
    },
  });
}

async function getLatestExtraction(jobId: string) {
  return prisma.fundingIntakeExtraction.findFirst({
    where: { job_id: jobId },
    orderBy: { created_at: 'desc' },
  });
}

async function getJobForProcessing(jobId: string) {
  return prisma.fundingIntakeJob.findUnique({
    where: { id: jobId },
  });
}

function buildFingerprint(agencyName: string, schemeTitle: string, closeDate: string | Date | null) {
  const normalizedAgency = normalizeAgency(agencyName);
  const normalizedTitle = normalizeTitle(schemeTitle);
  const normalizedDate = closeDate ? new Date(closeDate).toISOString().slice(0, 10) : '';
  return `${normalizedAgency}::${normalizedTitle}::${normalizedDate}`;
}

async function computeDuplicateCandidates(
  jobId: string,
  payload: FundingExtractionPayload,
  sourceUrl: string | null | undefined,
  fetchedUrl: string | null | undefined,
  operator: IntakeOperator,
  excludeFundingCallId?: string | null
): Promise<FundingDuplicateStatus> {
  const draftValues = buildDraftValuesFromExtraction(payload, { sourceUrl, fetchedUrl });
  const schemeTitle = draftValues.scheme_title;
  const agencyName = draftValues.agency_name;
  const closeDate = draftValues.close_date;
  const fingerprint = buildFingerprint(agencyName, schemeTitle, closeDate);
  const visibilityWhere = duplicateVisibilityWhere(operator);
  const sourceUrls = collectSourceUrls(sourceUrl, draftValues.official_urls);

  const sourceMatches = sourceUrls.length > 0
    ? await prisma.fundingCall.findMany({
        where: {
          AND: [
            visibilityWhere,
            ...(excludeFundingCallId ? [{ id: { not: excludeFundingCallId } }] : []),
            {
              OR: [
                { source_url: { in: sourceUrls } },
                { official_urls: { hasSome: sourceUrls } },
              ],
            },
          ],
        },
        select: {
          id: true,
          agency_name: true,
          scheme_title: true,
          catalog_status: true,
          source_url: true,
          official_urls: true,
          close_date: true,
        },
        take: 10,
      })
    : [];

  const agencyMatches = agencyName
    ? await prisma.fundingCall.findMany({
        where: {
          AND: [
            visibilityWhere,
            ...(excludeFundingCallId ? [{ id: { not: excludeFundingCallId } }] : []),
            {
              agency_name: {
                equals: agencyName,
                mode: 'insensitive',
              },
            },
          ],
        },
        select: {
          id: true,
          agency_name: true,
          scheme_title: true,
          catalog_status: true,
          source_url: true,
          official_urls: true,
          close_date: true,
        },
        take: 25,
      })
    : [];

  const titleMatches = schemeTitle
    ? await prisma.fundingCall.findMany({
        where: {
          AND: [
            visibilityWhere,
            ...(excludeFundingCallId ? [{ id: { not: excludeFundingCallId } }] : []),
            {
              scheme_title: {
                contains: schemeTitle.slice(0, 24),
                mode: 'insensitive',
              },
            },
          ],
        },
        select: {
          id: true,
          agency_name: true,
          scheme_title: true,
          catalog_status: true,
          source_url: true,
          official_urls: true,
          close_date: true,
        },
        take: 25,
      })
    : [];

  const candidateMap = new Map<string, DuplicateCandidateSummary>();

  for (const candidate of [...sourceMatches, ...agencyMatches, ...titleMatches]) {
    const titleScore = jaccardSimilarity(schemeTitle, candidate.scheme_title || '');
    const agencyScore = jaccardSimilarity(agencyName, candidate.agency_name || '');
    const candidateFingerprint = buildFingerprint(candidate.agency_name, candidate.scheme_title, candidate.close_date);

    let matchType: DuplicateCandidateSummary['match_type'] | null = null;
    let matchScore = Math.max(titleScore, agencyScore);

    const candidateUrls = collectSourceUrls(candidate.source_url, candidate.official_urls || []);

    if (sourceUrls.length > 0 && candidateUrls.some((candidateUrl) => sourceUrls.includes(candidateUrl))) {
      matchType = 'same_source_url';
      matchScore = 1;
    } else if (fingerprint === candidateFingerprint && fingerprint !== '::::') {
      matchType = 'exact_fingerprint';
      matchScore = 1;
    } else if (agencyScore >= 0.9 && titleScore >= 0.45) {
      matchType = 'fuzzy_title_agency';
      matchScore = (agencyScore + titleScore) / 2;
    } else if (titleScore >= 0.6 && closeDate && candidate.close_date) {
      const sourceTime = new Date(closeDate).getTime();
      const candidateTime = new Date(candidate.close_date).getTime();
      const dayDelta = Math.abs(sourceTime - candidateTime) / (1000 * 60 * 60 * 24);
      if (dayDelta <= 14) {
        matchType = 'same_deadline_cluster';
        matchScore = Math.max(0.55, titleScore);
      }
    }

    if (!matchType) {
      continue;
    }

    candidateMap.set(candidate.id, {
      id: '',
      candidate_funding_call_id: candidate.id,
      match_type: matchType,
      match_score: Number(matchScore.toFixed(3)),
      resolution: 'pending',
      resolved_by_user_id: null,
      resolved_at: null,
      candidate,
    });
  }

  await prisma.fundingIntakeDuplicate.deleteMany({ where: { job_id: jobId } });

  const candidates = Array.from(candidateMap.values());
  for (const candidate of candidates) {
    const created = await prisma.fundingIntakeDuplicate.create({
      data: {
        job_id: jobId,
        candidate_funding_call_id: candidate.candidate_funding_call_id,
        match_type: candidate.match_type,
        match_score: candidate.match_score,
      },
    });
    candidate.id = created.id;
  }

  if (candidates.some((candidate) => candidate.match_type === 'exact_fingerprint' || candidate.match_type === 'same_source_url')) {
    return 'exact_match_found';
  }

  return candidates.length > 0 ? 'candidate_found' : 'none';
}

async function computeDomainDuplicateCandidates(
  payload: FundingExtractionPayload | null | undefined,
  sourceUrl: string | null | undefined,
  fetchedUrl: string | null | undefined,
  operator: IntakeOperator,
  excludeFundingCallId?: string | null
): Promise<DomainDuplicateCandidateSummary[]> {
  if (!payload) return [];

  const draftValues = buildDraftValuesFromExtraction(payload, { sourceUrl, fetchedUrl });
  const submittedDomains = collectSourceDomains(sourceUrl, draftValues.official_urls);
  if (submittedDomains.length === 0) return [];

  const visibilityWhere = duplicateVisibilityWhere(operator);
  const domainSourceClauses = submittedDomains.map((domain) => ({
    source_url: {
      contains: domain,
      mode: 'insensitive' as const,
    },
  }));

  const similarityClauses: Prisma.FundingCallWhereInput[] = [];
  if (draftValues.agency_name) {
    similarityClauses.push({
      agency_name: {
        equals: draftValues.agency_name,
        mode: 'insensitive',
      },
    });
  }
  if (draftValues.scheme_title) {
    similarityClauses.push({
      scheme_title: {
        contains: draftValues.scheme_title.slice(0, 24),
        mode: 'insensitive',
      },
    });
  }

  const candidates = await prisma.fundingCall.findMany({
    where: {
      AND: [
        visibilityWhere,
        ...(excludeFundingCallId ? [{ id: { not: excludeFundingCallId } }] : []),
        {
          OR: [...domainSourceClauses, ...similarityClauses],
        },
      ],
    },
    select: {
      id: true,
      agency_name: true,
      scheme_title: true,
      status: true,
      source_url: true,
      official_urls: true,
      close_date: true,
    },
    take: 150,
  });

  return candidates
    .map((candidate): DomainDuplicateCandidateSummary | null => {
      const candidateUrls = collectSourceUrls(candidate.source_url, candidate.official_urls || []);
      const matchedUrl = candidateUrls.find((candidateUrl) => {
        const candidateDomain = normalizeHostname(candidateUrl);
        return Boolean(candidateDomain && submittedDomains.includes(candidateDomain));
      }) || null;
      const sourceDomain = matchedUrl ? normalizeHostname(matchedUrl) : null;

      if (!sourceDomain) {
        return null;
      }

      const titleSimilarity = jaccardSimilarity(draftValues.scheme_title, candidate.scheme_title || '');
      const agencySimilarity = jaccardSimilarity(draftValues.agency_name, candidate.agency_name || '');
      const deadlineScore = deadlineSimilarity(draftValues.close_date, candidate.close_date);
      const strongSimilarity =
        titleSimilarity >= 0.6 ||
        (agencySimilarity >= 0.9 && titleSimilarity >= 0.35) ||
        (deadlineScore >= 0.8 && (titleSimilarity >= 0.4 || agencySimilarity >= 0.7));
      const matchScore = Number((0.5 + Math.max(titleSimilarity, agencySimilarity) * 0.3 + deadlineScore * 0.2).toFixed(3));

      return {
        candidate_funding_call_id: candidate.id,
        match_type: 'same_source_domain',
        match_score: matchScore,
        source_domain: sourceDomain,
        matched_url: matchedUrl,
        title_similarity: Number(titleSimilarity.toFixed(3)),
        agency_similarity: Number(agencySimilarity.toFixed(3)),
        deadline_similarity: Number(deadlineScore.toFixed(3)),
        strong_similarity: strongSimilarity,
        candidate,
      };
    })
    .filter((candidate): candidate is DomainDuplicateCandidateSummary => candidate !== null)
    .sort((left, right) => {
      if (left.strong_similarity !== right.strong_similarity) {
        return left.strong_similarity ? -1 : 1;
      }
      return right.match_score - left.match_score;
    })
    .slice(0, 10);
}

async function persistDraft(
  job: any,
  draftValues: FundingDraftValues,
  operator: IntakeOperator,
  latestExtraction: any
) {
  const extractionOfficialUrls = latestExtraction
    ? buildDraftValuesFromExtraction(latestExtraction.extracted_json as any, {
        sourceUrl: job.source_url || null,
        fetchedUrl: readFetchedUrl(job.fetch_metadata_json),
      }).official_urls
    : [];
  const deterministicDraftValues = {
    ...draftValues,
    official_urls: collectSourceUrls(job.source_url, [
      ...(draftValues.official_urls || []),
      ...extractionOfficialUrls,
    ]),
  };
  const isTenantPrivateDraft = operator.role === 'USER' && Boolean(operator.tenantId);
  const sharedData = {
    status: mapCatalogStatusToFundingStatus('DRAFT'),
    catalog_status: 'DRAFT' as FundingCallStatus,
    visibility: isTenantPrivateDraft ? 'TENANT_PRIVATE' : 'GLOBAL_PUBLISHED',
    tenantId: isTenantPrivateDraft ? operator.tenantId || null : null,
    title: deterministicDraftValues.scheme_title || deterministicDraftValues.agency_name || job.source_url || 'Untitled funding call',
    agencyName: deterministicDraftValues.agency_name || null,
    sourceUrl: job.source_url || null,
    summary: deterministicDraftValues.description || null,
    sourceType: mapFundingSourceType(job.input_type),
    deadlineAt: deterministicDraftValues.close_date ? new Date(deterministicDraftValues.close_date) : null,
    extractedFacts: latestExtraction?.extracted_json || null,
    normalizedMetadata: latestExtraction?.confidence_json || null,
    createdByUserId: operator.userId,
    updatedByUserId: operator.userId,
    input_type: job.input_type,
    agency_name: deterministicDraftValues.agency_name,
    scheme_title: deterministicDraftValues.scheme_title,
    description: deterministicDraftValues.description,
    open_date: deterministicDraftValues.open_date ? new Date(deterministicDraftValues.open_date) : null,
    close_date: deterministicDraftValues.close_date ? new Date(deterministicDraftValues.close_date) : null,
    is_rolling: deterministicDraftValues.is_rolling,
    geography_scope: deterministicDraftValues.geography_scope || null,
    eligible_countries: deterministicDraftValues.eligible_countries,
    eligible_regions: deterministicDraftValues.eligible_regions,
    host_countries: deterministicDraftValues.host_countries,
    funder_country: deterministicDraftValues.funder_country || null,
    funding_kinds: deterministicDraftValues.funding_kinds,
    institution_types: deterministicDraftValues.institution_types,
    career_stages: deterministicDraftValues.career_stages,
    citizenship_requirements: deterministicDraftValues.citizenship_requirements,
    residency_requirements: deterministicDraftValues.residency_requirements,
    application_languages: deterministicDraftValues.application_languages,
    disciplines: deterministicDraftValues.disciplines,
    amount_min: deterministicDraftValues.amount_min,
    amount_max: deterministicDraftValues.amount_max,
    currency: deterministicDraftValues.currency || null,
    project_duration_min_months: deterministicDraftValues.project_duration_min_months,
    project_duration_max_months: deterministicDraftValues.project_duration_max_months,
    project_duration_text: deterministicDraftValues.project_duration_text || null,
    official_urls: deterministicDraftValues.official_urls,
    eligibility_text: deterministicDraftValues.eligibility_text || null,
    expected_deliverables_text: deterministicDraftValues.expected_deliverables_text || null,
    sponsor_type: deterministicDraftValues.sponsor_type || null,
    contact_info: deterministicDraftValues.contact_info || null,
    source: operator.role === 'USER' ? 'user-funding-intake' : 'funding-intake',
    source_url: job.source_url || null,
    source_text_hash: job.source_text_hash || null,
    uploaded_by: operator.email,
    raw_text: job.raw_text || null,
    normalized_text: job.normalized_text || null,
    operator_notes: job.operator_notes || null,
    extracted_json: latestExtraction?.extracted_json || null,
    extraction_confidence_json: latestExtraction?.confidence_json || null,
    expiration_date: deterministicDraftValues.close_date ? new Date(deterministicDraftValues.close_date) : null,
    is_active: false,
    intake_job_id: job.id,
    metadata: {
      source_module: 'funding_intake',
      intake_job_id: job.id,
      saved_by: operator.email,
      saved_at: new Date().toISOString(),
      last_catalog_update_by: operator.email,
      last_catalog_update_at: new Date().toISOString(),
      verification_status: operator.role === 'USER' ? 'pending_admin_verification' : 'curator_review',
      submitted_for_admin_review: operator.role === 'USER',
      admin_review_status: operator.role === 'USER' ? 'pending' : 'curator_review',
      owner_user_id: operator.role === 'USER' ? operator.userId : null,
      user_import: operator.role === 'USER'
        ? {
            owner_user_id: operator.userId,
            user_email: operator.email,
            verification_status: 'pending_admin_verification',
            submitted_for_admin_review: true,
            admin_review_status: 'pending',
            imported_at: new Date().toISOString(),
          }
        : null,
      embedding_status: 'not_generated',
      international_facets: {
        eligible_regions: deterministicDraftValues.eligible_regions,
        host_countries: deterministicDraftValues.host_countries,
        funder_country: deterministicDraftValues.funder_country || null,
        citizenship_requirements: deterministicDraftValues.citizenship_requirements,
        residency_requirements: deterministicDraftValues.residency_requirements,
        application_languages: deterministicDraftValues.application_languages,
      },
    },
  };

  if (job.linked_funding_call_id) {
    return prisma.fundingCall.update({
      where: { id: job.linked_funding_call_id },
      data: sharedData,
      select: { id: true },
    });
  }

  return prisma.fundingCall.create({
    data: sharedData,
    select: { id: true },
  });
}

class FundingIntakeService {
  private async ensureWorkingDraftCall(job: any, operator: IntakeOperator) {
    if (job.linked_funding_call_id) {
      return job.linked_funding_call_id as string;
    }

    const isTenantPrivateDraft = operator.role === 'USER' && Boolean(operator.tenantId);
    const sourceMetadata = readFetchMetadata(job.fetch_metadata_json);
    const sourceDomain = normalizeHostname(job.source_url);

    const call = await prisma.$transaction(async (tx) => {
      const latestJob = await tx.fundingIntakeJob.findUnique({
        where: { id: job.id },
        select: {
          linked_funding_call_id: true,
          status: true,
        },
      });

      if (latestJob?.linked_funding_call_id) {
        return { id: latestJob.linked_funding_call_id };
      }

      const created = await tx.fundingCall.create({
        data: {
          status: mapCatalogStatusToFundingStatus('DRAFT'),
          catalog_status: 'DRAFT',
          visibility: isTenantPrivateDraft ? 'TENANT_PRIVATE' : 'GLOBAL_PUBLISHED',
          tenantId: isTenantPrivateDraft ? operator.tenantId || null : null,
          title: buildWorkingDraftTitle(job),
          agencyName: null,
          sourceUrl: job.source_url || null,
          sourceDomain,
          summary: null,
          sourceType: mapFundingSourceType(job.input_type),
          extractedFacts: null,
          normalizedMetadata: null,
          createdByUserId: operator.userId,
          updatedByUserId: operator.userId,
          input_type: job.input_type,
          agency_name: null,
          scheme_title: null,
          description: null,
          is_rolling: false,
          official_urls: job.source_url ? [job.source_url] : [],
          source: operator.role === 'USER' ? 'user-funding-intake' : 'funding-intake',
          source_url: job.source_url || null,
          source_text_hash: job.source_text_hash || null,
          uploaded_by: operator.email,
          raw_text: job.raw_text || null,
          normalized_text: job.normalized_text || null,
          operator_notes: job.operator_notes || null,
          extracted_json: null,
          extraction_confidence_json: null,
          is_active: false,
          intake_job_id: job.id,
          metadata: {
            ...sourceMetadata,
            source_module: 'funding_intake',
            intake_job_id: job.id,
            saved_by: operator.email,
            saved_at: new Date().toISOString(),
            working_draft_created_at: new Date().toISOString(),
            parallel_intake_shell: true,
            source_text_status: job.normalized_text ? 'ready' : 'pending',
            verification_status: operator.role === 'USER' ? 'pending_admin_verification' : 'curator_review',
            submitted_for_admin_review: operator.role === 'USER',
            admin_review_status: operator.role === 'USER' ? 'pending' : 'curator_review',
            owner_user_id: operator.role === 'USER' ? operator.userId : null,
            user_import: operator.role === 'USER'
              ? {
                  owner_user_id: operator.userId,
                  user_email: operator.email,
                  verification_status: 'pending_admin_verification',
                  submitted_for_admin_review: true,
                  admin_review_status: 'pending',
                  imported_at: new Date().toISOString(),
                }
              : null,
            embedding_status: 'not_generated',
          },
        } as any,
        select: { id: true },
      });

      await tx.fundingIntakeJob.update({
        where: { id: job.id },
        data: {
          linked_funding_call_id: created.id,
        },
      });

      await tx.fundingIntakeJobEvent.create({
        data: {
          job_id: job.id,
          actor_user_id: operator.userId,
          previous_status: latestJob?.status || null,
          next_status: latestJob?.status || job.status,
          event_type: 'working_call_created',
          message: 'Working funding call draft created for parallel Call, Guidelines, and Template requests',
        },
      });

      return created;
    });

    return call.id as string;
  }

  async createJob(operator: IntakeOperator, input: IntakeSubmitInput) {
    const preparedSource = await prepareJobSourceData(sourceToIntakeSource(input), 0);
    const sourceHash = String(preparedSource.source_text_hash || '');

    const existingJob = await prisma.fundingIntakeJob.findFirst({
      where: {
        submitted_by_user_id: operator.userId,
        source_text_hash: sourceHash,
        status: { in: ACTIVE_STATUSES as any },
        created_at: {
          gte: new Date(Date.now() - 15 * 60 * 1000),
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (existingJob) {
      if (allowedTransitionTarget(existingJob.status)) {
        this.enqueue(existingJob.id);
      }
      await this.ensureWorkingDraftCall(existingJob, operator);
      return existingJob;
    }

    const job = await prisma.fundingIntakeJob.create({
      data: {
        submitted_by_user_id: operator.userId,
        input_type: preparedSource.input_type,
        source_url: preparedSource.source_url,
        source_text_hash: sourceHash,
        source_file_path: preparedSource.source_file_path,
        operator_notes: input.operatorNotes?.trim() || null,
        details_source_key: 'source_1',
        guidelines_source_key: 'source_1',
        template_source_key: 'source_1',
        processing_phase: 'queued',
        raw_text: preparedSource.raw_text,
        normalized_text: preparedSource.normalized_text,
        fetch_metadata_json: preparedSource.fetch_metadata_json as any,
        status: 'queued',
      },
    });

    await prisma.fundingIntakeJobSource.create({
      data: {
        job_id: job.id,
        ...preparedSource,
      } as any,
    });

    await recordJobEvent(job.id, 'queued', 'job_created', {
      actorUserId: operator.userId,
      previousStatus: null,
      message: 'Funding intake job created',
    });

    await this.ensureWorkingDraftCall(job, operator);
    this.enqueue(job.id);
    return job;
  }

  async createBatch(operator: IntakeOperator, input: BatchIntakeCreateInput) {
    if (!Array.isArray(input.jobs) || input.jobs.length === 0) {
      throw new Error('Batch must include at least one funding call');
    }
    if (input.jobs.length > 100) {
      throw new Error('Batch cannot include more than 100 funding calls');
    }

    const preparedJobs = [] as Array<{
      input: BatchIntakeJobInput;
      sources: Awaited<ReturnType<typeof prepareJobSourceData>>[];
      detailsSourceKey: string;
      guidelinesSourceKey: string;
      templateSourceKey: string;
    }>;

    for (const [jobIndex, jobInput] of input.jobs.entries()) {
      if (!Array.isArray(jobInput.sources) || jobInput.sources.length === 0) {
        throw new Error(`Job ${jobIndex + 1}: at least one source is required`);
      }
      if (jobInput.sources.length > BATCH_SOURCE_KEYS.length) {
        throw new Error(`Job ${jobIndex + 1}: a funding call can include at most 3 sources`);
      }

      const sources = [] as Awaited<ReturnType<typeof prepareJobSourceData>>[];
      const seen = new Set<string>();
      for (const [sourceIndex, source] of jobInput.sources.entries()) {
        const sourceWithKey = {
          ...source,
          sourceKey: normalizeSourceKey(source.sourceKey) || BATCH_SOURCE_KEYS[sourceIndex],
        };
        const prepared = await prepareJobSourceData(sourceWithKey, sourceIndex);
        if (seen.has(prepared.source_key)) {
          throw new Error(`Job ${jobIndex + 1}: duplicate source key ${prepared.source_key}`);
        }
        seen.add(prepared.source_key);
        sources.push(prepared);
      }

      const inputKindBySourceKey = new Map(
        jobInput.sources.map((source, index) => [
          normalizeSourceKey(source.sourceKey) || BATCH_SOURCE_KEYS[index],
          source.documentKind || null,
        ])
      );
      const assignment = resolveBatchSourceAssignments({
        sources: sources.map((source) => ({
          sourceKey: source.source_key,
          documentKind: inputKindBySourceKey.get(source.source_key) || null,
        })),
        detailsSourceKey: jobInput.detailsSourceKey,
        guidelinesSourceKey: jobInput.guidelinesSourceKey,
        templateSourceKey: jobInput.templateSourceKey,
      });

      // Stamp each source with its resolved document role so ingestion and
      // retries know what the operator meant without re-deriving slots.
      // JSON/CSV sources keep their imported artifacts in this same blob, so
      // stampSourceDocumentKind merges rather than replaces.
      for (const prepared of sources) {
        const resolvedKind = assignment.documentKinds[prepared.source_key];
        if (resolvedKind) {
          prepared.fetch_metadata_json = stampSourceDocumentKind(
            prepared.fetch_metadata_json,
            resolvedKind
          ) as any;
        }
      }

      preparedJobs.push({
        input: jobInput,
        sources,
        detailsSourceKey: assignment.detailsSourceKey,
        guidelinesSourceKey: assignment.guidelinesSourceKey,
        templateSourceKey: assignment.templateSourceKey,
      });
    }

    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.fundingIntakeBatch.create({
        data: {
          submitted_by_user_id: operator.userId,
          label: input.label?.trim() || null,
          total_jobs: preparedJobs.length,
          status: 'processing',
        },
      });

      for (const preparedJob of preparedJobs) {
        const detailSource = preparedJob.sources.find((source) => source.source_key === preparedJob.detailsSourceKey)!;
        const sourceMetadata = readFetchMetadata(detailSource.fetch_metadata_json as any);
        const jobMetadata = {
          ...sourceMetadata,
          batch_intake: {
            batch_id: createdBatch.id,
            auto_create_draft: preparedJob.input.autoCreateDraft !== false,
            extract_all: preparedJob.input.extractAll !== false,
            auto_publish: preparedJob.input.autoPublish === true,
          },
        };

        const job = await tx.fundingIntakeJob.create({
          data: {
            batch_id: createdBatch.id,
            submitted_by_user_id: operator.userId,
            input_type: detailSource.input_type,
            source_url: detailSource.source_url,
            source_text_hash: detailSource.source_text_hash,
            source_file_path: detailSource.source_file_path,
            operator_notes: preparedJob.input.operatorNotes?.trim() || null,
            details_source_key: preparedJob.detailsSourceKey,
            guidelines_source_key: preparedJob.guidelinesSourceKey,
            template_source_key: preparedJob.templateSourceKey,
            processing_phase: 'queued',
            raw_text: detailSource.raw_text,
            normalized_text: detailSource.normalized_text,
            fetch_metadata_json: jobMetadata as any,
            status: 'queued',
          },
        });

        await tx.fundingIntakeJobSource.createMany({
          data: preparedJob.sources.map((source) => ({
            job_id: job.id,
            ...source,
          })) as any,
        });

        await tx.fundingIntakeJobEvent.create({
          data: {
            job_id: job.id,
            actor_user_id: operator.userId,
            previous_status: null,
            next_status: 'queued',
            event_type: 'batch_job_created',
            message: 'Funding intake batch job created',
          },
        });
      }

      return createdBatch;
    });

    this.enqueue();
    return batch;
  }

  enqueue(_jobId?: string) {
    this.triggerDrain();
  }

  private triggerDrain() {
    if (drainPromise) {
      return;
    }

    drainPromise = this.drainQueue().finally(() => {
      drainPromise = null;
    });
  }

  async maybeResume(jobId: string) {
    const job = await prisma.fundingIntakeJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (job && allowedTransitionTarget(job.status)) {
      this.enqueue(jobId);
    }
  }

  private async claimQueuedJobs(limit: number): Promise<string[]> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - JOB_LOCK_STALE_MS);
    const candidates = await prisma.fundingIntakeJob.findMany({
      where: {
        status: { in: ['queued', 'fetching', 'extracting'] as any },
        AND: [
          {
            OR: [
              { next_attempt_at: null },
              { next_attempt_at: { lte: now } },
            ],
          },
          {
            OR: [
              { locked_at: null },
              { locked_at: { lte: staleBefore } },
            ],
          },
        ],
      },
      orderBy: [{ next_attempt_at: 'asc' }, { created_at: 'asc' }],
      take: limit * 2,
      select: { id: true },
    });

    const claimed: string[] = [];
    for (const candidate of candidates) {
      if (claimed.length >= limit) {
        break;
      }

      const result = await prisma.fundingIntakeJob.updateMany({
        where: {
          id: candidate.id,
          status: { in: ['queued', 'fetching', 'extracting'] as any },
          AND: [
            {
              OR: [
                { next_attempt_at: null },
                { next_attempt_at: { lte: now } },
              ],
            },
            {
              OR: [
                { locked_at: null },
                { locked_at: { lte: staleBefore } },
              ],
            },
          ],
        },
        data: {
          locked_at: now,
          locked_by: WORKER_ID,
          attempt_count: { increment: 1 },
          started_at: now,
          completed_at: null,
        },
      });

      if (result.count === 1) {
        claimed.push(candidate.id);
      }
    }

    return claimed;
  }

  private async drainQueue() {
    while (true) {
      const jobIds = await this.claimQueuedJobs(QUEUE_CONCURRENCY);
      if (jobIds.length === 0) {
        return;
      }

      console.log('[Funding Intake] queue drain claimed jobs', {
        workerId: WORKER_ID,
        configuredConcurrency: QUEUE_CONCURRENCY,
        claimedJobCount: jobIds.length,
      });

      await Promise.all(jobIds.map((jobId) => this.processJob(jobId)));
    }
  }

  async listJobs(): Promise<IntakeJobSummary[]> {
    const jobs = await prisma.fundingIntakeJob.findMany({
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    const linkedCallIds = Array.from(new Set(jobs.map((job) => job.linked_funding_call_id).filter(Boolean) as string[]));

    const userIds = Array.from(new Set(jobs.map((job) => job.submitted_by_user_id)));
    const [users, linkedCalls] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      }),
      linkedCallIds.length > 0
        ? prisma.fundingCall.findMany({
            where: { id: { in: linkedCallIds } },
            select: { id: true, catalog_status: true, scheme_title: true, agency_name: true },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((user) => [user.id, user]));
    const linkedCallStatusMap = new Map(linkedCalls.map((call) => [call.id, readCatalogStatus(call)]));
    const linkedCallMap = new Map(linkedCalls.map((call) => [call.id, call]));

    return jobs.map((job) => ({
      ...job,
      source_url: job.source_url || null,
      linked_funding_call_id: job.linked_funding_call_id || null,
      linked_call_status: job.linked_funding_call_id ? linkedCallStatusMap.get(job.linked_funding_call_id) || null : null,
      linked_call_title: job.linked_funding_call_id
        ? linkedCallMap.get(job.linked_funding_call_id)?.scheme_title || null
        : null,
      linked_call_agency: job.linked_funding_call_id
        ? linkedCallMap.get(job.linked_funding_call_id)?.agency_name || null
        : null,
      submitted_by: userMap.get(job.submitted_by_user_id) || null,
    }));
  }

  async listBatches(limit = 25): Promise<IntakeBatchSummary[]> {
    const batches = await prisma.fundingIntakeBatch.findMany({
      orderBy: { created_at: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
      include: {
        jobs: {
          select: { status: true },
        },
      },
    });

    const userIds = Array.from(new Set(batches.map((batch) => batch.submitted_by_user_id)));
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    return batches.map((batch) => {
      const jobStatuses = batch.jobs.map((job) => job.status as FundingIntakeJobStatus);
      const counts = buildFundingIntakeJobStatusCounts(jobStatuses);

      return {
        id: batch.id,
        label: batch.label,
        status: deriveFundingIntakeBatchStatus(jobStatuses) as any,
        total_jobs: batch.total_jobs,
        counts,
        created_at: batch.created_at,
        updated_at: batch.updated_at,
        submitted_by: userMap.get(batch.submitted_by_user_id) || null,
      };
    });
  }

  async getBatchDetails(batchId: string) {
    const batch = await prisma.fundingIntakeBatch.findUnique({
      where: { id: batchId },
      include: {
        jobs: {
          orderBy: { created_at: 'asc' },
          include: {
            sources: {
              orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
            },
          },
        },
      },
    });

    if (!batch) {
      return null;
    }

    const userIds = Array.from(new Set([batch.submitted_by_user_id, ...batch.jobs.map((job) => job.submitted_by_user_id)]));
    const linkedCallIds = Array.from(new Set(batch.jobs.map((job) => job.linked_funding_call_id).filter(Boolean) as string[]));
    const [users, linkedCalls] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      }),
      linkedCallIds.length > 0
        ? prisma.fundingCall.findMany({
            where: { id: { in: linkedCallIds } },
            select: { id: true, catalog_status: true },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((user) => [user.id, user]));
    const linkedCallStatusMap = new Map(linkedCalls.map((call) => [call.id, readCatalogStatus(call)]));
    const jobStatuses = batch.jobs.map((job) => job.status as FundingIntakeJobStatus);

    return {
      id: batch.id,
      label: batch.label,
      status: deriveFundingIntakeBatchStatus(jobStatuses),
      total_jobs: batch.total_jobs,
      counts: buildFundingIntakeJobStatusCounts(jobStatuses),
      created_at: batch.created_at,
      updated_at: batch.updated_at,
      submitted_by: userMap.get(batch.submitted_by_user_id) || null,
      jobs: batch.jobs.map((job) => ({
        ...job,
        source_url: job.source_url || null,
        linked_funding_call_id: job.linked_funding_call_id || null,
        linked_call_status: job.linked_funding_call_id ? linkedCallStatusMap.get(job.linked_funding_call_id) || null : null,
        submitted_by: userMap.get(job.submitted_by_user_id) || null,
      })),
    };
  }

  async getJobDetails(jobId: string, operator?: IntakeOperator) {
    const job = await prisma.fundingIntakeJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return null;
    }

    if (operator?.role === 'USER' && job.submitted_by_user_id !== operator.userId) {
      return null;
    }

    const [latestExtraction, duplicates, events, sources, catalogDetails, guidelineBundle, templateBundle, submitter] = await Promise.all([
      getLatestExtraction(jobId),
      prisma.fundingIntakeDuplicate.findMany({
        where: { job_id: jobId },
        orderBy: [{ match_score: 'desc' }, { created_at: 'asc' }],
      }),
      prisma.fundingIntakeJobEvent.findMany({
        where: { job_id: jobId },
        orderBy: { created_at: 'asc' },
      }),
      prisma.fundingIntakeJobSource.findMany({
        where: { job_id: jobId },
        orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
      }),
      job.linked_funding_call_id
        ? fundingCatalogService.getFundingCallDetails(job.linked_funding_call_id)
        : Promise.resolve(null),
      job.linked_funding_call_id
        ? fundingGuidelineService.getGuidelineBundle(job.linked_funding_call_id)
        : Promise.resolve(null),
      job.linked_funding_call_id
        ? fundingTemplateService.getTemplateBundle(job.linked_funding_call_id)
        : Promise.resolve(null),
      prisma.user.findUnique({
        where: { id: job.submitted_by_user_id },
        select: { id: true, email: true, name: true },
      }),
    ]);
    const fundingCall = catalogDetails?.call || null;

    const candidateIds = duplicates.map((duplicate) => duplicate.candidate_funding_call_id);
    const candidateVisibility = operator ? duplicateVisibilityWhere(operator) : {};
    const candidates = candidateIds.length > 0
      ? await prisma.fundingCall.findMany({
          where: {
            AND: [
              { id: { in: candidateIds } },
              candidateVisibility,
            ],
          },
          select: {
            id: true,
            agency_name: true,
            scheme_title: true,
            catalog_status: true,
            source_url: true,
            official_urls: true,
            close_date: true,
          },
        })
      : [];
    const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const duplicateOperator = operator || (submitter
      ? { userId: submitter.id, email: submitter.email, role: 'USER' as const }
      : null);
    const domainDuplicates = duplicateOperator
      ? await computeDomainDuplicateCandidates(
        latestExtraction?.extracted_json as any,
        job.source_url,
        readFetchedUrl(job.fetch_metadata_json),
        duplicateOperator,
        job.linked_funding_call_id
      )
      : [];

    const publishWarnings = buildPublishWarnings({
      call: fundingCall,
      guidelineBundle,
      templateBundle,
    });
    const draftingReadiness = buildDraftingReadiness(fundingCall);
    const callMetadata = readCatalogMetadata(fundingCall?.metadata);
    const extractedDraftValues = buildDraftValuesFromExtraction(latestExtraction?.extracted_json as any, {
      sourceUrl: job.source_url,
      fetchedUrl: readFetchedUrl(job.fetch_metadata_json),
    });
    const draftValues = callMetadata.parallel_intake_shell && latestExtraction
      ? extractedDraftValues
      : catalogDetails?.draftValues || extractedDraftValues;

    return {
      job,
      submitter,
      extraction: latestExtraction,
      draft: fundingCall,
      draftValues,
      call: catalogDetails?.call || null,
      publishReadiness: catalogDetails?.publishReadiness || null,
      publishWarnings,
      draftingReadiness,
      guidelines: guidelineBundle,
      template: templateBundle,
      duplicates: duplicates
        .filter((duplicate) => !operator || candidateMap.has(duplicate.candidate_funding_call_id))
        .map((duplicate) => ({
        ...duplicate,
        candidate: candidateMap.get(duplicate.candidate_funding_call_id) || null,
      })),
      domainDuplicates,
      events,
      sources,
    };
  }

  async deleteJob(jobId: string, operator: IntakeOperator) {
    const job = await prisma.fundingIntakeJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Funding intake job not found');
    }

    if (allowedTransitionTarget(job.status)) {
      throw new FundingIntakeDeleteError(
        'cancel_before_delete',
        'Cancel the active intake job before deleting it.',
        job.linked_funding_call_id
      );
    }

    const linkedCall = job.linked_funding_call_id
      ? await prisma.fundingCall.findUnique({
          where: { id: job.linked_funding_call_id },
          select: {
            id: true,
            catalog_status: true,
            intake_job_id: true,
          },
        })
      : null;

    if (linkedCall && readCatalogStatus(linkedCall) === 'PUBLISHED') {
      throw new FundingIntakeDeleteError(
        'must_unpublish_first',
        'Archive the published funding call first, then delete this intake job.',
        linkedCall.id
      );
    }

    const deleteLinkedCall = Boolean(linkedCall && linkedCall.intake_job_id === job.id);
    const templateAssetPaths = deleteLinkedCall && linkedCall
      ? (await prisma.fundingCallTemplateAsset.findMany({
          where: { funding_call_id: linkedCall.id },
          select: { storage_path: true },
        })).map((asset) => asset.storage_path).filter(Boolean)
      : [];
    const deletedFundingCallId = deleteLinkedCall && linkedCall ? linkedCall.id : null;

    await prisma.$transaction(async (tx) => {
      if (deletedFundingCallId) {
        await tx.fundingIntakeJob.updateMany({
          where: { linked_funding_call_id: deletedFundingCallId },
          data: { linked_funding_call_id: null },
        });

        await tx.fundingIntakeDuplicate.deleteMany({
          where: { candidate_funding_call_id: deletedFundingCallId },
        });

        await tx.fundingCall.delete({
          where: { id: deletedFundingCallId },
        });
      }

      await tx.fundingIntakeDuplicate.deleteMany({
        where: { job_id: jobId },
      });

      await tx.fundingIntakeExtraction.deleteMany({
        where: { job_id: jobId },
      });

      await tx.fundingIntakeJobEvent.deleteMany({
        where: { job_id: jobId },
      });

      await tx.fundingIntakeJob.delete({
        where: { id: jobId },
      });
    });

    const fileCleanupPaths = deletedFundingCallId
      ? [job.source_file_path, ...templateAssetPaths]
      : linkedCall
        ? []
        : [job.source_file_path];

    await Promise.all(fileCleanupPaths.map((filePath) => deleteManagedUploadIfPresent(filePath)));

    return {
      ok: true,
      deletedJobId: jobId,
      deletedFundingCallId,
      deletedBy: operator.email,
    };
  }

  async retryJob(jobId: string, operator: IntakeOperator, retrySourceInput?: Partial<IntakeSubmitInput> | null) {
    const job = await prisma.fundingIntakeJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Funding intake job not found');
    }

    if (job.status !== 'failed') {
      throw new Error('Only failed jobs can be retried');
    }

    let recoverySource: Awaited<ReturnType<typeof prepareJobSourceData>> | null = null;
    let recoverySourceKey = job.details_source_key || 'source_1';
    const previousDetailsSourceKey = job.details_source_key || 'source_1';

    if (retrySourceInput?.inputType) {
      const existingSources = await this.ensureJobSources(job);
      const usedSourceKeys = new Set(existingSources.map((source) => source.source_key));
      recoverySourceKey =
        BATCH_SOURCE_KEYS.find((sourceKey) => !usedSourceKeys.has(sourceKey)) ||
        previousDetailsSourceKey;
      const sequenceNo = BATCH_SOURCE_KEYS.indexOf(recoverySourceKey);

      recoverySource = await prepareJobSourceData(
        {
          ...sourceToIntakeSource(retrySourceInput as IntakeSubmitInput),
          sourceKey: recoverySourceKey,
        },
        sequenceNo >= 0 ? sequenceNo : existingSources.length
      );

      await prisma.fundingIntakeJobSource.upsert({
        where: {
          job_id_source_key: {
            job_id: jobId,
            source_key: recoverySource.source_key,
          },
        },
        create: {
          job_id: jobId,
          ...recoverySource,
        } as any,
        update: {
          sequence_no: recoverySource.sequence_no,
          input_type: recoverySource.input_type,
          source_url: recoverySource.source_url,
          source_text_hash: recoverySource.source_text_hash,
          source_file_path: recoverySource.source_file_path,
          raw_text: recoverySource.raw_text,
          normalized_text: recoverySource.normalized_text,
          fetch_metadata_json: recoverySource.fetch_metadata_json as any,
          status: recoverySource.status,
          error_code: null,
          error_message: null,
        } as any,
      });
    }

    const nextGuidelineSourceKey =
      recoverySource && (job.guidelines_source_key || previousDetailsSourceKey) === previousDetailsSourceKey
        ? recoverySource.source_key
        : job.guidelines_source_key || previousDetailsSourceKey;
    const nextTemplateSourceKey =
      recoverySource && (job.template_source_key || previousDetailsSourceKey) === previousDetailsSourceKey
        ? recoverySource.source_key
        : job.template_source_key || previousDetailsSourceKey;

    await prisma.fundingIntakeJob.update({
      where: { id: jobId },
      data: {
        status: 'queued',
        ...(recoverySource
          ? {
              input_type: recoverySource.input_type,
              source_url: recoverySource.source_url,
              source_text_hash: recoverySource.source_text_hash,
              source_file_path: recoverySource.source_file_path,
              raw_text: recoverySource.raw_text,
              normalized_text: recoverySource.normalized_text,
              fetch_metadata_json: recoverySource.fetch_metadata_json as any,
              details_source_key: recoverySource.source_key,
              guidelines_source_key: nextGuidelineSourceKey,
              template_source_key: nextTemplateSourceKey,
            }
          : {}),
        error_code: null,
        error_message: null,
        completed_at: null,
        started_at: null,
        locked_at: null,
        locked_by: null,
        next_attempt_at: null,
        processing_phase: 'queued',
        retry_count: { increment: 1 },
      },
    });
    if (job.batch_id) {
      await prisma.fundingIntakeBatch.update({
        where: { id: job.batch_id },
        data: { status: 'processing' },
      });
    }

    await recordJobEvent(jobId, 'queued', 'retry_requested', {
      actorUserId: operator.userId,
      previousStatus: job.status,
      message: recoverySource
        ? `Funding intake job retried from alternate ${recoverySource.input_type} source ${recoverySource.source_key}`
        : 'Funding intake job retried',
    });

    this.enqueue(jobId);
  }

  async cancelJob(jobId: string, operator: IntakeOperator) {
    const job = await prisma.fundingIntakeJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Funding intake job not found');
    }

    if (!allowedTransitionTarget(job.status)) {
      throw new Error('Only queued, fetching, or extracting jobs can be canceled');
    }

    await transitionJobStatus(jobId, 'canceled', {
      actorUserId: operator.userId,
      completedAt: new Date(),
      processingPhase: 'canceled',
      message: 'Funding intake job canceled',
    });
    await this.maybeUpdateBatchStatus(job.batch_id);
  }

  private async applyJsonArtifactsForFundingCall(job: any, fundingCallId: string, operator: IntakeOperator) {
    const artifacts = readPreparedFundingJsonArtifacts(job.fetch_metadata_json);

    if (artifacts.appliedFundingCallId === fundingCallId) {
      return {
        guidelineStatus: null,
        guidelineRunId: null,
        guidelineExtractionError: null,
        templateStatus: null,
        templateRunId: null,
        templateAssetId: null,
        templateExtractionError: null,
        jsonGuidelineImported: false,
        jsonTemplateImported: false,
        jsonDocumentsIngested: 0,
        jsonDocumentErrors: [],
        jsonImportSkippedReason: 'already_applied',
      };
    }

    let guidelineStatus: string | null = null;
    let guidelineExtractionError: string | null = null;
    let templateStatus: string | null = null;
    let templateExtractionError: string | null = null;
    let jsonGuidelineImported = false;
    let jsonTemplateImported = false;
    let jsonDocumentsIngested = 0;
    const jsonDocumentErrors: string[] = [];

    if (artifacts.guidelinePack) {
      try {
        const guidelineBundle = await fundingGuidelineService.updateGuideline(
          fundingCallId,
          artifacts.guidelinePack,
          operator,
          'Imported from JSON intake upload'
        );
        guidelineStatus = guidelineBundle?.guideline?.status || null;
        jsonGuidelineImported = true;
      } catch (error) {
        guidelineExtractionError = error instanceof Error ? error.message : String(error);
        console.error('[Funding Intake] JSON guideline import failed:', error);
      }
    }

    if (artifacts.template) {
      try {
        const templateBundle = await fundingTemplateService.updateTemplate(
          fundingCallId,
          artifacts.template,
          operator,
          'Imported from JSON intake upload'
        );
        templateStatus = templateBundle?.template?.status || null;
        jsonTemplateImported = true;
      } catch (error) {
        templateExtractionError = error instanceof Error ? error.message : String(error);
        console.error('[Funding Intake] JSON template import failed:', error);
      }
    }

    // Download and ingest each full-call document URL (PDF/DOCX). Each URL is
    // isolated so one dead link never blocks the rest of the import.
    for (const documentUrl of artifacts.documentUrls) {
      try {
        const ingested = await ingestFundingDocumentFromUrl(fundingCallId, documentUrl, operator);
        jsonDocumentsIngested += 1;
        console.log('[Funding Intake] document URL ingested', {
          jobId: job.id,
          fundingCallId,
          documentUrl,
          documentId: ingested.documentId,
          duplicate: ingested.duplicate,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jsonDocumentErrors.push(`${documentUrl}: ${message}`);
        console.error('[Funding Intake] document URL ingestion failed:', documentUrl, error);
      }
    }

    const metadata = readFetchMetadata(job.fetch_metadata_json);
    await prisma.fundingIntakeJob.update({
      where: { id: job.id },
      data: {
        fetch_metadata_json: ({
          ...metadata,
          json_artifacts_applied: {
            funding_call_id: fundingCallId,
            applied_at: new Date().toISOString(),
            guideline_imported: jsonGuidelineImported,
            template_imported: jsonTemplateImported,
            documents_ingested: jsonDocumentsIngested,
            document_errors: jsonDocumentErrors,
          },
        } as any),
      },
    });

    if (jsonGuidelineImported || jsonTemplateImported || jsonDocumentsIngested > 0) {
      await recordJobEvent(job.id, job.status, 'json_artifacts_imported', {
        actorUserId: operator.userId,
        previousStatus: job.status,
        message: `Imported JSON artifacts:${jsonGuidelineImported ? ' guidelines' : ''}${jsonTemplateImported ? ' template' : ''}${jsonDocumentsIngested > 0 ? ` documents(${jsonDocumentsIngested})` : ''}${jsonDocumentErrors.length > 0 ? ` document_errors(${jsonDocumentErrors.length})` : ''}`,
      });
    }

    return {
      guidelineStatus,
      guidelineRunId: null,
      guidelineExtractionError,
      templateStatus,
      templateRunId: null,
      templateAssetId: null,
      templateExtractionError,
      jsonGuidelineImported,
      jsonTemplateImported,
      jsonDocumentsIngested,
      jsonDocumentErrors,
      jsonImportSkippedReason:
        !jsonGuidelineImported && !jsonTemplateImported && jsonDocumentsIngested === 0 ? 'no_json_artifacts' : null,
    };
  }

  /** Mark the call as needing a dedicated template document (best-effort). */
  private async flagTemplateNeedsSource(fundingCallId: string, operator: IntakeOperator) {
    try {
      const call = await prisma.fundingCall.findUnique({
        where: { id: fundingCallId },
        select: { metadata: true },
      });
      const metadata = readCatalogMetadata(call?.metadata);
      metadata.template_extraction = {
        skipped: true,
        reason: 'no_application_sections',
        flagged_at: new Date().toISOString(),
        flagged_by: operator.email || operator.userId,
      };
      await prisma.fundingCall.update({
        where: { id: fundingCallId },
        data: { metadata: metadata as any },
      });
    } catch (error) {
      console.warn('[Funding Intake] could not flag template needs-source state:', error);
    }
  }

  /** The document role an intake source plays: explicit tag first, slot-derived otherwise. */
  private deriveSourceDocumentKind(job: any, source: any): 'call_document' | 'guideline_document' | 'template_document' {
    const metadata = readFetchMetadata(source.fetch_metadata_json);
    const explicit = metadata.document_kind;
    if (explicit === 'call_document' || explicit === 'guideline_document' || explicit === 'template_document') {
      return explicit;
    }
    const detailsKey = job.details_source_key || 'source_1';
    if (source.source_key === detailsKey) {
      return 'call_document';
    }
    if (source.source_key === (job.guidelines_source_key || detailsKey)) {
      return 'guideline_document';
    }
    if (source.source_key === (job.template_source_key || detailsKey)) {
      return 'template_document';
    }
    return 'call_document';
  }

  /**
   * Parse/sectionize a document now, but never longer than the intake time-box —
   * on timeout processing continues in the background and extraction falls back
   * to flat text for this run.
   */
  private async ensureDocumentProcessed(documentId: string, operator: IntakeOperator) {
    const document = await prisma.fundingCallDocument.findUnique({
      where: { id: documentId },
      select: { parsing_status: true },
    });
    if (!document || document.parsing_status === 'completed' || document.parsing_status === 'processing') {
      return document?.parsing_status || 'missing';
    }

    const processing = fundingDocumentService.processDocument(documentId, operator);
    let timedOut = false;
    await Promise.race([
      processing.then(() => undefined).catch(() => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, INTAKE_DOCUMENT_PROCESS_TIMEOUT_MS);
        (timer as any).unref?.();
      }),
    ]);

    if (timedOut) {
      console.warn(`[Funding Intake] document ${documentId} is still processing after the intake time-box; continuing in background`);
      void processing.catch((error) => {
        console.error('[Funding Intake] background document processing failed:', error);
      });
      return 'processing';
    }

    const refreshed = await prisma.fundingCallDocument.findUnique({
      where: { id: documentId },
      select: { parsing_status: true },
    });
    return refreshed?.parsing_status || 'missing';
  }

  /**
   * Register every distinct intake source as a funding-call document of its
   * tagged kind, so extraction can route by sections and RAG sees all files.
   * Idempotent (checksum + per-source ledger in fetch_metadata_json) and
   * failure-isolated: this method NEVER throws — a failed ingest degrades to
   * today's flat-text extraction for that source.
   */
  private async ensureIntakeSourceDocuments(job: any, fundingCallId: string, operator: IntakeOperator) {
    const report = {
      ingested: [] as Array<{ sourceKey: string; documentId: string; kind: string; duplicate: boolean; parsingStatus: string }>,
      errors: [] as Array<{ sourceKey: string; error: string }>,
    };

    try {
      const sources = await this.ensureJobSources(job);
      const jobRecord = await prisma.fundingIntakeJob.findUnique({
        where: { id: job.id },
        select: { fetch_metadata_json: true, status: true },
      });
      const jobMetadata = readFetchMetadata(jobRecord?.fetch_metadata_json);
      const previousLedger =
        jobMetadata.source_documents && typeof jobMetadata.source_documents === 'object' && !Array.isArray(jobMetadata.source_documents)
          ? { ...(jobMetadata.source_documents as Record<string, any>) }
          : {};
      const ledger: Record<string, any> = { ...previousLedger };
      const seenHashes = new Set<string>();
      const llmContext = { tenantId: operator.tenantId || null, userId: operator.userId };

      for (const source of sources) {
        const sourceKey = source.source_key;
        const kind = this.deriveSourceDocumentKind(job, source);
        const sourceHash = source.source_text_hash || null;

        try {
          // Identical bytes/text in two slots become one document; the reader
          // fallback (guideline_document → call_document) covers the second slot.
          if (sourceHash && seenHashes.has(sourceHash)) {
            continue;
          }
          if (sourceHash) {
            seenHashes.add(sourceHash);
          }

          const already = previousLedger[sourceKey];
          if (already?.document_id && already?.checksum && already.checksum === sourceHash) {
            const parsingStatus = await this.ensureDocumentProcessed(already.document_id, operator);
            report.ingested.push({ sourceKey, documentId: already.document_id, kind, duplicate: true, parsingStatus });
            continue;
          }

          let outcome: { document: { id: string }; duplicate?: boolean } | null = null;
          if (source.input_type === 'pdf' && source.source_file_path) {
            const sourceMeta = readFetchMetadata(source.fetch_metadata_json);
            outcome = await fundingDocumentService.registerLocalFileDocument({
              fundingCallId,
              filePath: source.source_file_path,
              mimeType: typeof sourceMeta.mime === 'string' ? sourceMeta.mime : null,
              originalFilename: typeof sourceMeta.original_name === 'string' ? sourceMeta.original_name : null,
              documentKind: kind,
              aliasChecksums: sourceHash ? [sourceHash] : [],
              deferProcessing: true,
              operator,
              eventPayload: { source: 'funding_intake', intakeJobId: job.id, sourceKey },
            });
          } else if (source.input_type === 'url' && source.source_url) {
            try {
              const ingested = await ingestFundingDocumentFromUrl(fundingCallId, source.source_url, operator, {
                documentKind: kind,
                deferProcessing: true,
              });
              outcome = { document: { id: ingested.documentId }, duplicate: ingested.duplicate };
            } catch (urlError) {
              // The URL serves an HTML page, not a file — persist the fetched
              // text (already prepared for extraction, no refetch in that case).
              const prepared = source.normalized_text
                ? source
                : await this.prepareSourceForExtraction(job, source, llmContext);
              if (!prepared.normalized_text) {
                throw urlError;
              }
              outcome = await fundingDocumentService.createDocumentFromText({
                fundingCallId,
                text: prepared.normalized_text,
                fileNameHint: `${normalizeHostname(source.source_url) || 'funding-call'}-${sourceKey}`,
                sourceUrl: source.source_url,
                documentKind: kind,
                deferProcessing: true,
                operator,
              });
            }
          } else {
            const text = source.normalized_text || source.raw_text || '';
            if (!text.trim()) {
              continue;
            }
            outcome = await fundingDocumentService.createDocumentFromText({
              fundingCallId,
              text,
              fileNameHint: `funding-intake-${sourceKey}`,
              documentKind: kind,
              deferProcessing: true,
              operator,
            });
          }

          if (outcome?.document?.id) {
            const parsingStatus = await this.ensureDocumentProcessed(outcome.document.id, operator);
            ledger[sourceKey] = {
              document_id: outcome.document.id,
              document_kind: kind,
              checksum: sourceHash,
              ingested_at: new Date().toISOString(),
            };
            report.ingested.push({
              sourceKey,
              documentId: outcome.document.id,
              kind,
              duplicate: Boolean(outcome.duplicate),
              parsingStatus,
            });
            await recordJobEvent(job.id, jobRecord?.status || job.status, 'source_document_ingested', {
              actorUserId: operator.userId,
              previousStatus: jobRecord?.status || job.status,
              message: `Registered ${sourceKey} as ${kind} (document ${outcome.document.id}, parsing ${parsingStatus})`,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report.errors.push({ sourceKey, error: message });
          console.error(`[Funding Intake] source document ingestion failed for ${sourceKey}:`, error);
          await recordJobEvent(job.id, jobRecord?.status || job.status, 'source_document_ingest_failed', {
            actorUserId: operator.userId,
            previousStatus: jobRecord?.status || job.status,
            message: `${sourceKey}: ${message}`,
          }).catch(() => undefined);
        }
      }

      await prisma.fundingIntakeJob.update({
        where: { id: job.id },
        data: {
          fetch_metadata_json: {
            ...jobMetadata,
            source_documents: ledger,
          } as any,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ sourceKey: '*', error: message });
      console.error('[Funding Intake] source document ingestion failed:', error);
    }

    return report;
  }

  private async runExtractAllForFundingCall(
    job: any,
    fundingCallId: string,
    operator: IntakeOperator,
    options?: {
      guidelineSource?: any | null;
      templateSource?: any | null;
    }
  ) {
    if (job.input_type === 'json') {
      return this.applyJsonArtifactsForFundingCall(job, fundingCallId, operator);
    }

    // Documents first: extraction below routes by the sections these produce.
    const documentIngest = await this.ensureIntakeSourceDocuments(job, fundingCallId, operator);

    const guidelineTask = (async () => {
      try {
        // Sections routed from the ingested documents drive extraction; the flat
        // prepared text only backstops calls whose documents failed to parse.
        const source = {
          sourceMode: 'documents' as const,
          fallbackText:
            options?.guidelineSource?.normalized_text
            || options?.guidelineSource?.raw_text
            || job.normalized_text
            || job.raw_text
            || null,
        };
        const guidelineRun = await fundingGuidelineService.createExtractionRunFromFundingCall(fundingCallId, operator, source);
        return {
          guidelineStatus: guidelineRun?.status || null,
          guidelineRunId: guidelineRun?.id || null,
          guidelineExtractionError: null as string | null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Funding Intake] guideline extraction failed:', error);
        return {
          guidelineStatus: null,
          guidelineRunId: null,
          guidelineExtractionError: message,
        };
      }
    })();

    const templateTask = (async () => {
      try {
        const templateJob = options?.templateSource
          ? makeJobLikeFromSource(job, options.templateSource)
          : job;
        const detailsKey = job.details_source_key || 'source_1';
        const hasExplicitTemplateSource = Boolean(
          options?.templateSource?.source_key && options.templateSource.source_key !== detailsKey
        );
        const autoAsset = await fundingTemplateService.upsertAutoManagedAssetFromIntakeSource(
          fundingCallId,
          templateJob,
          operator,
          {
            allowSkip: !hasExplicitTemplateSource,
            hasExplicitTemplateSource,
          }
        );
        if (!autoAsset) {
          // The parsed call document has no application-format sections and the
          // operator supplied no template source — flag instead of compiling a
          // template out of prose (a later template_document upload re-enables it).
          await this.flagTemplateNeedsSource(fundingCallId, operator);
          await recordJobEvent(job.id, job.status, 'template_extraction_skipped', {
            actorUserId: operator.userId,
            previousStatus: job.status,
            message: 'No application-format sections found; template needs a dedicated document',
          }).catch(() => undefined);
          return {
            templateStatus: 'skipped_needs_source',
            templateRunId: null,
            templateAssetId: null,
            templateExtractionError: null as string | null,
          };
        }
        const templateRun = await fundingTemplateService.createExtractionRun(fundingCallId, operator, [autoAsset.id]);
        return {
          templateStatus: templateRun?.status || null,
          templateRunId: templateRun?.id || null,
          templateAssetId: autoAsset.id,
          templateExtractionError: null as string | null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Funding Intake] template extraction failed:', error);
        return {
          templateStatus: null,
          templateRunId: null,
          templateAssetId: null,
          templateExtractionError: message,
        };
      }
    })();

    const [guidelineResult, templateResult] = await Promise.all([guidelineTask, templateTask]);

    return {
      ...guidelineResult,
      ...templateResult,
      sourceDocumentsIngested: documentIngest.ingested.length,
      sourceDocumentErrors: documentIngest.errors,
    };
  }

  async extractAll(jobId: string, operator: IntakeOperator) {
    const details = await this.getJobDetails(jobId);
    if (!details) {
      throw new Error('Funding intake job not found');
    }

    if (!details.job.linked_funding_call_id) {
      throw new Error('Save the funding call draft before running extract all');
    }

    await recordJobEvent(jobId, details.job.status, 'extract_all_requested', {
      actorUserId: operator.userId,
      previousStatus: details.job.status,
      message: 'Extract all requested from intake workspace',
    });

    const llmContext = {
      tenantId: operator.tenantId || null,
      userId: operator.userId,
    };
    const detailsSourceKey = details.job.details_source_key || 'source_1';
    const detailsSource = await this.prepareSourceByKey(details.job, detailsSourceKey, llmContext);
    const guidelineKey = details.job.guidelines_source_key || detailsSourceKey;
    const templateKey = details.job.template_source_key || detailsSourceKey;
    const guidelineSourcePromise = guidelineKey === detailsSource.source_key
      ? Promise.resolve(detailsSource)
      : this.prepareSourceByKey(details.job, guidelineKey, llmContext);
    const templateSourcePromise = templateKey === detailsSource.source_key
      ? Promise.resolve(detailsSource)
      : this.prepareSourceByKey(details.job, templateKey, llmContext);
    const [guidelineSource, templateSource] = await Promise.all([guidelineSourcePromise, templateSourcePromise]);

    return this.runExtractAllForFundingCall(
      makeJobLikeFromSource(details.job, detailsSource),
      details.job.linked_funding_call_id,
      operator,
      {
        guidelineSource,
        templateSource,
      }
    );
  }

  async createOrUpdateDraft(
    jobId: string,
    draftInput: Partial<FundingDraftValues>,
    operator: IntakeOperator,
    duplicateResolutions: IntakeDuplicateResolutionInput[] = [],
    extractAll = false
  ) {
    const details = await this.getJobDetails(jobId);
    if (!details) {
      throw new Error('Funding intake job not found');
    }

    if (!['needs_review', 'draft_created', 'failed'].includes(details.job.status)) {
      throw new Error('Draft can only be saved after extraction reaches review stage or from a failed recovery state');
    }

    for (const resolution of duplicateResolutions) {
      await prisma.fundingIntakeDuplicate.update({
        where: { id: resolution.duplicateId },
        data: {
          resolution: resolution.resolution,
          resolved_by_user_id: operator.userId,
          resolved_at: new Date(),
        },
      });
    }

    const unresolvedDuplicates = await prisma.fundingIntakeDuplicate.findMany({
      where: {
        job_id: jobId,
        resolution: 'pending',
      },
    });

    if (unresolvedDuplicates.length > 0) {
      return {
        ok: false,
        reason: 'duplicate_resolution_required',
        duplicates: unresolvedDuplicates,
      };
    }

    const mergedDuplicate = await prisma.fundingIntakeDuplicate.findFirst({
      where: {
        job_id: jobId,
        resolution: 'merged_to_existing',
      },
    });

    if (mergedDuplicate) {
      const previousLinkedCallId = details.job.linked_funding_call_id;
      if (previousLinkedCallId && previousLinkedCallId !== mergedDuplicate.candidate_funding_call_id) {
        const previousCall = await prisma.fundingCall.findUnique({
          where: { id: previousLinkedCallId },
          select: {
            id: true,
            catalog_status: true,
            intake_job_id: true,
          },
        });

        if (previousCall?.intake_job_id === jobId && readCatalogStatus(previousCall) !== 'PUBLISHED') {
          const templateAssetPaths = (await prisma.fundingCallTemplateAsset.findMany({
            where: { funding_call_id: previousCall.id },
            select: { storage_path: true },
          })).map((asset) => asset.storage_path).filter(Boolean);

          await prisma.fundingCall.delete({
            where: { id: previousCall.id },
          });
          await Promise.all(templateAssetPaths.map((filePath) => deleteManagedUploadIfPresent(filePath)));
        }
      }

      await transitionJobStatus(jobId, 'draft_created', {
        actorUserId: operator.userId,
        duplicateStatus: 'resolved',
        linkedFundingCallId: mergedDuplicate.candidate_funding_call_id,
        completedAt: new Date(),
        message: 'Job linked to an existing funding call',
      });

      return {
        ok: true,
        fundingCallId: mergedDuplicate.candidate_funding_call_id,
        requiredFieldsRemaining: [],
        duplicateResolutionState: 'resolved',
        extractAllSkippedReason: extractAll ? 'merged_to_existing' : null,
      };
    }

    const normalizedDraft = normalizeDraftInput(draftInput);
    const requiredFieldsRemaining = buildDraftRequiredFields(normalizedDraft);
    if (requiredFieldsRemaining.length > 0) {
      return {
        ok: false,
        reason: 'missing_required_fields',
        requiredFieldsRemaining,
      };
    }

    const fundingCall = await persistDraft(details.job, normalizedDraft, operator, details.extraction);

    await transitionJobStatus(jobId, 'draft_created', {
      actorUserId: operator.userId,
      duplicateStatus: details.duplicates.length > 0 ? 'resolved' : details.job.duplicate_status,
      linkedFundingCallId: fundingCall.id,
      completedAt: new Date(),
      message: details.job.status === 'failed'
        ? 'Manual recovery draft saved after failed extraction'
        : 'Draft funding call saved',
    });

    if (details.job.status === 'failed') {
      await recordJobEvent(jobId, 'draft_created', 'manual_recovery_draft_saved', {
        actorUserId: operator.userId,
        previousStatus: 'failed',
        message: 'Required call basics were saved manually after failed extraction',
      });
    }

    const runExtractAll = extractAll || details.job.input_type === 'json';
    if (!runExtractAll) {
      // Still register the intake sources as documents (sections + RAG) — in the
      // background so saving a draft stays fast.
      void this.ensureIntakeSourceDocuments(details.job, fundingCall.id, operator).catch((error) => {
        console.error('[Funding Intake] background source document ingestion failed:', error);
      });
    }

    const extractAllResult = runExtractAll
      ? await this.runExtractAllForFundingCall(details.job, fundingCall.id, operator)
      : {
          guidelineStatus: null,
          guidelineRunId: null,
          guidelineExtractionError: null,
          templateStatus: null,
          templateRunId: null,
          templateAssetId: null,
          templateExtractionError: null,
          jsonGuidelineImported: false,
          jsonTemplateImported: false,
          jsonImportSkippedReason: null,
        };

    return {
      ok: true,
      fundingCallId: fundingCall.id,
      requiredFieldsRemaining: [],
      duplicateResolutionState: details.duplicates.length > 0 ? 'resolved' : details.job.duplicate_status,
      extractAllTriggered: runExtractAll,
      ...extractAllResult,
    };
  }

  private async ensureJobSources(job: any) {
    const existingSources = await prisma.fundingIntakeJobSource.findMany({
      where: { job_id: job.id },
      orderBy: [{ sequence_no: 'asc' }, { created_at: 'asc' }],
    });

    if (existingSources.length > 0) {
      return existingSources;
    }

    const source = await prisma.fundingIntakeJobSource.create({
      data: {
        job_id: job.id,
        source_key: 'source_1',
        sequence_no: 0,
        input_type: job.input_type,
        source_url: job.source_url || null,
        source_text_hash: job.source_text_hash || null,
        source_file_path: job.source_file_path || null,
        raw_text: job.raw_text || null,
        normalized_text: job.normalized_text || null,
        fetch_metadata_json: job.fetch_metadata_json || Prisma.JsonNull,
        status: job.normalized_text ? 'ready' : 'pending',
      } as any,
    });

    await prisma.fundingIntakeJob.update({
      where: { id: job.id },
      data: {
        details_source_key: job.details_source_key || 'source_1',
        guidelines_source_key: job.guidelines_source_key || 'source_1',
        template_source_key: job.template_source_key || 'source_1',
      },
    });

    return [source];
  }

  private async updateJobLegacySource(jobId: string, source: any, processingPhase?: string) {
    const existingJob = await prisma.fundingIntakeJob.findUnique({
      where: { id: jobId },
      select: { fetch_metadata_json: true, linked_funding_call_id: true },
    });
    const existingMetadata = readFetchMetadata(existingJob?.fetch_metadata_json);
    const sourceMetadata = readFetchMetadata(source.fetch_metadata_json);
    const mergedMetadata = existingMetadata.batch_intake
      ? { ...sourceMetadata, batch_intake: existingMetadata.batch_intake }
      : sourceMetadata;

    await prisma.fundingIntakeJob.update({
      where: { id: jobId },
      data: {
        input_type: source.input_type,
        source_url: source.source_url || null,
        source_text_hash: source.source_text_hash || null,
        source_file_path: source.source_file_path || null,
        raw_text: source.raw_text || null,
        normalized_text: source.normalized_text || null,
        fetch_metadata_json: mergedMetadata as any,
        ...(processingPhase ? { processing_phase: processingPhase } : {}),
      } as any,
    });

    if (existingJob?.linked_funding_call_id) {
      const currentCall = await prisma.fundingCall.findUnique({
        where: { id: existingJob.linked_funding_call_id },
        select: { metadata: true },
      });
      const currentMetadata = readCatalogMetadata(currentCall?.metadata);
      await prisma.fundingCall.update({
        where: { id: existingJob.linked_funding_call_id },
        data: {
          sourceUrl: source.source_url || null,
          sourceDomain: normalizeHostname(source.source_url),
          sourceType: mapFundingSourceType(source.input_type),
          input_type: source.input_type,
          source_url: source.source_url || null,
          source_text_hash: source.source_text_hash || null,
          raw_text: source.raw_text || null,
          normalized_text: source.normalized_text || null,
          updatedByUserId: currentMetadata.owner_user_id || undefined,
          metadata: {
            ...currentMetadata,
            source_text_status: source.normalized_text ? 'ready' : 'pending',
            source_prepared_at: source.normalized_text ? new Date().toISOString() : currentMetadata.source_prepared_at || null,
          } as any,
        } as any,
      });
    }
  }

  private async prepareSourceForExtraction(
    job: any,
    source: any,
    llmContext: { tenantId?: string | null; userId?: string | null }
  ) {
    if (source.status === 'ready' && source.normalized_text) {
      return source;
    }

    try {
      await prisma.fundingIntakeJobSource.update({
        where: { id: source.id },
        data: {
          status: 'fetching',
          error_code: null,
          error_message: null,
        },
      });

      let rawText = source.raw_text || '';
      let normalizedText = source.normalized_text || '';
      let fetchMetadata = readFetchMetadata(source.fetch_metadata_json);
      let sourceHash = source.source_text_hash || null;

      if (source.input_type === 'url') {
        await transitionJobStatus(job.id, 'fetching', {
          startedAt: job.started_at || new Date(),
          processingPhase: `source:${source.source_key}:fetching`,
          message: `Fetching ${source.source_key}`,
        });

        const fetched = await fetchReadableUrlContent(source.source_url!);
        rawText = fetched.rawText;
        normalizedText = fetched.normalizedText;
        fetchMetadata = fetched.fetchMetadata;
        sourceHash = hashText(`${source.source_url || ''}::${normalizedText}`);
      } else if (source.input_type === 'text') {
        rawText = source.raw_text || '';
        normalizedText = source.normalized_text || normalizeMultilineText(rawText);
        sourceHash = hashText(normalizedText);
      } else if (source.input_type === 'pdf') {
        if (!source.source_file_path) {
          throw new Error(`No stored document file is available for ${source.source_key}`);
        }

        const isDocx =
          String((fetchMetadata as any)?.mime || '').toLowerCase() === DOCX_MIME ||
          source.source_file_path.toLowerCase().endsWith('.docx');

        await transitionJobStatus(job.id, 'extracting', {
          startedAt: job.started_at || new Date(),
          processingPhase: `source:${source.source_key}:transcribing_pdf`,
          message: `Transcribing ${source.source_key} ${isDocx ? 'DOCX' : 'PDF'} source`,
        });

        if (isDocx) {
          // DOCX carries its own text layer — mammoth extraction, no LLM needed.
          rawText = await extractDocxPlainText(source.source_file_path);
          normalizedText = normalizeMultilineText(rawText);
          fetchMetadata = {
            ...fetchMetadata,
            docx_extraction: {
              extractor: 'mammoth',
              source_file_path: source.source_file_path,
            },
          };
        } else {
          const pdfExtraction = await extractCanonicalTextFromPdf(source.source_file_path, llmContext);
          rawText = pdfExtraction.rawText;
          normalizedText = pdfExtraction.normalizedText;
          fetchMetadata = {
            ...fetchMetadata,
            pdf_transcription: {
              extractor_model: pdfExtraction.extractorModel,
              warnings: pdfExtraction.warnings,
              source_file_path: source.source_file_path,
            },
          };
        }
        sourceHash = sourceHash || hashText(`${source.source_file_path || ''}::${normalizedText}`);
      } else if (source.input_type === 'json') {
        const parsed = parseFundingJsonUpload(rawText || normalizedText);
        const prepared = prepareFundingJsonIntake(parsed);
        rawText = rawText || source.raw_text || '';
        normalizedText = normalizeMultilineText(prepared.sourceText || normalizedText || rawText);
        fetchMetadata = {
          ...fetchMetadata,
          json_upload: {
            ...((fetchMetadata as any)?.json_upload || {}),
            ...prepared.metadata,
          },
          json_artifacts: {
            grant_template_json: prepared.template || null,
            guideline_pack_json: prepared.guidelinePack || null,
            document_urls: prepared.documentUrls || [],
          },
        };
        sourceHash = sourceHash || hashText(JSON.stringify(parsed));
      } else {
        throw new Error(`Unsupported intake source type: ${source.input_type}`);
      }

      if (!normalizedText) {
        throw new Error(`${source.source_key} produced no normalized text`);
      }

      const updatedSource = await prisma.fundingIntakeJobSource.update({
        where: { id: source.id },
        data: {
          raw_text: rawText,
          normalized_text: normalizedText,
          source_text_hash: sourceHash,
          fetch_metadata_json: fetchMetadata as any,
          status: 'ready',
          error_code: null,
          error_message: null,
        },
      });

      console.log('[Funding Intake] source prepared', {
        jobId: job.id,
        sourceKey: updatedSource.source_key,
        sourceHash: updatedSource.source_text_hash,
        inputType: updatedSource.input_type,
        chars: updatedSource.normalized_text?.length || 0,
      });

      return updatedSource;
    } catch (error) {
      await prisma.fundingIntakeJobSource.update({
        where: { id: source.id },
        data: {
          status: 'failed',
          error_code: 'SOURCE_PREPARATION_FAILED',
          error_message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async prepareSourceByKey(
    job: any,
    sourceKey: string,
    llmContext: { tenantId?: string | null; userId?: string | null }
  ) {
    const sources = await this.ensureJobSources(job);
    const source = sources.find((item) => item.source_key === sourceKey);
    if (!source) {
      throw new Error(`Funding intake source not found: ${sourceKey}`);
    }
    return this.prepareSourceForExtraction(job, source, llmContext);
  }

  private async maybeUpdateBatchStatus(batchId?: string | null) {
    if (!batchId) {
      return;
    }

    const jobs = await prisma.fundingIntakeJob.findMany({
      where: { batch_id: batchId },
      select: { status: true },
    });
    if (jobs.length === 0) {
      return;
    }

    const status = deriveFundingIntakeBatchStatus(jobs.map((job) => job.status as FundingIntakeJobStatus));

    await prisma.fundingIntakeBatch.update({
      where: { id: batchId },
      data: { status: status as any },
    });
  }

  /**
   * Publish a batch job's freshly created draft when the batch was queued with
   * auto_publish (bulk bootstrap uploads). Publish failures never fail the
   * intake job — the call simply stays DRAFT for the manual "Publish Ready"
   * path, with the outcome recorded on the job's event trail.
   */
  private async maybeAutoPublishBatchDraft(jobId: string, fundingCallId: string, operator: IntakeOperator) {
    try {
      const publishResult = await fundingCatalogService.publishFundingCall(fundingCallId, operator);
      if (publishResult.ok) {
        await recordJobEvent(jobId, 'draft_created', 'auto_publish_completed', {
          actorUserId: operator.userId,
          previousStatus: 'draft_created',
          message: `Funding call ${fundingCallId} published automatically`,
        });
      } else {
        await recordJobEvent(jobId, 'draft_created', 'auto_publish_skipped', {
          actorUserId: operator.userId,
          previousStatus: 'draft_created',
          message: `Draft kept unpublished; missing required fields: ${(publishResult.requiredFieldsRemaining || []).join(', ') || 'unknown'}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Funding Intake] Auto-publish failed for job ${jobId} (call ${fundingCallId}):`, message);
      await recordJobEvent(jobId, 'draft_created', 'auto_publish_failed', {
        actorUserId: operator.userId,
        previousStatus: 'draft_created',
        message,
      }).catch(() => undefined);
    }
  }

  async processJob(jobId: string) {
    const job = await getJobForProcessing(jobId);
    if (!job || job.status === 'canceled' || !allowedTransitionTarget(job.status)) {
      return;
    }

    const stopHeartbeat = startExtractionHeartbeat(() => prisma.fundingIntakeJob.updateMany({
      where: {
        id: jobId,
        locked_by: WORKER_ID,
        status: { in: ['queued', 'fetching', 'extracting'] as any },
      },
      data: { locked_at: new Date() },
    }), Math.min(60_000, Math.max(10_000, Math.floor(JOB_LOCK_STALE_MS / 3))));

    try {
      const submitterForLlm = await prisma.user.findUnique({
        where: { id: job.submitted_by_user_id },
        select: { id: true, email: true, roles: true, tenantId: true },
      });
      const operator: IntakeOperator = {
        userId: submitterForLlm?.id || job.submitted_by_user_id,
        email: submitterForLlm?.email || '',
        role: deriveOperatorRoleFromUser(submitterForLlm),
        tenantId: submitterForLlm?.tenantId || null,
      };
      const llmContext = {
        tenantId: submitterForLlm?.tenantId || null,
        userId: submitterForLlm?.id || job.submitted_by_user_id,
      };
      const detailsSourceKey = job.details_source_key || 'source_1';

      const batchFlagsForResume = readBatchFlags(job.fetch_metadata_json);
      if (job.batch_id && job.linked_funding_call_id && batchFlagsForResume.extractAll) {
        await transitionJobStatus(jobId, 'extracting', {
          actorUserId: operator.userId,
          startedAt: job.started_at || new Date(),
          duplicateStatus: job.duplicate_status,
          linkedFundingCallId: job.linked_funding_call_id,
          processingPhase: 'extracting_guidelines_template',
          message: 'Resuming guideline and template extraction for existing draft',
        });

        const detailsSource = await this.prepareSourceByKey(job, detailsSourceKey, llmContext);
        const guidelineKey = job.guidelines_source_key || detailsSourceKey;
        const templateKey = job.template_source_key || detailsSourceKey;
        const guidelineSourcePromise = guidelineKey === detailsSource.source_key
          ? Promise.resolve(detailsSource)
          : this.prepareSourceByKey(job, guidelineKey, llmContext);
        const templateSourcePromise = templateKey === detailsSource.source_key
          ? Promise.resolve(detailsSource)
          : this.prepareSourceByKey(job, templateKey, llmContext);
        const [guidelineSource, templateSource] = await Promise.all([guidelineSourcePromise, templateSourcePromise]);

        const extractAllResult = await this.runExtractAllForFundingCall(
          makeJobLikeFromSource(job, detailsSource),
          job.linked_funding_call_id,
          operator,
          {
            guidelineSource,
            templateSource,
          }
        );

        await recordJobEvent(jobId, 'extracting', 'batch_extract_all_completed', {
          actorUserId: operator.userId,
          previousStatus: 'extracting',
          message: JSON.stringify(extractAllResult),
        });

        await transitionJobStatus(jobId, 'draft_created', {
          actorUserId: operator.userId,
          duplicateStatus: job.duplicate_status,
          linkedFundingCallId: job.linked_funding_call_id,
          completedAt: new Date(),
          processingPhase: 'draft_created',
          message: 'Batch funding intake job completed',
          expectedStatuses: ['queued', 'fetching', 'extracting'],
        });
        if (batchFlagsForResume.autoPublish) {
          await this.maybeAutoPublishBatchDraft(jobId, job.linked_funding_call_id, operator);
        }
        await this.maybeUpdateBatchStatus(job.batch_id);
        return;
      }

      const detailsSource = await this.prepareSourceByKey(job, detailsSourceKey, llmContext);
      await this.updateJobLegacySource(jobId, detailsSource, 'core_extraction');
      await transitionJobStatus(jobId, 'extracting', {
        startedAt: job.started_at || new Date(),
        processingPhase: 'core_extraction',
        message: 'Extracting core funding call details',
      });

      if (!detailsSource.normalized_text) {
        throw new Error('No source content available for extraction');
      }

      const extractionResult = detailsSource.input_type === 'json'
        ? (() => {
            const parsed = parseFundingJsonUpload(detailsSource.raw_text || detailsSource.normalized_text);
            const prepared = prepareFundingJsonIntake(parsed);
            return {
              payload: prepared.payload,
              extractorModel: FUNDING_JSON_UPLOAD_EXTRACTOR_MODEL,
              extractorVersion: FUNDING_JSON_UPLOAD_EXTRACTOR_VERSION,
              promptVersion: prepared.metadata.prompt_version || FUNDING_JSON_UPLOAD_PROMPT_VERSION,
              validationErrors: [],
            };
          })()
        : await extractFundingOpportunity(detailsSource.normalized_text, llmContext);
      const latestState = await getJobForProcessing(jobId);
      if (!latestState || latestState.status === 'canceled') {
        return;
      }

      await createExtractionAttempt(jobId, extractionResult.payload, extractionResult);
      const duplicateStatus = await computeDuplicateCandidates(
        jobId,
        extractionResult.payload,
        detailsSource.source_url,
        readFetchedUrl(detailsSource.fetch_metadata_json),
        operator,
        latestState.linked_funding_call_id
      );

      const latestJob = await getJobForProcessing(jobId);
      if (!latestJob || latestJob.status === 'canceled') {
        return;
      }

      const batchFlags = readBatchFlags(latestJob.fetch_metadata_json);
      if (latestJob.batch_id && batchFlags.autoCreateDraft && duplicateStatus === 'none') {
        const draftValues = normalizeDraftInput(buildDraftValuesFromExtraction(extractionResult.payload, {
          sourceUrl: detailsSource.source_url,
          fetchedUrl: readFetchedUrl(detailsSource.fetch_metadata_json),
        }));
        const requiredFieldsRemaining = buildDraftRequiredFields(draftValues);

        if (requiredFieldsRemaining.length === 0) {
          const latestExtraction = await getLatestExtraction(jobId);
          const detailsJob = makeJobLikeFromSource(latestJob, detailsSource);
          const fundingCall = await persistDraft(detailsJob, draftValues, operator, latestExtraction);

          await transitionJobStatus(jobId, 'extracting', {
            actorUserId: operator.userId,
            duplicateStatus,
            linkedFundingCallId: fundingCall.id,
            processingPhase: batchFlags.extractAll ? 'extracting_guidelines_template' : 'draft_created',
            message: batchFlags.extractAll
              ? 'Draft funding call saved; extracting guidelines and template'
              : 'Draft funding call saved',
          });

          let extractAllResult: Record<string, unknown> | null = null;
          if (batchFlags.extractAll) {
            const guidelineKey = latestJob.guidelines_source_key || detailsSourceKey;
            const templateKey = latestJob.template_source_key || detailsSourceKey;
            const guidelineSourcePromise = guidelineKey === detailsSource.source_key
              ? Promise.resolve(detailsSource)
              : this.prepareSourceByKey(latestJob, guidelineKey, llmContext);
            const templateSourcePromise = templateKey === detailsSource.source_key
              ? Promise.resolve(detailsSource)
              : this.prepareSourceByKey(latestJob, templateKey, llmContext);
            const [guidelineSource, templateSource] = await Promise.all([guidelineSourcePromise, templateSourcePromise]);

            extractAllResult = await this.runExtractAllForFundingCall(detailsJob, fundingCall.id, operator, {
              guidelineSource,
              templateSource,
            });

            await recordJobEvent(jobId, 'extracting', 'batch_extract_all_completed', {
              actorUserId: operator.userId,
              previousStatus: 'extracting',
              message: JSON.stringify(extractAllResult),
            });
          }

          await transitionJobStatus(jobId, 'draft_created', {
            actorUserId: operator.userId,
            duplicateStatus,
            linkedFundingCallId: fundingCall.id,
            completedAt: new Date(),
            processingPhase: 'draft_created',
            message: 'Batch funding intake job completed',
            expectedStatuses: ['queued', 'fetching', 'extracting'],
          });
          if (batchFlags.autoPublish) {
            await this.maybeAutoPublishBatchDraft(jobId, fundingCall.id, operator);
          }
          await this.maybeUpdateBatchStatus(latestJob.batch_id);
          return;
        }
      }

      await transitionJobStatus(jobId, 'needs_review', {
        duplicateStatus,
        completedAt: new Date(),
        processingPhase: 'needs_review',
        message: 'Extraction completed and awaiting curator review',
        expectedStatuses: ['queued', 'fetching', 'extracting'],
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const retryAfterMs = Number((error as any)?.retryAfterMs);
      const retryAfterText = Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? ` Retry after about ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
        : ' Retry in about a minute.';
      const isRateLimited = (
        (error instanceof Error && error.name === 'GeminiRateLimitError')
        || (typeof (error as any)?.code === 'string' && (error as any).code === 'GEMINI_RATE_LIMITED')
        || (/429/.test(rawMessage) && /(resource exhausted|too many requests|rate limit|quota)/i.test(rawMessage))
      );
      const message = isRateLimited
        ? `LLM rate limit reached while extracting this funding call.${retryAfterText}`
        : rawMessage;
      const errorCode = error instanceof Error && error.name === 'pdf_intake_requires_gemini'
        ? 'pdf_intake_requires_gemini'
        : isRateLimited
          ? 'LLM_RATE_LIMITED'
          : 'PROCESSING_FAILED';

      if (isRateLimited) {
        console.warn(`[Funding Intake] LLM rate limited for job ${jobId}: ${rawMessage}`);
      }

      const shouldRetry = isRateLimited && job.retry_count < MAX_RATE_LIMIT_RETRIES;
      if (shouldRetry) {
        const retryDelayMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? Math.min(retryAfterMs, 15 * 60 * 1000)
          : 60_000;
        const nextAttemptAt = new Date(Date.now() + retryDelayMs);
        const requeued = await transitionJobStatus(jobId, 'queued', {
          errorCode,
          errorMessage: message,
          completedAt: null,
          processingPhase: 'rate_limit_retry',
          message: `${message} Automatically retrying at ${nextAttemptAt.toISOString()}.`,
          nextAttemptAt,
          releaseLock: true,
          incrementRetryCount: true,
          expectedStatuses: ['queued', 'fetching', 'extracting'],
        });
        if (requeued) {
          const timer = setTimeout(() => this.enqueue(jobId), retryDelayMs);
          timer.unref?.();
        }
      } else {
        await transitionJobStatus(jobId, 'failed', {
          errorCode,
          errorMessage: message,
          completedAt: new Date(),
          processingPhase: 'failed',
          message,
          expectedStatuses: ['queued', 'fetching', 'extracting'],
        });
      }
    } finally {
      await stopHeartbeat();
      const latestJob = await prisma.fundingIntakeJob.findUnique({
        where: { id: jobId },
        select: { batch_id: true },
      });
      await this.maybeUpdateBatchStatus(latestJob?.batch_id);
    }
  }
}

export const fundingIntakeService = new FundingIntakeService();
