// @ts-nocheck
import fs from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import type {
  FundingCallStatus,
  FundingDuplicateResolution,
  FundingDuplicateStatus,
  FundingInputType,
  FundingIntakeJobStatus,
} from '@prisma/client';
import prisma from '../prisma';
import { fundingGuidelineService } from '../fundingGuidelines/service';
import { fundingTemplateService } from '../fundingTemplates/service';
import { fundingCatalogService } from '../services/fundingCatalogService';
import {
  ACTIVE_IDEMPOTENT_STATUSES,
  DRAFT_MINIMUM_FIELDS,
} from './constants';
import { extractCanonicalTextFromPdf, extractFundingOpportunity } from './extractor';
import type {
  DuplicateCandidateSummary,
  DomainDuplicateCandidateSummary,
  FundingDraftValues,
  FundingExtractionPayload,
  IntakeDuplicateResolutionInput,
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
const activeJobPromises = new Map<string, Promise<void>>();
const INTAKE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'funding-intake');
const TEMPLATE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'funding-templates');

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
  await fs.copyFile(file.tempFilePath, destinationPath);
  return destinationPath;
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

  const metadata = readCatalogMetadata(call.metadata);
  const lastCatalogUpdateAt = toTimestamp(metadata.last_catalog_update_at);

  if (lastCatalogUpdateAt && guidelineEditedAt && lastCatalogUpdateAt > guidelineEditedAt) {
    warnings.push({
      code: 'guidelines_stale',
      message: 'The funding call fields changed after the current guideline pack was last edited. Re-extract or review guidelines before publishing.',
    });
  }

  if (lastCatalogUpdateAt && templateEditedAt && lastCatalogUpdateAt > templateEditedAt) {
    warnings.push({
      code: 'template_stale',
      message: 'The funding call fields changed after the current template was last edited. Re-extract or review the template before publishing.',
    });
  }

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
    fetchMetadataJson?: Record<string, unknown> | null;
    rawText?: string | null;
    normalizedText?: string | null;
  }
) {
  const existing = await prisma.fundingIntakeJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  const previousStatus = existing?.status || null;

  await prisma.fundingIntakeJob.update({
    where: { id: jobId },
    data: {
      status: nextStatus,
      error_code: options?.errorCode ?? undefined,
      error_message: options?.errorMessage ?? undefined,
      started_at: options?.startedAt ?? undefined,
      completed_at: options?.completedAt ?? undefined,
      duplicate_status: options?.duplicateStatus ?? undefined,
      linked_funding_call_id: options?.linkedFundingCallId ?? undefined,
      fetch_metadata_json:
        options?.fetchMetadataJson === null
          ? Prisma.JsonNull
          : (options?.fetchMetadataJson as Prisma.InputJsonValue | undefined),
      raw_text: options?.rawText ?? undefined,
      normalized_text: options?.normalizedText ?? undefined,
    },
  });

  await recordJobEvent(jobId, nextStatus, 'status_transition', {
    actorUserId: options?.actorUserId,
    previousStatus,
    message: options?.message,
  });
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
  operator: IntakeOperator
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
  operator: IntakeOperator
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
  const deterministicDraftValues = {
    ...draftValues,
    official_urls: buildDraftValuesFromExtraction(latestExtraction?.extracted_json as any, {
      sourceUrl: job.source_url || null,
      fetchedUrl: readFetchedUrl(job.fetch_metadata_json),
    }).official_urls,
  };
  const sharedData = {
    status: mapCatalogStatusToFundingStatus('DRAFT'),
    catalog_status: 'DRAFT' as FundingCallStatus,
    visibility: operator.role === 'USER' ? 'TENANT_PRIVATE' : 'GLOBAL_PUBLISHED',
    tenantId: operator.role === 'USER' ? operator.tenantId || null : null,
    title: deterministicDraftValues.scheme_title || deterministicDraftValues.agency_name || job.source_url || 'Untitled funding call',
    agencyName: deterministicDraftValues.agency_name || null,
    sourceUrl: job.source_url || null,
    summary: deterministicDraftValues.description || null,
    sourceType: job.input_type === 'pdf' ? 'FILE' : job.input_type.toUpperCase(),
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
      owner_user_id: operator.role === 'USER' ? operator.userId : null,
      user_import: operator.role === 'USER'
        ? {
            owner_user_id: operator.userId,
            user_email: operator.email,
            verification_status: 'pending_admin_verification',
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
  async createJob(operator: IntakeOperator, input: IntakeSubmitInput) {
    if (input.inputType === 'url') {
      if (!input.sourceUrl) {
        throw new Error('sourceUrl is required for URL intake');
      }
      await assertSafePublicHttpsUrl(normalizeUrl(input.sourceUrl));
    }

    if (input.inputType === 'text') {
      if (!input.sourceText || normalizeWhitespace(input.sourceText).length < 80) {
        throw new Error('sourceText must contain meaningful content');
      }
    }

    if (input.inputType === 'pdf') {
      if (!input.sourceFile) {
        throw new Error('PDF file is required for PDF intake');
      }
    }

    const canonicalSource = input.inputType === 'url'
      ? normalizeUrl(input.sourceUrl!)
      : input.inputType === 'text'
        ? normalizeMultilineText(input.sourceText || '')
        : input.sourceFile?.checksum || '';
    const sourceHash = input.inputType === 'pdf'
      ? String(input.sourceFile?.checksum || '')
      : hashText(canonicalSource);

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
      return existingJob;
    }

    const storedPdfPath = input.inputType === 'pdf' && input.sourceFile
      ? await storeUploadedPdf(input.sourceFile)
      : null;
    const pdfMetadata = input.inputType === 'pdf' && input.sourceFile
      ? {
          original_name: input.sourceFile.originalName,
          mime: input.sourceFile.mimeType,
          bytes: input.sourceFile.size,
          checksum: input.sourceFile.checksum,
        }
      : null;

    const job = await prisma.fundingIntakeJob.create({
      data: {
        submitted_by_user_id: operator.userId,
        input_type: input.inputType,
        source_url: input.inputType === 'url' ? normalizeUrl(input.sourceUrl!) : null,
        source_text_hash: sourceHash,
        source_file_path: storedPdfPath,
        operator_notes: input.operatorNotes?.trim() || null,
        raw_text: input.inputType === 'text' ? input.sourceText || null : null,
        normalized_text: input.inputType === 'text' ? normalizeMultilineText(input.sourceText || '') : null,
        fetch_metadata_json: pdfMetadata ? (pdfMetadata as any) : undefined,
        status: 'queued',
      },
    });

    await recordJobEvent(job.id, 'queued', 'job_created', {
      actorUserId: operator.userId,
      previousStatus: null,
      message: 'Funding intake job created',
    });

    this.enqueue(job.id);
    return job;
  }

  enqueue(jobId: string) {
    if (activeJobPromises.has(jobId)) {
      return;
    }

    const promise = (async () => {
      try {
        await this.processJob(jobId);
      } finally {
        activeJobPromises.delete(jobId);
      }
    })();

    activeJobPromises.set(jobId, promise);
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
            select: { id: true, catalog_status: true },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((user) => [user.id, user]));
    const linkedCallStatusMap = new Map(linkedCalls.map((call) => [call.id, readCatalogStatus(call)]));

    return jobs.map((job) => ({
      ...job,
      source_url: job.source_url || null,
      linked_funding_call_id: job.linked_funding_call_id || null,
      linked_call_status: job.linked_funding_call_id ? linkedCallStatusMap.get(job.linked_funding_call_id) || null : null,
      submitted_by: userMap.get(job.submitted_by_user_id) || null,
    }));
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

    const [latestExtraction, duplicates, events, catalogDetails, guidelineBundle, templateBundle, submitter] = await Promise.all([
      getLatestExtraction(jobId),
      prisma.fundingIntakeDuplicate.findMany({
        where: { job_id: jobId },
        orderBy: [{ match_score: 'desc' }, { created_at: 'asc' }],
      }),
      prisma.fundingIntakeJobEvent.findMany({
        where: { job_id: jobId },
        orderBy: { created_at: 'asc' },
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
          duplicateOperator
        )
      : [];

    const publishWarnings = buildPublishWarnings({
      call: fundingCall,
      guidelineBundle,
      templateBundle,
    });
    const draftingReadiness = buildDraftingReadiness(fundingCall);

    return {
      job,
      submitter,
      extraction: latestExtraction,
      draft: fundingCall,
      draftValues: catalogDetails?.draftValues || buildDraftValuesFromExtraction(latestExtraction?.extracted_json as any, {
        sourceUrl: job.source_url,
        fetchedUrl: readFetchedUrl(job.fetch_metadata_json),
      }),
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

  async retryJob(jobId: string, operator: IntakeOperator) {
    const job = await prisma.fundingIntakeJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Funding intake job not found');
    }

    if (job.status !== 'failed') {
      throw new Error('Only failed jobs can be retried');
    }

    await prisma.fundingIntakeJob.update({
      where: { id: jobId },
      data: {
        status: 'queued',
        error_code: null,
        error_message: null,
        completed_at: null,
        started_at: null,
        retry_count: { increment: 1 },
      },
    });

    await recordJobEvent(jobId, 'queued', 'retry_requested', {
      actorUserId: operator.userId,
      previousStatus: job.status,
      message: 'Funding intake job retried',
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
      message: 'Funding intake job canceled',
    });
  }

  private async runExtractAllForFundingCall(job: any, fundingCallId: string, operator: IntakeOperator) {
    let guidelineStatus: string | null = null;
    let guidelineRunId: string | null = null;
    let guidelineExtractionError: string | null = null;
    let templateStatus: string | null = null;
    let templateRunId: string | null = null;
    let templateAssetId: string | null = null;
    let templateExtractionError: string | null = null;

    try {
      const guidelineRun = await fundingGuidelineService.createExtractionRunFromFundingCall(fundingCallId, operator);
      guidelineStatus = guidelineRun?.status || null;
      guidelineRunId = guidelineRun?.id || null;
    } catch (error) {
      guidelineExtractionError = error instanceof Error ? error.message : String(error);
      console.error('[Funding Intake] guideline extraction failed:', error);
    }

    try {
      const autoAsset = await fundingTemplateService.upsertAutoManagedAssetFromIntakeSource(fundingCallId, job, operator);
      templateAssetId = autoAsset.id;
      const templateRun = await fundingTemplateService.createExtractionRun(fundingCallId, operator, [autoAsset.id]);
      templateStatus = templateRun?.status || null;
      templateRunId = templateRun?.id || null;
    } catch (error) {
      templateExtractionError = error instanceof Error ? error.message : String(error);
      console.error('[Funding Intake] template extraction failed:', error);
    }

    return {
      guidelineStatus,
      guidelineRunId,
      guidelineExtractionError,
      templateStatus,
      templateRunId,
      templateAssetId,
      templateExtractionError,
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

    return this.runExtractAllForFundingCall(details.job, details.job.linked_funding_call_id, operator);
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

    if (!['needs_review', 'draft_created'].includes(details.job.status)) {
      throw new Error('Draft can only be saved after extraction reaches review stage');
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
      message: 'Draft funding call saved',
    });

    const extractAllResult = extractAll
      ? await this.runExtractAllForFundingCall(details.job, fundingCall.id, operator)
      : {
          guidelineStatus: null,
          guidelineRunId: null,
          guidelineExtractionError: null,
          templateStatus: null,
          templateRunId: null,
          templateAssetId: null,
          templateExtractionError: null,
        };

    return {
      ok: true,
      fundingCallId: fundingCall.id,
      requiredFieldsRemaining: [],
      duplicateResolutionState: details.duplicates.length > 0 ? 'resolved' : details.job.duplicate_status,
      extractAllTriggered: extractAll,
      ...extractAllResult,
    };
  }

  async processJob(jobId: string) {
    const job = await getJobForProcessing(jobId);
    if (!job || job.status === 'canceled' || !allowedTransitionTarget(job.status)) {
      return;
    }

    try {
      let rawText = job.raw_text || '';
      let normalizedText = job.normalized_text || '';
      let fetchMetadata = job.fetch_metadata_json as Record<string, unknown> | null;

      if (job.input_type === 'url') {
        await transitionJobStatus(jobId, 'fetching', {
          startedAt: job.started_at || new Date(),
          message: 'Fetching source URL',
        });

        const fetched = await fetchReadableUrlContent(job.source_url!);
        rawText = fetched.rawText;
        normalizedText = fetched.normalizedText;
        fetchMetadata = fetched.fetchMetadata;

        const refreshed = await getJobForProcessing(jobId);
        if (!refreshed || refreshed.status === 'canceled') {
          return;
        }

        await transitionJobStatus(jobId, 'extracting', {
          startedAt: refreshed.started_at || job.started_at || new Date(),
          rawText,
          normalizedText,
          fetchMetadataJson: fetchMetadata,
          message: 'Source content fetched successfully',
        });
      } else if (job.input_type === 'text') {
        rawText = job.raw_text || '';
        normalizedText = job.normalized_text || normalizeMultilineText(rawText);
        await transitionJobStatus(jobId, 'extracting', {
          startedAt: job.started_at || new Date(),
          rawText,
          normalizedText,
          message: 'Processing text submission',
        });
      } else if (job.input_type === 'pdf') {
        if (!job.source_file_path) {
          throw new Error('No stored PDF file is available for this intake job');
        }

        await transitionJobStatus(jobId, 'extracting', {
          startedAt: job.started_at || new Date(),
          message: 'Transcribing PDF source',
        });

        const pdfExtraction = await extractCanonicalTextFromPdf(job.source_file_path);
        rawText = pdfExtraction.rawText;
        normalizedText = pdfExtraction.normalizedText;
        fetchMetadata = {
          ...(fetchMetadata || {}),
          pdf_transcription: {
            extractor_model: pdfExtraction.extractorModel,
            warnings: pdfExtraction.warnings,
            source_file_path: job.source_file_path,
          },
        };

        await transitionJobStatus(jobId, 'extracting', {
          startedAt: job.started_at || new Date(),
          rawText,
          normalizedText,
          fetchMetadataJson: fetchMetadata,
          message: 'PDF source transcribed successfully',
        });
      } else {
        throw new Error('Unsupported intake input type');
      }

      if (!normalizedText) {
        throw new Error('No source content available for extraction');
      }

      const extractionResult = await extractFundingOpportunity(normalizedText);
      const latestState = await getJobForProcessing(jobId);
      if (!latestState || latestState.status === 'canceled') {
        return;
      }

      await createExtractionAttempt(jobId, extractionResult.payload, extractionResult);
      const submitter = await prisma.user.findUnique({
        where: { id: job.submitted_by_user_id },
        select: { id: true, email: true, roles: true },
      });
      const duplicateStatus = await computeDuplicateCandidates(
        jobId,
        extractionResult.payload,
        job.source_url,
        readFetchedUrl(fetchMetadata),
        {
          userId: submitter?.id || job.submitted_by_user_id,
          email: submitter?.email || '',
          role: deriveOperatorRoleFromUser(submitter),
        }
      );

      await transitionJobStatus(jobId, 'needs_review', {
        duplicateStatus,
        completedAt: new Date(),
        message: 'Extraction completed and awaiting curator review',
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

      await transitionJobStatus(jobId, 'failed', {
        errorCode,
        errorMessage: message,
        completedAt: new Date(),
        message,
      });
    }
  }
}

export const fundingIntakeService = new FundingIntakeService();
