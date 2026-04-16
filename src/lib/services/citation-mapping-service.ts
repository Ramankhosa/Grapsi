/**
 * Citation Mapping Service
 * Maps imported citations to blueprint sections and mustCover dimensions
 * 
 * Part B of the SRS: Batch LLM Review & Blueprint-Aligned Paper Mapping
 * - Extends the batch processing pattern from novelty-search-service.ts
 * - Maps papers to sections and dimensions with remarks
 * - Generates coverage reports for gap identification
 */

import { prisma } from '../prisma';
import { llmGateway, type TenantContext } from '../metering';
import { blueprintService, type BlueprintWithSectionPlan, type SectionPlanItem } from './blueprint-service';
import type { Citation, CitationUsage } from '@prisma/client';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Dimension mapping - maps a paper to a specific mustCover dimension
 */
export interface DimensionMapping {
  dimension: string;      // The exact mustCover text
  remark: string;         // 1-2 sentence grounded remark from abstract
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Optional per-paper AI metadata captured during relevance analysis.
 * Stored on Citation.aiMeta so drafting prompts can use richer relevance notes.
 */
export interface CitationMetaSnapshot {
  keyContribution?: string;
  keyFindings?: string;
  methodologicalApproach?: string | null;
  relevanceToResearch?: string;
  limitationsOrGaps?: string | null;
  claimTypesSupported?: Array<
    'BACKGROUND' |
    'GAP' |
    'METHOD' |
    'LIMITATION' |
    'DATASET' |
    'IMPLEMENTATION_CONSTRAINT'
  >;
  evidenceBoundary?: string | null;
  usage?: {
    introduction?: boolean;
    literatureReview?: boolean;
    methodology?: boolean;
    comparison?: boolean;
  };
  relevanceScore?: number;
  analyzedAt?: string;
  referenceArchetype?: string | null;
  archetypeSignal?: string | null;
  positionalRelation?: {
    relation?: 'REINFORCES' | 'CONTRADICTS' | 'EXTENDS' | 'QUALIFIES' | 'TENSION';
    rationale?: string;
  };
}

/**
 * Paper to blueprint mapping result
 */
export interface PaperBlueprintMapping {
  paperId: string;
  citationKey: string;
  sectionKey: string | null;    // null = no clear match (background_only)
  dimensionMappings: DimensionMapping[];
  mappingStatus: 'MAPPED' | 'WEAK' | 'UNMAPPED' | 'ERROR';
  citationMeta?: CitationMetaSnapshot;
}

/**
 * Coverage report showing which dimensions have supporting papers
 */
export interface CoverageReport {
  totalPapers: number;
  mappedPapers: number;
  weakPapers: number;
  unmappedPapers: number;
  errorPapers: number;
  sectionCoverage: Record<string, number>;
  dimensionCoverage: Record<string, {
    count: number;
    papers: Array<{ paperId: string; citationKey: string; remark: string }>;
  }>;
  gaps: Array<{
    sectionKey: string;
    dimension: string;
    message: string;
  }>;
  warnings: string[];
}

/**
 * Mapping result with all data
 */
export interface MappingResult {
  mappings: PaperBlueprintMapping[];
  coverage: CoverageReport;
  blueprintId: string;
}

/**
 * Citation with abstract for mapping
 */
interface CitationForMapping {
  id: string;
  citationKey: string;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  authors: string[];
  positionalRelation?: 'REINFORCES' | 'CONTRADICTS' | 'EXTENDS' | 'QUALIFIES' | 'TENSION' | null;
  positionalRelationRationale?: string | null;
}

// ============================================================================
// Constants
// ============================================================================

// Batch processing configuration (following novelty-search-service pattern)
const BATCH_CONFIG = {
  BATCH_SIZE: 8,            // Papers per LLM call (reduced to avoid JSON truncation)
  MAX_PAPERS_PER_RUN: 100,  // Maximum papers to process in one run
  MAX_DIMENSIONS_PER_PAPER: 4,  // Soft limit on dimensions per paper
  MIN_ABSTRACT_LENGTH: 50,  // Minimum abstract length to consider
  PARALLEL_BATCH_LIMIT: 3   // Parallel LLM calls per mapping run
};

const CLAIM_TYPE_VALUES = [
  'BACKGROUND',
  'GAP',
  'METHOD',
  'LIMITATION',
  'DATASET',
  'IMPLEMENTATION_CONSTRAINT'
] as const;
const CLAIM_TYPE_SET = new Set<string>(CLAIM_TYPE_VALUES);
const POSITIONAL_RELATION_VALUES = [
  'REINFORCES',
  'CONTRADICTS',
  'EXTENDS',
  'QUALIFIES',
  'TENSION'
] as const;
const POSITIONAL_RELATION_SET = new Set<string>(POSITIONAL_RELATION_VALUES);

// ============================================================================
// Section Filtering for Literature Mapping
// ============================================================================

// Sections that should be included in dimension mapping for non-review papers
// Literature citations typically support Introduction, Literature Review, and Methodology
// Results/Discussion sections cite for comparison, not literature grounding
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

// Check if paper type is a review paper (should include all sections)
function isReviewPaper(paperTypeCode?: string | null): boolean {
  if (!paperTypeCode) return false;
  const normalized = paperTypeCode.toLowerCase();
  return normalized.includes('review') || 
         normalized.includes('survey') || 
         normalized.includes('meta-analysis') ||
         normalized.includes('systematic');
}

// Filter blueprint sections for literature mapping
function filterSectionsForLiteratureMapping(
  sections: SectionPlanItem[],
  paperTypeCode?: string | null
): SectionPlanItem[] {
  const isReview = isReviewPaper(paperTypeCode);
  if (isReview) {
    console.log(`📚 Review paper detected (${paperTypeCode}) - including all sections for mapping`);
    return sections;
  }
  
  const filtered = sections.filter(s => isLiteratureMappingSection(s.sectionKey));
  console.log(`📚 Non-review paper (${paperTypeCode || 'unknown'}) - filtered to ${filtered.length} sections: ${filtered.map(s => s.sectionKey).join(', ')}`);
  return filtered;
}

// ============================================================================
// Service Class
// ============================================================================

class CitationMappingService {

  /**
   * Map all imported citations to blueprint dimensions
   * Extends the pattern from novelty-search-service.ts filterRelevantPatentsForReport
   */
  async mapCitationsToBlueprint(
    sessionId: string,
    tenantContext: TenantContext
  ): Promise<MappingResult> {
    console.log(`📚 Starting blueprint mapping for session ${sessionId}`);

    // 1. Get frozen blueprint
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint) {
      throw new Error('Blueprint not found. Generate a blueprint before mapping citations.');
    }
    if (blueprint.status !== 'FROZEN') {
      throw new Error('Blueprint must be frozen before mapping citations. Freeze the blueprint first.');
    }

    // 2. Get all imported citations with abstracts
    const citations = await this.getCitationsForMapping(sessionId);
    
    if (citations.length === 0) {
      return {
        mappings: [],
        coverage: this.generateEmptyCoverageReport(blueprint),
        blueprintId: blueprint.id
      };
    }

    console.log(`📖 Mapping ${citations.length} citations to blueprint...`);

    // 3. Build validation structures ONCE (performance optimization)
    const validationStructures = this.buildBlueprintValidationStructures(blueprint);

    // 4. Process in batches (parallel with limit)
    const batchSize = BATCH_CONFIG.BATCH_SIZE;
    const limitedCitations = citations.slice(0, BATCH_CONFIG.MAX_PAPERS_PER_RUN);
    const totalBatches = Math.ceil(limitedCitations.length / batchSize);
    const batches: CitationForMapping[][] = [];

    for (let i = 0; i < limitedCitations.length; i += batchSize) {
      batches.push(limitedCitations.slice(i, i + batchSize));
    }

    const batchResults = await this.runBatchesInParallel(
      batches,
      BATCH_CONFIG.PARALLEL_BATCH_LIMIT,
      async (batch, batchIndex) => {
        const batchNum = batchIndex + 1;
        console.log(`📋 Processing batch ${batchNum}/${totalBatches} (${batch.length} papers)`);

        return this.mapBatchToBlueprint(
          batch,
          blueprint,
          tenantContext,
          validationStructures
        );
      }
    );

    const allMappings = batchResults.flat();

    // 4. Store mappings in database
    await this.storeMappings(sessionId, allMappings);

    // 5. Generate coverage report
    const coverage = this.generateCoverageReport(blueprint, allMappings);

    console.log(`✅ Mapping complete: ${coverage.mappedPapers} mapped, ${coverage.gaps.length} gaps identified`);

    return {
      mappings: allMappings,
      coverage,
      blueprintId: blueprint.id
    };
  }

  private async runBatchesInParallel<T, R>(
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

  /**
   * Map a batch of papers to blueprint dimensions
   * Analogous to assessPatentRelevance in novelty-search-service
   */
  private async mapBatchToBlueprint(
    papers: CitationForMapping[],
    blueprint: BlueprintWithSectionPlan,
    tenantContext: TenantContext,
    validationStructures?: {
      validDimensions: Set<string>;
      dimensionToCanonical: Map<string, string>;
      validSectionKeys: Set<string>;
      sectionDimensionsByKey: Map<string, string[]>;
    }
  ): Promise<PaperBlueprintMapping[]> {
    
    // Build the comprehensive mapping prompt
    const prompt = this.buildBlueprintMappingPrompt(papers, blueprint);

    try {
      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        {
          taskCode: 'LLM2_DRAFT',
          stageCode: 'CITATION_BLUEPRINT_MAPPING',
          prompt,
          // maxTokensOut is controlled via super admin LLM config for CITATION_BLUEPRINT_MAPPING stage
          parameters: {
            temperature: 0.3,  // Lower temperature for consistent mapping
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            purpose: 'citation_blueprint_mapping',
            batchSize: papers.length
          }
        }
      );

      if (!result.success || !result.response) {
        console.warn('Blueprint mapping failed for batch, marking papers as error');
        return papers.map(p => this.createErrorMapping(p));
      }

      // Use pre-built validation structures or build them (for backwards compatibility)
      const { validDimensions, dimensionToCanonical, validSectionKeys, sectionDimensionsByKey } = 
        validationStructures || this.buildBlueprintValidationStructures(blueprint);

      return this.parseMappingResponse(
        result.response.output, 
        papers, 
        validDimensions,
        validSectionKeys,
        dimensionToCanonical,
        sectionDimensionsByKey
      );

    } catch (error) {
      console.error('Blueprint mapping error:', error);
      return papers.map(p => this.createErrorMapping(p));
    }
  }

  /**
   * Build validation structures from blueprint
   * Returns:
   * - validDimensions: Set of normalized dimension strings for exact matching
   * - dimensionToCanonical: Map from normalized to original blueprint dimension string
   * - validSectionKeys: Set of valid section keys from blueprint
   * 
   * Note: For non-review papers, only Introduction, Literature Review, and Methodology
   * sections are included in dimension mapping. Results/Discussion cite for comparison.
   */
  private buildBlueprintValidationStructures(blueprint: BlueprintWithSectionPlan): {
    validDimensions: Set<string>;
    dimensionToCanonical: Map<string, string>;
    validSectionKeys: Set<string>;
    sectionDimensionsByKey: Map<string, string[]>;
  } {
    const validDimensions = new Set<string>();
    const dimensionToCanonical = new Map<string, string>();
    const validSectionKeys = new Set<string>();
    const sectionDimensionsByKey = new Map<string, string[]>();
    
    // Filter sections for literature mapping (non-review papers exclude Results/Discussion)
    const sectionsForMapping = filterSectionsForLiteratureMapping(
      blueprint.sectionPlan, 
      blueprint.paperTypeCode
    );
    
    for (const section of sectionsForMapping) {
      // Collect valid section keys
      validSectionKeys.add(section.sectionKey);
      sectionDimensionsByKey.set(section.sectionKey, section.mustCover || []);
      
      for (const dimension of section.mustCover) {
        // Normalize: trim whitespace, normalize internal whitespace
        const normalized = this.normalizeDimensionString(dimension);
        validDimensions.add(normalized);
        
        // Store mapping from normalized to ORIGINAL blueprint dimension string
        // This ensures we always store the canonical form
        if (!dimensionToCanonical.has(normalized)) {
          dimensionToCanonical.set(normalized, dimension);
        }
      }
    }
    
    return { validDimensions, dimensionToCanonical, validSectionKeys, sectionDimensionsByKey };
  }

  /**
   * Normalize dimension string for comparison
   * Applied exactly once to both blueprint dimensions and LLM responses
   */
  private normalizeDimensionString(dimension: string): string {
    return dimension
      .trim()
      .replace(/\s+/g, ' ')  // Normalize internal whitespace
      .toLowerCase();         // Case-insensitive matching
  }

  private normalizeSectionKeyString(sectionKey: string): string {
    return sectionKey
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  /**
   * Build the LLM prompt for blueprint mapping
   * More complex than boolean relevance - extracts section + dimensions + remarks
   * Enhanced to use mustCoverTyping for better paper-dimension matching
   * 
   * Note: For non-review papers, only Introduction, Literature Review, and Methodology
   * sections are included. Results/Discussion sections cite for comparison, not grounding.
   */
  private buildBlueprintMappingPrompt(
    papers: CitationForMapping[],
    blueprint: BlueprintWithSectionPlan
  ): string {
    // Filter sections for literature mapping (non-review papers exclude Results/Discussion)
    const sectionsForMapping = filterSectionsForLiteratureMapping(
      blueprint.sectionPlan, 
      blueprint.paperTypeCode
    );
    
    // Build section context with mustCover items (dimensions) and their types
    const sectionContext = sectionsForMapping.map(section => {
      const dimensionsWithTypes = section.mustCover.map((mc, i) => {
        const dimType = section.mustCoverTyping?.[mc] || 'empirical';
        return `  ${i + 1}. "${mc}" [${dimType}]`;
      }).join('\n');
      
      return `
SECTION: ${section.sectionKey}
PURPOSE: ${section.purpose}
MUST COVER (dimensions to find support for):
${dimensionsWithTypes}
EXPECTED CITATIONS: ${section.suggestedCitationCount || 'Not specified'}
MUST AVOID: ${section.mustAvoid.slice(0, 3).join(', ')}`;
    }).join('\n---\n');

    // Build paper context
    const paperContext = papers.map((p, i) => `
PAPER ${i + 1} [ID: ${p.id}] [KEY: ${p.citationKey}]:
- Title: ${p.title}
- Year: ${p.year || 'Unknown'}
- Venue: ${p.venue || 'Unknown'}
- Positional Relation: ${p.positionalRelation || 'Not specified'}
${p.positionalRelationRationale ? `- Positional Rationale: ${p.positionalRelationRationale}` : ''}
- Abstract: ${p.abstract || 'No abstract available'}
`).join('\n');

    return `You are an academic research analyst mapping literature to a paper blueprint.

Your task is to determine which blueprint section each paper supports and which specific dimensions (mustCover items) it provides evidence for.

═══════════════════════════════════════════════════════════════
DIMENSION TYPES (ADVISORY CONTEXT ONLY)
═══════════════════════════════════════════════════════════════
Dimensions may have TYPE annotations for context:
- [foundational]: Typically supported by seminal/historical papers
- [methodological]: Typically supported by technique/method papers
- [empirical]: Typically supported by experimental/data papers
- [comparative]: Typically supported by comparison/benchmark papers
- [gap]: Typically supported by critique/limitation papers

IMPORTANT: Type annotations are ADVISORY only. Do NOT exclude papers based on type mismatch.
A paper that provides relevant evidence for a dimension should be mapped regardless of type.

═══════════════════════════════════════════════════════════════
BLUEPRINT SECTIONS AND DIMENSIONS
═══════════════════════════════════════════════════════════════
${sectionContext}

═══════════════════════════════════════════════════════════════
PAPERS TO MAP
═══════════════════════════════════════════════════════════════
${paperContext}

Note: A paper may include a Positional Relation (REINFORCES, CONTRADICTS, EXTENDS, QUALIFIES, TENSION).
- If CONTRADICTS or TENSION, your remark MUST explicitly describe the disagreement.
- If QUALIFIES, your remark MUST specify the boundary or limitation.
- Do NOT invent contrast.
- If all available evidence genuinely supports the dimension without qualification, it is valid to map all as SUPPORT.

═══════════════════════════════════════════════════════════════
MAPPING TASK (for EACH paper)
═══════════════════════════════════════════════════════════════
1. Identify the MOST appropriate section based on paper content
2. Identify which MUST COVER dimensions (0-4 maximum) the paper provides evidence for
3. Provide the dimensionIndex (1-based) from the list above (dimension text optional if index provided)
4. For EACH matched dimension, write a 1-2 sentence REMARK grounded in the abstract
4. A paper MAY support a dimension even if its type doesn't match the annotation

═══════════════════════════════════════════════════════════════
STRICT REMARK RULES (MANDATORY)
═══════════════════════════════════════════════════════════════
- Each (paper × dimension) pair MUST have its own unique remark
- Remarks MUST be dimension-specific, NOT paper-generic summaries
- 1-2 sentences ONLY per remark
- MUST be grounded in abstract text (no external knowledge)
- NO evaluative or comparative claims beyond what the paper states
- Explain HOW the paper's content supports the specific dimension

═══════════════════════════════════════════════════════════════
MAPPING RULES
═══════════════════════════════════════════════════════════════
- A paper MAY map to 0 dimensions (empty mapping is allowed)
- A paper MAY map to multiple dimensions (maximum 4)
- Use EXACT dimension text from mustCover (copy-paste, without the [type] suffix)
- If no clear section match, set sectionKey to null
- Map based on CONTENT RELEVANCE, not type matching

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON array - one object per paper)
═══════════════════════════════════════════════════════════════
[
  {
    "paperId": "exact paper ID from input",
    "citationKey": "exact citation key from input",
    "sectionKey": "literature_review" | "methodology" | "discussion" | null,
    "dimensionMappings": [
      {
        "dimensionIndex": 1,
        "dimension": "EXACT text from mustCover list (optional if index provided)",
        "remark": "1-2 sentence evidence-specific remark grounded in abstract"
      }
    ]
  }
]

Return ONLY the JSON array, no additional text or explanation.`;
  }

  /**
   * Parse LLM response into structured mappings
   * Enforces exact dimension string matching against blueprint
   * VALIDATES: paperId against inputs, sectionKey against blueprint sections
   */
  private parseMappingResponse(
    output: string,
    papers: CitationForMapping[],
    validDimensions?: Set<string>,
    validSectionKeys?: Set<string>,
    dimensionToCanonical?: Map<string, string>,
    sectionDimensionsByKey?: Map<string, string[]>
  ): PaperBlueprintMapping[] {
    try {
      // Clean JSON from markdown fences
      const cleaned = output
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      const parsed = JSON.parse(cleaned);
      
      if (!Array.isArray(parsed)) {
        throw new Error('Expected array response');
      }

      // Create a map for quick paper lookup
      const paperMap = new Map(papers.map(p => [p.id, p]));

      // Track rejected items for logging
      let rejectedDimensionCount = 0;
      let rejectedPaperIdCount = 0;
      let rejectedSectionKeyCount = 0;

      // Validate and normalize each mapping
      const mappings: PaperBlueprintMapping[] = [];
      
      for (const item of parsed) {
        const paperId = item.paperId || item.paper_id;
        const paper = paperMap.get(paperId);
        
        // VALIDATE: paperId must exist in input papers
        if (!paper) {
          console.warn(`🚫 Rejected mapping: paperId "${paperId}" not found in input papers`);
          rejectedPaperIdCount++;
          continue; // Skip this mapping entirely - don't create orphan mappings
        }
        
        // VALIDATE: sectionKey must be valid if provided
        let validatedSectionKey: string | null = item.sectionKey || item.section_key || null;
        if (validatedSectionKey && validSectionKeys && !validSectionKeys.has(validatedSectionKey)) {
          console.warn(`🚫 Rejected sectionKey "${validatedSectionKey}" for paper "${paperId}" - not in blueprint`);
          rejectedSectionKeyCount++;
          validatedSectionKey = null; // Set to null rather than using invalid section
        }
        
        // Normalize dimension mappings (support dimensionIndex)
        const rawMappings = item.dimensionMappings || item.dimension_mappings || [];
        const normalizedMappings = Array.isArray(rawMappings)
          ? rawMappings.map((dm: any) => {
              const indexValue = dm.dimensionIndex ?? dm.dimension_index;
              const indexNum = typeof indexValue === 'number'
                ? indexValue
                : (typeof indexValue === 'string' && indexValue.trim() !== '' ? Number(indexValue) : undefined);
              if (validatedSectionKey && typeof indexNum === 'number' && Number.isInteger(indexNum)) {
                const dims = sectionDimensionsByKey?.get(validatedSectionKey) || [];
                const canonical = dims[indexNum - 1];
                if (!canonical) return null;
                return { ...dm, dimension: canonical };
              }
              return dm;
            }).filter(Boolean)
          : [];

        // Strict mode with blueprint validation when structures are provided.
        // Falls back to legacy validation for compatibility in tests/util usage.
        let validMappings: DimensionMapping[] = [];
        if (validDimensions && validDimensions.size > 0) {
          const strict = this.validateDimensionMappingsExact(
            normalizedMappings,
            validDimensions,
            dimensionToCanonical
          );
          validMappings = strict.validMappings;
          rejectedDimensionCount += strict.rejected;
        } else {
          validMappings = this.validateDimensionMappings(normalizedMappings);
        }
        
        const mapping: PaperBlueprintMapping = {
          paperId: paper.id, // Use the validated paper ID from our input
          citationKey: paper.citationKey, // Use the known citation key from our input
          sectionKey: validatedSectionKey,
          dimensionMappings: validMappings,
          mappingStatus: this.determineMappingStatus({ dimensionMappings: validMappings })
        };
        
        mappings.push(mapping);
      }

      // Log warnings for rejected items (indicates LLM drift)
      if (rejectedPaperIdCount > 0) {
        console.warn(`⚠️ PAPER ID DRIFT DETECTED: Rejected ${rejectedPaperIdCount} mapping(s) with invalid paperId`);
      }
      if (rejectedSectionKeyCount > 0) {
        console.warn(`⚠️ SECTION KEY DRIFT DETECTED: Rejected ${rejectedSectionKeyCount} sectionKey(s) not in blueprint`);
      }
      if (rejectedDimensionCount > 0) {
        console.warn(`⚠️ DIMENSION DRIFT DETECTED: Rejected ${rejectedDimensionCount} dimension mapping(s) that did not match blueprint exactly`);
      }

      // DEDUPLICATE: If LLM returned same paperId multiple times, merge dimensions
      const deduplicatedMappings = this.deduplicateMappings(mappings);

      // Ensure we return a mapping for every input paper (even if LLM missed some)
      const mappedPaperIds = new Set(deduplicatedMappings.map(m => m.paperId));
      for (const paper of papers) {
        if (!mappedPaperIds.has(paper.id)) {
          console.warn(`⚠️ Paper "${paper.citationKey}" was not returned by LLM, marking as UNMAPPED`);
          deduplicatedMappings.push({
            paperId: paper.id,
            citationKey: paper.citationKey,
            sectionKey: null,
            dimensionMappings: [],
            mappingStatus: 'UNMAPPED'
          });
        }
      }

      return deduplicatedMappings;

    } catch (error) {
      console.error('Failed to parse mapping response:', error);
      // Return error status for all papers
      return papers.map(p => this.createErrorMapping(p));
    }
  }

  /**
   * Validate dimension mappings with EXACT string matching against blueprint
   * Rejects any dimension that doesn't match a blueprint mustCover exactly
   * 
   * STRICT RULE: No paraphrasing, no synonyms - exact match only
   * STORES: The canonical blueprint dimension string, NOT the LLM's version
   */
  private validateDimensionMappingsExact(
    mappings: any[],
    validDimensions: Set<string>,
    dimensionToCanonical?: Map<string, string>
  ): { validMappings: DimensionMapping[]; rejected: number } {
    if (!Array.isArray(mappings)) {
      return { validMappings: [], rejected: 0 };
    }

    const validMappings: DimensionMapping[] = [];
    let rejected = 0;

    for (const dm of mappings.slice(0, BATCH_CONFIG.MAX_DIMENSIONS_PER_PAPER)) {
      if (!dm || typeof dm.dimension !== 'string' || typeof dm.remark !== 'string') {
        rejected++;
        continue;
      }

      // Normalize the LLM-returned dimension for comparison
      const normalizedDimension = this.normalizeDimensionString(dm.dimension);

      // STRICT: Reject if dimension doesn't exactly match a blueprint mustCover
      if (!validDimensions.has(normalizedDimension)) {
        console.warn(`🚫 Rejected dimension (no exact match): "${dm.dimension.slice(0, 60)}..."`);
        rejected++;
        continue;
      }

      // CRITICAL: Use the CANONICAL blueprint dimension string, not the LLM's version
      // This prevents duplicate citationUsage rows due to casing/whitespace differences
      const canonicalDimension = dimensionToCanonical?.get(normalizedDimension) || dm.dimension.trim();

      validMappings.push({
        dimension: canonicalDimension,
        remark: String(dm.remark).trim().slice(0, 500),
        confidence: this.validateConfidence(dm.confidence)
      });
    }

    return { validMappings, rejected };
  }

  private validateConfidence(confidence: any): 'HIGH' | 'MEDIUM' | 'LOW' {
    const valid = ['HIGH', 'MEDIUM', 'LOW'];
    return valid.includes(confidence) ? confidence : 'MEDIUM';
  }

  private sanitizeCitationMeta(meta: CitationMetaSnapshot | undefined): CitationMetaSnapshot | undefined {
    if (!meta) {
      return undefined;
    }

    const cleaned: CitationMetaSnapshot = {};
    if (typeof meta.keyContribution === 'string' && meta.keyContribution.trim()) {
      cleaned.keyContribution = meta.keyContribution.trim().slice(0, 400);
    }
    if (typeof meta.keyFindings === 'string' && meta.keyFindings.trim()) {
      cleaned.keyFindings = meta.keyFindings.trim().slice(0, 400);
    }
    if (typeof meta.methodologicalApproach === 'string') {
      const value = meta.methodologicalApproach.trim();
      cleaned.methodologicalApproach = value ? value.slice(0, 400) : null;
    } else if (meta.methodologicalApproach === null) {
      cleaned.methodologicalApproach = null;
    }
    if (typeof meta.relevanceToResearch === 'string' && meta.relevanceToResearch.trim()) {
      cleaned.relevanceToResearch = meta.relevanceToResearch.trim().slice(0, 500);
    }
    if (typeof meta.limitationsOrGaps === 'string') {
      const value = meta.limitationsOrGaps.trim();
      cleaned.limitationsOrGaps = value ? value.slice(0, 500) : null;
    } else if (meta.limitationsOrGaps === null) {
      cleaned.limitationsOrGaps = null;
    }
    if (Array.isArray(meta.claimTypesSupported)) {
      const claimTypes = Array.from(
        new Set(
          meta.claimTypesSupported
            .map(value => String(value).trim().toUpperCase())
            .filter(value => CLAIM_TYPE_SET.has(value))
        )
      ).slice(0, 3) as Array<
        'BACKGROUND' |
        'GAP' |
        'METHOD' |
        'LIMITATION' |
        'DATASET' |
        'IMPLEMENTATION_CONSTRAINT'
      >;
      if (claimTypes.length > 0) {
        cleaned.claimTypesSupported = claimTypes;
      }
    }
    if (typeof meta.evidenceBoundary === 'string') {
      const value = meta.evidenceBoundary.trim();
      cleaned.evidenceBoundary = value ? value.slice(0, 400) : null;
    } else if (meta.evidenceBoundary === null) {
      cleaned.evidenceBoundary = null;
    }
    if (meta.usage && typeof meta.usage === 'object') {
      cleaned.usage = {
        introduction: Boolean(meta.usage.introduction),
        literatureReview: Boolean(meta.usage.literatureReview),
        methodology: Boolean(meta.usage.methodology),
        comparison: Boolean(meta.usage.comparison)
      };
    }
    if (typeof meta.relevanceScore === 'number' && Number.isFinite(meta.relevanceScore)) {
      cleaned.relevanceScore = Math.max(0, Math.min(100, Math.round(meta.relevanceScore)));
    }
    if (typeof meta.analyzedAt === 'string' && meta.analyzedAt.trim()) {
      cleaned.analyzedAt = meta.analyzedAt;
    }
    if (typeof meta.referenceArchetype === 'string') {
      const value = meta.referenceArchetype.trim();
      cleaned.referenceArchetype = value ? value.slice(0, 80) : null;
    } else if (meta.referenceArchetype === null) {
      cleaned.referenceArchetype = null;
    }
    if (typeof meta.archetypeSignal === 'string') {
      const value = meta.archetypeSignal.trim();
      cleaned.archetypeSignal = value ? value.slice(0, 300) : null;
    } else if (meta.archetypeSignal === null) {
      cleaned.archetypeSignal = null;
    }
    if (meta.positionalRelation && typeof meta.positionalRelation === 'object') {
      const relation = typeof meta.positionalRelation.relation === 'string'
        ? meta.positionalRelation.relation.trim().toUpperCase()
        : '';
      const rationale = typeof meta.positionalRelation.rationale === 'string'
        ? meta.positionalRelation.rationale.trim()
        : '';
      if (POSITIONAL_RELATION_SET.has(relation) || rationale) {
        cleaned.positionalRelation = {
          relation: POSITIONAL_RELATION_SET.has(relation)
            ? relation as NonNullable<CitationMetaSnapshot['positionalRelation']>['relation']
            : undefined,
          rationale: rationale ? rationale.slice(0, 300) : undefined
        };
      }
    }

    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  /**
   * Deduplicate mappings if LLM returned same paperId multiple times
   * Merges dimension mappings and keeps the first sectionKey encountered
   */
  private deduplicateMappings(mappings: PaperBlueprintMapping[]): PaperBlueprintMapping[] {
    const byPaperId = new Map<string, PaperBlueprintMapping>();
    
    for (const mapping of mappings) {
      const existing = byPaperId.get(mapping.paperId);
      
      if (!existing) {
        byPaperId.set(mapping.paperId, { ...mapping });
      } else {
        // Merge: combine dimension mappings, prefer non-null sectionKey
        const mergedDimensions = [...existing.dimensionMappings];
        
        // Add new dimensions that don't already exist (by normalized dimension string)
        const existingDimNormalized = new Set(
          existing.dimensionMappings.map(d => this.normalizeDimensionString(d.dimension))
        );
        
        for (const dim of mapping.dimensionMappings) {
          const normalized = this.normalizeDimensionString(dim.dimension);
          if (!existingDimNormalized.has(normalized)) {
            mergedDimensions.push(dim);
            existingDimNormalized.add(normalized);
          }
        }
        
        // Update the mapping
        existing.dimensionMappings = mergedDimensions.slice(0, BATCH_CONFIG.MAX_DIMENSIONS_PER_PAPER);
        existing.sectionKey = existing.sectionKey || mapping.sectionKey;
        existing.citationMeta = existing.citationMeta || mapping.citationMeta;
        existing.mappingStatus = this.determineMappingStatus({ dimensionMappings: existing.dimensionMappings });
        
        console.warn(`⚠️ Merged duplicate mapping for paper "${mapping.citationKey}"`);
      }
    }
    
    return Array.from(byPaperId.values());
  }

  private determineMappingStatus(item: any): 'MAPPED' | 'WEAK' | 'UNMAPPED' | 'ERROR' {
    const mappings = item.dimensionMappings || item.dimension_mappings || [];
    
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return 'UNMAPPED';
    }
    
    if (mappings.length === 1 && mappings[0]?.confidence === 'LOW') {
      return 'WEAK';
    }
    
    return 'MAPPED';
  }

  private createErrorMapping(paper: CitationForMapping): PaperBlueprintMapping {
    return {
      paperId: paper.id,
      citationKey: paper.citationKey,
      sectionKey: null,
      dimensionMappings: [],
      mappingStatus: 'ERROR'
    };
  }

  /**
   * Get citations with abstracts for mapping
   */
  private async getCitationsForMapping(sessionId: string): Promise<CitationForMapping[]> {
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      select: {
        id: true,
        citationKey: true,
        title: true,
        abstract: true,
        year: true,
        venue: true,
        authors: true,
        notes: true,  // notes sometimes contains abstract
        aiMeta: true
      },
      orderBy: { createdAt: 'asc' }
    });

    // Filter and prepare citations
    return citations
      .map(c => {
        const aiMeta = (c.aiMeta as Record<string, any> | null) || {};
        const rawPositionalRelation = aiMeta.positionalRelation && typeof aiMeta.positionalRelation === 'object'
          ? aiMeta.positionalRelation
          : null;
        const relationCandidate = typeof rawPositionalRelation?.relation === 'string'
          ? rawPositionalRelation.relation.trim().toUpperCase()
          : '';
        const positionalRelation = POSITIONAL_RELATION_SET.has(relationCandidate)
          ? relationCandidate as CitationForMapping['positionalRelation']
          : null;
        const positionalRelationRationale = typeof rawPositionalRelation?.rationale === 'string'
          ? rawPositionalRelation.rationale.trim().slice(0, 300)
          : null;

        return {
          id: c.id,
          citationKey: c.citationKey,
          title: c.title,
          abstract: c.abstract || c.notes || null, // Use notes as fallback for abstract
          year: c.year,
          venue: c.venue,
          authors: c.authors,
          positionalRelation,
          positionalRelationRationale
        };
      })
      .filter(c => {
        // Include papers with at least some content to analyze
        const hasContent = c.title.length > 10 || 
          (c.abstract && c.abstract.length >= BATCH_CONFIG.MIN_ABSTRACT_LENGTH);
        return hasContent;
      });
  }

  /**
   * Store mappings in database
   * Uses CitationUsage model with dedicated dimension fields + aiMeta for summary
   * MERGES aiMeta with existing data rather than overwriting
   */
  async storeMappings(
    sessionId: string,
    mappings: PaperBlueprintMapping[]
  ): Promise<void> {
    const now = new Date();
    
    // DEBUG: Log overall storage attempt
    console.log(`[CitationMappingService] storeMappings called with ${mappings.length} mappings for session ${sessionId}`);
    const withDimensions = mappings.filter(m => m.dimensionMappings.length > 0);
    const withSectionKey = mappings.filter(m => m.sectionKey);
    console.log(`[CitationMappingService]   - ${withDimensions.length} mappings have dimensions`);
    console.log(`[CitationMappingService]   - ${withSectionKey.length} mappings have sectionKey`);
    
    let citationUsageCreated = 0;
    let citationUsageSkipped = 0;
    
    // Process each mapping
    for (const mapping of mappings) {
      try {
        // First, fetch existing citation to get current aiMeta
        const existingCitation = await prisma.citation.findUnique({
          where: { id: mapping.paperId },
          select: { aiMeta: true } as any
        });

        if (!existingCitation) {
          console.warn(`⚠️ Citation ${mapping.paperId} not found during storage, skipping`);
          continue;
        }

        // MERGE aiMeta: preserve existing data, add/update blueprintMapping
        const existingMeta = (existingCitation.aiMeta as Record<string, any>) || {};
        const sanitizedCitationMeta = this.sanitizeCitationMeta(mapping.citationMeta);
        const mergedMeta = {
          ...existingMeta,
          ...(sanitizedCitationMeta || {}),
          blueprintMapping: {
            sectionKey: mapping.sectionKey,
            mappingStatus: mapping.mappingStatus,
            dimensionCount: mapping.dimensionMappings.length,
            mappedAt: now.toISOString()
          }
        };

        await prisma.citation.update({
          where: { id: mapping.paperId },
          data: {
            aiMeta: mergedMeta as any
          }
        });

        if (mapping.mappingStatus === 'ERROR' || !mapping.sectionKey) {
          citationUsageSkipped++;
          continue;
        }

        // Create CitationUsage records for each dimension with proper schema fields
        for (const dim of mapping.dimensionMappings) {
          await this.upsertCitationUsage(
            mapping.paperId,
            mapping.sectionKey!,
            dim,
            mapping.citationKey,
            now
          );
          citationUsageCreated++;
        }
      } catch (error) {
        console.error(`Failed to store mapping for paper ${mapping.paperId}:`, error);
        // Continue with other mappings
      }
    }
    
    // DEBUG: Log final counts
    console.log(`[CitationMappingService] Storage complete: ${citationUsageCreated} CitationUsage records created, ${citationUsageSkipped} mappings skipped (no sectionKey or ERROR)`);
  }

  /**
   * Atomic upsert for CitationUsage to handle race conditions
   * Uses create with conflict handling rather than find-then-create
   */
  private async upsertCitationUsage(
    citationId: string,
    sectionKey: string,
    dim: DimensionMapping,
    citationKey: string,
    now: Date
  ): Promise<void> {
    const usageData = {
      remark: dim.remark,
      confidence: dim.confidence,
      mappedAt: now,
      mappingSource: 'auto' as const,
      contextSnippet: dim.remark,
      inTextFormat: `[${citationKey}]`
    };

    try {
      // Try to find existing first
      const existing = await prisma.citationUsage.findFirst({
        where: {
          citationId,
          sectionKey,
          dimension: dim.dimension as any,
          usageKind: 'DIMENSION_MAPPING'
        }
      });

      if (existing) {
        // Preserve explicit user remaps from being overwritten by re-analysis.
        if ((existing as any).mappingSource === 'manual') {
          return;
        }
        await prisma.citationUsage.update({
          where: { id: existing.id },
          data: usageData
        });
      } else {
        await prisma.citationUsage.create({
          data: {
            citationId,
            sectionKey,
            dimension: dim.dimension as any,
            usageKind: 'DIMENSION_MAPPING',
            ...usageData
          }
        });
      }
    } catch (error: any) {
      // Handle unique constraint violation (race condition)
      // P2002 is Prisma's error code for unique constraint violation
      if (error?.code === 'P2002') {
        console.warn(`⚠️ Race condition detected for citation usage, retrying as update`);
        // Another concurrent request created the record, try to update instead
        const existing = await prisma.citationUsage.findFirst({
          where: {
            citationId,
            sectionKey,
            dimension: dim.dimension as any,
            usageKind: 'DIMENSION_MAPPING'
          }
        });
        
        if (existing) {
          await prisma.citationUsage.update({
            where: { id: existing.id },
            data: usageData
          });
        }
      } else {
        throw error; // Re-throw other errors
      }
    }
  }

  /**
   * Generate coverage report showing which dimensions have supporting papers
   * Uses EXACT dimension matching (no fuzzy/substring matching)
   * 
   * Note: For non-review papers, only Introduction, Literature Review, and Methodology
   * sections are included in coverage calculation. Results/Discussion cite for comparison.
   */
  private generateCoverageReport(
    blueprint: BlueprintWithSectionPlan,
    mappings: PaperBlueprintMapping[]
  ): CoverageReport {
    const report: CoverageReport = {
      totalPapers: mappings.length,
      mappedPapers: mappings.filter(m => m.mappingStatus === 'MAPPED').length,
      weakPapers: mappings.filter(m => m.mappingStatus === 'WEAK').length,
      unmappedPapers: mappings.filter(m => m.mappingStatus === 'UNMAPPED').length,
      errorPapers: mappings.filter(m => m.mappingStatus === 'ERROR').length,
      sectionCoverage: {},
      dimensionCoverage: {},
      gaps: [],
      warnings: []
    };

    // Filter sections for coverage (non-review papers exclude Results/Discussion)
    const sectionsForCoverage = filterSectionsForLiteratureMapping(
      blueprint.sectionPlan, 
      blueprint.paperTypeCode
    );

    // Calculate per-section coverage
    for (const section of sectionsForCoverage) {
      const sectionMappings = mappings.filter(m => m.sectionKey === section.sectionKey);
      report.sectionCoverage[section.sectionKey] = sectionMappings.length;

      // Calculate per-dimension coverage within section using EXACT matching
      for (const dimension of section.mustCover) {
        const normalizedBlueprintDim = this.normalizeDimensionString(dimension);
        const dimKey = `${section.sectionKey}:${dimension}`;
        
        // STRICT: Exact match only - no substring/fuzzy matching
        const supporting = sectionMappings.filter(m => 
          m.dimensionMappings.some(dm => 
            this.normalizeDimensionString(dm.dimension) === normalizedBlueprintDim
          )
        );

        report.dimensionCoverage[dimKey] = {
          count: supporting.length,
          papers: supporting.map(m => {
            // Find the exact matching dimension mapping
            const relevantDim = m.dimensionMappings.find(dm =>
              this.normalizeDimensionString(dm.dimension) === normalizedBlueprintDim
            );
            return {
              paperId: m.paperId,
              citationKey: m.citationKey,
              remark: relevantDim?.remark || ''
            };
          })
        };

        // Identify gaps
        if (supporting.length === 0) {
          report.gaps.push({
            sectionKey: section.sectionKey,
            dimension,
            message: `No papers support: "${dimension.slice(0, 50)}${dimension.length > 50 ? '...' : ''}"`
          });
        }
      }
    }

    // Generate warnings
    if (report.unmappedPapers > report.totalPapers * 0.3) {
      report.warnings.push(`High unmapped rate: ${report.unmappedPapers} of ${report.totalPapers} papers not mapped to any dimension`);
    }

    if (report.gaps.length > 0) {
      report.warnings.push(`${report.gaps.length} dimension(s) have no supporting papers - consider additional literature search`);
    }

    if (report.errorPapers > 0) {
      report.warnings.push(`${report.errorPapers} paper(s) failed to map due to errors`);
    }

    return report;
  }

  private generateEmptyCoverageReport(blueprint: BlueprintWithSectionPlan): CoverageReport {
    const report: CoverageReport = {
      totalPapers: 0,
      mappedPapers: 0,
      weakPapers: 0,
      unmappedPapers: 0,
      errorPapers: 0,
      sectionCoverage: {},
      dimensionCoverage: {},
      gaps: [],
      warnings: ['No citations imported. Import citations before mapping.']
    };

    // Filter sections for coverage (non-review papers exclude Results/Discussion)
    const sectionsForCoverage = filterSectionsForLiteratureMapping(
      blueprint.sectionPlan, 
      blueprint.paperTypeCode
    );

    // All dimensions are gaps
    for (const section of sectionsForCoverage) {
      report.sectionCoverage[section.sectionKey] = 0;
      for (const dimension of section.mustCover) {
        const dimKey = `${section.sectionKey}:${dimension}`;
        report.dimensionCoverage[dimKey] = { count: 0, papers: [] };
        report.gaps.push({
          sectionKey: section.sectionKey,
          dimension,
          message: `No papers support: "${dimension.slice(0, 50)}..."`
        });
      }
    }

    return report;
  }

  /**
   * Get existing mappings for a session
   * Uses both aiMeta (for summary) and CitationUsage (for dimension details)
   */
  async getMappings(sessionId: string): Promise<PaperBlueprintMapping[]> {
    // Get citations with mapping metadata
    const citations = await prisma.citation.findMany({
      where: {
        sessionId,
        isActive: true
      },
      select: {
        id: true,
        citationKey: true,
            aiMeta: true as any,
        usages: {
          where: {
            dimension: { not: null } as any,
            usageKind: 'DIMENSION_MAPPING'
          },
          select: {
            sectionKey: true,
            dimension: true as any,
            remark: true,
            confidence: true
          }
        }
      }
    });

    return citations
      .filter(c => c.aiMeta && (c.aiMeta as any).blueprintMapping)
      .map(c => {
        const bm = (c.aiMeta as any).blueprintMapping;
        const citationMeta = this.sanitizeCitationMeta(c.aiMeta as CitationMetaSnapshot | undefined);
        
        // Build dimension mappings from CitationUsage records
        const dimensionMappings: DimensionMapping[] = c.usages.map(u => ({
          dimension: (u as any).dimension || '',
          remark: u.remark || '',
          confidence: (u.confidence as 'HIGH' | 'MEDIUM' | 'LOW') || 'MEDIUM'
        }));

        return {
          paperId: c.id,
          citationKey: c.citationKey,
          sectionKey: bm.sectionKey || (c.usages[0]?.sectionKey ?? null),
          dimensionMappings,
          mappingStatus: bm.mappingStatus || (dimensionMappings.length > 0 ? 'MAPPED' : 'UNMAPPED'),
          citationMeta
        };
      });
  }

  /**
   * Get mapped citations for a specific section (for section generation)
   * Part C integration point - uses the new schema fields for efficient querying
   */
  async getMappedCitationsForSection(
    sessionId: string,
    sectionKey: string
  ): Promise<Array<{
    dimension: string;
    citations: Array<{
      paperId: string;
      citationKey: string;
      remark: string;
      confidence: string;
    }>;
  }>> {
    const blueprint = await blueprintService.getBlueprint(sessionId);
    if (!blueprint) {
      return [];
    }

    const normalizedRequestedSection = this.normalizeSectionKeyString(sectionKey);
    const sectionPlan = blueprint.sectionPlan.find(
      s => this.normalizeSectionKeyString(s.sectionKey) === normalizedRequestedSection
    );
    if (!sectionPlan) {
      return [];
    }

    // Query CitationUsage records with dimension mappings for this section
    const usages = await prisma.citationUsage.findMany({
      where: {
        citation: { sessionId, isActive: true },
        dimension: { not: null }, // Only get records with dimension mappings
        usageKind: 'DIMENSION_MAPPING',
        inclusionStatus: 'INCLUDED'
      },
      select: {
        citationId: true,
        sectionKey: true,
        dimension: true,
        remark: true,
        confidence: true,
        citation: {
          select: {
            citationKey: true
          }
        }
      }
    });
    const sectionUsages = usages.filter(
      u => this.normalizeSectionKeyString((u as any).sectionKey || '') === this.normalizeSectionKeyString(sectionPlan.sectionKey)
    );

    // Group by dimension from blueprint mustCover using EXACT matching
    const result: Array<{
      dimension: string;
      citations: Array<{
        paperId: string;
        citationKey: string;
        remark: string;
        confidence: string;
      }>;
    }> = [];

    for (const dimension of sectionPlan.mustCover) {
      const normalizedBlueprintDim = this.normalizeDimensionString(dimension);
      
      // STRICT: Exact match only - no substring/fuzzy matching
      const matchingUsages = sectionUsages.filter(u =>
        (u as any).dimension &&
        this.normalizeDimensionString((u as any).dimension) === normalizedBlueprintDim
      );

      result.push({
        dimension,
        citations: matchingUsages.map(u => ({
          paperId: u.citationId,
          citationKey: (u as any).citation?.citationKey || '',
          remark: (u as any).remark || '',
          confidence: (u as any).confidence || 'MEDIUM'
        }))
      });
    }

    return result;
  }

  /**
   * Clear existing mappings for a session (for re-mapping)
   */
  async clearMappings(sessionId: string): Promise<void> {
    // Clear aiMeta blueprintMapping from all citations
    const citations = await prisma.citation.findMany({
      where: { sessionId, isActive: true },
      select: { id: true, aiMeta: true as any }
    });

    for (const c of citations) {
      const aiMeta = c.aiMeta as Record<string, any> | null;
      if (aiMeta?.blueprintMapping) {
        const { blueprintMapping, ...rest } = aiMeta;
        await prisma.citation.update({
          where: { id: c.id },
          data: { aiMeta: Object.keys(rest).length > 0 ? rest : undefined as any }
        });
      }
    }

    // Delete mapping rows written by the mapping flow, keep draft usage rows.
    await prisma.citationUsage.deleteMany({
      where: {
        citation: { sessionId },
        usageKind: 'DIMENSION_MAPPING'
      }
    });
  }

  /**
   * Legacy validator kept for backward compatibility in tests and utility callers.
   * Applies structural validation and light normalization without blueprint strictness.
   */
  private validateDimensionMappings(mappings: any[]): DimensionMapping[] {
    if (!Array.isArray(mappings)) {
      return [];
    }

    const validMappings: DimensionMapping[] = [];
    for (const dm of mappings.slice(0, BATCH_CONFIG.MAX_DIMENSIONS_PER_PAPER)) {
      if (!dm || typeof dm.dimension !== 'string' || typeof dm.remark !== 'string') {
        continue;
      }

      validMappings.push({
        dimension: String(dm.dimension).trim().slice(0, 500),
        remark: String(dm.remark).trim().slice(0, 500),
        confidence: this.validateConfidence(dm.confidence)
      });
    }
    return validMappings;
  }

  /**
   * Clear auto-generated mapping rows for a subset of citations in a session.
   * Used by API chunked remapping to avoid stale dimension rows.
   */
  async clearMappingsForCitations(sessionId: string, citationIds: string[]): Promise<void> {
    if (!citationIds.length) {
      return;
    }

    await prisma.citationUsage.deleteMany({
      where: {
        citationId: { in: citationIds },
        citation: { sessionId },
        usageKind: 'DIMENSION_MAPPING',
        inclusionStatus: 'INCLUDED',
        OR: [
          { mappingSource: null },
          { mappingSource: 'auto' }
        ]
      }
    });
  }
}

// Export singleton instance
export const citationMappingService = new CitationMappingService();

// Export class for testing
export { CitationMappingService };
