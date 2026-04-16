import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { defaultConfig as meteringDefaultConfig } from '@/lib/metering/config';
import { createReservationService } from '@/lib/metering/reservation';
import { featureFlags } from '@/lib/feature-flags';
import { blueprintService, type BlueprintWithSectionPlan, type SectionPlanItem } from '@/lib/services/blueprint-service';
import { citationMappingService, type CitationMetaSnapshot, type PaperBlueprintMapping } from '@/lib/services/citation-mapping-service';
import { proactiveParsingService } from '@/lib/services/proactive-parsing-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow up to 300s for LLM processing across all aggregated search runs

const requestSchema = z.object({
  searchRunId: z.string().min(1),
  maxSuggestions: z.number().int().min(1).max(20).optional().default(10),
  includeBlueprint: z.boolean().optional().default(true), // Include blueprint dimension mapping
  forceReanalyze: z.boolean().optional().default(false),  // Skip incremental — re-analyze all papers
});

const updateSchema = z.object({
  searchRunId: z.string().min(1),
  removedResultIds: z.array(z.string().min(1)).min(1)
});

const BATCH_SIZE = 12;
const DEFAULT_PARALLEL_BATCH_LIMIT = parsePositiveInt(
  process.env.LITERATURE_RELEVANCE_DEFAULT_PARALLEL_BATCH_LIMIT,
  5
);
const MAX_PARALLEL_BATCH_LIMIT = parsePositiveInt(
  process.env.LITERATURE_RELEVANCE_MAX_PARALLEL_BATCH_LIMIT,
  15
);
const LITERATURE_TASK_CODE = 'LITERATURE_RELEVANCE' as const;
const reservationService = createReservationService(meteringDefaultConfig);

async function runBatchesInParallel<T, R>(
  batches: T[],
  limit: number,
  worker: (batch: T, index: number) => Promise<R>
): Promise<R[]> {
  if (batches.length === 0) return [];
  const results: R[] = new Array(batches.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, batches.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= batches.length) break;
      results[currentIndex] = await worker(batches[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampParallelLimit(value: number): number {
  return Math.max(1, Math.min(value, MAX_PARALLEL_BATCH_LIMIT));
}

async function resolveParallelBatchLimit(tenantId?: string | null): Promise<number> {
  const defaultLimit = clampParallelLimit(DEFAULT_PARALLEL_BATCH_LIMIT);
  if (!tenantId) {
    return defaultLimit;
  }

  try {
    const meteringLimit = await reservationService.getConcurrencyLimit(tenantId, LITERATURE_TASK_CODE);
    if (typeof meteringLimit === 'number' && meteringLimit > 0) {
      return clampParallelLimit(meteringLimit);
    }
  } catch (error) {
    console.warn('[LiteratureRelevance] Failed to resolve policy concurrency limit, using default:', error);
  }

  return defaultLimit;
}

// Enhanced response structure from LLM with citation metadata
interface CitationUsage {
  introduction: boolean;      // Cite for background/context
  literatureReview: boolean;  // Cite for detailed analysis
  methodology: boolean;       // Reference their method
  comparison: boolean;        // Use as baseline/comparison
}

interface PositionalRelation {
  relation: PositionalRelationLabel;
  rationale: string;
}

const CLAIM_TYPE_VALUES = [
  'BACKGROUND',
  'GAP',
  'METHOD',
  'LIMITATION',
  'DATASET',
  'IMPLEMENTATION_CONSTRAINT'
] as const;
type ClaimType = (typeof CLAIM_TYPE_VALUES)[number];
const CLAIM_TYPE_SET = new Set<string>(CLAIM_TYPE_VALUES);

const POSITIONAL_RELATION_VALUES = [
  'REINFORCES',
  'CONTRADICTS',
  'EXTENDS',
  'QUALIFIES',
  'TENSION'
] as const;
type PositionalRelationLabel = (typeof POSITIONAL_RELATION_VALUES)[number];
const POSITIONAL_RELATION_SET = new Set<string>(POSITIONAL_RELATION_VALUES);

const DEEP_ANALYSIS_RECOMMENDATION_VALUES = [
  'DEEP_ANCHOR',
  'DEEP_SUPPORT',
  'DEEP_STRESS_TEST',
  'LIT_ONLY'
] as const;
type DeepAnalysisRecommendation = (typeof DEEP_ANALYSIS_RECOMMENDATION_VALUES)[number];
const DEEP_ANALYSIS_RECOMMENDATION_SET = new Set<string>(DEEP_ANALYSIS_RECOMMENDATION_VALUES);

const REFERENCE_ARCHETYPE_VALUES = [
  'SYSTEM_ALGO_EVALUATION',
  'CONTROLLED_EXPERIMENTAL_STUDY',
  'EMPIRICAL_OBSERVATIONAL_STUDY',
  'MIXED_METHODS_APPLIED_STUDY',
  'SYNTHESIS_REVIEW',
  'POSITION_CONCEPTUAL'
] as const;
type ReferenceArchetype = (typeof REFERENCE_ARCHETYPE_VALUES)[number];
const REFERENCE_ARCHETYPE_SET = new Set<string>(REFERENCE_ARCHETYPE_VALUES);

// Dimension mapping for blueprint integration
interface DimensionMapping {
  sectionKey: string;
  dimension: string;
  remark: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  dimensionIndex?: number;
}

interface CitationMeta {
  keyContribution: string;         // Main contribution (1 sentence)
  keyFindings: string;             // Main results/findings (1 sentence)
  methodologicalApproach: string | null;  // Their method (if relevant)
  relevanceToResearch: string;     // How it relates to user's research
  limitationsOrGaps: string | null;       // What they didn't address
  claimTypesSupported: ClaimType[]; // Structured claim categories this paper can support
  evidenceBoundary: string | null;  // What should NOT be claimed from this paper
  positionalRelation: PositionalRelation;
  usage: CitationUsage;
  referenceArchetype: ReferenceArchetype | null;
  archetypeSignal: string | null;
}

interface PaperRelevanceAnalysis {
  paperId: string;
  paperTitle?: string;
  paperDoi?: string;
  paperSource?: string;
  providerPaperId?: string;
  paperIdentityKey?: string;
  paperIsOpenAccess?: boolean | null;
  paperPdfStatus?: 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE';
  isRelevant: boolean;
  relevanceScore: number; // 0-100
  reasoning: string;
  citationMeta: CitationMeta;  // Enhanced metadata for section generation
  dimensionMappings?: DimensionMapping[];  // Blueprint dimension mappings
  recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';  // Import recommendation
  deepAnalysisRecommendation: DeepAnalysisRecommendation;
  deepAnalysisRationale: string;
  referenceArchetype: ReferenceArchetype | null;
  archetypeSignal: string | null;
}

// Coverage analysis for blueprint gaps
interface BlueprintCoverage {
  totalDimensions: number;
  coveredDimensions: number;
  gaps: Array<{
    sectionKey: string;
    sectionTitle: string;
    dimension: string;
  }>;
  sectionCoverage: Record<string, {
    total: number;
    covered: number;
    dimensions: Array<{
      dimension: string;
      paperCount: number;
      papers: string[];
    }>;
  }>;
}

interface ShortlistSummary {
  anchors: string[];
  supports: string[];
  stressTests: string[];
  targetCount: number;
  notes: string;
}

interface LLMResponse {
  suggestions: PaperRelevanceAnalysis[];
  summary: string;
  blueprintCoverage?: BlueprintCoverage;
  shortlistSummary?: ShortlistSummary;
}

// Normalize DOIs / titles to build deduplication keys
function normalizeDoi(doi?: string | null) {
  return typeof doi === 'string'
    ? doi.trim().toLowerCase()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
        .replace(/\s+/g, '')
    : '';
}

function normalizeTitle(title?: string | null) {
  return typeof title === 'string'
    ? title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function normalizeProvider(provider?: string | null): string {
  return typeof provider === 'string'
    ? provider.trim().toLowerCase().replace(/\s+/g, '_')
    : '';
}

function normalizeAuthor(author?: string | null): string {
  return typeof author === 'string'
    ? author
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function toCitationMetaSnapshot(
  suggestion: Pick<PaperRelevanceAnalysis, 'citationMeta' | 'relevanceScore'>
): CitationMetaSnapshot | undefined {
  const meta = suggestion.citationMeta;
  if (!meta) {
    return undefined;
  }

  return {
    keyContribution: typeof meta.keyContribution === 'string' ? meta.keyContribution.slice(0, 400) : undefined,
    keyFindings: typeof meta.keyFindings === 'string' ? meta.keyFindings.slice(0, 400) : undefined,
    methodologicalApproach: typeof meta.methodologicalApproach === 'string'
      ? meta.methodologicalApproach.slice(0, 400)
      : (meta.methodologicalApproach ?? null),
    relevanceToResearch: typeof meta.relevanceToResearch === 'string' ? meta.relevanceToResearch.slice(0, 500) : undefined,
    limitationsOrGaps: typeof meta.limitationsOrGaps === 'string'
      ? meta.limitationsOrGaps.slice(0, 500)
      : (meta.limitationsOrGaps ?? null),
    claimTypesSupported: Array.isArray(meta.claimTypesSupported)
      ? Array.from(
          new Set(
            meta.claimTypesSupported
              .map(v => String(v).trim().toUpperCase())
              .filter(v => CLAIM_TYPE_SET.has(v))
          )
        ).slice(0, 3) as ClaimType[]
      : undefined,
    evidenceBoundary: typeof meta.evidenceBoundary === 'string'
      ? meta.evidenceBoundary.slice(0, 400)
      : (meta.evidenceBoundary ?? null),
    positionalRelation: (() => {
      if (!meta.positionalRelation || typeof meta.positionalRelation !== 'object') {
        return undefined;
      }
      const relation = POSITIONAL_RELATION_SET.has(String(meta.positionalRelation.relation || '').trim().toUpperCase())
        ? String(meta.positionalRelation.relation).trim().toUpperCase() as PositionalRelationLabel
        : undefined;
      const rationale = typeof meta.positionalRelation.rationale === 'string'
        ? meta.positionalRelation.rationale.slice(0, 300)
        : undefined;
      return relation || rationale ? { relation, rationale } : undefined;
    })(),
    usage: meta.usage ? {
      introduction: Boolean(meta.usage.introduction),
      literatureReview: Boolean(meta.usage.literatureReview),
      methodology: Boolean(meta.usage.methodology),
      comparison: Boolean(meta.usage.comparison)
    } : undefined,
    relevanceScore: Number.isFinite(Number(suggestion.relevanceScore))
      ? Math.max(0, Math.min(100, Number(suggestion.relevanceScore)))
      : undefined,
    analyzedAt: new Date().toISOString(),
    referenceArchetype: typeof meta.referenceArchetype === 'string'
      ? (REFERENCE_ARCHETYPE_SET.has(meta.referenceArchetype.toUpperCase())
        ? meta.referenceArchetype.toUpperCase()
        : null)
      : null,
    archetypeSignal: typeof meta.archetypeSignal === 'string'
      ? meta.archetypeSignal.slice(0, 300)
      : null
  };
}

function deduplicatePapers(papers: any[]) {
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const p of papers) {
    const doiKey = normalizeDoi(p.doi);
    const titleKey = normalizeTitle(p.title);
    const idKey = String(p.id || p.paperId || p.citationKey || '').toLowerCase();

    const key = doiKey || titleKey || idKey;
    if (!key) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(p);
  }

  return unique;
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ 
      where: { id: sessionId },
      include: { researchTopic: true, ideaRecord: true }
    });
  }

  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { researchTopic: true, ideaRecord: true }
  });
}

/**
 * Attempt to salvage a truncated JSON response
 * This handles cases where the LLM output was cut off due to token limits
 */
function attemptJsonSalvage(truncatedJson: string): { suggestions: any[]; summary: string } | null {
  try {
    // Find the suggestions array start
    const suggestionsMatch = truncatedJson.match(/"suggestions"\s*:\s*\[/);
    if (!suggestionsMatch) return null;
    
    const suggestionsStart = suggestionsMatch.index! + suggestionsMatch[0].length;
    
    // Try to find complete suggestion objects by looking for closing braces
    // Each suggestion ends with }] or }, 
    let lastCompleteIndex = -1;
    let braceDepth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = suggestionsStart; i < truncatedJson.length; i++) {
      const char = truncatedJson[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          // Found a complete top-level object in suggestions array
          lastCompleteIndex = i;
        }
      }
    }
    
    if (lastCompleteIndex === -1) return null;
    
    // Extract the valid portion up to the last complete suggestion
    const validSuggestions = truncatedJson.substring(suggestionsStart, lastCompleteIndex + 1);
    
    // Construct a valid JSON object
    const reconstructed = `{"suggestions":[${validSuggestions}],"summary":"Analysis partially completed (response was truncated)"}`;
    
    const parsed = JSON.parse(reconstructed);
    
    // Verify we have at least one suggestion
    if (!parsed.suggestions || parsed.suggestions.length === 0) {
      return null;
    }
    
    console.log(`[LiteratureRelevance] Salvaged ${parsed.suggestions.length} complete suggestion(s) from truncated response`);
    return parsed;
  } catch (error) {
    console.error('[LiteratureRelevance] JSON salvage failed:', error);
    return null;
  }
}

// Sections that should be included in dimension mapping for non-review papers
const LITERATURE_MAPPING_SECTIONS = [
  'introduction',
  'literature_review', 'literature-review', 'literaturereview',
  'background',
  'related_work', 'related-work', 'relatedwork',
  'theoretical_framework', 'theoretical-framework', 'theoreticalframework',
  'methodology', 'methods', 'research_methodology', 'research-methodology',
  'materials_and_methods', 'materials-and-methods'
];

// Check if a section key matches literature mapping sections
function isLiteratureMappingSection(sectionKey: string): boolean {
  const normalized = sectionKey.toLowerCase().replace(/[\s_-]+/g, '_');
  return LITERATURE_MAPPING_SECTIONS.some(s => 
    normalized.includes(s.replace(/[\s_-]+/g, '_')) ||
    s.replace(/[\s_-]+/g, '_').includes(normalized)
  );
}

// Check if paper type is a review paper
function isReviewPaper(paperTypeCode?: string): boolean {
  if (!paperTypeCode) return false;
  const normalized = paperTypeCode.toLowerCase();
  return normalized.includes('review') || 
         normalized.includes('survey') || 
         normalized.includes('meta-analysis') ||
         normalized.includes('systematic');
}

function normalizePdfStatus(value: unknown): 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE' {
  if (value === 'UPLOADED' || value === 'PARSING' || value === 'READY' || value === 'FAILED') {
    return value;
  }
  return 'NONE';
}

function normalizeDocumentSourceType(
  sourceType: unknown,
  sourceIdentifier?: unknown,
  mimeType?: unknown
): 'UPLOAD' | 'DOI_FETCH' | 'URL_IMPORT' | 'TEXT_PASTE' | undefined {
  const normalizedSourceIdentifier = typeof sourceIdentifier === 'string'
    ? sourceIdentifier.toLowerCase()
    : '';
  const normalizedMimeType = typeof mimeType === 'string'
    ? mimeType.toLowerCase()
    : '';

  if (
    sourceType === 'TEXT_PASTE' ||
    normalizedSourceIdentifier.startsWith('text:') ||
    normalizedMimeType.startsWith('text/')
  ) {
    return 'TEXT_PASTE';
  }

  if (sourceType === 'UPLOAD' || sourceType === 'DOI_FETCH' || sourceType === 'URL_IMPORT') {
    return sourceType;
  }

  return undefined;
}

function normalizeDoiKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:/, '')
    .replace(/\s+/g, '');
}

function normalizeTitleKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toYearOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildTitleYearKey(title: unknown, year: unknown): string {
  const normalizedTitle = normalizeTitleKey(title);
  if (!normalizedTitle) return '';
  const normalizedYear = toYearOrNull(year);
  return `${normalizedTitle}::${normalizedYear ?? 'na'}`;
}

function getPrimaryDocument(reference: any): any | null {
  const links = Array.isArray(reference?.documents) ? reference.documents : [];
  const first = links[0];
  return first?.document || null;
}

function referenceRank(reference: any): number {
  const document = getPrimaryDocument(reference);
  const status = normalizePdfStatus(document?.status);
  let rank = 0;

  if (document) rank += 100;
  if (status === 'READY') rank += 30;
  if (status === 'UPLOADED' || status === 'PARSING') rank += 20;
  if (status === 'FAILED') rank += 5;
  if (reference?.pdfUrl) rank += 1;

  return rank;
}

function pickPreferredReference(current: any, incoming: any): any {
  if (!current) return incoming;
  return referenceRank(incoming) > referenceRank(current) ? incoming : current;
}

async function hydrateSearchRunResultsWithReferenceState(userId: string, rawResults: unknown): Promise<any[]> {
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    return [];
  }

  const results = rawResults.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return { ...(item as Record<string, any>) };
  });

  const referenceIds = new Set<string>();
  const doiKeys = new Set<string>();
  const titleKeys = new Set<string>();

  for (const item of results) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const result = item as Record<string, any>;

    const referenceId = typeof result.libraryReferenceId === 'string'
      ? result.libraryReferenceId.trim()
      : (typeof result.referenceId === 'string' ? result.referenceId.trim() : '');
    if (referenceId) {
      referenceIds.add(referenceId);
    }

    const doiKey = normalizeDoiKey(result.doi);
    if (doiKey) {
      doiKeys.add(doiKey);
    }

    const titleKey = normalizeTitleKey(result.title);
    if (titleKey) {
      titleKeys.add(titleKey);
    }
  }

  const orFilters: any[] = [];
  if (referenceIds.size > 0) {
    orFilters.push({ id: { in: Array.from(referenceIds) } });
  }
  for (const doi of Array.from(doiKeys)) {
    orFilters.push({ doi: { equals: doi, mode: 'insensitive' } });
  }
  for (const title of Array.from(titleKeys)) {
    orFilters.push({ title: { equals: title, mode: 'insensitive' } });
  }

  if (orFilters.length === 0) {
    return results.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const result = item as Record<string, any>;
      return {
        ...result,
        pdfStatus: normalizePdfStatus(result.pdfStatus),
      };
    });
  }

  const references = await prisma.referenceLibrary.findMany({
    where: {
      userId,
      isActive: true,
      OR: orFilters,
    },
    select: {
      id: true,
      doi: true,
      title: true,
      year: true,
      pdfUrl: true,
      documents: {
        where: { isPrimary: true },
        orderBy: { linkedAt: 'desc' },
        take: 1,
        select: {
          document: {
            select: {
              id: true,
              status: true,
              sourceType: true,
              sourceIdentifier: true,
              mimeType: true,
              updatedAt: true,
            },
          },
        },
      },
    },
    take: 200,
  });

  const byId = new Map<string, any>();
  const byDoi = new Map<string, any>();
  const byTitleYear = new Map<string, any>();
  const byTitle = new Map<string, any>();

  for (const reference of references) {
    byId.set(reference.id, pickPreferredReference(byId.get(reference.id), reference));

    const doiKey = normalizeDoiKey(reference.doi);
    if (doiKey) {
      byDoi.set(doiKey, pickPreferredReference(byDoi.get(doiKey), reference));
    }

    const titleYearKey = buildTitleYearKey(reference.title, reference.year);
    if (titleYearKey) {
      byTitleYear.set(titleYearKey, pickPreferredReference(byTitleYear.get(titleYearKey), reference));
    }

    const titleKey = normalizeTitleKey(reference.title);
    if (titleKey) {
      byTitle.set(titleKey, pickPreferredReference(byTitle.get(titleKey), reference));
    }
  }

  return results.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const result = item as Record<string, any>;

    const referenceId = typeof result.libraryReferenceId === 'string'
      ? result.libraryReferenceId.trim()
      : (typeof result.referenceId === 'string' ? result.referenceId.trim() : '');
    const doiKey = normalizeDoiKey(result.doi);
    const titleYearKey = buildTitleYearKey(result.title, result.year);
    const titleKey = normalizeTitleKey(result.title);

    const matchedReference =
      (referenceId ? byId.get(referenceId) : undefined) ||
      (doiKey ? byDoi.get(doiKey) : undefined) ||
      (titleYearKey ? byTitleYear.get(titleYearKey) : undefined) ||
      (titleKey ? byTitle.get(titleKey) : undefined);

    const primaryDocument = getPrimaryDocument(matchedReference);
    const existingStatus = normalizePdfStatus(result.pdfStatus);
    const primaryStatus = normalizePdfStatus(primaryDocument?.status);
    const nextStatus = primaryStatus !== 'NONE'
      ? primaryStatus
      : (result.libraryDocumentId ? (existingStatus === 'NONE' ? 'UPLOADED' : existingStatus) : existingStatus);

    const nextSourceType = normalizeDocumentSourceType(
      primaryDocument?.sourceType,
      primaryDocument?.sourceIdentifier,
      primaryDocument?.mimeType
    );

    return {
      ...result,
      pdfStatus: nextStatus,
      libraryReferenceId: matchedReference?.id || result.libraryReferenceId || null,
      libraryDocumentId: primaryDocument?.id || result.libraryDocumentId || null,
      documentSourceType: nextSourceType || result.documentSourceType,
      pdfUrl: result.pdfUrl || matchedReference?.pdfUrl || null,
    };
  });
}

function normalizeRecommendation(
  recommendation: unknown,
  dimensionMappings?: DimensionMapping[]
): 'IMPORT' | 'MAYBE' | 'SKIP' | undefined {
  if (recommendation === 'IMPORT' || recommendation === 'MAYBE' || recommendation === 'SKIP') {
    return recommendation;
  }
  if (!dimensionMappings || dimensionMappings.length === 0) {
    return undefined;
  }
  const highMediumCount = dimensionMappings.filter(
    dm => dm.confidence === 'HIGH' || dm.confidence === 'MEDIUM'
  ).length;
  return highMediumCount >= 2 ? 'IMPORT' : highMediumCount >= 1 ? 'MAYBE' : 'SKIP';
}

function normalizeReferenceArchetype(value: unknown): ReferenceArchetype | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (REFERENCE_ARCHETYPE_SET.has(upper)) {
    return upper as ReferenceArchetype;
  }
  // Fuzzy fallback for common LLM variations
  if (upper.includes('REVIEW') || upper.includes('META') || upper.includes('SURVEY') || upper.includes('SYNTHESIS')) {
    return 'SYNTHESIS_REVIEW';
  }
  if (upper.includes('POSITION') || upper.includes('CONCEPTUAL') || upper.includes('EDITORIAL') || upper.includes('COMMENTARY')) {
    return 'POSITION_CONCEPTUAL';
  }
  if (upper.includes('MIXED') || upper.includes('QUAL')) {
    return 'MIXED_METHODS_APPLIED_STUDY';
  }
  if (upper.includes('EXPERIMENT') || upper.includes('RCT') || upper.includes('CONTROLLED') || upper.includes('INTERVENTION')) {
    return 'CONTROLLED_EXPERIMENTAL_STUDY';
  }
  if (upper.includes('OBSERVATIONAL') || upper.includes('COHORT') || upper.includes('RETROSPECTIVE')) {
    return 'EMPIRICAL_OBSERVATIONAL_STUDY';
  }
  return 'SYSTEM_ALGO_EVALUATION'; // safe default
}

function normalizePositionalRelationLabel(value: unknown): PositionalRelationLabel | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (POSITIONAL_RELATION_SET.has(upper)) {
    return upper as PositionalRelationLabel;
  }
  if (/\b(CONTRADICT|CONFLICT|OPPOS|DISAGREE)\b/.test(upper)) {
    return 'CONTRADICTS';
  }
  if (/\b(TENSION|TRADE_OFF|TRADEOFF|COMPETING)\b/.test(upper)) {
    return 'TENSION';
  }
  if (/\b(QUALIF|BOUNDARY|LIMIT|SCOPE|CONDITION)\b/.test(upper)) {
    return 'QUALIFIES';
  }
  if (/\b(EXTEND|ADAPT|TRANSFER|GENERALI[ZS])\b/.test(upper)) {
    return 'EXTENDS';
  }
  if (/\b(REINFORCE|SUPPORT|ALIGN)\b/.test(upper)) {
    return 'REINFORCES';
  }
  return null;
}

function inferPositionalRelation(
  reasoning: string,
  limitationsOrGaps: string | null | undefined,
  evidenceBoundary: string | null | undefined
): PositionalRelation {
  const limitationText = typeof limitationsOrGaps === 'string' ? limitationsOrGaps.trim() : '';
  const boundaryText = typeof evidenceBoundary === 'string' ? evidenceBoundary.trim() : '';
  const combined = `${reasoning || ''} ${limitationText} ${boundaryText}`.toLowerCase();

  let relation: PositionalRelationLabel = 'REINFORCES';
  if (/\b(contradict|conflict|oppose|disagree|inconsistent)\b/.test(combined)) {
    relation = 'CONTRADICTS';
  } else if (/\b(tension|trade[\s-]?off|competing|mixed findings|compromise)\b/.test(combined)) {
    relation = 'TENSION';
  } else if (/\b(boundary|scope|limit|limitation|condition|only when|under)\b/.test(combined)) {
    relation = 'QUALIFIES';
  } else if (/\b(extend|adapt|different population|different setting|different domain|different scale)\b/.test(combined)) {
    relation = 'EXTENDS';
  }

  const rationaleSource = limitationText || boundaryText || reasoning || 'Relation inferred from available abstract evidence.';
  return {
    relation,
    rationale: rationaleSource.slice(0, 300),
  };
}

function hasStressSignalStrong(
  citationMeta: CitationMeta | undefined,
  reasoning: string
): boolean {
  if (citationMeta?.positionalRelation?.relation === 'CONTRADICTS' || citationMeta?.positionalRelation?.relation === 'TENSION') {
    return true;
  }
  if (Array.isArray(citationMeta?.claimTypesSupported) && citationMeta.claimTypesSupported.includes('LIMITATION')) {
    return true;
  }

  const limitations = citationMeta?.limitationsOrGaps || '';
  const evidenceBoundary = citationMeta?.evidenceBoundary || '';
  const combined = `${reasoning} ${limitations} ${evidenceBoundary}`.toLowerCase();

  return /\b(contradict|contrary|counter|challenge|inconsisten|mixed|null|negative|no significant|fails?|limitation|trade[\s-]?off|underperform)\b/i.test(combined);
}

function buildDeepAnalysisFallbackRationale(
  recommendation: DeepAnalysisRecommendation,
  score: number,
  mappingCount: number,
  highMedCount: number,
  sectionSpread: number
): string {
  const mappingFacts = mappingCount > 0
    ? `mappings ${mappingCount} (${highMedCount} HIGH/MED), section spread ${sectionSpread}`
    : 'no confident mapping evidence';

  if (recommendation === 'DEEP_ANCHOR') {
    return `Score ${score}; ${mappingFacts}; strong coverage -> DEEP_ANCHOR.`;
  }
  if (recommendation === 'DEEP_STRESS_TEST') {
    return `Score ${score}; ${mappingFacts}; contradiction/limitation signals -> DEEP_STRESS_TEST.`;
  }
  if (recommendation === 'DEEP_SUPPORT') {
    return `Score ${score}; ${mappingFacts}; useful but narrower coverage -> DEEP_SUPPORT.`;
  }
  return `Score ${score}; ${mappingFacts}; low deep-extraction ROI -> LIT_ONLY.`;
}

function deriveDeepAnalysisFields(input: {
  isRelevant: boolean;
  relevanceScore: number;
  recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
  dimensionMappings?: DimensionMapping[];
  citationMeta?: CitationMeta;
  reasoning: string;
  rawDeepAnalysisRecommendation?: unknown;
  rawDeepAnalysisRationale?: unknown;
}): {
  deepAnalysisRecommendation: DeepAnalysisRecommendation;
  deepAnalysisRationale: string;
} {
  const score = Math.min(100, Math.max(0, Number(input.relevanceScore) || 0));
  const mappings = Array.isArray(input.dimensionMappings) ? input.dimensionMappings : [];
  const highMedCount = mappings.filter(dm => dm.confidence === 'HIGH' || dm.confidence === 'MEDIUM').length;
  const sectionSpread = new Set(mappings.map(dm => dm.sectionKey).filter(Boolean)).size;
  const hasConfidentMapping = highMedCount > 0;
  const strongCoverage = highMedCount >= 2 || (highMedCount >= 1 && sectionSpread >= 2);
  const stressSignalStrong = hasStressSignalStrong(input.citationMeta, input.reasoning);

  let deepAnalysisRecommendation: DeepAnalysisRecommendation;
  if (typeof input.rawDeepAnalysisRecommendation === 'string' && DEEP_ANALYSIS_RECOMMENDATION_SET.has(input.rawDeepAnalysisRecommendation)) {
    deepAnalysisRecommendation = input.rawDeepAnalysisRecommendation as DeepAnalysisRecommendation;
  } else if (input.isRelevant === false || score < 50) {
    deepAnalysisRecommendation = 'LIT_ONLY';
  } else if (score >= 80 && strongCoverage) {
    deepAnalysisRecommendation = 'DEEP_ANCHOR';
  } else if (stressSignalStrong && score >= 70 && hasConfidentMapping) {
    deepAnalysisRecommendation = 'DEEP_STRESS_TEST';
  } else if (score >= 65 && (hasConfidentMapping || input.recommendation === 'IMPORT' || input.recommendation === 'MAYBE')) {
    deepAnalysisRecommendation = 'DEEP_SUPPORT';
  } else {
    deepAnalysisRecommendation = 'LIT_ONLY';
  }

  const candidateRationale = typeof input.rawDeepAnalysisRationale === 'string'
    ? input.rawDeepAnalysisRationale.trim()
    : '';
  const deepAnalysisRationale = candidateRationale
    ? candidateRationale.slice(0, 280)
    : buildDeepAnalysisFallbackRationale(
      deepAnalysisRecommendation,
      score,
      mappings.length,
      highMedCount,
      sectionSpread
    );

  return {
    deepAnalysisRecommendation,
    deepAnalysisRationale
  };
}

function buildAdvisoryShortlistSummary(
  suggestions: PaperRelevanceAnalysis[],
  maxSuggestions: number
): ShortlistSummary | undefined {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return undefined;
  }

  const desiredTarget = Math.max(12, Math.min(15, maxSuggestions || 12));
  const targetCount = Math.min(desiredTarget, suggestions.length);
  const sorted = [...suggestions].sort((a, b) => {
    const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.paperId).localeCompare(String(b.paperId));
  });

  const anchorsPool = sorted.filter(s => s.deepAnalysisRecommendation === 'DEEP_ANCHOR');
  const stressPool = sorted.filter(s => s.deepAnalysisRecommendation === 'DEEP_STRESS_TEST');
  const supportsPool = sorted.filter(s => s.deepAnalysisRecommendation === 'DEEP_SUPPORT');
  const litPool = sorted.filter(s => s.deepAnalysisRecommendation === 'LIT_ONLY');

  const selected: PaperRelevanceAnalysis[] = [];
  const selectedIds = new Set<string>();
  const pushUnique = (paper: PaperRelevanceAnalysis | undefined) => {
    if (!paper || selectedIds.has(paper.paperId) || selected.length >= targetCount) return;
    selected.push(paper);
    selectedIds.add(paper.paperId);
  };

  for (const paper of anchorsPool) pushUnique(paper);
  for (const paper of stressPool) pushUnique(paper);
  for (const paper of supportsPool) pushUnique(paper);
  for (const paper of litPool) pushUnique(paper);

  if (stressPool.length > 0 && !selected.some(s => s.deepAnalysisRecommendation === 'DEEP_STRESS_TEST')) {
    const topStress = stressPool[0];
    if (topStress) {
      if (selected.length < targetCount) {
        pushUnique(topStress);
      } else if (selected.length > 0) {
        const replaceIdx = selected.findIndex(s => s.deepAnalysisRecommendation !== 'DEEP_ANCHOR');
        const idx = replaceIdx >= 0 ? replaceIdx : selected.length - 1;
        selectedIds.delete(selected[idx].paperId);
        selected[idx] = topStress;
        selectedIds.add(topStress.paperId);
      }
    }
  }

  return {
    anchors: selected.filter(s => s.deepAnalysisRecommendation === 'DEEP_ANCHOR').map(s => s.paperId),
    supports: selected.filter(s => s.deepAnalysisRecommendation === 'DEEP_SUPPORT').map(s => s.paperId),
    stressTests: selected.filter(s => s.deepAnalysisRecommendation === 'DEEP_STRESS_TEST').map(s => s.paperId),
    targetCount,
    notes: 'Advisory shortlist optimized for coverage breadth and at least one stress-test paper when available.'
  };
}

function logDeepAnalysisDistribution(suggestions: PaperRelevanceAnalysis[]) {
  const counts: Record<DeepAnalysisRecommendation, number> = {
    DEEP_ANCHOR: 0,
    DEEP_SUPPORT: 0,
    DEEP_STRESS_TEST: 0,
    LIT_ONLY: 0
  };

  for (const suggestion of suggestions) {
    counts[suggestion.deepAnalysisRecommendation] += 1;
  }

  const total = suggestions.length;
  const anchorRatio = total > 0 ? counts.DEEP_ANCHOR / total : 0;
  console.log('[LiteratureRelevance] Deep analysis label distribution:', counts);
  if (total > 0 && anchorRatio > 0.7) {
    console.warn(`[LiteratureRelevance] Deep labels may be too permissive: DEEP_ANCHOR is ${(anchorRatio * 100).toFixed(1)}% of suggestions`);
  }
  if (total >= 15 && counts.DEEP_STRESS_TEST === 0) {
    console.warn('[LiteratureRelevance] No DEEP_STRESS_TEST papers found for >=15 suggestions (bias risk)');
  }
}

function normalizeSuggestionForOutput(
  suggestion: any,
  blueprint: BlueprintWithSectionPlan | null
): any {
  const mappings = Array.isArray(suggestion?.dimensionMappings)
    ? suggestion.dimensionMappings.filter((dm: any) => dm?.sectionKey && dm?.dimension)
    : [];
  const recommendation = blueprint
    ? (normalizeRecommendation(suggestion?.recommendation, mappings) || 'SKIP')
    : normalizeRecommendation(suggestion?.recommendation, mappings);
  const isRelevant = suggestion?.isRelevant !== false;
  const relevanceScore = Math.min(100, Math.max(0, Number(suggestion?.relevanceScore) || 50));
  const reasoning = String(suggestion?.reasoning || 'No reasoning provided').slice(0, 500);
  const { deepAnalysisRecommendation, deepAnalysisRationale } = deriveDeepAnalysisFields({
    isRelevant,
    relevanceScore,
    recommendation,
    dimensionMappings: mappings,
    citationMeta: suggestion?.citationMeta,
    reasoning,
    rawDeepAnalysisRecommendation: suggestion?.deepAnalysisRecommendation,
    rawDeepAnalysisRationale: suggestion?.deepAnalysisRationale
  });

  return {
    ...suggestion,
    isRelevant,
    relevanceScore,
    reasoning,
    recommendation,
    deepAnalysisRecommendation,
    deepAnalysisRationale,
    referenceArchetype: normalizeReferenceArchetype(suggestion?.referenceArchetype ?? suggestion?.citationMeta?.referenceArchetype),
    archetypeSignal: typeof (suggestion?.archetypeSignal ?? suggestion?.citationMeta?.archetypeSignal) === 'string'
      ? String(suggestion?.archetypeSignal ?? suggestion?.citationMeta?.archetypeSignal).trim().slice(0, 300)
      : null
  };
}

function buildPrompt(
  researchQuestion: string,
  papers: Array<{
    id: string;
    title: string;
    abstract?: string;
    authors?: string[];
    year?: number;
    isOpenAccess?: boolean | null;
    pdfStatus?: string | null;
    archetype?: string | null;
  }>,
  blueprint?: BlueprintWithSectionPlan | null
): string {
  const paperList = papers.map((p, idx) => {
    const authorStr = p.authors?.slice(0, 3).join(', ') || 'Unknown';
    const yearStr = p.year ? ` (${p.year})` : '';
    const openAccess = p.isOpenAccess === true ? 'true' : p.isOpenAccess === false ? 'false' : 'null';
    const pdfStatus = normalizePdfStatus(typeof p.pdfStatus === 'string' ? p.pdfStatus.trim().toUpperCase() : p.pdfStatus);
    const archetype = typeof p.archetype === 'string' && p.archetype.trim() ? p.archetype.trim() : 'UNKNOWN';
    const abstractStr = p.abstract 
      ? `\n   Abstract: ${p.abstract.slice(0, 500)}${p.abstract.length > 500 ? '...' : ''}`
      : '\n   Abstract: Not available';
    
    return `${idx + 1}. [ID: ${p.id}] "${p.title}"
   Authors: ${authorStr}${yearStr}
   isOpenAccess: ${openAccess}
   pdfStatus: ${pdfStatus}
   archetype: ${archetype}${abstractStr}`;
  }).join('\n\n');

  // Build blueprint sections string if available
  let blueprintSection = '';
  let dimensionMappingInstructions = '';
  
  if (blueprint && blueprint.sectionPlan && blueprint.sectionPlan.length > 0) {
    // Filter sections for dimension mapping:
    // - For review papers: include all sections
    // - For other papers: only Introduction, Literature Review, and Methodology
    const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
    const sectionsForMapping = isReview 
      ? blueprint.sectionPlan 
      : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));
    
    console.log(`[LiteratureRelevance] Paper type: ${blueprint.paperTypeCode || 'unknown'}, isReview: ${isReview}, sections for mapping: ${sectionsForMapping.map(s => s.sectionKey).join(', ')}`);
    
    const sectionsText = sectionsForMapping.map((section, idx) => {
      const dimensions = section.mustCover && section.mustCover.length > 0
        ? section.mustCover.map((dim, i) => `    ${i + 1}. "${dim}"`).join('\n')
        : '    (No specific dimensions defined)';
      return `${idx + 1}. ${section.sectionKey} - "${section.purpose}"
   Must Cover Dimensions:
${dimensions}`;
    }).join('\n\n');

    blueprintSection = `
PAPER BLUEPRINT (Frozen Structure):
Central Objective: ${blueprint.centralObjective || 'Not specified'}

SECTIONS AND DIMENSIONS TO COVER:
${sectionsText}
`;

    dimensionMappingInstructions = `
7. DIMENSION MAPPINGS (CRITICAL):
   For each paper, identify which blueprint dimensions it supports:
   - Prefer the dimensionIndex (1-based) from the list above
   - If you provide dimension text, it must match EXACTLY from the blueprint above
   - Provide a grounded remark (1-2 sentences from abstract) explaining how it supports the dimension
   - Assign confidence: HIGH (directly addresses), MEDIUM (partially relevant), LOW (tangentially related)
   - A paper can map to multiple dimensions across different sections
   - Only map if there's concrete evidence in the abstract

8. RECOMMENDATION:
   - "IMPORT" if paper maps to 2+ dimensions with HIGH/MEDIUM confidence
   - "MAYBE" if paper maps to 1 dimension or has only LOW confidence mappings
   - "SKIP" if paper doesn't map to any blueprint dimensions (but might still be useful for background)

9. DEEP ANALYSIS RECOMMENDATION (WORTHINESS ONLY):
   Assign exactly one: DEEP_ANCHOR, DEEP_SUPPORT, DEEP_STRESS_TEST, LIT_ONLY
   - DEEP_ANCHOR: high relevance (typically >=80), strong mapping coverage, likely extractable evidence
   - DEEP_SUPPORT: relevant and mapped but narrower/redundant vs anchors
   - DEEP_STRESS_TEST: contradiction/null/negative/limitation-heavy or alternative setting/method
   - LIT_ONLY: conceptual/background-heavy or weak evidence density for deep extraction
   Do NOT use PDF/Open Access status to decide deep-worthiness.
`;
  }

  const baseTasks = `
For each paper, determine:
1. Key contribution (1 sentence - what's new/important about this paper)
2. Key findings (1 sentence - main results or conclusions)
3. Methodological approach (if relevant to the research question)
4. How it relates to the research question (1-2 sentences, concrete and specific)
5. Limitations or gaps (what they didn't address - useful for positioning your work)
6. Claim types this paper can support (choose up to 3): BACKGROUND, GAP, METHOD, LIMITATION, DATASET, IMPLEMENTATION_CONSTRAINT
7. Evidence boundary (1 sentence: what NOT to claim from this paper)
8. WHERE to cite this paper:
   - Introduction: Good for background/context/motivation?
   - Literature Review: Needs detailed analysis/comparison?
   - Methodology: Reference their method/approach?
   - Comparison: Use as baseline/competing approach?
9. POSITIONAL RELATION to the research question:
   Assign exactly one: REINFORCES | CONTRADICTS | EXTENDS | QUALIFIES | TENSION
   - REINFORCES: Directly supports thesis or framework
   - CONTRADICTS: Conflicting findings or opposing methodology
   - EXTENDS: Related but different domain/population/scale
   - QUALIFIES: Introduces scope limits or boundary conditions
   - TENSION: Reveals unresolved trade-off or competing interpretations
   Write 1 sentence explaining why.
   Do NOT default to REINFORCES if the paper includes boundary conditions, scope limits, or trade-offs relevant to the research question.
10. DEEP ANALYSIS RECOMMENDATION (WORTHINESS ONLY):
   - Assign exactly one: DEEP_ANCHOR, DEEP_SUPPORT, DEEP_STRESS_TEST, LIT_ONLY
   - Use only title/abstract/mapping signals for this decision
   - Do NOT use PDF/Open Access status for this decision
11. REFERENCE ARCHETYPE (classify the paper's own research type):
   - SYSTEM_ALGO_EVALUATION: proposes/evaluates a model, algorithm, pipeline, or system with quantitative metrics
   - CONTROLLED_EXPERIMENTAL_STUDY: tests a hypothesis with intervention/control design, statistical tests, effect sizes
   - EMPIRICAL_OBSERVATIONAL_STUDY: analyzes existing data (cohort, registry, EHR, retrospective) without intervention
   - MIXED_METHODS_APPLIED_STUDY: combines quantitative evaluation with qualitative methods (surveys, interviews, thematic analysis)
   - SYNTHESIS_REVIEW: systematic review, meta-analysis, survey paper, or scoping review that synthesizes other studies
   - POSITION_CONCEPTUAL: position paper, editorial, commentary, or conceptual/theoretical framework proposal
   Classify based on the paper's OWN methodology, not its relevance to your research.`;

  // Build JSON schema based on whether blueprint exists
  const jsonSchema = blueprint ? `{
  "suggestions": [
    {
      "paperId": "<exact paper ID from the list>",
      "isRelevant": true,
      "relevanceScore": <0-100>,
      "reasoning": "<1-2 sentence explanation of overall relevance>",
      "recommendation": "<IMPORT|MAYBE|SKIP>",
      "deepAnalysisRecommendation": "<DEEP_ANCHOR|DEEP_SUPPORT|DEEP_STRESS_TEST|LIT_ONLY>",
      "deepAnalysisRationale": "<1-2 factual lines explaining deep-worthiness>",
      "referenceArchetype": "<SYSTEM_ALGO_EVALUATION|CONTROLLED_EXPERIMENTAL_STUDY|EMPIRICAL_OBSERVATIONAL_STUDY|MIXED_METHODS_APPLIED_STUDY|SYNTHESIS_REVIEW|POSITION_CONCEPTUAL>",
      "archetypeSignal": "<1-line reason for archetype choice based on abstract>",
      "dimensionMappings": [
        {
          "sectionKey": "<exact section key from blueprint>",
          "dimensionIndex": <1-based index from the section list>,
          "dimension": "<exact dimension text from blueprint>",
          "remark": "<1-2 sentence grounded explanation from abstract>",
          "confidence": "<HIGH|MEDIUM|LOW>"
        }
      ],
      "citationMeta": {
        "keyContribution": "<main contribution in 1 sentence>",
        "keyFindings": "<main results/findings in 1 sentence>",
        "methodologicalApproach": "<their method, or null if not relevant>",
        "relevanceToResearch": "<how it connects to the research question>",
        "limitationsOrGaps": "<what they didn't address, or null>",
        "claimTypesSupported": ["<BACKGROUND|GAP|METHOD|LIMITATION|DATASET|IMPLEMENTATION_CONSTRAINT>"],
        "evidenceBoundary": "<one sentence boundary on what this paper does NOT support, or null>",
        "positionalRelation": {
          "relation": "<REINFORCES|CONTRADICTS|EXTENDS|QUALIFIES|TENSION>",
          "rationale": "<one sentence explaining the positional relation>"
        },
        "usage": {
          "introduction": <true/false>,
          "literatureReview": <true/false>,
          "methodology": <true/false>,
          "comparison": <true/false>
        }
      }
    }
  ],
  "summary": "<2-3 sentence summary of coverage analysis>"
}` : `{
  "suggestions": [
    {
      "paperId": "<exact paper ID from the list>",
      "isRelevant": true,
      "relevanceScore": <0-100>,
      "reasoning": "<1-2 sentence explanation of overall relevance>",
      "deepAnalysisRecommendation": "<DEEP_ANCHOR|DEEP_SUPPORT|DEEP_STRESS_TEST|LIT_ONLY>",
      "deepAnalysisRationale": "<1-2 factual lines explaining deep-worthiness>",
      "referenceArchetype": "<SYSTEM_ALGO_EVALUATION|CONTROLLED_EXPERIMENTAL_STUDY|EMPIRICAL_OBSERVATIONAL_STUDY|MIXED_METHODS_APPLIED_STUDY|SYNTHESIS_REVIEW|POSITION_CONCEPTUAL>",
      "archetypeSignal": "<1-line reason for archetype choice based on abstract>",
      "citationMeta": {
        "keyContribution": "<main contribution in 1 sentence>",
        "keyFindings": "<main results/findings in 1 sentence>",
        "methodologicalApproach": "<their method, or null if not relevant>",
        "relevanceToResearch": "<how it connects to the research question>",
        "limitationsOrGaps": "<what they didn't address, or null>",
        "claimTypesSupported": ["<BACKGROUND|GAP|METHOD|LIMITATION|DATASET|IMPLEMENTATION_CONSTRAINT>"],
        "evidenceBoundary": "<one sentence boundary on what this paper does NOT support, or null>",
        "positionalRelation": {
          "relation": "<REINFORCES|CONTRADICTS|EXTENDS|QUALIFIES|TENSION>",
          "rationale": "<one sentence explaining the positional relation>"
        },
        "usage": {
          "introduction": <true/false>,
          "literatureReview": <true/false>,
          "methodology": <true/false>,
          "comparison": <true/false>
        }
      }
    }
  ],
  "summary": "<1-2 sentence summary of the selected papers>"
}`;

  return `You are a research assistant helping identify relevant papers for academic writing.${blueprint ? ' You will map papers to a structured blueprint with specific dimensions to cover.' : ''}

RESEARCH QUESTION:
${researchQuestion}
${blueprintSection}
CANDIDATE PAPERS:
${paperList}

TASK:
Analyze EVERY paper in the list above for relevance to the research question.${blueprint ? ' Map each paper to the blueprint dimensions it supports.' : ''} Assign a relevance score (0-100), recommendation, and deep analysis recommendation to each paper — do NOT skip any.
${baseTasks}${dimensionMappingInstructions}

IMPORTANT CRITERIA:
- Papers with abstracts provide more context - prefer them
- Include foundational/seminal works even if older
- Include papers showing contrasting viewpoints
- Do not guess pdfStatus or isOpenAccess; use provided values only
- Do NOT use PDF/Open Access status to decide deepAnalysisRecommendation
- Consider methodological relevance${blueprint ? `
- Prioritize papers that cover uncovered dimensions
- A paper covering multiple dimensions is more valuable
- Be precise with dimension mapping - only map if abstract provides evidence` : ''}

Respond in the following JSON format ONLY (no markdown, no explanation outside JSON):
${jsonSchema}

Include ALL papers in the response with their analysis. Order by relevance score (highest first).`;
}

function parseAndValidateLLMResponse(
  output: string, 
  validPaperIds: Set<string>,
  blueprint?: BlueprintWithSectionPlan | null
): LLMResponse {
  const normalizeDimension = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();

  const extractJsonBlock = (text: string) => {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }
    return text;
  };

  // Clean up response - remove markdown code blocks if present
  let cleaned = output.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Handle truncated JSON responses (common when output token limit is hit)
  // Try to salvage partial results by fixing common truncation issues
  let parsed: any;
  try {
    parsed = JSON.parse(extractJsonBlock(cleaned));
  } catch (parseError) {
    console.warn('[LiteratureRelevance] Initial JSON parse failed, attempting to salvage truncated response...');
    
    // Try to fix truncated JSON by finding the last complete suggestion
    const salvaged = attemptJsonSalvage(cleaned);
    if (salvaged) {
      console.log('[LiteratureRelevance] Successfully salvaged partial JSON response');
      parsed = salvaged;
    } else {
      // Re-throw if salvage failed
      throw parseError;
    }
  }
  
  if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
    throw new Error('Invalid response format: missing suggestions array');
  }

  // Build valid section keys and dimensions from blueprint
  const validSectionKeys = new Set<string>();
  const validDimensions = new Map<string, Map<string, string>>(); // sectionKey -> normalized -> canonical
  const sectionDimensionsByKey = new Map<string, string[]>(); // sectionKey -> ordered mustCover
  
  if (blueprint?.sectionPlan) {
    const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
    const sectionsForValidation = isReview
      ? blueprint.sectionPlan
      : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));

    for (const section of sectionsForValidation) {
      validSectionKeys.add(section.sectionKey);
      const dimMap = new Map<string, string>();
      for (const dim of section.mustCover || []) {
        dimMap.set(normalizeDimension(dim), dim);
      }
      validDimensions.set(section.sectionKey, dimMap);
      sectionDimensionsByKey.set(section.sectionKey, section.mustCover || []);
    }
  }

  // Validate and filter suggestions
  const validatedSuggestions: PaperRelevanceAnalysis[] = [];
  
  for (const suggestion of parsed.suggestions) {
    if (!suggestion.paperId || !validPaperIds.has(suggestion.paperId)) {
      console.warn(`Skipping invalid paperId: ${suggestion.paperId}`);
      continue;
    }
    
    // Parse citation metadata with defaults
    const rawMeta = suggestion.citationMeta || {};
    const usage = rawMeta.usage || {};
    const claimTypesSupported = Array.isArray(rawMeta.claimTypesSupported)
      ? Array.from(
          new Set(
            rawMeta.claimTypesSupported
              .map((value: unknown) => String(value).trim().toUpperCase())
              .filter((value: string) => CLAIM_TYPE_SET.has(value))
          )
        ).slice(0, 3) as ClaimType[]
      : [];
    const evidenceBoundary = typeof rawMeta.evidenceBoundary === 'string'
      ? rawMeta.evidenceBoundary.trim().slice(0, 400)
      : null;
    const rawPositionalRelation = rawMeta.positionalRelation && typeof rawMeta.positionalRelation === 'object'
      ? rawMeta.positionalRelation as Record<string, unknown>
      : {};
    const parsedPositionalRelation = normalizePositionalRelationLabel(
      rawPositionalRelation.relation
      ?? rawPositionalRelation.label
      ?? suggestion.positionalRelation?.relation
      ?? suggestion.positionalRelation?.label
      ?? suggestion.positionalRelation
    );
    const parsedPositionalRationaleRaw = typeof (rawPositionalRelation.rationale ?? rawPositionalRelation.reason) === 'string'
      ? String(rawPositionalRelation.rationale ?? rawPositionalRelation.reason).trim()
      : (typeof suggestion.positionalRelation?.rationale === 'string'
        ? suggestion.positionalRelation.rationale.trim()
        : typeof suggestion.positionalRelation?.reason === 'string'
          ? suggestion.positionalRelation.reason.trim()
          : '');
    const inferredPositional = inferPositionalRelation(
      String(suggestion.reasoning || ''),
      typeof rawMeta.limitationsOrGaps === 'string' ? rawMeta.limitationsOrGaps : null,
      evidenceBoundary
    );
    let finalPositionalRelation = parsedPositionalRelation || inferredPositional.relation;
    // Guardrail: do not keep REINFORCES when extracted text suggests boundaries/tension.
    if (finalPositionalRelation === 'REINFORCES' && inferredPositional.relation !== 'REINFORCES') {
      finalPositionalRelation = inferredPositional.relation;
    }
    const finalPositionalRationale = (parsedPositionalRationaleRaw || inferredPositional.rationale || 'Relation inferred from available abstract evidence.')
      .slice(0, 300);
    
    const citationMeta: CitationMeta = {
      keyContribution: String(rawMeta.keyContribution || 'Not specified').slice(0, 400),
      keyFindings: String(rawMeta.keyFindings || 'Not specified').slice(0, 400),
      methodologicalApproach: rawMeta.methodologicalApproach 
        ? String(rawMeta.methodologicalApproach).slice(0, 400) 
        : null,
      relevanceToResearch: String(rawMeta.relevanceToResearch || suggestion.reasoning || 'Relevant to research').slice(0, 500),
      limitationsOrGaps: rawMeta.limitationsOrGaps 
        ? String(rawMeta.limitationsOrGaps).slice(0, 500) 
        : null,
      claimTypesSupported,
      evidenceBoundary: evidenceBoundary || null,
      positionalRelation: {
        relation: finalPositionalRelation,
        rationale: finalPositionalRationale
      },
      usage: {
        introduction: Boolean(usage.introduction),
        literatureReview: Boolean(usage.literatureReview !== false), // Default true for relevant papers
        methodology: Boolean(usage.methodology),
        comparison: Boolean(usage.comparison),
      },
      referenceArchetype: normalizeReferenceArchetype(suggestion.referenceArchetype),
      archetypeSignal: typeof suggestion.archetypeSignal === 'string'
        ? suggestion.archetypeSignal.trim().slice(0, 300)
        : null
    };
    
    // Parse dimension mappings if blueprint exists
    let dimensionMappings: DimensionMapping[] | undefined;
    if (blueprint && suggestion.dimensionMappings && Array.isArray(suggestion.dimensionMappings)) {
      dimensionMappings = [];
      for (const dm of suggestion.dimensionMappings) {
        // Validate section key
        if (!dm.sectionKey || !validSectionKeys.has(dm.sectionKey)) {
          console.warn(`Skipping invalid sectionKey: ${dm.sectionKey}`);
          continue;
        }
        
        // Validate dimension exists in that section (fuzzy match for minor variations)
        let matchedDimension: string | undefined;
        const indexValue = dm.dimensionIndex ?? dm.dimension_index;
        const indexNum = typeof indexValue === 'number'
          ? indexValue
          : (typeof indexValue === 'string' && indexValue.trim() !== '' ? Number(indexValue) : undefined);
        if (typeof indexNum === 'number' && Number.isInteger(indexNum)) {
          const dims = sectionDimensionsByKey.get(dm.sectionKey) || [];
          matchedDimension = dims[indexNum - 1];
        } else {
          const sectionDimensions = validDimensions.get(dm.sectionKey);
          const normalizedInput = normalizeDimension(String(dm.dimension || ''));
          matchedDimension = sectionDimensions?.get(normalizedInput);
        }
        if (!matchedDimension) continue;

        dimensionMappings.push({
          sectionKey: dm.sectionKey,
          dimension: String(matchedDimension).slice(0, 500),
          remark: String(dm.remark || 'No remark provided').slice(0, 500),
          confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(dm.confidence) 
            ? dm.confidence 
            : 'MEDIUM'
        });
      }
    }
    
    const recommendation = blueprint
      ? (normalizeRecommendation(suggestion.recommendation, dimensionMappings) || 'SKIP')
      : undefined;
    const normalizedIsRelevant = suggestion.isRelevant !== false;
    const normalizedRelevanceScore = Math.min(100, Math.max(0, Number(suggestion.relevanceScore) || 50));
    const normalizedReasoning = String(suggestion.reasoning || 'No reasoning provided').slice(0, 500);
    const { deepAnalysisRecommendation, deepAnalysisRationale } = deriveDeepAnalysisFields({
      isRelevant: normalizedIsRelevant,
      relevanceScore: normalizedRelevanceScore,
      recommendation,
      dimensionMappings,
      citationMeta,
      reasoning: normalizedReasoning,
      rawDeepAnalysisRecommendation: suggestion.deepAnalysisRecommendation,
      rawDeepAnalysisRationale: suggestion.deepAnalysisRationale
    });

    validatedSuggestions.push({
      paperId: suggestion.paperId,
      isRelevant: normalizedIsRelevant,
      relevanceScore: normalizedRelevanceScore,
      reasoning: normalizedReasoning,
      citationMeta,
      dimensionMappings,
      recommendation,
      deepAnalysisRecommendation,
      deepAnalysisRationale,
      referenceArchetype: citationMeta.referenceArchetype,
      archetypeSignal: citationMeta.archetypeSignal,
    });
  }

  // Calculate blueprint coverage if blueprint exists
  let blueprintCoverage: BlueprintCoverage | undefined;
  if (blueprint?.sectionPlan) {
    blueprintCoverage = calculateBlueprintCoverage(blueprint, validatedSuggestions);
  }

  return {
    suggestions: validatedSuggestions,
    summary: String(parsed.summary || 'AI analysis completed'),
    blueprintCoverage,
  };
}

// Calculate coverage of blueprint dimensions
function calculateBlueprintCoverage(
  blueprint: BlueprintWithSectionPlan,
  suggestions: PaperRelevanceAnalysis[]
): BlueprintCoverage {
  const sectionCoverage: BlueprintCoverage['sectionCoverage'] = {};
  const gaps: BlueprintCoverage['gaps'] = [];
  let totalDimensions = 0;
  let coveredDimensions = 0;

  // Filter sections for coverage calculation (same logic as prompt building)
  const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
  const sectionsForCoverage = isReview 
    ? blueprint.sectionPlan 
    : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));

  for (const section of sectionsForCoverage) {
    const dimensions = section.mustCover || [];
    const dimensionData: BlueprintCoverage['sectionCoverage'][string]['dimensions'] = [];
    
    for (const dimension of dimensions) {
      totalDimensions++;
      
      // Find papers that map to this dimension
      const matchingPapers: string[] = [];
      for (const suggestion of suggestions) {
        if (suggestion.dimensionMappings) {
          const hasMapping = suggestion.dimensionMappings.some(
            dm => dm.sectionKey === section.sectionKey && 
                  dm.dimension.toLowerCase().trim() === dimension.toLowerCase().trim()
          );
          if (hasMapping) {
            matchingPapers.push(suggestion.paperId);
          }
        }
      }
      
      dimensionData.push({
        dimension,
        paperCount: matchingPapers.length,
        papers: matchingPapers
      });
      
      if (matchingPapers.length > 0) {
        coveredDimensions++;
      } else {
        gaps.push({
          sectionKey: section.sectionKey,
          sectionTitle: section.purpose,
          dimension
        });
      }
    }
    
    sectionCoverage[section.sectionKey] = {
      total: dimensions.length,
      covered: dimensionData.filter(d => d.paperCount > 0).length,
      dimensions: dimensionData
    };
  }

  return {
    totalDimensions,
    coveredDimensions,
    gaps,
    sectionCoverage
  };
}

type CitationLookupRow = {
  id: string;
  citationKey: string;
  doiNormalized: string | null;
  paperIdentityKey: string | null;
  importProvider: string | null;
  importProviderPaperId: string | null;
  titleFingerprint: string | null;
  year: number | null;
  firstAuthorNormalized: string | null;
};

type CitationLookupIndex = {
  byId: Map<string, CitationLookupRow>;
  byIdentity: Map<string, CitationLookupRow[]>;
  byDoi: Map<string, CitationLookupRow[]>;
  byProviderAndPaperId: Map<string, CitationLookupRow[]>;
  byProviderPaperId: Map<string, CitationLookupRow[]>;
  byTitleFingerprint: Map<string, CitationLookupRow[]>;
};

function pushLookup(map: Map<string, CitationLookupRow[]>, key: string, value: CitationLookupRow) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(value);
}

function buildCitationLookupIndex(citations: CitationLookupRow[]): CitationLookupIndex {
  const byId = new Map<string, CitationLookupRow>();
  const byIdentity = new Map<string, CitationLookupRow[]>();
  const byDoi = new Map<string, CitationLookupRow[]>();
  const byProviderAndPaperId = new Map<string, CitationLookupRow[]>();
  const byProviderPaperId = new Map<string, CitationLookupRow[]>();
  const byTitleFingerprint = new Map<string, CitationLookupRow[]>();

  for (const row of citations) {
    byId.set(row.id, row);
    if (row.paperIdentityKey) {
      pushLookup(byIdentity, row.paperIdentityKey, row);
    }
    if (row.doiNormalized) {
      pushLookup(byDoi, row.doiNormalized, row);
    }
    if (row.importProviderPaperId) {
      pushLookup(byProviderPaperId, row.importProviderPaperId, row);
      const providerPair = `${normalizeProvider(row.importProvider)}::${row.importProviderPaperId}`;
      pushLookup(byProviderAndPaperId, providerPair, row);
    }
    if (row.titleFingerprint) {
      pushLookup(byTitleFingerprint, row.titleFingerprint, row);
    }
  }

  return {
    byId,
    byIdentity,
    byDoi,
    byProviderAndPaperId,
    byProviderPaperId,
    byTitleFingerprint
  };
}

function narrowCitationCandidates(
  candidates: CitationLookupRow[],
  suggestion: PaperRelevanceAnalysis
): CitationLookupRow[] {
  if (candidates.length <= 1) {
    return candidates;
  }

  const identity = suggestion.paperIdentityKey || '';
  const yearMatch = identity.match(/\|y:([^|]+)/);
  const authorMatch = identity.match(/\|fa:([^|]+)/);
  const expectedYear = yearMatch && yearMatch[1] !== 'na' ? Number(yearMatch[1]) : undefined;
  const expectedAuthor = authorMatch?.[1] && authorMatch[1] !== 'na' ? authorMatch[1] : '';

  let narrowed = candidates;
  if (typeof expectedYear === 'number' && Number.isFinite(expectedYear)) {
    const yearFiltered = narrowed.filter(c => c.year === expectedYear);
    if (yearFiltered.length > 0) {
      narrowed = yearFiltered;
    }
  }
  if (expectedAuthor) {
    const authorFiltered = narrowed.filter(c => (c.firstAuthorNormalized || '') === expectedAuthor);
    if (authorFiltered.length > 0) {
      narrowed = authorFiltered;
    }
  }

  return narrowed;
}

function resolveCitationForSuggestion(
  suggestion: PaperRelevanceAnalysis,
  index: CitationLookupIndex
): CitationLookupRow | null {
  if (suggestion.paperId && index.byId.has(suggestion.paperId)) {
    return index.byId.get(suggestion.paperId) || null;
  }

  if (suggestion.paperIdentityKey) {
    const byIdentity = narrowCitationCandidates(index.byIdentity.get(suggestion.paperIdentityKey) || [], suggestion);
    if (byIdentity.length > 0) {
      return byIdentity[0];
    }
  }

  const normalizedDoi = normalizeDoi(suggestion.paperDoi);
  if (normalizedDoi) {
    const byDoi = narrowCitationCandidates(index.byDoi.get(normalizedDoi) || [], suggestion);
    if (byDoi.length > 0) {
      return byDoi[0];
    }
  }

  const providerPaperId = suggestion.providerPaperId || suggestion.paperId;
  if (providerPaperId) {
    const providerPairKey = `${normalizeProvider(suggestion.paperSource)}::${providerPaperId}`;
    const byProviderPair = narrowCitationCandidates(index.byProviderAndPaperId.get(providerPairKey) || [], suggestion);
    if (byProviderPair.length > 0) {
      return byProviderPair[0];
    }

    const byProviderPaperId = narrowCitationCandidates(index.byProviderPaperId.get(providerPaperId) || [], suggestion);
    if (byProviderPaperId.length > 0) {
      return byProviderPaperId[0];
    }
  }

  const titleFingerprint = normalizeTitle(suggestion.paperTitle);
  if (titleFingerprint) {
    const byTitle = narrowCitationCandidates(index.byTitleFingerprint.get(titleFingerprint) || [], suggestion);
    if (byTitle.length > 0) {
      return byTitle[0];
    }
  }

  return null;
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    // Check feature flag
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

    // Authenticate user
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Get session
    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    // Parse request
    const body = await request.json();
    const { searchRunId, maxSuggestions, includeBlueprint, forceReanalyze } = requestSchema.parse(body);

    // Get the search run
    const searchRun = await prisma.literatureSearchRun.findFirst({
      where: { id: searchRunId, sessionId }
    });
    
    if (!searchRun) {
      return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
    }

    // Collect all search runs for the session to cover the full search space
    const allRuns = await prisma.literatureSearchRun.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 50 // safety cap
    });

    // Merge results across runs, excluding user-removed items
    const removedAcrossRuns = new Set<string>();
    for (const run of allRuns) {
      const removed = (run.aiAnalysis as any)?.removedResultIds;
      if (Array.isArray(removed)) {
        removed.forEach((id: string) => removedAcrossRuns.add(String(id)));
      }
    }

    const aggregatedResults = deduplicatePapers(
      allRuns.flatMap(run => Array.isArray(run.results) ? run.results : [])
    ).filter(p => !removedAcrossRuns.has(String(p.id || p.paperId || p.citationKey || p.doi || '')));

    // Fetch blueprint if requested and available
    let blueprint: BlueprintWithSectionPlan | null = null;
    if (includeBlueprint) {
      blueprint = await blueprintService.getBlueprint(sessionId);
    }

    // Get research question from session or blueprint
    const researchQuestion = blueprint?.centralObjective
      || session.researchTopic?.researchQuestion 
      || session.ideaRecord?.title 
      || session.ideaRecord?.problem
      || 'General research topic';

    // Parse search results
    const results = aggregatedResults;
    if (!results || results.length === 0) {
      return NextResponse.json({ error: 'No search results to analyze' }, { status: 400 });
    }

    // Prefer papers with abstracts — title-only papers produce lower-quality
    // results.  However, if fewer than 5 papers have abstracts fall back to
    // ALL papers so the user still gets analysis.  Skipped IDs are returned
    // in the response so the frontend can show a "No Abstract" indicator.
    const papersWithAbstracts = results.filter((r: any) => r.abstract);
    const papersToAnalyze = papersWithAbstracts.length >= 5
      ? papersWithAbstracts
      : results;  // fallback: include title-only papers when few abstracts are available
    const skippedNoAbstract = results.filter((r: any) => !r.abstract && !papersToAnalyze.includes(r));
    const skippedNoAbstractIds = skippedNoAbstract.map((r: any) => String(r.id || r.paperId || r.citationKey || ''));

    if (papersToAnalyze.length === 0) {
      return NextResponse.json({ error: 'No papers available for analysis (all results lack abstracts and fallback threshold not met)' }, { status: 400 });
    }

    // ── Incremental analysis: skip papers that already have a successful suggestion ──
    // On re-click we only send NEW + PREVIOUSLY-FAILED papers to the LLM.
    // Previous suggestions for successful papers are preserved and merged into the
    // final result.  Pass forceReanalyze=true to bypass this and re-analyze everything.
    const existingAnalysis = (searchRun.aiAnalysis as any) || {};
    const existingRemoved = Array.isArray(existingAnalysis.removedResultIds)
      ? existingAnalysis.removedResultIds
      : [];
    const existingSuggestions: any[] = Array.isArray(existingAnalysis.suggestions) ? existingAnalysis.suggestions : [];
    const normalizedExistingSuggestions = existingSuggestions
      .map(suggestion => normalizeSuggestionForOutput(suggestion, blueprint))
      .filter(suggestion => Boolean(suggestion?.paperId));
    const previouslyFailedIds = new Set<string>(
      Array.isArray(existingAnalysis.analysisMeta?.failedPaperIds) ? existingAnalysis.analysisMeta.failedPaperIds : []
    );
    const alreadyAnalyzedIds = new Set<string>(
      normalizedExistingSuggestions.map((s: any) => String(s.paperId || ''))
    );

    let papersNeedingAnalysis: typeof papersToAnalyze;
    let carriedOverSuggestions: any[] = [];

    if (forceReanalyze || existingSuggestions.length === 0) {
      // First analysis or explicit re-analysis — send everything
      papersNeedingAnalysis = papersToAnalyze;
    } else {
      // Incremental: only analyze papers that are NEW or previously FAILED
      papersNeedingAnalysis = papersToAnalyze.filter((p: any) => {
        const pid = String(p.id || p.paperId || p.citationKey || '');
        return !alreadyAnalyzedIds.has(pid) || previouslyFailedIds.has(pid);
      });
      // Carry over successful suggestions from the previous run
      carriedOverSuggestions = normalizedExistingSuggestions.filter((s: any) => {
        const pid = String(s.paperId || '');
        return !previouslyFailedIds.has(pid);
      });
    }

    console.log(`[LiteratureRelevance] Analyzing ${papersNeedingAnalysis.length} papers (${papersWithAbstracts.length} with abstracts, ${skippedNoAbstract.length} skipped, ${carriedOverSuggestions.length} carried over from previous analysis, forceReanalyze=${forceReanalyze})`);

    // If all papers were already analyzed and none need re-analysis, return the existing data
    if (papersNeedingAnalysis.length === 0 && carriedOverSuggestions.length > 0) {
      const normalizedCarryOver = carriedOverSuggestions
        .map(suggestion => normalizeSuggestionForOutput(suggestion, blueprint))
        .sort((a: any, b: any) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      const shortlistSummary = buildAdvisoryShortlistSummary(normalizedCarryOver, maxSuggestions);
      logDeepAnalysisDistribution(normalizedCarryOver);
      const blueprintCoverage = blueprint?.sectionPlan
        ? calculateBlueprintCoverage(blueprint, normalizedCarryOver)
        : undefined;
      await prisma.literatureSearchRun.update({
        where: { id: searchRunId },
        data: {
          aiAnalysis: {
            ...existingAnalysis,
            suggestions: normalizedCarryOver,
            summary: existingAnalysis.summary || 'All papers already analyzed.',
            blueprintCoverage,
            shortlistSummary,
            removedResultIds: existingRemoved,
          } as any
        }
      });
      return NextResponse.json({
        success: true,
        searchRunId,
        analysis: {
          suggestions: normalizedCarryOver,
          summary: 'All papers already analyzed. Click again with force re-analyze to refresh.',
          blueprintCoverage,
          shortlistSummary,
          analyzedAt: existingAnalysis.analyzedAt || new Date().toISOString(),
          papersAnalyzed: papersToAnalyze.length,
          blueprintIncluded: !!blueprint,
          parseError: false,
          analysisMeta: existingAnalysis.analysisMeta || {
            totalPapers: papersToAnalyze.length,
            reviewedPapers: normalizedCarryOver.length,
            failedPapers: 0,
            failedPaperIds: [],
            skippedNoAbstractIds,
            skippedNoAbstractCount: skippedNoAbstractIds.length,
            status: 'COMPLETED',
            processedBatches: 0,
            totalBatches: 0,
            carriedOverPapers: normalizedCarryOver.length,
            queuedPapers: 0,
            progressUpdatedAt: new Date().toISOString()
          }
        }
      });
    }

    const batches: typeof papersNeedingAnalysis[] = [];
    for (let i = 0; i < papersNeedingAnalysis.length; i += BATCH_SIZE) {
      batches.push(papersNeedingAnalysis.slice(i, i + BATCH_SIZE));
    }

    const parallelBatchLimit = await resolveParallelBatchLimit(user.tenantId);
    console.log(
      `[LiteratureRelevance] Effective parallel batch limit: ${parallelBatchLimit} (default=${DEFAULT_PARALLEL_BATCH_LIMIT}, max=${MAX_PARALLEL_BATCH_LIMIT})`
    );

    const totalBatches = batches.length;
    const carriedSuggestionMap = new Map<string, any>();
    for (const suggestion of carriedOverSuggestions) {
      const normalized = normalizeSuggestionForOutput(suggestion, blueprint);
      const paperId = String(normalized?.paperId || '');
      if (!paperId) continue;
      carriedSuggestionMap.set(paperId, normalized);
    }

    const progressiveSuggestionMap = new Map<string, any>();
    const progressiveFailedPaperIds = new Set<string>();
    let processedBatchCount = 0;
    let expectedBatchCount = totalBatches;
    let progressPersistChain: Promise<void> = Promise.resolve();

    const buildRunningSuggestionsSnapshot = () => {
      const mergedByPaperId = new Map<string, any>();
      for (const [paperId, suggestion] of Array.from(carriedSuggestionMap.entries())) {
        mergedByPaperId.set(paperId, suggestion);
      }
      for (const [paperId, suggestion] of Array.from(progressiveSuggestionMap.entries())) {
        mergedByPaperId.set(paperId, suggestion);
      }
      return Array.from(mergedByPaperId.values()).sort(
        (a: any, b: any) => (b?.relevanceScore || 0) - (a?.relevanceScore || 0)
      );
    };

    const buildRunningAnalysisMeta = () => ({
      totalPapers: papersToAnalyze.length,
      reviewedPapers: Math.min(
        papersToAnalyze.length,
        carriedSuggestionMap.size + progressiveSuggestionMap.size
      ),
      failedPapers: progressiveFailedPaperIds.size,
      failedPaperIds: Array.from(progressiveFailedPaperIds),
      skippedNoAbstractIds,
      skippedNoAbstractCount: skippedNoAbstractIds.length,
      status: 'RUNNING',
      processedBatches: processedBatchCount,
      totalBatches: expectedBatchCount,
      carriedOverPapers: carriedSuggestionMap.size,
      queuedPapers: papersNeedingAnalysis.length,
      progressUpdatedAt: new Date().toISOString()
    });

    const queueRunningProgressUpdate = () => {
      const suggestionsSnapshot = buildRunningSuggestionsSnapshot();
      const analysisMeta = buildRunningAnalysisMeta();
      progressPersistChain = progressPersistChain
        .then(async () => {
          await prisma.literatureSearchRun.update({
            where: { id: searchRunId },
            data: {
              aiAnalysis: {
                ...existingAnalysis,
                suggestions: suggestionsSnapshot,
                summary: 'AI analysis in progress.',
                removedResultIds: existingRemoved,
                analysisMeta
              } as any
            }
          });
        })
        .catch((progressError) => {
          console.error('[LiteratureRelevance] Failed to persist running progress:', progressError);
        });
      return progressPersistChain;
    };

    const applyBatchProgress = (result: {
      suggestions: PaperRelevanceAnalysis[];
      failedPaperIds: string[];
    }) => {
      const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
      for (const suggestion of suggestions) {
        const normalized = normalizeSuggestionForOutput(suggestion, blueprint);
        const paperId = String(normalized?.paperId || '');
        if (!paperId) continue;
        progressiveSuggestionMap.set(paperId, normalized);
        progressiveFailedPaperIds.delete(paperId);
      }

      const failedIds = Array.isArray(result.failedPaperIds) ? result.failedPaperIds : [];
      for (const failedPaperIdRaw of failedIds) {
        const failedPaperId = String(failedPaperIdRaw || '');
        if (!failedPaperId) continue;
        if (progressiveSuggestionMap.has(failedPaperId) || carriedSuggestionMap.has(failedPaperId)) {
          continue;
        }
        progressiveFailedPaperIds.add(failedPaperId);
      }

      processedBatchCount += 1;
      void queueRunningProgressUpdate();
    };

    await queueRunningProgressUpdate();

    // Get auth headers for LLM gateway
    const authHeader = request.headers.get('authorization') || '';
    const headers: Record<string, string> = { authorization: authHeader };

    // Token consumption safeguard: hard cap on LLM calls per request.
    let llmCallCount = 0;
    const MAX_LLM_CALLS_PER_REQUEST = 50;

    const processBatchWithRetry = async (
      batch: typeof papersToAnalyze,
      batchIndex: number,
      depth: number = 0
    ): Promise<{
      suggestions: PaperRelevanceAnalysis[];
      summary: string;
      parseError: boolean;
      outputTokens: number;
      modelClass: string;
      failedPaperIds: string[];
    }> => {
      // Outer try-catch: prevents ANY exception from propagating up and
      // killing Promise.all (which would abort all remaining batches)
      try {
        if (llmCallCount >= MAX_LLM_CALLS_PER_REQUEST) {
          console.warn(`[LiteratureRelevance] LLM call budget exhausted (${llmCallCount}/${MAX_LLM_CALLS_PER_REQUEST}), skipping batch ${batchIndex + 1}`);
          return { suggestions: [], summary: '', parseError: true, outputTokens: 0, modelClass: 'unknown', failedPaperIds: batch.map(p => p.id) };
        }

        const validPaperIds = new Set(batch.map(p => p.id));
        const prompt = buildPrompt(
          researchQuestion,
          batch,
          blueprint
        );

        // The metering system enforces a per-task concurrency limit on active
        // reservations. Retry with back-off so every batch eventually gets a slot.
        const MAX_CONCURRENCY_RETRIES = 8;
        let llmResult: any = null;

        for (let attempt = 0; attempt <= MAX_CONCURRENCY_RETRIES; attempt++) {
          llmResult = await llmGateway.executeLLMOperation(
            { headers },
            {
              taskCode: LITERATURE_TASK_CODE,
              stageCode: LITERATURE_TASK_CODE,
              prompt,
              parameters: {
                temperature: 0.3,
              },
              idempotencyKey: `lit-relevance-${searchRunId}-${Date.now()}-${batchIndex}-${depth}-${attempt}`,
              metadata: {
                sessionId,
                searchRunId,
                paperCount: batch.length,
                batchIndex: batchIndex + 1,
                totalBatches,
                blueprintId: blueprint?.id || null,
              }
            }
          );

          if (llmResult.success && llmResult.response) {
            llmCallCount++;
            break;
          }

          const errorCode = (llmResult.error as any)?.code;
          if (errorCode === 'CONCURRENCY_LIMIT' && attempt < MAX_CONCURRENCY_RETRIES) {
            const delayMs = (attempt + 1) * 3000;
            console.log(`[LiteratureRelevance] Concurrency limit hit for batch ${batchIndex + 1}, waiting ${delayMs / 1000}s (${attempt + 1}/${MAX_CONCURRENCY_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }

          break;
        }

        if (!llmResult?.success || !llmResult?.response) {
          const errorCode = (llmResult?.error as any)?.code || 'UNKNOWN';
          console.error(`[LiteratureRelevance] LLM call failed for batch ${batchIndex + 1} (${errorCode}):`, llmResult?.error);
          return { suggestions: [], summary: '', parseError: true, outputTokens: 0, modelClass: 'unknown', failedPaperIds: batch.map(p => p.id) };
        }

        try {
          const analysis = parseAndValidateLLMResponse(llmResult.response.output, validPaperIds, blueprint);
          const paperById = new Map(batch.map(paper => [paper.id, paper]));
          const enrichedSuggestions = analysis.suggestions.map(suggestion => {
            const paper = paperById.get(suggestion.paperId);
            const normalizedDoi = normalizeDoi(paper?.doi);
            const normalizedTitle = normalizeTitle(paper?.title);
            const firstAuthor = Array.isArray(paper?.authors) && paper?.authors.length > 0
              ? normalizeAuthor(String(paper.authors[0]))
              : 'na';
            const identityKey = normalizedDoi
              ? `doi:${normalizedDoi}`
              : (normalizedTitle
                ? `tfp:${normalizedTitle}|y:${paper?.year || 'na'}|fa:${firstAuthor || 'na'}`
                : undefined);
            return {
              ...suggestion,
              paperTitle: paper?.title,
              paperDoi: paper?.doi,
              paperSource: paper?.source,
              providerPaperId: paper?.id,
              paperIdentityKey: identityKey,
              paperIsOpenAccess: typeof paper?.isOpenAccess === 'boolean' ? paper.isOpenAccess : null,
              paperPdfStatus: normalizePdfStatus(typeof paper?.pdfStatus === 'string' ? paper.pdfStatus.trim().toUpperCase() : paper?.pdfStatus)
            };
          });

          // Track papers the LLM omitted from its response
          const returnedPaperIds = new Set(analysis.suggestions.map(s => s.paperId));
          const missedInBatch = batch.filter(p => !returnedPaperIds.has(p.id));
          let missedSuggestions: PaperRelevanceAnalysis[] = [];
          let missedFailedIds: string[] = [];

          // Immediately retry missed papers with a smaller batch (avoids
          // waiting for a second pass or re-click). Only retry when there
          // are ≥1 missed papers AND the batch had more than just those
          // papers (otherwise we'd loop on the same set).
          if (missedInBatch.length > 0 && missedInBatch.length < batch.length && depth < 2) {
            console.warn(`[LiteratureRelevance] LLM missed ${missedInBatch.length} paper(s) in batch ${batchIndex + 1}, retrying missed papers immediately`);
            const missedResult = await processBatchWithRetry(missedInBatch, batchIndex, depth + 1);
            missedSuggestions = missedResult.suggestions;
            missedFailedIds = missedResult.failedPaperIds;
          } else if (missedInBatch.length > 0) {
            missedFailedIds = missedInBatch.map(p => p.id);
            console.warn(`[LiteratureRelevance] LLM missed ${missedInBatch.length} paper(s) in batch ${batchIndex + 1}: ${missedFailedIds.join(', ')}`);
          }

          return {
            ...analysis,
            suggestions: [...enrichedSuggestions, ...missedSuggestions] as any[],
            parseError: false,
            outputTokens: llmResult.response.outputTokens || 0,
            modelClass: llmResult.response.modelClass || 'unknown',
            failedPaperIds: missedFailedIds
          };
        } catch (parseError) {
          console.error(`[LiteratureRelevance] Failed to parse LLM response for batch ${batchIndex + 1}:`, parseError);
          console.error('Raw output preview:', llmResult.response.output?.slice(0, 500));
          if (batch.length > 1 && depth < 2) {
            console.warn(`[LiteratureRelevance] Retrying batch ${batchIndex + 1} with smaller chunks (size ${batch.length})`);
            const mid = Math.ceil(batch.length / 2);
            // Run both halves in parallel — halves the retry latency
            const [left, right] = await Promise.all([
              processBatchWithRetry(batch.slice(0, mid), batchIndex, depth + 1),
              processBatchWithRetry(batch.slice(mid), batchIndex, depth + 1)
            ]);
            return {
              suggestions: [...left.suggestions, ...right.suggestions],
              summary: left.summary || right.summary || '',
              parseError: left.parseError || right.parseError,
              outputTokens: (left.outputTokens || 0) + (right.outputTokens || 0),
              modelClass: left.modelClass !== 'unknown' ? left.modelClass : right.modelClass,
              failedPaperIds: [...left.failedPaperIds, ...right.failedPaperIds]
            };
          }
          return {
            suggestions: [],
            summary: '',
            parseError: true,
            outputTokens: llmResult.response.outputTokens || 0,
            modelClass: llmResult.response.modelClass || 'unknown',
            failedPaperIds: batch.map(p => p.id)
          };
        }
      } catch (outerError) {
        // Catch-all: LLM gateway exceptions, network errors, unexpected failures
        console.error(`[LiteratureRelevance] Unexpected error in batch ${batchIndex + 1}:`, outerError);
        return {
          suggestions: [],
          summary: '',
          parseError: true,
          outputTokens: 0,
          modelClass: 'unknown',
          failedPaperIds: batch.map(p => p.id)
        };
      }
    };

    const batchResults = await runBatchesInParallel(batches, parallelBatchLimit, async (batch, batchIndex) => {
      const result = await processBatchWithRetry(batch, batchIndex);
      applyBatchProgress(result);
      return result;
    });

    let parseError = batchResults.some(r => r.parseError);
    let totalOutputTokens = batchResults.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
    let newSuggestions = batchResults.flatMap(r => r.suggestions || []);
    let failedPaperIds = Array.from(new Set(batchResults.flatMap(r => r.failedPaperIds || [])));

    // Second pass: retry failed/missed papers (ensures up to 2 attempts per paper)
    if (failedPaperIds.length > 0) {
      const failedSet = new Set(failedPaperIds);
      const retryPapers = papersNeedingAnalysis.filter((p: any) => failedSet.has(p.id));
      if (retryPapers.length > 0) {
        console.log(`[LiteratureRelevance] Retry pass: ${retryPapers.length} paper(s) failed/missed in first pass, retrying with smaller batches...`);
        const retryBatchSize = Math.min(BATCH_SIZE, 4); // smaller batches for retry
        const retryBatches: typeof papersNeedingAnalysis[] = [];
        for (let i = 0; i < retryPapers.length; i += retryBatchSize) {
          retryBatches.push(retryPapers.slice(i, i + retryBatchSize));
        }
        expectedBatchCount = totalBatches + retryBatches.length;
        await queueRunningProgressUpdate();
        const retryResults = await runBatchesInParallel(retryBatches, parallelBatchLimit, async (batch, idx) => {
          const result = await processBatchWithRetry(batch, totalBatches + idx);
          applyBatchProgress(result);
          return result;
        });
        const retrySuggestions = retryResults.flatMap(r => r.suggestions || []);
        const retryStillFailed = Array.from(new Set(retryResults.flatMap(r => r.failedPaperIds || [])));
        totalOutputTokens += retryResults.reduce((sum, r) => sum + (r.outputTokens || 0), 0);

        // Merge: prefer retry results for papers that were retried successfully
        const retryPaperIdSet = new Set(retrySuggestions.map((s: any) => String(s.paperId || '')));
        newSuggestions = [
          ...newSuggestions.filter((s: any) => !retryPaperIdSet.has(String(s.paperId || ''))),
          ...retrySuggestions
        ];
        failedPaperIds = retryStillFailed; // Only papers that failed BOTH passes
        parseError = parseError || retryResults.some(r => r.parseError);
        console.log(`[LiteratureRelevance] Retry complete: ${retrySuggestions.length} recovered, ${retryStillFailed.length} still failed`);
      }
    }

    await progressPersistChain;

    // Merge new suggestions with carried-over suggestions from the previous run.
    // New suggestions take priority (in case a previously-failed paper now succeeded).
    const newSuggestionIds = new Set(newSuggestions.map((s: any) => String(s.paperId || '')));
    const mergedSuggestions = [
      ...newSuggestions,
      ...carriedOverSuggestions.filter((s: any) => !newSuggestionIds.has(String(s.paperId || '')))
    ]
      .map(suggestion => normalizeSuggestionForOutput(suggestion, blueprint))
      .filter(suggestion => Boolean(suggestion?.paperId));

    const totalPapers = papersToAnalyze.length;
    const reviewedPapers = Math.max(0, mergedSuggestions.length);
    // Return ALL analyzed papers sorted by relevance — don't truncate.
    // All papers consumed LLM tokens; discarding results wastes that spend.
    // The frontend can filter/paginate as needed.
    const sortedSuggestions = mergedSuggestions
      .sort((a: any, b: any) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    logDeepAnalysisDistribution(sortedSuggestions);
    const completedBatchCount = Math.max(processedBatchCount, expectedBatchCount);
    const summary = completedBatchCount > 1
      ? `AI analysis completed across ${completedBatchCount} batches.`
      : (batchResults[0]?.summary || 'AI analysis completed.');
    const blueprintCoverage = blueprint?.sectionPlan
      ? calculateBlueprintCoverage(blueprint, sortedSuggestions)
      : undefined;
    const shortlistSummary = buildAdvisoryShortlistSummary(sortedSuggestions, maxSuggestions);
    const modelUsed = batchResults.find(r => r.modelClass && r.modelClass !== 'unknown')?.modelClass || 'unknown';
    const finalAnalysisMeta = {
      totalPapers,
      reviewedPapers,
      failedPapers: failedPaperIds.length,
      failedPaperIds,
      skippedNoAbstractIds,
      skippedNoAbstractCount: skippedNoAbstractIds.length,
      status: 'COMPLETED',
      processedBatches: completedBatchCount,
      totalBatches: expectedBatchCount,
      carriedOverPapers: carriedSuggestionMap.size,
      queuedPapers: papersNeedingAnalysis.length,
      progressUpdatedAt: new Date().toISOString()
    };

    // If all batches failed, return partial success with empty analysis
    if (sortedSuggestions.length === 0 && parseError) {
      await prisma.literatureSearchRun.update({
        where: { id: searchRunId },
        data: {
          aiAnalysis: {
            suggestions: [],
            summary: 'AI analysis completed but results could not be parsed. You can still manually review papers.',
            blueprintCoverage: blueprint ? {
              totalDimensions: blueprint.sectionPlan.reduce((acc, s) => acc + (s.mustCover?.length || 0), 0),
              coveredDimensions: 0,
              gaps: blueprint.sectionPlan.flatMap(s => (s.mustCover || []).map(d => ({
                sectionKey: s.sectionKey,
                sectionTitle: s.purpose,
                dimension: d
              }))),
              sectionCoverage: {}
            } : undefined,
            parseError: true,
            removedResultIds: existingRemoved,
            analysisMeta: finalAnalysisMeta
          } as any,
          aiAnalyzedAt: new Date(),
          aiModelUsed: modelUsed,
          aiTokensUsed: totalOutputTokens,
          researchQuestion,
        }
      });

      return NextResponse.json({
        success: true,
        searchRunId,
        analysis: {
          suggestions: [],
          summary: 'AI analysis completed but results could not be parsed. You can still manually review papers.',
          blueprintCoverage: blueprint ? {
            totalDimensions: blueprint.sectionPlan.reduce((acc, s) => acc + (s.mustCover?.length || 0), 0),
            coveredDimensions: 0,
            gaps: blueprint.sectionPlan.flatMap(s => (s.mustCover || []).map(d => ({
              sectionKey: s.sectionKey,
              sectionTitle: s.purpose,
              dimension: d
            }))),
            sectionCoverage: {}
          } : undefined,
          analyzedAt: new Date().toISOString(),
          papersAnalyzed: papersToAnalyze.length,
          blueprintIncluded: !!blueprint,
          parseError: true,
          analysisMeta: finalAnalysisMeta
        }
      });
    }

    // Update search run with AI analysis
    await prisma.literatureSearchRun.update({
      where: { id: searchRunId },
      data: {
        aiAnalysis: {
          suggestions: sortedSuggestions,
          summary,
          blueprintCoverage,
          shortlistSummary,
          parseError: parseError || undefined,
          removedResultIds: existingRemoved,
          analysisMeta: finalAnalysisMeta
        } as any,
        aiAnalyzedAt: new Date(),
        aiModelUsed: modelUsed,
        aiTokensUsed: totalOutputTokens,
        researchQuestion,
      }
    });

    // ============================================================================
    // PERSIST DIMENSION MAPPINGS TO CitationUsage FOR DRAFTING SERVICE
    // This ensures the "Analyze & Map to Blueprint" button in search results
    // also populates the CitationUsage table used by the drafting service.
    // ============================================================================
    if (blueprint && sortedSuggestions.length > 0) {
      try {
        const citationRows = await prisma.citation.findMany({
          where: { sessionId, isActive: true },
          select: {
            id: true,
            citationKey: true,
            doiNormalized: true,
            paperIdentityKey: true,
            importProvider: true,
            importProviderPaperId: true,
            titleFingerprint: true,
            year: true,
            firstAuthorNormalized: true
          }
        });

        const citationLookup = buildCitationLookupIndex(citationRows as CitationLookupRow[]);

        const mappingsToPersist: PaperBlueprintMapping[] = [];
        const mappedCitationIds = new Set<string>();
        let unmatchedSuggestions = 0;

        for (const suggestion of sortedSuggestions) {
          const citation = resolveCitationForSuggestion(suggestion, citationLookup);
          if (!citation) {
            unmatchedSuggestions++;
            continue;
          }

          mappedCitationIds.add(citation.id);
          const citationMeta = toCitationMetaSnapshot(suggestion);
          const dimensionMappings = suggestion.dimensionMappings || [];
          if (dimensionMappings.length === 0) {
            mappingsToPersist.push({
              paperId: citation.id,
              citationKey: citation.citationKey,
              sectionKey: null,
              dimensionMappings: [],
              mappingStatus: 'UNMAPPED',
              citationMeta
            });
            continue;
          }

          // Group dimension mappings by section
          const bySection = new Map<string, typeof dimensionMappings>();
          for (const dm of dimensionMappings) {
            if (!dm.sectionKey) continue;
            if (!bySection.has(dm.sectionKey)) {
              bySection.set(dm.sectionKey, []);
            }
            bySection.get(dm.sectionKey)!.push(dm);
          }
          
          if (bySection.size === 0) {
            mappingsToPersist.push({
              paperId: citation.id,
              citationKey: citation.citationKey,
              sectionKey: null,
              dimensionMappings: [],
              mappingStatus: 'UNMAPPED',
              citationMeta
            });
            continue;
          }
          
          // Create one mapping entry per section
          for (const [mappedSectionKey, sectionMappings] of Array.from(bySection.entries())) {
            const highMediumCount = sectionMappings.filter(
              (dm: DimensionMapping) => dm.confidence === 'HIGH' || dm.confidence === 'MEDIUM'
            ).length;
            const mappingStatus = highMediumCount >= 2 ? 'MAPPED' 
              : highMediumCount >= 1 ? 'WEAK' 
              : sectionMappings.length > 0 ? 'WEAK' : 'UNMAPPED';
            
            mappingsToPersist.push({
              paperId: citation.id,
              citationKey: citation.citationKey,
              sectionKey: mappedSectionKey,
              dimensionMappings: sectionMappings.map((dm: DimensionMapping) => ({
                dimension: dm.dimension,
                remark: dm.remark,
                confidence: dm.confidence
              })),
              mappingStatus,
              citationMeta
            });
          }
        }

        if (unmatchedSuggestions > 0) {
          console.log(`[LiteratureRelevance] ${unmatchedSuggestions} suggestion(s) could not be reconciled to imported citations yet`);
        }

        // Persist to CitationUsage table
        if (mappingsToPersist.length > 0) {
          const citationIds = Array.from(mappedCitationIds);
          await citationMappingService.clearMappingsForCitations(sessionId, citationIds);
          await citationMappingService.storeMappings(sessionId, mappingsToPersist);
          await prisma.draftingSession.update({
            where: { id: sessionId },
            data: { archetypeEvidenceStale: false }
          });
          console.log(`[LiteratureRelevance] Persisted ${mappingsToPersist.length} mapping row(s) to CitationUsage for ${citationIds.length} citation(s)`);
        }
      } catch (mappingError) {
        // Don't fail the request if mapping persistence fails - just log it
        console.error('[LiteratureRelevance] Failed to persist dimension mappings to CitationUsage:', mappingError);
      }
    }

    const deepLabelCounts = sortedSuggestions.reduce((acc: Record<string, number>, suggestion: any) => {
      const label = suggestion?.deepAnalysisRecommendation;
      if (typeof label === 'string') {
        acc[label] = (acc[label] || 0) + 1;
      }
      return acc;
    }, {});

    const deepCandidateCount = (deepLabelCounts['DEEP_ANCHOR'] || 0) + (deepLabelCounts['DEEP_SUPPORT'] || 0) + (deepLabelCounts['DEEP_STRESS_TEST'] || 0);
    if (deepCandidateCount > 0) {
      console.log(`[LiteratureRelevance] ${deepCandidateCount} DEEP candidates classified (A:${deepLabelCounts['DEEP_ANCHOR'] || 0} S:${deepLabelCounts['DEEP_SUPPORT'] || 0} T:${deepLabelCounts['DEEP_STRESS_TEST'] || 0}) — triggering proactive PDF parsing for papers with PDFs`);
      proactiveParsingService.triggerForSessionCitations(sessionId, ['DEEP_ANCHOR', 'DEEP_SUPPORT', 'DEEP_STRESS_TEST'], 'classification');
    }

    // Log audit
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'LITERATURE_AI_ANALYSIS',
        resource: `literature_search_run:${searchRunId}`,
        meta: {
          sessionId,
          papersAnalyzed: papersToAnalyze.length,
          suggestionsReturned: sortedSuggestions.length,
          tokensUsed: totalOutputTokens,
          blueprintIncluded: !!blueprint,
          dimensionsCovered: blueprintCoverage?.coveredDimensions || 0,
          deepLabelCounts,
        }
      }
    });

    return NextResponse.json({
      success: true,
      searchRunId,
      analysis: {
        suggestions: sortedSuggestions,
        summary,
        blueprintCoverage,
        shortlistSummary,
        analyzedAt: new Date().toISOString(),
        papersAnalyzed: papersToAnalyze.length,
        blueprintIncluded: !!blueprint,
        parseError: parseError || undefined,
        analysisMeta: finalAnalysisMeta
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[LiteratureRelevance] POST error:', error);
    return NextResponse.json({ error: 'Failed to analyze literature relevance' }, { status: 500 });
  }
}

// PATCH - Persist removed search results for a run
export async function PATCH(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const { searchRunId, removedResultIds } = updateSchema.parse(body);

    const searchRun = await prisma.literatureSearchRun.findFirst({
      where: { id: searchRunId, sessionId }
    });

    if (!searchRun) {
      return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
    }

    const existingAnalysis = (searchRun.aiAnalysis as Record<string, any>) || {};
    const existingRemoved = Array.isArray(existingAnalysis.removedResultIds)
      ? existingAnalysis.removedResultIds
      : [];
    const merged = new Set<string>([...existingRemoved, ...removedResultIds]);

    await prisma.literatureSearchRun.update({
      where: { id: searchRunId },
      data: {
        aiAnalysis: {
          ...existingAnalysis,
          removedResultIds: Array.from(merged)
        }
      }
    });

    return NextResponse.json({
      success: true,
      removedResultIds: Array.from(merged)
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[LiteratureRelevance] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update removed results' }, { status: 500 });
  }
}

// GET - Retrieve existing AI analysis for a search run
export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const searchRunId = searchParams.get('searchRunId');
    const progressOnly = searchParams.get('progressOnly') === 'true';

    if (searchRunId) {
      // Get specific search run
      const searchRun = await prisma.literatureSearchRun.findFirst({
        where: { id: searchRunId, sessionId }
      });
      
      if (!searchRun) {
        return NextResponse.json({ error: 'Search run not found' }, { status: 404 });
      }

      if (progressOnly) {
        return NextResponse.json({
          searchRun: {
            id: searchRun.id,
            aiAnalysis: {
              analysisMeta: (searchRun.aiAnalysis as any)?.analysisMeta || null
            }
          }
        });
      }

      const hydratedResults = await hydrateSearchRunResultsWithReferenceState(user.id, searchRun.results);

      return NextResponse.json({
        searchRun: {
          id: searchRun.id,
          query: searchRun.query,
          results: hydratedResults,
          aiAnalysis: searchRun.aiAnalysis,
          aiAnalyzedAt: searchRun.aiAnalyzedAt,
          createdAt: searchRun.createdAt,
        }
      });
    }

    // Get all search runs for session (increased limit to preserve accumulated results across refresh)
    const searchRuns = await prisma.literatureSearchRun.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20, // Increased to preserve more accumulated results
      select: {
        id: true,
        query: true,
        sources: true,
        aiAnalysis: true,
        aiAnalyzedAt: true,
        createdAt: true,
      }
    });

    return NextResponse.json({ searchRuns });

  } catch (error) {
    console.error('[LiteratureRelevance] GET error:', error);
    return NextResponse.json({ error: 'Failed to retrieve search runs' }, { status: 500 });
  }
}
