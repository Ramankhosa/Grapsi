import crypto from 'crypto';
import type { DeepAnalysisStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { blueprintService, type BlueprintWithSectionPlan } from './blueprint-service';
import {
  BATCH_MAPPING_CHUNK_SIZE,
  DEEP_ANALYSIS_LABELS,
  DEFAULT_EXTRACTION_CONCURRENCY,
  MAX_DEEP_ANALYSIS_CONCURRENCY,
  MAX_CARD_PAGE_SIZE,
  REFERENCE_ARCHETYPES,
  type DeepAnalysisLabel,
  type ExtractedCardWithIdentity,
  type EvidenceConfidenceLevel,
  type ReferenceArchetype,
} from './deep-analysis-types';
import { textPreparationService } from './text-preparation-service';
import { evidenceExtractionService } from './evidence-extraction-service';
import { quoteVerificationService } from './quote-verification-service';
import { evidenceMappingService, type CardDimensionMapping } from './evidence-mapping-service';
import type { TenantContext } from '../metering';

interface StartBatchOptions {
  concurrency?: number;
  tenantContext?: TenantContext | null;
  allowTextFallback?: boolean;
}

export interface DeepAnalysisStartJobSummary {
  jobId: string;
  citationId: string;
  citationKey: string;
  depthLabel: string;
  status: DeepAnalysisStatus;
}

export interface DeepAnalysisStartResult {
  batchId: string;
  jobsCreated: number;
  estimatedSeconds: number;
  jobs: DeepAnalysisStartJobSummary[];
  skipped?: Array<{
    citationId: string;
    citationKey: string;
    reason: string;
  }>;
}

export interface DeepAnalysisStatusResult {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'PARTIAL';
  totalJobs: number;
  completed: number;
  failed: number;
  inProgress: number;
  totalCardsExtracted: number;
  totalMappingsCreated: number;
  startedAt: string | null;
  estimatedSecondsRemaining: number | null;
  jobs: Array<{
    jobId: string;
    citationId: string;
    citationKey: string;
    status: DeepAnalysisStatus;
    cardsExtracted: number | null;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export interface EvidenceCardsQuery {
  view?: 'paper' | 'dimension' | 'section';
  citationId?: string;
  sectionKey?: string;
  dimension?: string;
  claimType?: string;
  confidence?: string;
  verified?: boolean;
  page?: number;
  limit?: number;
}

export interface DeepAnalysisCandidate {
  citationId: string;
  citationKey: string;
  title: string;
  depthLabel: Exclude<DeepAnalysisLabel, 'LIT_ONLY'>;
  referenceArchetype: ReferenceArchetype;
  deepAnalysisStatus: string | null;
  evidenceCardCount: number;
  ready: boolean;
  readinessReason: string | null;
  documentId: string | null;
  referenceId: string | null;
  parserCandidate: 'PDFJS' | 'GROBID' | 'REGEX_FALLBACK' | null;
}

export interface DeepAnalysisCandidatesResult {
  ready: DeepAnalysisCandidate[];
  notReady: DeepAnalysisCandidate[];
  totalEligible: number;
}

interface CoverageSummary {
  totalDimensions: number;
  coveredDimensions: number;
  gaps: string[];
  underSupported: string[];
}

const ACTIVE_STATUSES: DeepAnalysisStatus[] = ['PENDING', 'PREPARING', 'EXTRACTING', 'MAPPING'];
const RECOVERABLE_STALE_STATUSES: DeepAnalysisStatus[] = ['PREPARING', 'EXTRACTING', 'MAPPING'];
const CANCELLATION_ERROR = 'Cancelled by user';
const STALE_JOB_RECOVERY_MS = 5 * 60 * 1000;
const STALE_JOB_WARNING = 'Job was auto-requeued after worker interruption';
const MAPPING_POLL_INTERVAL_MS = 1_200;
const MAPPING_FAST_LOOP_MS = 120;

const LABEL_SET = new Set<string>(DEEP_ANALYSIS_LABELS);
const ARCHETYPE_SET = new Set<string>(REFERENCE_ARCHETYPES);

const normalizeDoi = (value?: string | null): string => {
  if (!value || typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:/, '')
    .replace(/\s+/g, '');
};

const normalizeTitle = (value?: string | null): string => {
  if (!value || typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

function normalizeArchetype(value: unknown): ReferenceArchetype {
  const candidate = String(value || '').trim().toUpperCase();
  return ARCHETYPE_SET.has(candidate)
    ? (candidate as ReferenceArchetype)
    : 'SYSTEM_ALGO_EVALUATION';
}

function normalizeDepthLabel(value: unknown): DeepAnalysisLabel {
  const candidate = String(value || '').trim().toUpperCase();
  return LABEL_SET.has(candidate)
    ? (candidate as DeepAnalysisLabel)
    : 'LIT_ONLY';
}

function estimateDepthLabelFromCitation(citation: any): DeepAnalysisLabel {
  const explicit = normalizeDepthLabel(citation.deepAnalysisLabel || (citation.aiMeta as any)?.deepAnalysisRecommendation);
  if (explicit !== 'LIT_ONLY') {
    return explicit;
  }

  const score = Number((citation.aiMeta as any)?.relevanceScore || 0);
  if (score >= 85) return 'DEEP_ANCHOR';
  if (score >= 65) return 'DEEP_SUPPORT';
  if (score >= 45) return 'DEEP_STRESS_TEST';
  return 'LIT_ONLY';
}

function estimateArchetypeFromCitation(citation: any): ReferenceArchetype {
  const aiMetaArchetype = citation?.aiMeta && typeof citation.aiMeta === 'object'
    ? String((citation.aiMeta as any).referenceArchetype || '').trim().toUpperCase()
    : '';

  if (ARCHETYPE_SET.has(aiMetaArchetype)) {
    return aiMetaArchetype as ReferenceArchetype;
  }

  const corpus = [
    citation?.title,
    citation?.abstract,
    citation?.venue,
    citation?.sourceType,
    citation?.aiMeta && typeof citation.aiMeta === 'object'
      ? JSON.stringify(citation.aiMeta)
      : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!corpus) {
    return 'POSITION_CONCEPTUAL';
  }

  if (/\b(systematic review|meta-analys(?:is|es)|scoping review|literature review|review article)\b/.test(corpus)) {
    return 'SYNTHESIS_REVIEW';
  }

  if (/\b(mixed methods?|multi[-\s]?method|triangulation|qualitative and quantitative)\b/.test(corpus)) {
    return 'MIXED_METHODS_APPLIED_STUDY';
  }

  if (/\b(randomized|randomised|control group|intervention|placebo|double blind|trial)\b/.test(corpus)) {
    return 'CONTROLLED_EXPERIMENTAL_STUDY';
  }

  if (/\b(observational|cohort|cross[-\s]?sectional|longitudinal|case[-\s]?control|regression|odds ratio|hazard ratio|survey)\b/.test(corpus)) {
    return 'EMPIRICAL_OBSERVATIONAL_STUDY';
  }

  if (/\b(algorithm|model|dataset|benchmark|baseline|accuracy|auc|f1|ablation|architecture)\b/.test(corpus)) {
    return 'SYSTEM_ALGO_EVALUATION';
  }

  if (/\b(theory|theoretical|conceptual|framework|normative|philosoph|discourse|hermeneutic)\b/.test(corpus)) {
    return 'POSITION_CONCEPTUAL';
  }

  return 'POSITION_CONCEPTUAL';
}

function rankConfidence(value: EvidenceConfidenceLevel): number {
  if (value === 'HIGH') return 3;
  if (value === 'MEDIUM') return 2;
  return 1;
}

function clampConcurrency(value?: number): number {
  const parsed = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_EXTRACTION_CONCURRENCY;
  return Math.max(1, Math.min(MAX_DEEP_ANALYSIS_CONCURRENCY, parsed || DEFAULT_EXTRACTION_CONCURRENCY || MAX_DEEP_ANALYSIS_CONCURRENCY));
}

function nowIso(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isCancelledError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as any).code === 'CANCELLED'
  );
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.min(limit, items.length);
  let cursor = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Persist runner tracking across Next.js HMR reloads in dev mode
const globalForRunners = globalThis as unknown as {
  __deepAnalysisActiveRunners?: Map<string, Promise<void>>;
};
if (!globalForRunners.__deepAnalysisActiveRunners) {
  globalForRunners.__deepAnalysisActiveRunners = new Map<string, Promise<void>>();
}

class DeepAnalysisService {
  private get activeRunners(): Map<string, Promise<void>> {
    return globalForRunners.__deepAnalysisActiveRunners!;
  }

  private runnerKey(sessionId: string, batchId: string): string {
    return `${sessionId}:${batchId}`;
  }

  private triggerBatch(
    sessionId: string,
    batchId: string,
    jobIds: string[],
    options: { concurrency: number; tenantContext?: TenantContext | null; allowTextFallback?: boolean },
    source: 'start' | 'retry' | 'status'
  ): void {
    const ids = Array.from(new Set(jobIds.map(id => String(id || '').trim()).filter(Boolean)));
    if (ids.length === 0) return;

    const key = this.runnerKey(sessionId, batchId);
    if (this.activeRunners.has(key)) return;

    const runner = this.runBatch(sessionId, batchId, ids, options)
      .catch(error => {
        console.error(`[DeepAnalysis] ${source} batch failed:`, error);
      })
      .finally(() => {
        this.activeRunners.delete(key);
      });

    this.activeRunners.set(key, runner);
  }

  private async recoverStaleJobs(sessionId: string): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_JOB_RECOVERY_MS);
    const staleJobs = await prisma.deepAnalysisJob.findMany({
      where: {
        sessionId,
        status: { in: RECOVERABLE_STALE_STATUSES },
        updatedAt: { lt: staleBefore },
      },
      select: {
        id: true,
        citationId: true,
      },
    });

    if (staleJobs.length === 0) {
      return;
    }

    const staleJobIds = staleJobs.map(job => job.id);
    const citationIds = Array.from(new Set(staleJobs.map(job => job.citationId)));

    await prisma.$transaction(async tx => {
      await tx.deepAnalysisJob.updateMany({
        where: {
          id: { in: staleJobIds },
          status: { in: RECOVERABLE_STALE_STATUSES },
        },
        data: {
          status: 'PENDING',
          startedAt: null,
          completedAt: null,
          error: null,
          warning: STALE_JOB_WARNING,
        },
      });

      await tx.citation.updateMany({
        where: {
          id: { in: citationIds },
        },
        data: {
          deepAnalysisStatus: 'PENDING',
        },
      });
    });
  }

  private async triggerActiveBatches(
    sessionId: string,
    options: { concurrency: number; tenantContext?: TenantContext | null; allowTextFallback?: boolean }
  ): Promise<void> {
    const pendingJobs = await prisma.deepAnalysisJob.findMany({
      where: {
        sessionId,
        status: 'PENDING',
      },
      select: {
        id: true,
        batchId: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    if (pendingJobs.length === 0) {
      return;
    }

    const jobsByBatch = new Map<string, string[]>();
    for (const job of pendingJobs) {
      const batchId = job.batchId || `recovered_${sessionId}`;
      if (!jobsByBatch.has(batchId)) {
        jobsByBatch.set(batchId, []);
      }
      jobsByBatch.get(batchId)!.push(job.id);
    }

    jobsByBatch.forEach((jobIds, batchId) => {
      this.triggerBatch(sessionId, batchId, jobIds, options, 'status');
    });
  }

  private async throwIfJobCancelled(jobId: string): Promise<void> {
    const row = await prisma.deepAnalysisJob.findUnique({
      where: { id: jobId },
      select: { status: true, error: true },
    });

    if (!row) {
      const error = new Error('Deep analysis job not found');
      (error as any).code = 'JOB_NOT_FOUND';
      throw error;
    }

    if (row.status === 'FAILED' && String(row.error || '').includes(CANCELLATION_ERROR)) {
      const error = new Error('Deep analysis job was cancelled');
      (error as any).code = 'CANCELLED';
      throw error;
    }
  }

  private async getBlueprintContext(sessionId: string): Promise<{ blueprint: BlueprintWithSectionPlan | null; dimensions: string[] }> {
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint?.sectionPlan?.length) {
      return { blueprint: null, dimensions: [] };
    }

    const dimensions = Array.from(
      new Set(
        blueprint.sectionPlan.flatMap(section => Array.isArray(section.mustCover) ? section.mustCover : [])
      )
    );

    return { blueprint, dimensions };
  }

  private async ensureNoActiveRun(sessionId: string): Promise<void> {
    const activeCount = await prisma.deepAnalysisJob.count({
      where: {
        sessionId,
        status: { in: ACTIVE_STATUSES },
      },
    });

    if (activeCount > 0) {
      const error = new Error('Deep analysis already in progress');
      (error as any).code = 'ACTIVE_RUN';
      (error as any).activeCount = activeCount;
      throw error;
    }
  }

  private async getSessionUserId(sessionId: string): Promise<string> {
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    if (!session?.userId) {
      throw new Error('Drafting session not found');
    }

    return session.userId;
  }

  async startBatch(
    sessionId: string,
    citationIds: string[],
    options: StartBatchOptions = {}
  ): Promise<DeepAnalysisStartResult> {
    if (!citationIds.length) {
      throw new Error('No citation IDs were provided');
    }

    await this.ensureNoActiveRun(sessionId);
    const sessionUserId = await this.getSessionUserId(sessionId);

    const uniqueCitationIds = Array.from(new Set(citationIds.map(id => String(id || '').trim()).filter(Boolean)));
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        id: { in: uniqueCitationIds },
        isActive: true,
      },
      select: {
        id: true,
        citationKey: true,
        title: true,
        abstract: true,
        venue: true,
        sourceType: true,
        doi: true,
        year: true,
        authors: true,
        aiMeta: true,
        deepAnalysisLabel: true,
        libraryReferenceId: true,
      },
    });

    if (citations.length === 0) {
      throw new Error('No eligible citations found for deep analysis');
    }

    const batchId = crypto.randomUUID();
    const now = new Date();

    const jobs: DeepAnalysisStartJobSummary[] = [];
    const skipped: Array<{ citationId: string; citationKey: string; reason: string }> = [];

    const readinessMap = new Map<string, Awaited<ReturnType<typeof textPreparationService.checkCitationReadiness>>>();
    await runWithConcurrency(citations, 6, async (citation) => {
      const depthLabel = estimateDepthLabelFromCitation(citation);
      if (depthLabel === 'LIT_ONLY') {
        return;
      }

      const readiness = await textPreparationService.checkCitationReadiness(sessionId, {
        id: citation.id,
        doi: citation.doi,
        title: citation.title,
        year: citation.year,
        authors: citation.authors,
        libraryReferenceId: citation.libraryReferenceId,
      }, { userId: sessionUserId });
      readinessMap.set(citation.id, readiness);
    });

    await runWithConcurrency(citations, 6, async (citation) => {
      const depthLabel = estimateDepthLabelFromCitation(citation);
      const archetype = estimateArchetypeFromCitation(citation);

      if (depthLabel === 'LIT_ONLY') {
        return;
      }

      const readiness = readinessMap.get(citation.id);
      if (!readiness?.ready) {
        skipped.push({
          citationId: citation.id,
          citationKey: citation.citationKey,
          reason: readiness?.reason || 'No full text available',
        });
        await prisma.citation.update({
          where: { id: citation.id },
          data: {
            deepAnalysisStatus: 'FAILED',
            deepAnalysisLabel: depthLabel,
            evidenceCardCount: 0,
          },
        }).catch(() => undefined);
        return;
      }

      const textSource = readiness.textAvailable
        ? (readiness.parserCandidate || 'REGEX_FALLBACK')
        : 'NATIVE_PDF';

      const job = await prisma.deepAnalysisJob.upsert({
        where: {
          sessionId_citationId: {
            sessionId,
            citationId: citation.id,
          },
        },
        update: {
          batchId,
          status: 'PENDING',
          startedAt: null,
          completedAt: null,
          error: null,
          warning: null,
          referenceArchetype: archetype,
          deepAnalysisLabel: depthLabel,
          textSource,
          inputTokens: null,
          outputTokens: null,
          updatedAt: now,
        },
        create: {
          batchId,
          sessionId,
          citationId: citation.id,
          status: 'PENDING',
          referenceArchetype: archetype,
          deepAnalysisLabel: depthLabel,
          textSource,
        },
      });

      await Promise.all([
        prisma.evidenceCard.deleteMany({
          where: { jobId: job.id },
        }),
        prisma.citation.update({
          where: { id: citation.id },
          data: {
            deepAnalysisStatus: 'PENDING',
            deepAnalysisLabel: depthLabel,
            evidenceCardCount: 0,
          },
        }),
      ]);

      jobs.push({
        jobId: job.id,
        citationId: citation.id,
        citationKey: citation.citationKey,
        depthLabel,
        status: 'PENDING',
      });
    });

    const concurrency = clampConcurrency(options.concurrency);
    const estimatedSeconds = Math.max(10, Math.ceil(jobs.length / Math.max(1, concurrency / 3)) * 25);

    if (jobs.length > 0) {
      this.triggerBatch(
        sessionId,
        batchId,
        jobs.map(job => job.jobId),
        {
          concurrency,
          tenantContext: options.tenantContext || null,
          allowTextFallback: options.allowTextFallback === true,
        },
        'start'
      );
    }

    return {
      batchId,
      jobsCreated: jobs.length,
      estimatedSeconds,
      jobs,
      skipped,
    };
  }

  async getCandidates(sessionId: string): Promise<DeepAnalysisCandidatesResult> {
    const sessionUserId = await this.getSessionUserId(sessionId);
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true,
      },
      select: {
        id: true,
        citationKey: true,
        title: true,
        abstract: true,
        venue: true,
        sourceType: true,
        doi: true,
        year: true,
        authors: true,
        aiMeta: true,
        deepAnalysisLabel: true,
        deepAnalysisStatus: true,
        evidenceCardCount: true,
        libraryReferenceId: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const eligible = citations.filter(citation => {
      const label = estimateDepthLabelFromCitation(citation);
      return label === 'DEEP_ANCHOR' || label === 'DEEP_SUPPORT' || label === 'DEEP_STRESS_TEST';
    });

    const candidates: Array<DeepAnalysisCandidate | null> = await Promise.all(eligible.map(async citation => {
      const depthLabel = estimateDepthLabelFromCitation(citation);
      const archetype = estimateArchetypeFromCitation(citation);

      const readiness = await textPreparationService.checkCitationReadiness(sessionId, {
        id: citation.id,
        doi: citation.doi,
        title: citation.title,
        year: citation.year,
        authors: citation.authors,
        libraryReferenceId: citation.libraryReferenceId,
      }, { userId: sessionUserId }).catch(() => ({
        ready: false,
        reason: 'Unable to verify text readiness',
        referenceId: null,
        documentId: null,
        parserCandidate: null,
        textAvailable: false,
        hasAttachedSource: false,
      }));

      if (!readiness.hasAttachedSource) {
        return null;
      }

      return {
        citationId: citation.id,
        citationKey: citation.citationKey,
        title: citation.title,
        depthLabel: depthLabel as Exclude<DeepAnalysisLabel, 'LIT_ONLY'>,
        referenceArchetype: archetype,
        deepAnalysisStatus: citation.deepAnalysisStatus || null,
        evidenceCardCount: Number(citation.evidenceCardCount || 0),
        ready: Boolean(readiness.ready),
        readinessReason: readiness.reason || null,
        documentId: readiness.documentId || null,
        referenceId: readiness.referenceId || null,
        parserCandidate: readiness.parserCandidate || null,
      };
    }));

    const visibleCandidates = candidates.filter((candidate): candidate is DeepAnalysisCandidate => Boolean(candidate));

    const ready = visibleCandidates.filter(candidate => candidate.ready);
    const notReady = visibleCandidates.filter(candidate => !candidate.ready);

    return {
      ready,
      notReady,
      totalEligible: visibleCandidates.length,
    };
  }

  private async runBatch(
    sessionId: string,
    batchId: string,
    jobIds: string[],
    options: { concurrency: number; tenantContext?: TenantContext | null; allowTextFallback?: boolean }
  ): Promise<void> {
    const sessionUserId = await this.getSessionUserId(sessionId);
    const jobs = await prisma.deepAnalysisJob.findMany({
      where: {
        id: { in: jobIds },
        sessionId,
      },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
            title: true,
            doi: true,
            year: true,
            authors: true,
            aiMeta: true,
            libraryReferenceId: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const { blueprint, dimensions } = await this.getBlueprintContext(sessionId);

    let extractionDone = false;
    let mappingLoopPromise: Promise<void> | null = null;

    if (blueprint) {
      mappingLoopPromise = this.runIncrementalMappingLoop(
        sessionId,
        batchId,
        blueprint,
        options.tenantContext || null,
        () => extractionDone
      );
    }

    // Phase 1: Extract evidence cards for all jobs concurrently (no mapping)
    console.log(`[DeepAnalysis] Batch ${batchId}: starting extraction for ${jobs.length} jobs (concurrency=${options.concurrency})`);
    await runWithConcurrency(jobs, options.concurrency, async (job) => {
      await this.processJob(job, {
        batchId,
        dimensions,
        blueprint,
        sessionUserId,
        tenantContext: options.tenantContext || null,
        allowTextFallback: options.allowTextFallback === true,
      });
    });
    extractionDone = true;

    // Phase 2: ensure mapping loop drains all remaining jobs.
    if (mappingLoopPromise) {
      await mappingLoopPromise;
    } else {
      await this.finalizeJobsWithoutMapping(sessionId, batchId);
    }
  }

  private async runIncrementalMappingLoop(
    sessionId: string,
    batchId: string,
    blueprint: BlueprintWithSectionPlan,
    tenantContext: TenantContext | null,
    isExtractionDone: () => boolean
  ): Promise<void> {
    let consecutiveFailures = 0;

    while (true) {
      let processedInCycle = 0;
      try {
        processedInCycle = await this.batchMapExtractedCards(sessionId, batchId, blueprint, tenantContext);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[DeepAnalysis] Batch ${batchId}: incremental mapping loop error (${consecutiveFailures}):`, message);

        if (isExtractionDone() && consecutiveFailures >= 3) {
          throw error;
        }

        await sleep(MAPPING_POLL_INTERVAL_MS);
        continue;
      }

      if (isExtractionDone() && processedInCycle === 0) {
        break;
      }

      await sleep(processedInCycle > 0 ? MAPPING_FAST_LOOP_MS : MAPPING_POLL_INTERVAL_MS);
    }
  }

  private async batchMapExtractedCards(
    sessionId: string,
    batchId: string,
    blueprint: BlueprintWithSectionPlan,
    tenantContext: TenantContext | null
  ): Promise<number> {
    const mappingJobs = await prisma.deepAnalysisJob.findMany({
      where: { sessionId, batchId, status: 'MAPPING' },
      select: { id: true, citationId: true },
    });

    if (mappingJobs.length === 0) return 0;

    const jobIds = mappingJobs.map(j => j.id);
    const citationIds = Array.from(new Set(mappingJobs.map(j => j.citationId)));

    const cards = await prisma.evidenceCard.findMany({
      where: { jobId: { in: jobIds } },
      select: {
        id: true,
        citationId: true,
        citationKey: true,
        referenceArchetype: true,
        deepAnalysisLabel: true,
        claim: true,
        claimType: true,
        quantitativeDetail: true,
        conditions: true,
        comparableMetrics: true,
        doesNotSupport: true,
        scopeCondition: true,
        studyDesign: true,
        rigorIndicators: true,
        sourceFragment: true,
        pageHint: true,
        confidence: true,
        sourceSection: true,
        quoteVerified: true,
        quoteVerificationMethod: true,
        quoteVerificationScore: true,
      },
    });

    if (cards.length === 0) {
      await this.finalizeJobsWithoutMapping(sessionId, batchId);
      return mappingJobs.length;
    }

    console.log(`[DeepAnalysis] Batch ${batchId}: batch-mapping ${cards.length} cards from ${mappingJobs.length} jobs`);

    const identityCards: ExtractedCardWithIdentity[] = cards.map(card => ({
      cardId: card.id,
      citationId: card.citationId,
      citationKey: card.citationKey,
      referenceArchetype: normalizeArchetype(card.referenceArchetype),
      deepAnalysisLabel: normalizeDepthLabel(card.deepAnalysisLabel),
      claim: card.claim,
      claimType: card.claimType as any,
      quantitativeDetail: card.quantitativeDetail,
      conditions: card.conditions,
      comparableMetrics: (card.comparableMetrics || null) as any,
      doesNotSupport: card.doesNotSupport,
      scopeCondition: card.scopeCondition,
      studyDesign: card.studyDesign,
      rigorIndicators: card.rigorIndicators,
      sourceFragment: card.sourceFragment,
      pageHint: card.pageHint,
      confidence: card.confidence as any,
      sourceSection: card.sourceSection || 'unknown',
      quoteVerified: card.quoteVerified,
      quoteVerificationMethod: card.quoteVerificationMethod,
      quoteVerificationScore: card.quoteVerificationScore,
    }));

    let mappingWarnings: string[] = [];
    let allMappings: CardDimensionMapping[] = [];

    try {
      const mapped = await evidenceMappingService.batchMapMultipleCitations(
        identityCards,
        blueprint,
        tenantContext
      );
      allMappings = mapped.mappings;
      mappingWarnings = mapped.warnings;
      console.log(`[DeepAnalysis] Batch ${batchId}: batch mapping produced ${allMappings.length} mappings (warnings=${mappingWarnings.length})`);
    } catch (mappingError) {
      const message = mappingError instanceof Error ? mappingError.message : 'Unknown batch mapping error';
      mappingWarnings.push(`Batch mapping failed: ${message.slice(0, 400)}. Cards saved without mappings.`);
      console.error(`[DeepAnalysis] Batch ${batchId}: batch mapping failed:`, message);
    }

    await prisma.$transaction(async tx => {
      await tx.evidenceCardMapping.deleteMany({
        where: { card: { jobId: { in: jobIds } } },
      });

      if (allMappings.length > 0) {
        await tx.evidenceCardMapping.createMany({
          data: allMappings.map(mapping => ({
            cardId: mapping.cardId,
            sectionKey: mapping.sectionKey,
            dimension: mapping.dimension,
            useAs: mapping.useAs,
            mappingConfidence: mapping.mappingConfidence,
          })),
        });
      }

      const warningText = mappingWarnings.length > 0
        ? mappingWarnings.join(' | ').slice(0, 6000)
        : null;

      await tx.deepAnalysisJob.updateMany({
        where: { id: { in: jobIds }, status: 'MAPPING' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          ...(warningText ? { warning: warningText } : {}),
        },
      });

      await tx.citation.updateMany({
        where: { id: { in: citationIds } },
        data: { deepAnalysisStatus: 'COMPLETED' },
      });
    });

    return mappingJobs.length;
  }

  private async finalizeJobsWithoutMapping(
    sessionId: string,
    batchId: string
  ): Promise<void> {
    const mappingJobs = await prisma.deepAnalysisJob.findMany({
      where: { sessionId, batchId, status: 'MAPPING' },
      select: { id: true, citationId: true },
    });

    if (mappingJobs.length === 0) return;

    const jobIds = mappingJobs.map(j => j.id);
    const citationIds = Array.from(new Set(mappingJobs.map(j => j.citationId)));

    await prisma.$transaction(async tx => {
      await tx.deepAnalysisJob.updateMany({
        where: { id: { in: jobIds }, status: 'MAPPING' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      await tx.citation.updateMany({
        where: { id: { in: citationIds } },
        data: { deepAnalysisStatus: 'COMPLETED' },
      });
    });
  }

  private async processJob(
    job: any,
    context: {
      batchId: string;
      dimensions: string[];
      blueprint: BlueprintWithSectionPlan | null;
      sessionUserId: string;
      tenantContext?: TenantContext | null;
      allowTextFallback?: boolean;
    }
  ): Promise<void> {
    const jobId = job.id;

    try {
      const claim = await prisma.deepAnalysisJob.updateMany({
        where: {
          id: jobId,
          status: 'PENDING',
        },
        data: {
          status: 'PREPARING',
          startedAt: new Date(),
          error: null,
          warning: null,
          batchId: context.batchId,
        },
      });
      if (claim.count === 0) {
        return;
      }

      await this.throwIfJobCancelled(jobId);

      console.log(`[DeepAnalysis] Job ${jobId}: preparing text for citation ${job.citation.citationKey} (depth=${job.deepAnalysisLabel})`);

      const prepared = await textPreparationService.prepareForCitation(
        job.sessionId,
        {
          id: job.citation.id,
          doi: job.citation.doi,
          title: job.citation.title,
          year: job.citation.year,
          authors: job.citation.authors,
          libraryReferenceId: job.citation.libraryReferenceId,
        },
        normalizeDepthLabel(job.deepAnalysisLabel),
        { userId: context.sessionUserId }
      );

      console.log(
        `[DeepAnalysis] Job ${jobId}: input ready (source=${prepared.preparedText.source}, `
        + `tokens~${prepared.preparedText.estimatedTokens}, sections=${prepared.preparedText.sections?.length ?? 0}, `
        + `textAvailable=${prepared.textAvailable}, pdfAttached=${Boolean(prepared.pdfAttachment)})`
      );

      const movedToExtracting = await prisma.deepAnalysisJob.updateMany({
        where: {
          id: jobId,
          status: 'PREPARING',
        },
        data: {
          status: 'EXTRACTING',
          textSource: prepared.textAvailable ? prepared.preparedText.source : 'NATIVE_PDF',
        },
      });
      if (movedToExtracting.count === 0) {
        return;
      }

      console.log(`[DeepAnalysis] Job ${jobId}: sending to LLM for evidence extraction...`);

      const extracted = await evidenceExtractionService.extractCards({
        citationId: job.citation.id,
        citationKey: job.citation.citationKey,
        referenceArchetype: job.referenceArchetype,
        deepAnalysisLabel: job.deepAnalysisLabel,
        preparedText: prepared.preparedText,
        pdfAttachment: prepared.pdfAttachment,
        allowTextFallback: context.allowTextFallback === true,
        blueprintDimensions: context.dimensions,
        tenantContext: context.tenantContext || null,
      });

      console.log(`[DeepAnalysis] Job ${jobId}: extracted ${extracted.cards.length} cards (warnings=${extracted.warnings.length})`);
      if (extracted.warnings.length > 0) {
        console.log(`[DeepAnalysis] Job ${jobId} warnings: ${extracted.warnings.slice(0, 3).join('; ')}`);
      }

      await this.throwIfJobCancelled(jobId);

      const depthLabel = normalizeDepthLabel(job.deepAnalysisLabel);
      const verifyAgainst = depthLabel === 'DEEP_ANCHOR'
        ? (prepared.preparedText.rawFullText || prepared.preparedText.fullText)
        : prepared.preparedText.fullText;
      const canVerifyQuotes = prepared.textAvailable && typeof verifyAgainst === 'string' && verifyAgainst.trim().length > 0;
      const verifiedCards = canVerifyQuotes
        ? quoteVerificationService.verifyAllCards(extracted.cards, verifyAgainst)
        : extracted.cards.map(card => ({
          ...card,
          quoteVerified: false,
          quoteVerificationMethod: null,
          quoteVerificationScore: null,
        }));

      const cardIdentityRows: ExtractedCardWithIdentity[] = verifiedCards.map((card, index) => ({
        ...card,
        cardId: `card_${index}`,
        citationId: job.citation.id,
        citationKey: job.citation.citationKey,
        referenceArchetype: normalizeArchetype(job.referenceArchetype),
        deepAnalysisLabel: normalizeDepthLabel(job.deepAnalysisLabel),
      }));

      await this.throwIfJobCancelled(jobId);

      // Persist cards and set status to MAPPING (awaiting batch mapping phase).
      // Use a non-interactive transaction with createMany to avoid interactive-tx timeout under load.
      const currentJob = await prisma.deepAnalysisJob.findUnique({
        where: { id: jobId },
        select: { status: true, error: true },
      });

      if (!currentJob) {
        return;
      }

      if (currentJob.status === 'FAILED' && String(currentJob.error || '').includes(CANCELLATION_ERROR)) {
        return;
      }

      if (currentJob.status !== 'EXTRACTING') {
        return;
      }

      const warningParts = [...extracted.warnings];
      if (prepared.warning) {
        warningParts.push(prepared.warning);
      }
      if (!canVerifyQuotes) {
        warningParts.push('Quote verification skipped: parsed text unavailable; extracted from native PDF');
      }
      const cardCreateData = cardIdentityRows.map(card => ({
        jobId,
        sessionId: job.sessionId,
        citationId: job.citation.id,
        citationKey: job.citation.citationKey,
        referenceArchetype: card.referenceArchetype,
        deepAnalysisLabel: card.deepAnalysisLabel,
        sourceSection: card.sourceSection,
        claim: card.claim,
        claimType: card.claimType,
        quantitativeDetail: card.quantitativeDetail,
        conditions: card.conditions,
        comparableMetrics: card.comparableMetrics
          ? (card.comparableMetrics as Prisma.InputJsonValue)
          : undefined,
        doesNotSupport: card.doesNotSupport,
        scopeCondition: card.scopeCondition,
        studyDesign: card.studyDesign,
        rigorIndicators: card.rigorIndicators,
        sourceFragment: card.sourceFragment,
        pageHint: card.pageHint,
        quoteVerified: card.quoteVerified,
        quoteVerificationMethod: card.quoteVerificationMethod || null,
        quoteVerificationScore: card.quoteVerificationScore ?? null,
        confidence: card.confidence,
        extractedFrom: 'FULL_TEXT',
      }));

      const writes: Prisma.PrismaPromise<unknown>[] = [
        prisma.evidenceCard.deleteMany({
          where: { jobId },
        }),
      ];

      if (cardCreateData.length > 0) {
        writes.push(
          prisma.evidenceCard.createMany({
            data: cardCreateData,
          })
        );
      }

      writes.push(
        prisma.deepAnalysisJob.updateMany({
          where: {
            id: jobId,
            status: 'EXTRACTING',
          },
          data: {
            status: 'MAPPING',
            warning: warningParts.length > 0 ? warningParts.join(' | ').slice(0, 6000) : null,
            error: null,
            inputTokens: extracted.usage.inputTokens,
            outputTokens: extracted.usage.outputTokens,
          },
        }),
        prisma.citation.updateMany({
          where: {
            id: job.citation.id,
            deepAnalysisJobs: {
              some: {
                id: jobId,
                status: 'MAPPING',
              },
            },
          },
          data: {
            deepAnalysisStatus: 'MAPPING',
            deepAnalysisLabel: job.deepAnalysisLabel,
            evidenceCardCount: cardIdentityRows.length,
          },
        })
      );

      await prisma.$transaction(writes);

      console.log(`[DeepAnalysis] Job ${jobId}: extraction complete, ${cardIdentityRows.length} cards persisted (awaiting batch mapping)`);
    } catch (error) {
      if (isCancelledError(error)) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown deep analysis error';
      console.error(`[DeepAnalysis] Job ${jobId} (citation ${job.citation?.citationKey}) FAILED:`, message);
      if (error instanceof Error && error.stack) {
        console.error(`[DeepAnalysis] Stack:`, error.stack.split('\n').slice(0, 5).join('\n'));
      }
      const failedUpdate = await prisma.deepAnalysisJob.updateMany({
        where: {
          id: jobId,
          status: { in: ACTIVE_STATUSES },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: message.slice(0, 6000),
        },
      }).catch(() => ({ count: 0 }));

      if (failedUpdate.count > 0) {
        await prisma.citation.update({
          where: { id: job.citation.id },
          data: {
            deepAnalysisStatus: 'FAILED',
            deepAnalysisLabel: job.deepAnalysisLabel,
          },
        }).catch(() => undefined);
      }
    }
  }

  async stopActive(
    sessionId: string
  ): Promise<{ stoppedCount: number; jobs: Array<{ jobId: string; citationId: string; citationKey: string }> }> {
    const activeJobs = await prisma.deepAnalysisJob.findMany({
      where: {
        sessionId,
        status: { in: ACTIVE_STATUSES },
      },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
          },
        },
      },
    });

    if (activeJobs.length === 0) {
      return { stoppedCount: 0, jobs: [] };
    }

    const ids = activeJobs.map(job => job.id);
    const citationIds = Array.from(new Set(activeJobs.map(job => job.citationId)));

    await prisma.$transaction(async tx => {
      await tx.deepAnalysisJob.updateMany({
        where: {
          id: { in: ids },
          status: { in: ACTIVE_STATUSES },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: CANCELLATION_ERROR,
        },
      });

      await tx.citation.updateMany({
        where: {
          id: { in: citationIds },
        },
        data: {
          deepAnalysisStatus: 'FAILED',
        },
      });
    });

    return {
      stoppedCount: ids.length,
      jobs: activeJobs.map(job => ({
        jobId: job.id,
        citationId: job.citationId,
        citationKey: job.citation.citationKey,
      })),
    };
  }

  async getStatus(
    sessionId: string,
    options: { tenantContext?: TenantContext | null; concurrency?: number } = {}
  ): Promise<DeepAnalysisStatusResult> {
    const hasActiveRunner = Array.from(this.activeRunners.keys()).some(key => key.startsWith(`${sessionId}:`));
    if (!hasActiveRunner) {
      await this.recoverStaleJobs(sessionId);
      await this.triggerActiveBatches(sessionId, {
        concurrency: clampConcurrency(options.concurrency ?? DEFAULT_EXTRACTION_CONCURRENCY),
        tenantContext: options.tenantContext || null,
      });
    }

    const jobs = await prisma.deepAnalysisJob.findMany({
      where: { sessionId },
      include: {
        citation: {
          select: {
            id: true,
            citationKey: true,
          },
        },
        _count: {
          select: {
            cards: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const totalJobs = jobs.length;
    const completed = jobs.filter(job => job.status === 'COMPLETED').length;
    const failed = jobs.filter(job => job.status === 'FAILED').length;
    const inProgress = jobs.filter(job => ACTIVE_STATUSES.includes(job.status)).length;

    const totalCardsExtracted = jobs.reduce((sum, job) => sum + (job._count?.cards || 0), 0);

    const totalMappingsCreated = await prisma.evidenceCardMapping.count({
      where: {
        card: {
          sessionId,
        },
      },
    });

    let status: DeepAnalysisStatusResult['status'];
    if (totalJobs === 0) {
      status = 'IDLE';
    } else if (inProgress > 0) {
      status = 'RUNNING';
    } else if (failed === 0 && completed === totalJobs) {
      status = 'COMPLETED';
    } else {
      status = 'PARTIAL';
    }

    const oldestActive = jobs
      .filter(job => job.status !== 'COMPLETED' && job.status !== 'FAILED')
      .sort((a, b) => (a.startedAt?.getTime() || 0) - (b.startedAt?.getTime() || 0))[0];

    const pendingCount = jobs.filter(job => job.status === 'PENDING').length;
    const extractingCount = jobs.filter(job => ['PREPARING', 'EXTRACTING'].includes(job.status)).length;
    const mappingCount = jobs.filter(job => job.status === 'MAPPING').length;
    const estimatedSecondsRemaining = inProgress > 0
      ? extractingCount * 15 + pendingCount * 20 + (mappingCount > 0 ? 15 : 0)
      : null;

    return {
      status,
      totalJobs,
      completed,
      failed,
      inProgress,
      totalCardsExtracted,
      totalMappingsCreated,
      startedAt: nowIso(oldestActive?.startedAt || jobs[0]?.startedAt || null),
      estimatedSecondsRemaining,
      jobs: jobs.map(job => ({
        jobId: job.id,
        citationId: job.citationId,
        citationKey: job.citation.citationKey,
        status: job.status,
        cardsExtracted: job._count?.cards || null,
        error: job.error,
        startedAt: nowIso(job.startedAt),
        completedAt: nowIso(job.completedAt),
      })),
    };
  }

  async retryFailed(
    sessionId: string,
    jobIds: string[] | undefined,
    options: StartBatchOptions = {}
  ): Promise<{ retriedCount: number; jobs: Array<{ jobId: string; citationKey: string; status: 'PENDING' }> }> {
    const where: Prisma.DeepAnalysisJobWhereInput = {
      sessionId,
      status: 'FAILED',
      ...(Array.isArray(jobIds) && jobIds.length > 0 ? { id: { in: jobIds } } : {}),
    };

    const failedJobs = await prisma.deepAnalysisJob.findMany({
      where,
      include: {
        citation: {
          select: {
            citationKey: true,
          },
        },
      },
    });

    if (failedJobs.length === 0) {
      return { retriedCount: 0, jobs: [] };
    }

    const batchId = crypto.randomUUID();

    const failedJobIds = failedJobs.map(job => job.id);
    const failedCitationIds = Array.from(new Set(failedJobs.map(job => job.citationId)));

    await prisma.$transaction([
      prisma.deepAnalysisJob.updateMany({
        where: {
          id: { in: failedJobIds },
          sessionId,
          status: 'FAILED',
        },
        data: {
          status: 'PENDING',
          error: null,
          warning: null,
          startedAt: null,
          completedAt: null,
          batchId,
        },
      }),
      prisma.evidenceCard.deleteMany({
        where: { jobId: { in: failedJobIds } },
      }),
      prisma.citation.updateMany({
        where: { id: { in: failedCitationIds } },
        data: {
          deepAnalysisStatus: 'PENDING',
          evidenceCardCount: 0,
        },
      }),
    ]);

    const concurrency = clampConcurrency(options.concurrency);
    this.triggerBatch(
      sessionId,
      batchId,
      failedJobs.map(job => job.id),
      {
        concurrency,
        tenantContext: options.tenantContext || null,
        allowTextFallback: options.allowTextFallback === true,
      },
      'retry'
    );

    return {
      retriedCount: failedJobs.length,
      jobs: failedJobs.map(job => ({ jobId: job.id, citationKey: job.citation.citationKey, status: 'PENDING' })),
    };
  }

  async remapAll(
    sessionId: string,
    tenantContext?: TenantContext | null
  ): Promise<{ cardsRemapped: number; newMappingsCreated: number; oldMappingsDeleted: number }> {
    const { blueprint } = await this.getBlueprintContext(sessionId);
    if (!blueprint) {
      throw new Error('Blueprint not found for remapping');
    }

    const cards = await prisma.evidenceCard.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        citationId: true,
        citationKey: true,
        referenceArchetype: true,
        deepAnalysisLabel: true,
        claim: true,
        claimType: true,
        quantitativeDetail: true,
        conditions: true,
        comparableMetrics: true,
        doesNotSupport: true,
        scopeCondition: true,
        studyDesign: true,
        rigorIndicators: true,
        sourceFragment: true,
        pageHint: true,
        confidence: true,
        sourceSection: true,
        quoteVerified: true,
        quoteVerificationMethod: true,
        quoteVerificationScore: true,
      },
    });

    if (cards.length === 0) {
      return {
        cardsRemapped: 0,
        newMappingsCreated: 0,
        oldMappingsDeleted: 0,
      };
    }

    const oldMappingsDeletedResult = await prisma.evidenceCardMapping.deleteMany({
      where: {
        card: { sessionId },
      },
    });

    const cardsByCitation = new Map<string, ExtractedCardWithIdentity[]>();

    for (const card of cards) {
      const row: ExtractedCardWithIdentity = {
        cardId: card.id,
        citationId: card.citationId,
        citationKey: card.citationKey,
        referenceArchetype: normalizeArchetype(card.referenceArchetype),
        deepAnalysisLabel: normalizeDepthLabel(card.deepAnalysisLabel),
        claim: card.claim,
        claimType: card.claimType as any,
        quantitativeDetail: card.quantitativeDetail,
        conditions: card.conditions,
        comparableMetrics: (card.comparableMetrics || null) as any,
        doesNotSupport: card.doesNotSupport,
        scopeCondition: card.scopeCondition,
        studyDesign: card.studyDesign,
        rigorIndicators: card.rigorIndicators,
        sourceFragment: card.sourceFragment,
        pageHint: card.pageHint,
        confidence: card.confidence as any,
        sourceSection: card.sourceSection || 'unknown',
        quoteVerified: card.quoteVerified,
        quoteVerificationMethod: card.quoteVerificationMethod,
        quoteVerificationScore: card.quoteVerificationScore,
      };

      if (!cardsByCitation.has(card.citationId)) {
        cardsByCitation.set(card.citationId, []);
      }
      cardsByCitation.get(card.citationId)!.push(row);
    }

    const allMappings: CardDimensionMapping[] = [];

    for (const citationCards of Array.from(cardsByCitation.values())) {
      const idAliasMap = new Map<string, string>();
      const promptCards: ExtractedCardWithIdentity[] = citationCards.map((card, index) => {
        const promptCardId = `card_${index}`;
        idAliasMap.set(promptCardId, card.cardId);
        return {
          ...card,
          cardId: promptCardId,
        };
      });

      const mapped = await evidenceMappingService.mapCardsToDimensions(promptCards, blueprint, tenantContext || null);
      allMappings.push(
        ...mapped.mappings.map(mapping => ({
          ...mapping,
          cardId: idAliasMap.get(mapping.cardId) || mapping.cardId,
        }))
      );
    }

    if (allMappings.length > 0) {
      await prisma.evidenceCardMapping.createMany({
        data: allMappings.map(mapping => ({
          cardId: mapping.cardId,
          sectionKey: mapping.sectionKey,
          dimension: mapping.dimension,
          useAs: mapping.useAs,
          mappingConfidence: mapping.mappingConfidence,
        })),
      });
    }

    // Finalize any jobs stuck in MAPPING status (cards extracted but batch mapping failed earlier)
    const stuckMappingJobs = await prisma.deepAnalysisJob.findMany({
      where: { sessionId, status: 'MAPPING' },
      select: { id: true, citationId: true },
    });

    if (stuckMappingJobs.length > 0) {
      const stuckJobIds = stuckMappingJobs.map(j => j.id);
      const stuckCitationIds = Array.from(new Set(stuckMappingJobs.map(j => j.citationId)));

      await prisma.$transaction(async tx => {
        await tx.deepAnalysisJob.updateMany({
          where: { id: { in: stuckJobIds }, status: 'MAPPING' },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            warning: 'Completed via manual remap',
          },
        });

        await tx.citation.updateMany({
          where: { id: { in: stuckCitationIds } },
          data: { deepAnalysisStatus: 'COMPLETED' },
        });
      });

      console.log(`[DeepAnalysis] remapAll: finalized ${stuckMappingJobs.length} jobs stuck in MAPPING status`);
    }

    return {
      cardsRemapped: cards.length,
      newMappingsCreated: allMappings.length,
      oldMappingsDeleted: oldMappingsDeletedResult.count,
    };
  }

  private async buildCoverageSummary(sessionId: string): Promise<CoverageSummary> {
    const { blueprint } = await this.getBlueprintContext(sessionId);
    if (!blueprint) {
      return {
        totalDimensions: 0,
        coveredDimensions: 0,
        gaps: [],
        underSupported: [],
      };
    }

    const allDimensions = blueprint.sectionPlan.flatMap(section =>
      (section.mustCover || []).map(dimension => ({ sectionKey: section.sectionKey, dimension }))
    );

    if (allDimensions.length === 0) {
      return {
        totalDimensions: 0,
        coveredDimensions: 0,
        gaps: [],
        underSupported: [],
      };
    }

    const mappings = await prisma.evidenceCardMapping.findMany({
      where: {
        card: { sessionId },
      },
      include: {
        card: {
          select: {
            confidence: true,
          },
        },
      },
    });

    const byDimension = new Map<string, Array<{ confidence: EvidenceConfidenceLevel }>>();

    for (const mapping of mappings) {
      const key = `${mapping.sectionKey}::${mapping.dimension}`;
      if (!byDimension.has(key)) {
        byDimension.set(key, []);
      }
      byDimension.get(key)!.push({ confidence: mapping.card.confidence as EvidenceConfidenceLevel });
    }

    const gaps: string[] = [];
    const underSupported: string[] = [];
    let coveredDimensions = 0;

    for (const row of allDimensions) {
      const key = `${row.sectionKey}::${row.dimension}`;
      const evidences = byDimension.get(key) || [];
      if (evidences.length === 0) {
        gaps.push(row.dimension);
        continue;
      }

      coveredDimensions += 1;
      const strongest = evidences.reduce((best, current) =>
        rankConfidence(current.confidence) > rankConfidence(best)
          ? current.confidence
          : best,
        'LOW' as EvidenceConfidenceLevel
      );

      if (strongest === 'LOW') {
        underSupported.push(row.dimension);
      }
    }

    return {
      totalDimensions: allDimensions.length,
      coveredDimensions,
      gaps,
      underSupported,
    };
  }

  async getCards(sessionId: string, query: EvidenceCardsQuery) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(MAX_CARD_PAGE_SIZE, Number(query.limit || 50)));

    const where: Prisma.EvidenceCardWhereInput = {
      sessionId,
      ...(query.citationId ? { citationId: query.citationId } : {}),
      ...(query.claimType ? { claimType: query.claimType } : {}),
      ...(query.confidence ? { confidence: query.confidence } : {}),
      ...(typeof query.verified === 'boolean' ? { quoteVerified: query.verified } : {}),
      ...(query.sectionKey || query.dimension
        ? {
          mappings: {
            some: {
              ...(query.sectionKey ? { sectionKey: query.sectionKey } : {}),
              ...(query.dimension ? { dimension: query.dimension } : {}),
            },
          },
        }
        : {}),
    };

    const [totalCards, rows] = await Promise.all([
      prisma.evidenceCard.count({ where }),
      prisma.evidenceCard.findMany({
        where,
        include: {
          mappings: true,
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const coverage = await this.buildCoverageSummary(sessionId);

    const cards = rows.map(card => ({
      id: card.id,
      citationKey: card.citationKey,
      citationId: card.citationId,
      claim: card.claim,
      claimType: card.claimType,
      quantitativeDetail: card.quantitativeDetail,
      conditions: card.conditions,
      comparableMetrics: card.comparableMetrics,
      doesNotSupport: card.doesNotSupport,
      scopeCondition: card.scopeCondition,
      studyDesign: card.studyDesign,
      rigorIndicators: card.rigorIndicators,
      sourceFragment: card.sourceFragment,
      pageHint: card.pageHint,
      confidence: card.confidence,
      sourceSection: card.sourceSection,
      quoteVerified: card.quoteVerified,
      mappings: card.mappings.map(mapping => ({
        sectionKey: mapping.sectionKey,
        dimension: mapping.dimension,
        useAs: mapping.useAs,
        mappingConfidence: mapping.mappingConfidence,
      })),
    }));

    const dimensionGroups = new Map<string, {
      sectionKey: string;
      dimension: string;
      cards: typeof cards;
      citationKeys: Set<string>;
    }>();

    for (const card of cards) {
      for (const mapping of card.mappings) {
        const key = `${mapping.sectionKey}::${mapping.dimension}`;
        if (!dimensionGroups.has(key)) {
          dimensionGroups.set(key, {
            sectionKey: mapping.sectionKey,
            dimension: mapping.dimension,
            cards: [],
            citationKeys: new Set<string>(),
          });
        }
        const group = dimensionGroups.get(key)!;
        group.cards.push(card);
        group.citationKeys.add(card.citationKey);
      }
    }

    const paperGroups = (() => {
      const byPaper = new Map<string, { citationId: string; citationKey: string; cardCount: number; cards: typeof cards }>();
      for (const card of cards) {
        const key = `${card.citationId}::${card.citationKey}`;
        if (!byPaper.has(key)) {
          byPaper.set(key, {
            citationId: card.citationId,
            citationKey: card.citationKey,
            cardCount: 0,
            cards: [],
          });
        }
        const group = byPaper.get(key)!;
        group.cards.push(card);
        group.cardCount += 1;
      }
      return Array.from(byPaper.values())
        .sort((a, b) => b.cardCount - a.cardCount || a.citationKey.localeCompare(b.citationKey));
    })();

    const dimensions = Array.from(dimensionGroups.values())
      .map(group => ({
        sectionKey: group.sectionKey,
        dimension: group.dimension,
        cardCount: group.cards.length,
        paperCount: group.citationKeys.size,
        cards: group.cards,
      }))
      .sort((a, b) =>
        a.sectionKey.localeCompare(b.sectionKey)
        || a.dimension.localeCompare(b.dimension)
      );

    const sections = (() => {
      const bySection = new Map<string, Array<{
        dimension: string;
        cardCount: number;
        paperCount: number;
        cards: typeof cards;
      }>>();

      for (const dim of dimensions) {
        if (!bySection.has(dim.sectionKey)) {
          bySection.set(dim.sectionKey, []);
        }
        bySection.get(dim.sectionKey)!.push({
          dimension: dim.dimension,
          cardCount: dim.cardCount,
          paperCount: dim.paperCount,
          cards: dim.cards,
        });
      }

      return Array.from(bySection.entries())
        .map(([sectionKey, groupedDimensions]) => ({
          sectionKey,
          cardCount: groupedDimensions.reduce((sum, item) => sum + item.cardCount, 0),
          dimensions: groupedDimensions.sort((a, b) => a.dimension.localeCompare(b.dimension)),
        }))
        .sort((a, b) => a.sectionKey.localeCompare(b.sectionKey));
    })();

    return {
      totalCards,
      page,
      limit,
      cards,
      viewData: {
        requestedView: query.view || 'paper',
        papers: paperGroups,
        dimensions,
        sections,
      },
      coverage,
    };
  }

  async getCoverage(sessionId: string) {
    const { blueprint } = await this.getBlueprintContext(sessionId);

    const [mappings, cards] = await Promise.all([
      prisma.evidenceCardMapping.findMany({
        where: { card: { sessionId } },
        include: {
          card: {
            select: {
              citationKey: true,
              citationId: true,
              confidence: true,
            },
          },
        },
      }),
      prisma.evidenceCard.findMany({
        where: { sessionId },
        select: {
          citationKey: true,
          citationId: true,
        },
      }),
    ]);

    const citationSectionCounts = new Map<string, Map<string, number>>();
    const dimensionSummary = new Map<string, { sectionKey: string; dimension: string; cardIds: Set<string>; citationIds: Set<string>; minConfidence: EvidenceConfidenceLevel }>();

    for (const mapping of mappings) {
      const citationKey = mapping.card.citationKey;
      if (!citationSectionCounts.has(citationKey)) {
        citationSectionCounts.set(citationKey, new Map());
      }
      const sectionMap = citationSectionCounts.get(citationKey)!;
      sectionMap.set(mapping.sectionKey, (sectionMap.get(mapping.sectionKey) || 0) + 1);

      const dimKey = `${mapping.sectionKey}::${mapping.dimension}`;
      if (!dimensionSummary.has(dimKey)) {
        dimensionSummary.set(dimKey, {
          sectionKey: mapping.sectionKey,
          dimension: mapping.dimension,
          cardIds: new Set(),
          citationIds: new Set(),
          minConfidence: mapping.card.confidence as EvidenceConfidenceLevel,
        });
      }

      const summary = dimensionSummary.get(dimKey)!;
      summary.cardIds.add(mapping.cardId);
      summary.citationIds.add(mapping.card.citationId);
      if (rankConfidence(mapping.card.confidence as EvidenceConfidenceLevel) < rankConfidence(summary.minConfidence)) {
        summary.minConfidence = mapping.card.confidence as EvidenceConfidenceLevel;
      }
    }

    const matrix = Array.from(citationSectionCounts.entries()).map(([citationKey, sections]) => ({
      citationKey,
      sections: Object.fromEntries(sections.entries()),
    }));

    const dimensionCoverage = Array.from(dimensionSummary.values()).map(item => ({
      sectionKey: item.sectionKey,
      dimension: item.dimension,
      cardCount: item.cardIds.size,
      paperCount: item.citationIds.size,
      minConfidence: item.minConfidence,
    }));

    const blueprintDimensions = blueprint
      ? blueprint.sectionPlan.flatMap(section =>
        (section.mustCover || []).map(dimension => ({ sectionKey: section.sectionKey, dimension }))
      )
      : [];

    const covered = new Set(dimensionCoverage.map(item => `${item.sectionKey}::${item.dimension}`));
    const gaps = blueprintDimensions
      .filter(item => !covered.has(`${item.sectionKey}::${item.dimension}`))
      .map(item => item.dimension);

    const overallCoverage = blueprintDimensions.length > 0
      ? (blueprintDimensions.length - gaps.length) / blueprintDimensions.length
      : 0;

    return {
      matrix,
      dimensionCoverage,
      gaps,
      overallCoverage,
      totalCards: cards.length,
    };
  }
}

export const deepAnalysisService = new DeepAnalysisService();
export { DeepAnalysisService };
