import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { defaultConfig as meteringDefaultConfig } from '@/lib/metering/config';
import { createReservationService } from '@/lib/metering/reservation';
import { featureFlags } from '@/lib/feature-flags';
import { blueprintService, type BlueprintWithSectionPlan } from '@/lib/services/blueprint-service';
import { citationMappingService, type PaperBlueprintMapping } from '@/lib/services/citation-mapping-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const requestSchema = z.object({
  citations: z.array(z.object({
    id: z.string(),
    title: z.string(),
    abstract: z.string().nullable().optional(),
    authors: z.array(z.string()).optional(),
    year: z.number().nullable().optional(),
    doi: z.string().nullable().optional()
  })).min(1).max(100),
  includeBlueprint: z.boolean().optional().default(true),
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

// ============================================================================
// Section Filtering Helpers (module-level — used by buildPrompt,
// parseAndValidateLLMResponse, and calculateBlueprintCoverage)
// ============================================================================

const LITERATURE_MAPPING_SECTIONS = [
  'introduction',
  'literature_review', 'literature-review', 'literaturereview',
  'background',
  'related_work', 'related-work', 'relatedwork',
  'theoretical_framework', 'theoretical-framework', 'theoreticalframework',
  'methodology', 'methods', 'research_methodology', 'research-methodology',
  'materials_and_methods', 'materials-and-methods'
];

function isLiteratureMappingSection(sectionKey: string): boolean {
  const normalized = sectionKey.toLowerCase().replace(/[\s_-]+/g, '_');
  return LITERATURE_MAPPING_SECTIONS.some(s =>
    normalized.includes(s.replace(/[\s_-]+/g, '_')) ||
    s.replace(/[\s_-]+/g, '_').includes(normalized)
  );
}

function isReviewPaper(paperTypeCode?: string | null): boolean {
  if (!paperTypeCode) return false;
  const normalized = paperTypeCode.toLowerCase();
  return normalized.includes('review') ||
         normalized.includes('survey') ||
         normalized.includes('meta-analysis') ||
         normalized.includes('systematic');
}

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
    console.warn('[CitationMapping] Failed to resolve policy concurrency limit, using default:', error);
  }

  return defaultLimit;
}

// Dimension mapping for blueprint integration
interface DimensionMapping {
  sectionKey: string;
  dimension: string;
  remark: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  dimensionIndex?: number;
}

interface CitationAnalysis {
  paperId: string;
  isRelevant: boolean;
  relevanceScore: number;
  reasoning: string;
  dimensionMappings?: DimensionMapping[];
  recommendation?: 'IMPORT' | 'MAYBE' | 'SKIP';
}

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

interface LLMResponse {
  suggestions: CitationAnalysis[];
  summary: string;
  blueprintCoverage?: BlueprintCoverage;
}

function toMappingStatus(suggestion: CitationAnalysis): PaperBlueprintMapping['mappingStatus'] {
  const mappings = suggestion.dimensionMappings || [];
  if (!mappings.length) {
    return 'UNMAPPED';
  }
  if (mappings.length === 1 && mappings[0].confidence === 'LOW') {
    return 'WEAK';
  }
  return 'MAPPED';
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

function buildPrompt(
  researchQuestion: string,
  papers: Array<{ id: string; title: string; abstract?: string | null; authors?: string[]; year?: number | null }>,
  blueprint: BlueprintWithSectionPlan
): string {
  const paperList = papers.map((p, idx) => {
    const authorStr = p.authors?.slice(0, 3).join(', ') || 'Unknown';
    const yearStr = p.year ? ` (${p.year})` : '';
    const abstractStr = p.abstract 
      ? `\n   Abstract: ${p.abstract.slice(0, 500)}${p.abstract.length > 500 ? '...' : ''}`
      : '\n   Abstract: Not available';
    
    return `${idx + 1}. [ID: ${p.id}] "${p.title}"
   Authors: ${authorStr}${yearStr}${abstractStr}`;
  }).join('\n\n');

  // Filter sections for dimension mapping:
  // - For review papers: include all sections
  // - For other papers: only Introduction, Literature Review, and Methodology
  const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
  const sectionsForMapping = isReview 
    ? blueprint.sectionPlan 
    : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));
  
  console.log(`[CitationMapping] Paper type: ${blueprint.paperTypeCode || 'unknown'}, isReview: ${isReview}, sections for mapping: ${sectionsForMapping.map(s => s.sectionKey).join(', ')}`);

  // Build blueprint sections string
  const sectionsText = sectionsForMapping.map((section, idx) => {
    const dimensions = section.mustCover && section.mustCover.length > 0
      ? section.mustCover.map((dim, i) => `    ${i + 1}. "${dim}"`).join('\n')
      : '    (No specific dimensions defined)';
    return `${idx + 1}. ${section.sectionKey} - "${section.purpose}"
   Must Cover Dimensions:
${dimensions}`;
  }).join('\n\n');

  return `You are a research assistant analyzing imported citations against a paper blueprint. Map each citation to the blueprint dimensions it supports.

RESEARCH OBJECTIVE:
${researchQuestion}

PAPER BLUEPRINT:
Central Objective: ${blueprint.centralObjective || 'Not specified'}

SECTIONS AND DIMENSIONS TO COVER:
${sectionsText}

IMPORTED CITATIONS TO ANALYZE:
${paperList}

TASK:
For each citation, identify which blueprint dimensions it supports:
- Prefer the dimensionIndex (1-based) from the list above
- If you provide dimension text, it must match EXACTLY from the blueprint above
- Provide a grounded remark (1-2 sentences) explaining how it supports the dimension
- Assign confidence: HIGH (directly addresses), MEDIUM (partially relevant), LOW (tangentially related)
- A citation can map to multiple dimensions across different sections
- Only map if there's concrete evidence in the title/abstract

Respond in the following JSON format ONLY (no markdown, no explanation outside JSON):
{
  "suggestions": [
    {
      "paperId": "<exact paper ID from the list>",
      "isRelevant": true,
      "relevanceScore": <0-100>,
      "reasoning": "<1-2 sentence explanation of overall relevance>",
      "recommendation": "<IMPORT|MAYBE|SKIP>",
      "dimensionMappings": [
        {
          "sectionKey": "<exact section key from blueprint>",
          "dimensionIndex": <1-based index from the section list>,
          "dimension": "<exact dimension text from blueprint>",
          "remark": "<1-2 sentence grounded explanation>",
          "confidence": "<HIGH|MEDIUM|LOW>"
        }
      ]
    }
  ],
  "summary": "<2-3 sentence summary of how well the citations cover the blueprint>"
}

Analyze ALL citations provided. Be precise with dimension mapping.`;
}

/**
 * Attempt to salvage a truncated JSON response
 */
function attemptJsonSalvage(truncatedJson: string): { suggestions: any[]; summary: string } | null {
  try {
    const suggestionsMatch = truncatedJson.match(/"suggestions"\s*:\s*\[/);
    if (!suggestionsMatch) return null;
    
    const suggestionsStart = suggestionsMatch.index! + suggestionsMatch[0].length;
    let lastCompleteIndex = -1;
    let braceDepth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = suggestionsStart; i < truncatedJson.length; i++) {
      const char = truncatedJson[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\') { escapeNext = true; continue; }
      if (char === '"' && !escapeNext) { inString = !inString; continue; }
      if (inString) continue;
      if (char === '{') braceDepth++;
      else if (char === '}') {
        braceDepth--;
        if (braceDepth === 0) lastCompleteIndex = i;
      }
    }
    
    if (lastCompleteIndex === -1) return null;
    
    const validSuggestions = truncatedJson.substring(suggestionsStart, lastCompleteIndex + 1);
    const reconstructed = `{"suggestions":[${validSuggestions}],"summary":"Analysis partially completed (response was truncated)"}`;
    const parsed = JSON.parse(reconstructed);
    
    if (!parsed.suggestions || parsed.suggestions.length === 0) return null;
    console.log(`[CitationMapping] Salvaged ${parsed.suggestions.length} complete suggestion(s) from truncated response`);
    return parsed;
  } catch (error) {
    console.error('[CitationMapping] JSON salvage failed:', error);
    return null;
  }
}

function parseAndValidateLLMResponse(
  output: string, 
  validPaperIds: Set<string>,
  blueprint: BlueprintWithSectionPlan
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

  // Clean up response
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

  // Handle truncated JSON responses
  let parsed: any;
  try {
    parsed = JSON.parse(extractJsonBlock(cleaned));
  } catch (parseError) {
    console.warn('[CitationMapping] Initial JSON parse failed, attempting to salvage truncated response...');
    const salvaged = attemptJsonSalvage(cleaned);
    if (salvaged) {
      console.log('[CitationMapping] Successfully salvaged partial JSON response');
      parsed = salvaged;
    } else {
      throw parseError;
    }
  }
  
  if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
    throw new Error('Invalid response format: missing suggestions array');
  }

  // Build valid section keys and dimensions
  const validSectionKeys = new Set<string>();
  const validDimensions = new Map<string, Map<string, string>>();
  const sectionDimensionsByKey = new Map<string, string[]>();

  // Filter sections for dimension mapping:
  // - For review papers: include all sections
  // - For other papers: only Introduction, Literature Review, and Methodology
  const isReview = isReviewPaper(blueprint.paperTypeCode);
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

  // Validate suggestions
  const validatedSuggestions: CitationAnalysis[] = [];
  
  for (const suggestion of parsed.suggestions) {
    if (!suggestion.paperId || !validPaperIds.has(suggestion.paperId)) {
      console.warn(`Skipping invalid paperId: ${suggestion.paperId}`);
      continue;
    }
    
    // Parse dimension mappings
    let dimensionMappings: DimensionMapping[] | undefined;
    if (suggestion.dimensionMappings && Array.isArray(suggestion.dimensionMappings)) {
      dimensionMappings = [];
      for (const dm of suggestion.dimensionMappings) {
        if (!dm.sectionKey || !validSectionKeys.has(dm.sectionKey)) {
          continue;
        }
        let canonical: string | undefined;
        const indexValue = dm.dimensionIndex ?? dm.dimension_index;
        const indexNum = typeof indexValue === 'number'
          ? indexValue
          : (typeof indexValue === 'string' && indexValue.trim() !== '' ? Number(indexValue) : undefined);
        if (typeof indexNum === 'number' && Number.isInteger(indexNum)) {
          const dims = sectionDimensionsByKey.get(dm.sectionKey) || [];
          canonical = dims[indexNum - 1];
        } else {
          const sectionDimensions = validDimensions.get(dm.sectionKey);
          const normalized = normalizeDimension(String(dm.dimension || ''));
          canonical = sectionDimensions?.get(normalized);
        }
        if (!canonical) continue;

        dimensionMappings.push({
          sectionKey: dm.sectionKey,
          dimension: String(canonical).slice(0, 500),
          remark: String(dm.remark || 'No remark provided').slice(0, 500),
          confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(dm.confidence) ? dm.confidence : 'MEDIUM'
        });
      }
    }
    
    // Determine recommendation
    let recommendation: 'IMPORT' | 'MAYBE' | 'SKIP' | undefined;
    if (suggestion.recommendation && ['IMPORT', 'MAYBE', 'SKIP'].includes(suggestion.recommendation)) {
      recommendation = suggestion.recommendation;
    } else if (dimensionMappings && dimensionMappings.length > 0) {
      const highMediumCount = dimensionMappings.filter(
        dm => dm.confidence === 'HIGH' || dm.confidence === 'MEDIUM'
      ).length;
      recommendation = highMediumCount >= 2 ? 'IMPORT' : highMediumCount >= 1 ? 'MAYBE' : 'SKIP';
    } else {
      recommendation = 'SKIP';
    }
    
    validatedSuggestions.push({
      paperId: suggestion.paperId,
      isRelevant: suggestion.isRelevant !== false,
      relevanceScore: Math.min(100, Math.max(0, Number(suggestion.relevanceScore) || 50)),
      reasoning: String(suggestion.reasoning || 'No reasoning provided').slice(0, 500),
      dimensionMappings,
      recommendation,
    });
  }

  // Calculate blueprint coverage
  const blueprintCoverage = calculateBlueprintCoverage(blueprint, validatedSuggestions);

  return {
    suggestions: validatedSuggestions,
    summary: String(parsed.summary || 'Analysis completed'),
    blueprintCoverage,
  };
}

function calculateBlueprintCoverage(
  blueprint: BlueprintWithSectionPlan,
  suggestions: CitationAnalysis[]
): BlueprintCoverage {
  const sectionCoverage: BlueprintCoverage['sectionCoverage'] = {};
  const gaps: BlueprintCoverage['gaps'] = [];
  let totalDimensions = 0;
  let coveredDimensions = 0;

  // Filter sections for coverage calculation
  const isReview = isReviewPaper(blueprint.paperTypeCode ?? undefined);
  const sectionsForCoverage = isReview 
    ? blueprint.sectionPlan 
    : blueprint.sectionPlan.filter(s => isLiteratureMappingSection(s.sectionKey));

  for (const section of sectionsForCoverage) {
    const dimensions = section.mustCover || [];
    const dimensionData: BlueprintCoverage['sectionCoverage'][string]['dimensions'] = [];
    
    for (const dimension of dimensions) {
      totalDimensions++;
      
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

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

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
    const { citations, includeBlueprint } = requestSchema.parse(body);

    // Blueprint is required for mapping
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint || !blueprint.sectionPlan || blueprint.sectionPlan.length === 0) {
      return NextResponse.json({ 
        error: 'Blueprint not found or has no section plan. Please generate a blueprint first.' 
      }, { status: 400 });
    }

    const researchQuestion = blueprint.centralObjective
      || session.researchTopic?.researchQuestion 
      || session.ideaRecord?.title 
      || 'General research topic';

    // Only analyze citations that have abstracts — title-only papers produce
    // low-quality results and waste LLM tokens. Skipped IDs are returned in
    // the response so the frontend can show a "No Abstract" indicator.
    const citationsWithAbstracts = citations.filter(c => c.abstract);
    const skippedNoAbstractIds = citations.filter(c => !c.abstract).map(c => c.id);
    const papersToAnalyze = citationsWithAbstracts;
    const parallelBatchLimit = await resolveParallelBatchLimit(user.tenantId);

    console.log(
      `[CitationMapping] Effective parallel batch limit: ${parallelBatchLimit} (default=${DEFAULT_PARALLEL_BATCH_LIMIT}, max=${MAX_PARALLEL_BATCH_LIMIT})`
    );

    const authHeader = request.headers.get('authorization') || '';
    const headers: Record<string, string> = { authorization: authHeader };

    const batches: typeof papersToAnalyze[] = [];
    for (let i = 0; i < papersToAnalyze.length; i += BATCH_SIZE) {
      batches.push(papersToAnalyze.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = batches.length;

    // Token consumption safeguard: hard cap on LLM calls per request.
    // Worst case without cap: 7 calls/batch (split tree) × batches + second pass.
    // Cap ensures bounded spend even when every batch fails JSON parsing.
    let llmCallCount = 0;
    const MAX_LLM_CALLS_PER_REQUEST = 50;

    const processBatchWithRetry = async (
      batch: typeof papersToAnalyze,
      batchIndex: number,
      depth: number = 0
    ): Promise<{
      suggestions: CitationAnalysis[];
      summary: string;
      parseError: boolean;
      analyzedPaperIds: string[];
      outputTokens: number;
      failedPaperIds: string[];
    }> => {
      // Outer try-catch: prevents ANY exception from propagating up and killing
      // Promise.all (which would abort all remaining batches in parallel execution)
      try {
        // Check LLM call budget before making a call
        if (llmCallCount >= MAX_LLM_CALLS_PER_REQUEST) {
          console.warn(`[CitationMapping] LLM call budget exhausted (${llmCallCount}/${MAX_LLM_CALLS_PER_REQUEST}), skipping batch ${batchIndex + 1} (${batch.length} papers)`);
          return { suggestions: [], summary: '', parseError: true, analyzedPaperIds: [] as string[], outputTokens: 0, failedPaperIds: batch.map(p => p.id) };
        }

        const validPaperIds = new Set(batch.map(p => p.id));
        const prompt = buildPrompt(researchQuestion, batch, blueprint);

        // maxTokensOut and temperature are controlled via super admin LLM config
        // for the LITERATURE_RELEVANCE stage (PlanStageModelConfig).
        // Providers read limits.maxTokensOut from the gateway's model resolver,
        // NOT from parameters — so token limits are set in /super-admin/llm-config.
        //
        // The metering system enforces a per-task concurrency limit on active
        // reservations. When multiple batches run in parallel some may be
        // rejected with CONCURRENCY_LIMIT until a slot frees up. The retry
        // loop below backs off and retries so every batch eventually gets a slot.
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
              idempotencyKey: `citation-mapping-${sessionId}-${Date.now()}-${batchIndex}-${depth}-${attempt}`,
              metadata: {
                sessionId,
                citationCount: batch.length,
                batchIndex: batchIndex + 1,
                totalBatches,
                blueprintId: blueprint.id,
              }
            }
          );

          // Success — count as an actual LLM call and proceed
          if (llmResult.success && llmResult.response) {
            llmCallCount++;
            break;
          }

          // Check if this is a retryable concurrency error
          const errorCode = (llmResult.error as any)?.code;
          if (errorCode === 'CONCURRENCY_LIMIT' && attempt < MAX_CONCURRENCY_RETRIES) {
            const delayMs = (attempt + 1) * 3000; // 3s, 6s, 9s … 24s
            console.log(`[CitationMapping] Concurrency limit hit for batch ${batchIndex + 1}, waiting ${delayMs / 1000}s before retry (${attempt + 1}/${MAX_CONCURRENCY_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }

          // Non-retryable gateway error (quota, policy, etc.)
          break;
        }

        if (!llmResult?.success || !llmResult?.response) {
          const errorCode = (llmResult?.error as any)?.code || 'UNKNOWN';
          console.error(`[CitationMapping] LLM call failed for batch ${batchIndex + 1} (${errorCode}):`, llmResult?.error);
          return { suggestions: [], summary: '', parseError: true, analyzedPaperIds: [] as string[], outputTokens: 0, failedPaperIds: batch.map(p => p.id) };
        }

        try {
          const analysis = parseAndValidateLLMResponse(llmResult.response.output, validPaperIds, blueprint);
          // Only mark papers as analyzed if the LLM actually returned results for them
          const returnedPaperIds = new Set(analysis.suggestions.map(s => s.paperId));
          const missedPapers = batch.filter(p => !returnedPaperIds.has(p.id));
          let missedRetrySuggestions: typeof analysis.suggestions = [];
          let missedRetryAnalyzedIds: string[] = [];
          let missedRetryFailedIds: string[] = [];

          // Immediately retry missed papers with a smaller batch (avoids
          // waiting for the second pass). Only retry when there are ≥1
          // missed papers AND the batch had more than just those papers.
          if (missedPapers.length > 0 && missedPapers.length < batch.length && depth < 2) {
            console.warn(`[CitationMapping] LLM missed ${missedPapers.length} paper(s) in batch ${batchIndex + 1}, retrying missed papers immediately`);
            const missedResult = await processBatchWithRetry(missedPapers, batchIndex, depth + 1);
            missedRetrySuggestions = missedResult.suggestions;
            missedRetryAnalyzedIds = missedResult.analyzedPaperIds;
            missedRetryFailedIds = missedResult.failedPaperIds;
          } else if (missedPapers.length > 0) {
            missedRetryFailedIds = missedPapers.map(p => p.id);
            console.warn(`[CitationMapping] LLM missed ${missedPapers.length} paper(s) in batch ${batchIndex + 1}: ${missedRetryFailedIds.join(', ')}`);
          }

          return {
            ...analysis,
            suggestions: [...analysis.suggestions, ...missedRetrySuggestions],
            analyzedPaperIds: [...Array.from(returnedPaperIds), ...missedRetryAnalyzedIds],
            parseError: false,
            outputTokens: llmResult.response.outputTokens || 0,
            failedPaperIds: missedRetryFailedIds
          };
        } catch (parseError) {
          console.error(`[CitationMapping] Failed to parse LLM response for batch ${batchIndex + 1}:`, parseError);
          console.error('Raw output preview:', llmResult.response.output?.slice(0, 500));
          if (batch.length > 1 && depth < 2) {
            console.warn(`[CitationMapping] Retrying batch ${batchIndex + 1} with smaller chunks (size ${batch.length})`);
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
              analyzedPaperIds: [...left.analyzedPaperIds, ...right.analyzedPaperIds],
              outputTokens: (left.outputTokens || 0) + (right.outputTokens || 0),
              failedPaperIds: [...left.failedPaperIds, ...right.failedPaperIds]
            };
          }
          return {
            suggestions: [],
            summary: '',
            parseError: true,
            analyzedPaperIds: [] as string[],
            outputTokens: llmResult.response.outputTokens || 0,
            failedPaperIds: batch.map(p => p.id)
          };
        }
      } catch (outerError) {
        // Catch-all: LLM gateway exceptions, network errors, unexpected failures
        // Return graceful failure instead of throwing (which would kill Promise.all)
        console.error(`[CitationMapping] Unexpected error in batch ${batchIndex + 1}:`, outerError);
        return {
          suggestions: [],
          summary: '',
          parseError: true,
          analyzedPaperIds: [] as string[],
          outputTokens: 0,
          failedPaperIds: batch.map(p => p.id)
        };
      }
    };

    const batchResults = await runBatchesInParallel(batches, parallelBatchLimit, async (batch, batchIndex) => {
      return processBatchWithRetry(batch, batchIndex);
    });

    let parseError = batchResults.some(r => r.parseError);
    let totalOutputTokens = batchResults.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
    let allSuggestions = batchResults.flatMap(r => r.suggestions || []);
    let analyzedPaperIds = Array.from(new Set(batchResults.flatMap(r => r.analyzedPaperIds || [])));
    let failedPaperIds = Array.from(new Set(batchResults.flatMap(r => r.failedPaperIds || [])));

    // Second pass: retry failed/missed papers (ensures up to 2 attempts per paper)
    if (failedPaperIds.length > 0) {
      const failedSet = new Set(failedPaperIds);
      const retryPapers = papersToAnalyze.filter(p => failedSet.has(p.id));
      if (retryPapers.length > 0) {
        console.log(`[CitationMapping] Retry pass: ${retryPapers.length} paper(s) failed/missed in first pass, retrying with smaller batches...`);
        const retryBatchSize = Math.min(BATCH_SIZE, 4); // smaller batches for retry
        const retryBatches: typeof papersToAnalyze[] = [];
        for (let i = 0; i < retryPapers.length; i += retryBatchSize) {
          retryBatches.push(retryPapers.slice(i, i + retryBatchSize));
        }
        const retryResults = await runBatchesInParallel(retryBatches, parallelBatchLimit, async (batch, idx) => {
          return processBatchWithRetry(batch, totalBatches + idx);
        });
        const retrySuggestions = retryResults.flatMap(r => r.suggestions || []);
        const retryAnalyzedIds = retryResults.flatMap(r => r.analyzedPaperIds || []);
        const retryStillFailed = Array.from(new Set(retryResults.flatMap(r => r.failedPaperIds || [])));
        totalOutputTokens += retryResults.reduce((sum, r) => sum + (r.outputTokens || 0), 0);

        // Merge: prefer retry results for papers that were retried successfully
        const retryPaperIdSet = new Set(retrySuggestions.map(s => s.paperId));
        allSuggestions = [
          ...allSuggestions.filter(s => !retryPaperIdSet.has(s.paperId)),
          ...retrySuggestions
        ];
        analyzedPaperIds = Array.from(new Set([...analyzedPaperIds, ...retryAnalyzedIds]));
        failedPaperIds = retryStillFailed; // Only papers that failed BOTH passes
        parseError = parseError || retryResults.some(r => r.parseError);
        console.log(`[CitationMapping] Retry complete: ${retryAnalyzedIds.length} recovered, ${retryStillFailed.length} still failed`);
      }
    }

    const totalPapers = papersToAnalyze.length;
    const reviewedPapers = Math.max(0, totalPapers - failedPaperIds.length);
    const summary = totalBatches > 1
      ? `Analysis completed across ${totalBatches} batches.`
      : (batchResults[0]?.summary || 'Analysis completed.');
    const blueprintCoverage = calculateBlueprintCoverage(blueprint, allSuggestions);

    const mappedIds = Array.from(new Set(
      allSuggestions
        .map(s => s.paperId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ));
    const citationRows = mappedIds.length > 0
      ? await prisma.citation.findMany({
          where: {
            sessionId,
            id: { in: mappedIds }
          },
          select: {
            id: true,
            citationKey: true
          }
        })
      : [];
    const citationById = new Map(citationRows.map(c => [c.id, c]));
    const unresolvedPaperIds: string[] = [];
    const mappingsToPersist: PaperBlueprintMapping[] = [];

    for (const suggestion of allSuggestions) {
      if (!suggestion.paperId) continue;
      const citation = citationById.get(suggestion.paperId);
      if (!citation) {
        unresolvedPaperIds.push(suggestion.paperId);
        continue;
      }
      const dimensionMappings = suggestion.dimensionMappings || [];
      if (dimensionMappings.length === 0) {
        mappingsToPersist.push({
          paperId: suggestion.paperId,
          citationKey: citation.citationKey,
          sectionKey: null,
          dimensionMappings: [],
          mappingStatus: toMappingStatus(suggestion)
        });
        continue;
      }

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
          paperId: suggestion.paperId,
          citationKey: citation.citationKey,
          sectionKey: null,
          dimensionMappings: [],
          mappingStatus: 'UNMAPPED'
        });
        continue;
      }

      for (const [mappedSectionKey, sectionMappings] of Array.from(bySection.entries())) {
        mappingsToPersist.push({
          paperId: suggestion.paperId,
          citationKey: citation.citationKey,
          sectionKey: mappedSectionKey,
          dimensionMappings: sectionMappings.map((dm: DimensionMapping) => ({
            dimension: dm.dimension,
            remark: dm.remark,
            confidence: dm.confidence
          })),
          mappingStatus: toMappingStatus({
            ...suggestion,
            dimensionMappings: sectionMappings
          })
        });
      }
    }

    if (mappingsToPersist.length > 0) {
      const mappedCitationIds = Array.from(new Set(mappingsToPersist.map(m => m.paperId)));
      await citationMappingService.clearMappingsForCitations(sessionId, mappedCitationIds);
      await citationMappingService.storeMappings(sessionId, mappingsToPersist);
      await prisma.draftingSession.update({
        where: { id: sessionId },
        data: { archetypeEvidenceStale: false }
      });
    }

    // If all batches failed, return partial success with empty analysis
    if (allSuggestions.length === 0 && parseError) {
      return NextResponse.json({
        success: true,
        analysis: {
          suggestions: [],
          summary: 'Analysis completed but results could not be parsed. Try again with fewer citations.',
          blueprintCoverage: {
            totalDimensions: blueprint.sectionPlan.reduce((acc, s) => acc + (s.mustCover?.length || 0), 0),
            coveredDimensions: 0,
            gaps: blueprint.sectionPlan.flatMap(s => (s.mustCover || []).map(d => ({
              sectionKey: s.sectionKey,
              sectionTitle: s.purpose,
              dimension: d
            }))),
            sectionCoverage: {}
          },
          analyzedAt: new Date().toISOString(),
          citationsAnalyzed: 0,
          analyzedPaperIds: [],
          parseError: true,
          analysisMeta: {
            totalPapers,
            reviewedPapers,
            failedPapers: failedPaperIds.length,
            failedPaperIds,
            skippedNoAbstractIds,
            skippedNoAbstractCount: skippedNoAbstractIds.length,
            persistedMappings: 0
          }
        }
      });
    }

    // Log audit
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'CITATION_BLUEPRINT_MAPPING',
        resource: `session:${sessionId}`,
        meta: {
          sessionId,
          citationsAnalyzed: analyzedPaperIds.length,
          dimensionsCovered: blueprintCoverage.coveredDimensions || 0,
          tokensUsed: totalOutputTokens,
          batches: totalBatches,
          persistedMappings: mappingsToPersist.length,
          unresolvedPaperIds
        }
      }
    });

    return NextResponse.json({
      success: true,
      analysis: {
        suggestions: allSuggestions,
        summary,
        blueprintCoverage,
        analyzedAt: new Date().toISOString(),
        citationsAnalyzed: analyzedPaperIds.length,
        analyzedPaperIds,
        parseError: parseError || undefined,
        unresolvedPaperIds,
        analysisMeta: {
          totalPapers,
          reviewedPapers,
          failedPapers: failedPaperIds.length,
          failedPaperIds,
          skippedNoAbstractIds,
          skippedNoAbstractCount: skippedNoAbstractIds.length,
          persistedMappings: mappingsToPersist.length
        }
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[CitationMapping] POST error:', error);
    return NextResponse.json({ error: 'Failed to map citations to blueprint' }, { status: 500 });
  }
}
