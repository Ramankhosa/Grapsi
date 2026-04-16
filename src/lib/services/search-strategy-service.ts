/**
 * Search Strategy Service
 * Generates blueprint-aware literature search strategies and queries
 * 
 * Part A of the SRS: Search Strategy Planning & Query Generation
 * - Phase A1: Search Strategy Planning (LLM judgment)
 * - Phase A2: Query Generation (LLM + deterministic guardrails)
 */

import { prisma } from '../prisma';
import { llmGateway, type TenantContext } from '../metering';
import { blueprintService, type BlueprintWithSectionPlan, type SectionPlanItem } from './blueprint-service';
import { paperTypeService } from './paper-type-service';
import type { 
  CitationSearchStrategy, 
  CitationSearchQuery, 
  SearchQueryCategory,
  SearchStrategyStatus,
  ResearchTopic,
  PaperTypeDefinition
} from '@prisma/client';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Search Plan - Ephemeral planning output from Phase A1
 * Guides query generation but also persisted for audit
 */
export interface SearchPlan {
  breadth: 'LOW' | 'MEDIUM' | 'HIGH';
  depth: 'LOW' | 'MEDIUM' | 'HIGH';
  disciplineWeighting: 'PRIMARY_HEAVY' | 'BALANCED' | 'SECONDARY_HEAVY';
  categoryPriority: Record<SearchQueryCategory, 'HIGH' | 'MEDIUM' | 'LOW'>;
  reasoning?: string;
}

/**
 * Generated Query - Output from Phase A2
 */
export interface GeneratedQuery {
  queryText: string;
  category: SearchQueryCategory;
  searchIntent: string;
  description: string;
  priority: number;
  suggestedSources: string[];
  suggestedYearFrom?: number;
  suggestedYearTo?: number;
}

/**
 * Strategy Generation Input
 */
export interface StrategyGenerationInput {
  sessionId: string;
  researchTopic: ResearchTopic;
  paperTypeCode: string;
  blueprint?: BlueprintWithSectionPlan;
  tenantContext: TenantContext;
}

/**
 * Strategy Generation Result
 */
export interface StrategyGenerationResult {
  strategy: CitationSearchStrategy;
  queries: CitationSearchQuery[];
  searchPlan: SearchPlan;
  coverage: CategoryCoverage;
}

export interface CategoryCoverage {
  totalQueries: number;
  byCategory: Record<string, number>;
  mandatoryCoverageIntents: string[];
  missingIntents: string[];
}

// ============================================================================
// Constants
// ============================================================================

// Deterministic guardrails from SRS A5.1
const QUERY_CONSTRAINTS = {
  MIN_QUERIES: 6,
  MAX_QUERIES: 12,
  PRIORITY_MINIMUMS: {
    HIGH: 2,
    MEDIUM: 1,
    LOW: 0
  },
  PRIORITY_MAXIMUMS: {
    HIGH: 4,
    MEDIUM: 3,
    LOW: 1
  },
  PRIMARY_DISCIPLINE_RATIO: 0.6, // ≥60% queries anchored in primary discipline
  MIN_SECONDARY_QUERIES: 1 // ≥1 query per secondary discipline
};

// Mandatory coverage intents from SRS A5.1
const MANDATORY_INTENTS = [
  'historical_foundational',
  'methodological',
  'comparison_baseline',
  'limitations_gaps'
];

// Default search plan when LLM fails
const DEFAULT_SEARCH_PLAN: SearchPlan = {
  breadth: 'MEDIUM',
  depth: 'MEDIUM',
  disciplineWeighting: 'PRIMARY_HEAVY',
  categoryPriority: {
    CORE_CONCEPTS: 'HIGH',
    DOMAIN_APPLICATION: 'HIGH',
    METHODOLOGY: 'MEDIUM',
    THEORETICAL_FOUNDATION: 'MEDIUM',
    SURVEYS_REVIEWS: 'MEDIUM',
    COMPETING_APPROACHES: 'LOW',
    RECENT_ADVANCES: 'LOW',
    GAP_IDENTIFICATION: 'LOW',
    CUSTOM: 'LOW'
  },
  reasoning: 'Default balanced strategy'
};

// Paper type to search plan adjustments (from SRS A4.3)
const PAPER_TYPE_ADJUSTMENTS: Record<string, Partial<SearchPlan>> = {
  REVIEW_ARTICLE: {
    breadth: 'HIGH',
    categoryPriority: {
      ...DEFAULT_SEARCH_PLAN.categoryPriority,
      SURVEYS_REVIEWS: 'HIGH',
      THEORETICAL_FOUNDATION: 'HIGH',
      RECENT_ADVANCES: 'MEDIUM'
    }
  },
  JOURNAL_ARTICLE: {
    depth: 'HIGH',
    categoryPriority: {
      ...DEFAULT_SEARCH_PLAN.categoryPriority,
      METHODOLOGY: 'HIGH',
      COMPETING_APPROACHES: 'MEDIUM'
    }
  },
  CONFERENCE_PAPER: {
    breadth: 'MEDIUM',
    depth: 'MEDIUM',
    categoryPriority: {
      ...DEFAULT_SEARCH_PLAN.categoryPriority,
      RECENT_ADVANCES: 'HIGH',
      COMPETING_APPROACHES: 'MEDIUM'
    }
  },
  THESIS_PHD: {
    breadth: 'HIGH',
    depth: 'HIGH',
    categoryPriority: {
      ...DEFAULT_SEARCH_PLAN.categoryPriority,
      THEORETICAL_FOUNDATION: 'HIGH',
      SURVEYS_REVIEWS: 'HIGH',
      GAP_IDENTIFICATION: 'HIGH'
    }
  }
};

// ============================================================================
// Service Class
// ============================================================================

class SearchStrategyService {
  
  /**
   * Generate a complete search strategy for a paper session
   * Implements the two-phase architecture from SRS Part A
   */
  async generateStrategy(input: StrategyGenerationInput): Promise<StrategyGenerationResult> {
    const { sessionId, researchTopic, paperTypeCode, tenantContext } = input;

    console.log(`🔍 Generating search strategy for session ${sessionId}`);

    // Check if strategy already exists
    const existingStrategy = await (prisma as any).citationSearchStrategy.findUnique({
      where: { sessionId },
      include: { queries: true }
    });

    if (existingStrategy && existingStrategy.status !== 'DRAFT') {
      console.log('Strategy already exists, returning existing');
      const plan = this.extractSearchPlanFromStrategy(existingStrategy);
      return {
        strategy: existingStrategy,
        queries: existingStrategy.queries,
        searchPlan: plan,
        coverage: this.calculateCoverage(existingStrategy.queries)
      };
    }

    // Get paper type for context
    const paperType = await paperTypeService.getPaperType(paperTypeCode);

    // Get blueprint if available (for mustCover context)
    let blueprint = input.blueprint;
    if (!blueprint) {
      blueprint = await blueprintService.getBlueprint(sessionId) || undefined;
    }

    // Phase A1: Generate Search Plan
    const searchPlan = await this.generateSearchPlan(
      researchTopic,
      paperType,
      blueprint,
      tenantContext
    );

    // Phase A2: Generate Queries with Guardrails
    const queries = await this.generateQueriesWithGuardrails(
      researchTopic,
      paperType,
      blueprint,
      searchPlan,
      tenantContext
    );

    // Persist strategy
    const strategy = await this.persistStrategy(
      sessionId,
      researchTopic,
      searchPlan,
      queries
    );

    const coverage = this.calculateCoverage(strategy.queries);

    console.log(`✅ Strategy generated: ${strategy.queries.length} queries, coverage: ${JSON.stringify(coverage.byCategory)}`);

    return {
      strategy,
      queries: strategy.queries,
      searchPlan,
      coverage
    };
  }

  /**
   * Phase A1: Search Strategy Planning (LLM judgment)
   * Determines breadth, depth, discipline weighting, and category priorities
   */
  private async generateSearchPlan(
    researchTopic: ResearchTopic,
    paperType: PaperTypeDefinition | null,
    blueprint: BlueprintWithSectionPlan | undefined,
    tenantContext: TenantContext
  ): Promise<SearchPlan> {
    
    // Build context for LLM
    const blueprintContext = blueprint ? this.buildBlueprintContext(blueprint) : '';
    
    const prompt = `You are a research methodology expert planning a systematic literature search strategy.

═══════════════════════════════════════════════════════════════
RESEARCH CONTEXT
═══════════════════════════════════════════════════════════════
Title: ${researchTopic.title || 'Untitled'}
Research Question: ${researchTopic.researchQuestion || 'Not specified'}
Keywords: ${(researchTopic.keywords || []).join(', ')}
Methodology: ${researchTopic.methodology || 'Not specified'}
Paper Type: ${paperType?.name || paperType?.code || 'Journal Article'}
${blueprintContext}

═══════════════════════════════════════════════════════════════
TASK
═══════════════════════════════════════════════════════════════
Generate a search plan that determines:
1. Search BREADTH (how wide to cast the net)
2. Search DEPTH (how deep to go in specific areas)
3. Discipline weighting (primary vs secondary research areas)
4. Category priorities for 8 search categories

CATEGORIES TO PRIORITIZE:
- CORE_CONCEPTS: Main topic keywords and concepts
- DOMAIN_APPLICATION: Field-specific applications
- METHODOLOGY: Methods and techniques used
- THEORETICAL_FOUNDATION: Foundational/seminal works
- SURVEYS_REVIEWS: Existing reviews and meta-analyses
- COMPETING_APPROACHES: Alternative methods and baselines
- RECENT_ADVANCES: Latest papers (last 2-3 years)
- GAP_IDENTIFICATION: Papers highlighting research gaps

PLANNING RULES:
- REVIEW papers need HIGH breadth, HIGH surveys/theory
- EMPIRICAL papers need HIGH depth, HIGH methodology/baselines
- THEORETICAL papers need HIGH theoretical foundation
- Multidisciplinary: primary discipline gets depth, secondary gets coverage

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only)
═══════════════════════════════════════════════════════════════
{
  "breadth": "LOW" | "MEDIUM" | "HIGH",
  "depth": "LOW" | "MEDIUM" | "HIGH",
  "disciplineWeighting": "PRIMARY_HEAVY" | "BALANCED" | "SECONDARY_HEAVY",
  "categoryPriority": {
    "CORE_CONCEPTS": "HIGH" | "MEDIUM" | "LOW",
    "DOMAIN_APPLICATION": "HIGH" | "MEDIUM" | "LOW",
    "METHODOLOGY": "HIGH" | "MEDIUM" | "LOW",
    "THEORETICAL_FOUNDATION": "HIGH" | "MEDIUM" | "LOW",
    "SURVEYS_REVIEWS": "HIGH" | "MEDIUM" | "LOW",
    "COMPETING_APPROACHES": "HIGH" | "MEDIUM" | "LOW",
    "RECENT_ADVANCES": "HIGH" | "MEDIUM" | "LOW",
    "GAP_IDENTIFICATION": "HIGH" | "MEDIUM" | "LOW"
  },
  "reasoning": "Brief explanation of strategy choices"
}

Return ONLY the JSON object.`;

    try {
      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        {
          taskCode: 'LLM2_DRAFT',
          stageCode: 'SEARCH_STRATEGY_PLANNING',
          prompt,
          // maxTokensOut is controlled via super admin LLM config for SEARCH_STRATEGY_PLANNING stage
          parameters: {
            temperature: 0.4,
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId: researchTopic.sessionId,
            purpose: 'search_plan_generation'
          }
        }
      );

      if (!result.success || !result.response) {
        console.warn('Search plan generation failed, using defaults');
        return this.applyPaperTypeAdjustments(DEFAULT_SEARCH_PLAN, paperType?.code);
      }

      const parsed = this.parseSearchPlanResponse(result.response.output);
      if (!parsed) {
        return this.applyPaperTypeAdjustments(DEFAULT_SEARCH_PLAN, paperType?.code);
      }

      // Validate and normalize
      return this.validateSearchPlan(parsed, paperType?.code);

    } catch (error) {
      console.error('Search plan generation error:', error);
      return this.applyPaperTypeAdjustments(DEFAULT_SEARCH_PLAN, paperType?.code);
    }
  }

  /**
   * Phase A2: Query Generation with Deterministic Guardrails
   * Generates queries constrained by the search plan
   */
  private async generateQueriesWithGuardrails(
    researchTopic: ResearchTopic,
    paperType: PaperTypeDefinition | null,
    blueprint: BlueprintWithSectionPlan | undefined,
    searchPlan: SearchPlan,
    tenantContext: TenantContext
  ): Promise<GeneratedQuery[]> {
    
    // Calculate target query counts based on priorities
    const targetCounts = this.calculateTargetQueryCounts(searchPlan.categoryPriority);
    
    // Build blueprint mustCover context if available
    const mustCoverContext = blueprint 
      ? this.buildMustCoverContext(blueprint)
      : '';

    const prompt = `You are generating literature search queries for a systematic review.

═══════════════════════════════════════════════════════════════
RESEARCH CONTEXT
═══════════════════════════════════════════════════════════════
Title: ${researchTopic.title || 'Untitled'}
Research Question: ${researchTopic.researchQuestion || 'Not specified'}
Keywords: ${(researchTopic.keywords || []).join(', ')}
Methodology: ${researchTopic.methodology || 'Not specified'}
${mustCoverContext}

═══════════════════════════════════════════════════════════════
SEARCH PLAN (from planning phase)
═══════════════════════════════════════════════════════════════
Breadth: ${searchPlan.breadth}
Depth: ${searchPlan.depth}
Discipline Focus: ${searchPlan.disciplineWeighting}

Query Count Targets by Category:
${Object.entries(targetCounts).map(([cat, count]) => `- ${cat}: ${count} queries`).join('\n')}

Total queries: ${Object.values(targetCounts).reduce((a, b) => a + b, 0)} (must be between ${QUERY_CONSTRAINTS.MIN_QUERIES}-${QUERY_CONSTRAINTS.MAX_QUERIES})

═══════════════════════════════════════════════════════════════
MANDATORY COVERAGE INTENTS (SYSTEM ENFORCED)
═══════════════════════════════════════════════════════════════
At least one query MUST cover each of these intents:
1. historical_foundational - Seminal/foundational works in the field
2. methodological - Methods, techniques, approaches used
3. comparison_baseline - Competing/alternative approaches for comparison
4. limitations_gaps - Papers discussing limitations or research gaps

These intents are NON-NEGOTIABLE. Do not omit any.

═══════════════════════════════════════════════════════════════
QUERY GENERATION RULES (STRICT)
═══════════════════════════════════════════════════════════════
- Each query: 3-7 keyword phrase (plain English, no boolean operators)
- Include searchIntent field indicating which intent the query addresses
- Suggest appropriate academic sources (semantic_scholar, google_scholar, crossref, openalex, pubmed, arxiv)
- Suggest year ranges where appropriate (e.g., RECENT_ADVANCES: last 3 years)
- Priority 1 = most important, higher numbers = lower priority

SEARCH MUST BE COVERAGE-FIRST:
- Do NOT generate queries per paper section
- Do NOT allocate queries to specific blueprint dimensions
- Do NOT suppress any search category
- Research themes above are for PHRASING guidance only, not query allocation

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON array)
═══════════════════════════════════════════════════════════════
[
  {
    "queryText": "3-7 keyword search phrase",
    "category": "CORE_CONCEPTS" | "DOMAIN_APPLICATION" | "METHODOLOGY" | "THEORETICAL_FOUNDATION" | "SURVEYS_REVIEWS" | "COMPETING_APPROACHES" | "RECENT_ADVANCES" | "GAP_IDENTIFICATION",
    "searchIntent": "historical_foundational" | "methodological" | "comparison_baseline" | "limitations_gaps" | "topic_coverage",
    "description": "Why this query is included and what it will find",
    "priority": 1-12,
    "suggestedSources": ["semantic_scholar", "google_scholar", ...],
    "suggestedYearFrom": 2020,
    "suggestedYearTo": 2024
  }
]

Return ONLY the JSON array.`;

    try {
      const result = await llmGateway.executeLLMOperation(
        { tenantContext },
        {
          taskCode: 'LLM2_DRAFT',
          stageCode: 'SEARCH_QUERY_GENERATION',
          prompt,
          // maxTokensOut is controlled via super admin LLM config for SEARCH_QUERY_GENERATION stage
          parameters: {
            temperature: 0.5,
          },
          idempotencyKey: crypto.randomUUID(),
          metadata: {
            sessionId: researchTopic.sessionId,
            purpose: 'search_query_generation'
          }
        }
      );

      if (!result.success || !result.response) {
        console.warn('Query generation failed, using fallback queries');
        return this.generateFallbackQueries(researchTopic, searchPlan);
      }

      const queries = this.parseQueriesResponse(result.response.output);
      
      // If LLM returned empty/invalid JSON, use fallback immediately
      if (queries.length === 0) {
        console.warn('LLM returned empty/invalid queries, using fallback queries');
        return this.generateFallbackQueries(researchTopic, searchPlan);
      }
      
      // Apply deterministic guardrails with backfill for missing intents/categories
      const validatedQueries = this.applyQueryGuardrails(
        queries, 
        searchPlan, 
        targetCounts,
        researchTopic
      );
      
      return validatedQueries;

    } catch (error) {
      console.error('Query generation error:', error);
      return this.generateFallbackQueries(researchTopic, searchPlan);
    }
  }

  /**
   * Apply deterministic guardrails to generated queries
   * ENFORCES: mandatory intents, category minimums, and query count bounds
   */
  private applyQueryGuardrails(
    queries: GeneratedQuery[],
    searchPlan: SearchPlan,
    targetCounts: Record<string, number>,
    researchTopic?: ResearchTopic
  ): GeneratedQuery[] {
    
    // Sort by priority first (lower = more important)
    let validQueries = [...queries].sort((a, b) => (a.priority || 99) - (b.priority || 99));
    
    // Track what we have
    const coveredIntents = new Set(validQueries.map(q => q.searchIntent));
    const categoryCounts: Record<string, number> = {};
    for (const q of validQueries) {
      categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
    }

    // BACKFILL missing mandatory intents (this is enforced, not just logged)
    const missingIntents = MANDATORY_INTENTS.filter(intent => !coveredIntents.has(intent));
    if (missingIntents.length > 0) {
      console.warn(`⚠️ Backfilling ${missingIntents.length} missing mandatory intents: ${missingIntents.join(', ')}`);
      const backfillQueries = this.generateBackfillQueriesForIntents(missingIntents, researchTopic);
      validQueries.push(...backfillQueries);
      
      // Update category counts
      for (const q of backfillQueries) {
        categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
      }
    }

    // ENFORCE category minimums from targetCounts
    for (const [category, targetCount] of Object.entries(targetCounts)) {
      const currentCount = categoryCounts[category] || 0;
      if (currentCount < targetCount && targetCount > 0) {
        const deficit = targetCount - currentCount;
        console.warn(`⚠️ Category ${category} has ${currentCount} queries, target is ${targetCount}. Backfilling ${deficit}.`);
        
        // Generate simple backfill queries for underrepresented categories
        const backfillQueries = this.generateBackfillQueriesForCategory(
          category as SearchQueryCategory,
          deficit,
          researchTopic,
          validQueries.length + 1
        );
        validQueries.push(...backfillQueries);
        categoryCounts[category] = currentCount + backfillQueries.length;
      }
    }

    // ENFORCE minimum query count
    if (validQueries.length < QUERY_CONSTRAINTS.MIN_QUERIES) {
      console.warn(`⚠️ Only ${validQueries.length} queries after guardrails, minimum is ${QUERY_CONSTRAINTS.MIN_QUERIES}. Adding more.`);
      // Add generic topic coverage queries until we hit minimum
      const mainKeyword = researchTopic?.keywords?.[0] || researchTopic?.title?.split(' ').slice(0, 3).join(' ') || 'research topic';
      let priority = validQueries.length + 1;
      
      while (validQueries.length < QUERY_CONSTRAINTS.MIN_QUERIES) {
        validQueries.push({
          queryText: `${mainKeyword} ${['applications', 'techniques', 'frameworks', 'analysis'][validQueries.length % 4]}`,
          category: 'CORE_CONCEPTS',
          searchIntent: 'topic_coverage',
          description: 'Additional query to meet minimum coverage requirement',
          priority: priority++,
          suggestedSources: ['semantic_scholar', 'google_scholar']
        });
      }
    }

    // TRUNCATE to max, but preserve mandatory intent coverage
    if (validQueries.length > QUERY_CONSTRAINTS.MAX_QUERIES) {
      // Separate mandatory-intent queries from others
      const mandatoryQueries = validQueries.filter(q => MANDATORY_INTENTS.includes(q.searchIntent));
      const otherQueries = validQueries.filter(q => !MANDATORY_INTENTS.includes(q.searchIntent));
      
      // Sort others by priority and take as many as we can after mandatory
      otherQueries.sort((a, b) => (a.priority || 99) - (b.priority || 99));
      const remaining = QUERY_CONSTRAINTS.MAX_QUERIES - mandatoryQueries.length;
      
      validQueries = [...mandatoryQueries, ...otherQueries.slice(0, Math.max(0, remaining))];
      console.warn(`⚠️ Truncated to ${validQueries.length} queries (max ${QUERY_CONSTRAINTS.MAX_QUERIES}), preserved ${mandatoryQueries.length} mandatory intent queries`);
    }

    // Reassign priorities sequentially
    validQueries = validQueries.map((q, i) => ({
      ...q,
      priority: i + 1
    }));

    // Final sort by priority
    validQueries.sort((a, b) => a.priority - b.priority);

    return validQueries;
  }

  /**
   * Generate backfill queries for missing mandatory intents
   */
  private generateBackfillQueriesForIntents(
    missingIntents: string[],
    researchTopic?: ResearchTopic
  ): GeneratedQuery[] {
    const mainKeyword = researchTopic?.keywords?.[0] || 
      researchTopic?.title?.split(' ').slice(0, 3).join(' ') || 
      'research topic';
    
    const intentToQuery: Record<string, { queryText: string; category: SearchQueryCategory; description: string }> = {
      'historical_foundational': {
        queryText: `${mainKeyword} seminal foundational works history`,
        category: 'THEORETICAL_FOUNDATION',
        description: 'Backfill query for foundational/historical works coverage'
      },
      'methodological': {
        queryText: `${mainKeyword} methodology methods techniques`,
        category: 'METHODOLOGY',
        description: 'Backfill query for methodological coverage'
      },
      'comparison_baseline': {
        queryText: `${mainKeyword} comparison benchmark baseline evaluation`,
        category: 'COMPETING_APPROACHES',
        description: 'Backfill query for comparison/baseline coverage'
      },
      'limitations_gaps': {
        queryText: `${mainKeyword} limitations challenges gaps future work`,
        category: 'GAP_IDENTIFICATION',
        description: 'Backfill query for limitations/gaps coverage'
      }
    };

    return missingIntents.map((intent, i) => {
      const template = intentToQuery[intent] || {
        queryText: `${mainKeyword} ${intent}`,
        category: 'CORE_CONCEPTS' as SearchQueryCategory,
        description: `Backfill query for ${intent} coverage`
      };

      return {
        queryText: template.queryText,
        category: template.category,
        searchIntent: intent,
        description: template.description,
        priority: 100 + i, // Will be reassigned
        suggestedSources: ['semantic_scholar', 'google_scholar']
      };
    });
  }

  /**
   * Generate backfill queries for underrepresented categories
   */
  private generateBackfillQueriesForCategory(
    category: SearchQueryCategory,
    count: number,
    researchTopic?: ResearchTopic,
    startPriority: number = 50
  ): GeneratedQuery[] {
    const mainKeyword = researchTopic?.keywords?.[0] || 
      researchTopic?.title?.split(' ').slice(0, 3).join(' ') || 
      'research topic';

    const categoryPhrases: Record<string, string[]> = {
      'CORE_CONCEPTS': ['concepts', 'fundamentals', 'overview'],
      'DOMAIN_APPLICATION': ['application', 'use case', 'implementation'],
      'METHODOLOGY': ['methodology', 'methods', 'approach'],
      'THEORETICAL_FOUNDATION': ['theory', 'foundations', 'principles'],
      'SURVEYS_REVIEWS': ['survey', 'review', 'state of the art'],
      'COMPETING_APPROACHES': ['alternative', 'comparison', 'benchmark'],
      'RECENT_ADVANCES': ['recent', 'advances', '2023 2024'],
      'GAP_IDENTIFICATION': ['gaps', 'challenges', 'future directions'],
      'CUSTOM': ['custom', 'specific', 'targeted']
    };

    const phrases = categoryPhrases[category] || ['research', 'study'];
    const queries: GeneratedQuery[] = [];

    for (let i = 0; i < Math.min(count, 2); i++) { // Cap at 2 backfill per category
      queries.push({
        queryText: `${mainKeyword} ${phrases[i % phrases.length]}`,
        category,
        searchIntent: 'topic_coverage',
        description: `Backfill query for ${category} category coverage`,
        priority: startPriority + i,
        suggestedSources: ['semantic_scholar', 'google_scholar']
      });
    }

    return queries;
  }

  /**
   * Calculate target query counts based on category priorities
   */
  private calculateTargetQueryCounts(
    priorities: Record<SearchQueryCategory, 'HIGH' | 'MEDIUM' | 'LOW'>
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    let total = 0;

    for (const [category, priority] of Object.entries(priorities)) {
      const min = QUERY_CONSTRAINTS.PRIORITY_MINIMUMS[priority];
      counts[category] = min;
      total += min;
    }

    // If under minimum, add to HIGH priority categories
    while (total < QUERY_CONSTRAINTS.MIN_QUERIES) {
      for (const [category, priority] of Object.entries(priorities)) {
        if (priority === 'HIGH' && counts[category] < QUERY_CONSTRAINTS.PRIORITY_MAXIMUMS.HIGH) {
          counts[category]++;
          total++;
          if (total >= QUERY_CONSTRAINTS.MIN_QUERIES) break;
        }
      }
    }

    return counts;
  }

  /**
   * Persist strategy and queries to database
   */
  private async persistStrategy(
    sessionId: string,
    researchTopic: ResearchTopic,
    searchPlan: SearchPlan,
    queries: GeneratedQuery[]
  ): Promise<CitationSearchStrategy & { queries: CitationSearchQuery[] }> {
    
    // Delete existing draft strategy if any
    await (prisma as any).citationSearchStrategy.deleteMany({
      where: { sessionId, status: 'DRAFT' }
    });

    // Create strategy with queries
    const strategy = await (prisma as any).citationSearchStrategy.create({
      data: {
        sessionId,
        paperTitle: researchTopic.title,
        paperAbstract: researchTopic.abstractDraft,
        keywords: researchTopic.keywords || [],
        researchFocus: researchTopic.researchQuestion,
        summary: searchPlan.reasoning || `${searchPlan.breadth} breadth, ${searchPlan.depth} depth search strategy`,
        estimatedPapers: queries.length * 15, // Rough estimate
        status: 'READY',
        queries: {
          create: queries.map(q => ({
            queryText: q.queryText,
            category: q.category as SearchQueryCategory,
            description: q.description,
            priority: q.priority,
            suggestedSources: q.suggestedSources,
            suggestedYearFrom: q.suggestedYearFrom,
            suggestedYearTo: q.suggestedYearTo,
            suggestedFilters: { searchIntent: q.searchIntent },
            status: 'PENDING'
          }))
        }
      },
      include: {
        queries: {
          orderBy: { priority: 'asc' }
        }
      }
    });

    return strategy;
  }

  /**
   * Get existing strategy for a session
   */
  async getStrategy(sessionId: string): Promise<(CitationSearchStrategy & { queries: CitationSearchQuery[] }) | null> {
    return (prisma as any).citationSearchStrategy.findUnique({
      where: { sessionId },
      include: {
        queries: {
          orderBy: { priority: 'asc' }
        }
      }
    });
  }

  /**
   * Update query status after execution
   */
  async updateQueryStatus(
    queryId: string,
    status: 'SEARCHING' | 'SEARCHED' | 'COMPLETED' | 'SKIPPED',
    resultsCount?: number,
    importedCount?: number
  ): Promise<CitationSearchQuery> {
    return (prisma as any).citationSearchQuery.update({
      where: { id: queryId },
      data: {
        status,
        searchedAt: status === 'SEARCHED' || status === 'COMPLETED' ? new Date() : undefined,
        resultsCount,
        importedCount
      }
    });
  }

  /**
   * Mark strategy as completed when all queries are done
   */
  async checkAndUpdateStrategyStatus(strategyId: string): Promise<void> {
    const strategy: (CitationSearchStrategy & { queries: CitationSearchQuery[] }) | null =
      await (prisma as any).citationSearchStrategy.findUnique({
      where: { id: strategyId },
      include: { queries: true }
    });

    if (!strategy) return;

    const allCompleted = strategy.queries.every(
      q => q.status === 'COMPLETED' || q.status === 'SKIPPED'
    );

    if (allCompleted) {
      await (prisma as any).citationSearchStrategy.update({
        where: { id: strategyId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });
    } else {
      const anyInProgress = strategy.queries.some(
        q => q.status === 'SEARCHING' || q.status === 'SEARCHED'
      );
      
      if (anyInProgress && strategy.status === 'READY') {
        await (prisma as any).citationSearchStrategy.update({
          where: { id: strategyId },
          data: { status: 'IN_PROGRESS' }
        });
      }
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Build SOFT advisory context from blueprint (per A1)
   * Only includes aggregated metadata, NOT per-dimension or per-section requirements
   */
  private buildBlueprintContext(blueprint: BlueprintWithSectionPlan): string {
    // Aggregate dimension type counts (advisory only)
    const typeCounts: Record<string, number> = {
      foundational: 0,
      methodological: 0,
      empirical: 0,
      comparative: 0,
      gap: 0
    };
    
    for (const section of blueprint.sectionPlan) {
      if (section.mustCoverTyping) {
        for (const dimType of Object.values(section.mustCoverTyping)) {
          if (typeCounts[dimType] !== undefined) {
            typeCounts[dimType]++;
          }
        }
      }
    }
    
    // Build advisory emphasis summary
    const emphasis: string[] = [];
    if (typeCounts.foundational >= 3) emphasis.push('foundational/historical');
    if (typeCounts.comparative >= 2) emphasis.push('comparative/baseline');
    if (typeCounts.gap >= 2) emphasis.push('gap/limitation');
    if (typeCounts.methodological >= 3) emphasis.push('methodological');
    if (typeCounts.empirical >= 3) emphasis.push('empirical evidence');

    const emphasisNote = emphasis.length > 0
      ? `Blueprint emphasizes ${emphasis.join(' and ')} evidence.`
      : '';

    return `
BLUEPRINT CONTEXT (advisory only - do not suppress any search category):
Thesis: ${blueprint.thesisStatement.slice(0, 200)}${blueprint.thesisStatement.length > 200 ? '...' : ''}
Methodology Type: ${blueprint.methodologyType || 'Not specified'}
${emphasisNote}`;
  }

  /**
   * Build soft phrasing context from blueprint (per A1)
   * Provides general topic hints WITHOUT per-mustCover query allocation
   */
  private buildMustCoverContext(blueprint: BlueprintWithSectionPlan): string {
    // Extract key noun phrases from thesis and contributions for phrasing hints
    const keyPhrases = [
      ...blueprint.keyContributions.slice(0, 3),
      blueprint.thesisStatement
    ]
      .join(' ')
      .split(/[,.;]/)
      .map(s => s.trim())
      .filter(s => s.length > 10 && s.length < 80)
      .slice(0, 5);

    if (keyPhrases.length === 0) {
      return '';
    }

    return `
KEY RESEARCH THEMES (for phrasing guidance, not query allocation):
${keyPhrases.map((p, i) => `- ${p}`).join('\n')}

NOTE: Search must be coverage-first. Do NOT allocate queries to specific themes.`;
  }

  private parseSearchPlanResponse(output: string): SearchPlan | null {
    try {
      const cleaned = output
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      return JSON.parse(cleaned) as SearchPlan;
    } catch (error) {
      console.error('Failed to parse search plan:', error);
      return null;
    }
  }

  private parseQueriesResponse(output: string): GeneratedQuery[] {
    try {
      const cleaned = output
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Failed to parse queries:', error);
      return [];
    }
  }

  private validateSearchPlan(plan: Partial<SearchPlan>, paperTypeCode?: string): SearchPlan {
    const validBreadth = ['LOW', 'MEDIUM', 'HIGH'];
    const validDepth = ['LOW', 'MEDIUM', 'HIGH'];
    const validWeighting = ['PRIMARY_HEAVY', 'BALANCED', 'SECONDARY_HEAVY'];
    const validPriority = ['HIGH', 'MEDIUM', 'LOW'];

    const validated: SearchPlan = {
      breadth: validBreadth.includes(plan.breadth || '') 
        ? plan.breadth as SearchPlan['breadth']
        : 'MEDIUM',
      depth: validDepth.includes(plan.depth || '')
        ? plan.depth as SearchPlan['depth']
        : 'MEDIUM',
      disciplineWeighting: validWeighting.includes(plan.disciplineWeighting || '')
        ? plan.disciplineWeighting as SearchPlan['disciplineWeighting']
        : 'PRIMARY_HEAVY',
      categoryPriority: {} as SearchPlan['categoryPriority'],
      reasoning: plan.reasoning
    };

    // Validate each category priority
    const categories: SearchQueryCategory[] = [
      'CORE_CONCEPTS', 'DOMAIN_APPLICATION', 'METHODOLOGY', 
      'THEORETICAL_FOUNDATION', 'SURVEYS_REVIEWS', 'COMPETING_APPROACHES',
      'RECENT_ADVANCES', 'GAP_IDENTIFICATION', 'CUSTOM'
    ];

    for (const cat of categories) {
      const priority = plan.categoryPriority?.[cat];
      validated.categoryPriority[cat] = validPriority.includes(priority || '')
        ? priority as 'HIGH' | 'MEDIUM' | 'LOW'
        : DEFAULT_SEARCH_PLAN.categoryPriority[cat] || 'LOW';
    }

    return this.applyPaperTypeAdjustments(validated, paperTypeCode);
  }

  private applyPaperTypeAdjustments(plan: SearchPlan, paperTypeCode?: string): SearchPlan {
    if (!paperTypeCode) return plan;

    const adjustments = PAPER_TYPE_ADJUSTMENTS[paperTypeCode];
    if (!adjustments) return plan;

    return {
      ...plan,
      breadth: adjustments.breadth || plan.breadth,
      depth: adjustments.depth || plan.depth,
      categoryPriority: {
        ...plan.categoryPriority,
        ...adjustments.categoryPriority
      }
    };
  }

  private generateFallbackQueries(
    researchTopic: ResearchTopic,
    searchPlan: SearchPlan
  ): GeneratedQuery[] {
    const title = researchTopic.title || 'research topic';
    const keywords = (researchTopic.keywords || []).slice(0, 5);
    const mainKeyword = keywords[0] || title.split(' ').slice(0, 3).join(' ');

    return [
      {
        queryText: `${mainKeyword} comprehensive review`,
        category: 'SURVEYS_REVIEWS',
        searchIntent: 'historical_foundational',
        description: 'Find existing reviews and surveys',
        priority: 1,
        suggestedSources: ['semantic_scholar', 'google_scholar'],
        suggestedYearFrom: 2015
      },
      {
        queryText: `${mainKeyword} methodology approach`,
        category: 'METHODOLOGY',
        searchIntent: 'methodological',
        description: 'Find methodological papers',
        priority: 2,
        suggestedSources: ['semantic_scholar', 'crossref']
      },
      {
        queryText: `${mainKeyword} ${keywords[1] || 'application'}`,
        category: 'CORE_CONCEPTS',
        searchIntent: 'topic_coverage',
        description: 'Core topic coverage',
        priority: 3,
        suggestedSources: ['semantic_scholar', 'google_scholar']
      },
      {
        queryText: `${mainKeyword} comparison benchmark`,
        category: 'COMPETING_APPROACHES',
        searchIntent: 'comparison_baseline',
        description: 'Find comparison and baseline studies',
        priority: 4,
        suggestedSources: ['semantic_scholar']
      },
      {
        queryText: `${mainKeyword} challenges limitations`,
        category: 'GAP_IDENTIFICATION',
        searchIntent: 'limitations_gaps',
        description: 'Find papers discussing limitations',
        priority: 5,
        suggestedSources: ['semantic_scholar', 'google_scholar']
      },
      {
        queryText: `${mainKeyword} recent advances 2023 2024`,
        category: 'RECENT_ADVANCES',
        searchIntent: 'topic_coverage',
        description: 'Find recent papers',
        priority: 6,
        suggestedSources: ['semantic_scholar', 'arxiv'],
        suggestedYearFrom: 2023
      }
    ];
  }

  private extractSearchPlanFromStrategy(strategy: CitationSearchStrategy): SearchPlan {
    // Reconstruct search plan from stored strategy
    const queries = (strategy as any).queries || [];
    const categoryCounts: Record<string, number> = {};
    
    for (const q of queries) {
      categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
    }

    const categoryPriority: Record<SearchQueryCategory, 'HIGH' | 'MEDIUM' | 'LOW'> = {} as any;
    for (const cat of Object.keys(DEFAULT_SEARCH_PLAN.categoryPriority)) {
      const count = categoryCounts[cat] || 0;
      categoryPriority[cat as SearchQueryCategory] = 
        count >= 2 ? 'HIGH' : count === 1 ? 'MEDIUM' : 'LOW';
    }

    return {
      breadth: 'MEDIUM',
      depth: 'MEDIUM',
      disciplineWeighting: 'PRIMARY_HEAVY',
      categoryPriority,
      reasoning: strategy.summary || undefined
    };
  }

  private calculateCoverage(queries: CitationSearchQuery[]): CategoryCoverage {
    const byCategory: Record<string, number> = {};
    const intents = new Set<string>();

    for (const q of queries) {
      byCategory[q.category] = (byCategory[q.category] || 0) + 1;
      const filters = q.suggestedFilters as { searchIntent?: string } | null;
      if (filters?.searchIntent) {
        intents.add(filters.searchIntent);
      }
    }

    const missingIntents = MANDATORY_INTENTS.filter(i => !intents.has(i));

    return {
      totalQueries: queries.length,
      byCategory,
      mandatoryCoverageIntents: MANDATORY_INTENTS,
      missingIntents
    };
  }
}

// Export singleton instance
export const searchStrategyService = new SearchStrategyService();

// Export class for testing
export { SearchStrategyService };


