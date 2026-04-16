import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { SearchStrategyService, type SearchPlan, type GeneratedQuery } from '../../lib/services/search-strategy-service';

// Mock dependencies
vi.mock('../../lib/prisma', () => ({
  prisma: {
    citationSearchStrategy: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    citationSearchQuery: {
      update: vi.fn()
    }
  }
}));

vi.mock('../../lib/metering', () => ({
  llmGateway: {
    executeLLMOperation: vi.fn()
  }
}));

vi.mock('../../lib/services/blueprint-service', () => ({
  blueprintService: {
    getBlueprint: vi.fn()
  }
}));

vi.mock('../../lib/services/paper-type-service', () => ({
  paperTypeService: {
    getPaperType: vi.fn()
  }
}));

import { prisma } from '../../lib/prisma';
import { llmGateway } from '../../lib/metering';
import { blueprintService } from '../../lib/services/blueprint-service';
import { paperTypeService } from '../../lib/services/paper-type-service';

describe('SearchStrategyService', () => {
  let service: SearchStrategyService;

  beforeEach(() => {
    service = new SearchStrategyService();
    vi.clearAllMocks();
  });

  describe('Search Plan Validation', () => {
    it('should validate breadth values correctly', () => {
      const validPlan: Partial<SearchPlan> = {
        breadth: 'HIGH',
        depth: 'MEDIUM',
        disciplineWeighting: 'PRIMARY_HEAVY',
        categoryPriority: {
          CORE_CONCEPTS: 'HIGH',
          DOMAIN_APPLICATION: 'MEDIUM',
          METHODOLOGY: 'LOW',
          THEORETICAL_FOUNDATION: 'MEDIUM',
          SURVEYS_REVIEWS: 'LOW',
          COMPETING_APPROACHES: 'LOW',
          RECENT_ADVANCES: 'MEDIUM',
          GAP_IDENTIFICATION: 'LOW',
          CUSTOM: 'LOW'
        }
      };

      const validated = (service as any).validateSearchPlan(validPlan);
      
      expect(validated.breadth).toBe('HIGH');
      expect(validated.depth).toBe('MEDIUM');
    });

    it('should default invalid breadth/depth to MEDIUM', () => {
      const invalidPlan: Partial<SearchPlan> = {
        breadth: 'INVALID' as any,
        depth: 'ALSO_INVALID' as any
      };

      const validated = (service as any).validateSearchPlan(invalidPlan);
      
      expect(validated.breadth).toBe('MEDIUM');
      expect(validated.depth).toBe('MEDIUM');
    });

    it('should apply paper type adjustments for REVIEW_ARTICLE', () => {
      const basePlan: SearchPlan = {
        breadth: 'MEDIUM',
        depth: 'MEDIUM',
        disciplineWeighting: 'PRIMARY_HEAVY',
        categoryPriority: {
          CORE_CONCEPTS: 'MEDIUM',
          DOMAIN_APPLICATION: 'MEDIUM',
          METHODOLOGY: 'MEDIUM',
          THEORETICAL_FOUNDATION: 'MEDIUM',
          SURVEYS_REVIEWS: 'MEDIUM',
          COMPETING_APPROACHES: 'LOW',
          RECENT_ADVANCES: 'LOW',
          GAP_IDENTIFICATION: 'LOW',
          CUSTOM: 'LOW'
        }
      };

      const adjusted = (service as any).applyPaperTypeAdjustments(basePlan, 'REVIEW_ARTICLE');
      
      expect(adjusted.breadth).toBe('HIGH'); // Reviews need high breadth
      expect(adjusted.categoryPriority.SURVEYS_REVIEWS).toBe('HIGH');
      expect(adjusted.categoryPriority.THEORETICAL_FOUNDATION).toBe('HIGH');
    });

    it('should apply paper type adjustments for JOURNAL_ARTICLE', () => {
      const basePlan: SearchPlan = {
        breadth: 'MEDIUM',
        depth: 'MEDIUM',
        disciplineWeighting: 'PRIMARY_HEAVY',
        categoryPriority: {
          CORE_CONCEPTS: 'MEDIUM',
          DOMAIN_APPLICATION: 'MEDIUM',
          METHODOLOGY: 'MEDIUM',
          THEORETICAL_FOUNDATION: 'MEDIUM',
          SURVEYS_REVIEWS: 'MEDIUM',
          COMPETING_APPROACHES: 'LOW',
          RECENT_ADVANCES: 'LOW',
          GAP_IDENTIFICATION: 'LOW',
          CUSTOM: 'LOW'
        }
      };

      const adjusted = (service as any).applyPaperTypeAdjustments(basePlan, 'JOURNAL_ARTICLE');
      
      expect(adjusted.depth).toBe('HIGH'); // Journal articles need high depth
      expect(adjusted.categoryPriority.METHODOLOGY).toBe('HIGH');
    });
  });

  describe('Query Count Calculation', () => {
    it('should calculate target query counts based on priorities', () => {
      const priorities = {
        CORE_CONCEPTS: 'HIGH' as const,
        DOMAIN_APPLICATION: 'HIGH' as const,
        METHODOLOGY: 'MEDIUM' as const,
        THEORETICAL_FOUNDATION: 'MEDIUM' as const,
        SURVEYS_REVIEWS: 'LOW' as const,
        COMPETING_APPROACHES: 'LOW' as const,
        RECENT_ADVANCES: 'LOW' as const,
        GAP_IDENTIFICATION: 'LOW' as const,
        CUSTOM: 'LOW' as const
      };

      const counts = (service as any).calculateTargetQueryCounts(priorities);
      
      // HIGH priority should have at least 2
      expect(counts.CORE_CONCEPTS).toBeGreaterThanOrEqual(2);
      expect(counts.DOMAIN_APPLICATION).toBeGreaterThanOrEqual(2);
      
      // MEDIUM priority should have at least 1
      expect(counts.METHODOLOGY).toBeGreaterThanOrEqual(1);
      expect(counts.THEORETICAL_FOUNDATION).toBeGreaterThanOrEqual(1);
      
      // Total should be at least 6 (minimum per SRS)
      const total = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(6);
    });

    it('should ensure minimum total of 6 queries', () => {
      // All LOW priorities
      const priorities = {
        CORE_CONCEPTS: 'LOW' as const,
        DOMAIN_APPLICATION: 'LOW' as const,
        METHODOLOGY: 'LOW' as const,
        THEORETICAL_FOUNDATION: 'LOW' as const,
        SURVEYS_REVIEWS: 'LOW' as const,
        COMPETING_APPROACHES: 'LOW' as const,
        RECENT_ADVANCES: 'LOW' as const,
        GAP_IDENTIFICATION: 'LOW' as const,
        CUSTOM: 'LOW' as const
      };

      const counts = (service as any).calculateTargetQueryCounts(priorities);
      const total = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
      
      // Even with all LOW, should still hit minimum
      expect(total).toBeGreaterThanOrEqual(6);
    });
  });

  describe('Query Guardrails', () => {
    it('should apply guardrails to limit maximum queries', () => {
      const tooManyQueries: GeneratedQuery[] = Array.from({ length: 20 }, (_, i) => ({
        queryText: `Query ${i}`,
        category: 'CORE_CONCEPTS' as const,
        searchIntent: 'topic_coverage',
        description: `Description ${i}`,
        priority: i + 1,
        suggestedSources: ['semantic_scholar']
      }));

      const searchPlan: SearchPlan = {
        breadth: 'MEDIUM',
        depth: 'MEDIUM',
        disciplineWeighting: 'PRIMARY_HEAVY',
        categoryPriority: {
          CORE_CONCEPTS: 'HIGH',
          DOMAIN_APPLICATION: 'MEDIUM',
          METHODOLOGY: 'MEDIUM',
          THEORETICAL_FOUNDATION: 'MEDIUM',
          SURVEYS_REVIEWS: 'LOW',
          COMPETING_APPROACHES: 'LOW',
          RECENT_ADVANCES: 'LOW',
          GAP_IDENTIFICATION: 'LOW',
          CUSTOM: 'LOW'
        }
      };

      const validated = (service as any).applyQueryGuardrails(tooManyQueries, searchPlan, {});
      
      expect(validated.length).toBeLessThanOrEqual(12); // Max 12 per SRS
    });

    it('should sort queries by priority', () => {
      const unsortedQueries: GeneratedQuery[] = [
        { queryText: 'Query 3', category: 'CORE_CONCEPTS', searchIntent: 'topic_coverage', description: 'D3', priority: 3, suggestedSources: [] },
        { queryText: 'Query 1', category: 'CORE_CONCEPTS', searchIntent: 'historical_foundational', description: 'D1', priority: 1, suggestedSources: [] },
        { queryText: 'Query 2', category: 'METHODOLOGY', searchIntent: 'methodological', description: 'D2', priority: 2, suggestedSources: [] }
      ];

      const searchPlan: SearchPlan = {
        breadth: 'MEDIUM',
        depth: 'MEDIUM',
        disciplineWeighting: 'PRIMARY_HEAVY',
        categoryPriority: {
          CORE_CONCEPTS: 'HIGH',
          DOMAIN_APPLICATION: 'MEDIUM',
          METHODOLOGY: 'MEDIUM',
          THEORETICAL_FOUNDATION: 'MEDIUM',
          SURVEYS_REVIEWS: 'LOW',
          COMPETING_APPROACHES: 'LOW',
          RECENT_ADVANCES: 'LOW',
          GAP_IDENTIFICATION: 'LOW',
          CUSTOM: 'LOW'
        }
      };

      const sorted = (service as any).applyQueryGuardrails(unsortedQueries, searchPlan, {});
      
      expect(sorted[0].priority).toBe(1);
      expect(sorted[1].priority).toBe(2);
      expect(sorted[2].priority).toBe(3);
    });
  });

  describe('Fallback Queries', () => {
    it('should generate fallback queries when LLM fails', () => {
      const researchTopic = {
        title: 'Machine Learning for Medical Imaging',
        keywords: ['deep learning', 'radiology', 'CNN'],
        researchQuestion: 'How can deep learning improve diagnostic accuracy?',
        sessionId: 'test-session'
      };

      const searchPlan: SearchPlan = {
        breadth: 'MEDIUM',
        depth: 'MEDIUM',
        disciplineWeighting: 'PRIMARY_HEAVY',
        categoryPriority: {
          CORE_CONCEPTS: 'HIGH',
          DOMAIN_APPLICATION: 'MEDIUM',
          METHODOLOGY: 'MEDIUM',
          THEORETICAL_FOUNDATION: 'MEDIUM',
          SURVEYS_REVIEWS: 'LOW',
          COMPETING_APPROACHES: 'LOW',
          RECENT_ADVANCES: 'LOW',
          GAP_IDENTIFICATION: 'LOW',
          CUSTOM: 'LOW'
        }
      };

      const fallback = (service as any).generateFallbackQueries(researchTopic, searchPlan);
      
      // Should generate at least 6 queries (minimum)
      expect(fallback.length).toBeGreaterThanOrEqual(6);
      
      // Should cover mandatory intents
      const intents = fallback.map((q: GeneratedQuery) => q.searchIntent);
      expect(intents).toContain('historical_foundational');
      expect(intents).toContain('methodological');
      expect(intents).toContain('comparison_baseline');
      expect(intents).toContain('limitations_gaps');
    });

    it('should use keywords from research topic in fallback queries', () => {
      const researchTopic = {
        title: 'Blockchain in Healthcare',
        keywords: ['blockchain', 'healthcare', 'security'],
        sessionId: 'test-session'
      };

      const searchPlan: SearchPlan = {
        breadth: 'MEDIUM',
        depth: 'MEDIUM',
        disciplineWeighting: 'PRIMARY_HEAVY',
        categoryPriority: {
          CORE_CONCEPTS: 'HIGH',
          DOMAIN_APPLICATION: 'MEDIUM',
          METHODOLOGY: 'MEDIUM',
          THEORETICAL_FOUNDATION: 'MEDIUM',
          SURVEYS_REVIEWS: 'LOW',
          COMPETING_APPROACHES: 'LOW',
          RECENT_ADVANCES: 'LOW',
          GAP_IDENTIFICATION: 'LOW',
          CUSTOM: 'LOW'
        }
      };

      const fallback = (service as any).generateFallbackQueries(researchTopic, searchPlan);
      
      // At least one query should contain the main keyword
      const queryTexts = fallback.map((q: GeneratedQuery) => q.queryText.toLowerCase());
      const hasMainKeyword = queryTexts.some((text: string) => text.includes('blockchain'));
      
      expect(hasMainKeyword).toBe(true);
    });
  });

  describe('Coverage Calculation', () => {
    it('should calculate coverage correctly', () => {
      const queries = [
        { category: 'CORE_CONCEPTS', suggestedFilters: { searchIntent: 'historical_foundational' } },
        { category: 'CORE_CONCEPTS', suggestedFilters: { searchIntent: 'topic_coverage' } },
        { category: 'METHODOLOGY', suggestedFilters: { searchIntent: 'methodological' } },
        { category: 'COMPETING_APPROACHES', suggestedFilters: { searchIntent: 'comparison_baseline' } },
        { category: 'GAP_IDENTIFICATION', suggestedFilters: { searchIntent: 'limitations_gaps' } }
      ];

      const coverage = (service as any).calculateCoverage(queries);
      
      expect(coverage.totalQueries).toBe(5);
      expect(coverage.byCategory.CORE_CONCEPTS).toBe(2);
      expect(coverage.byCategory.METHODOLOGY).toBe(1);
      expect(coverage.missingIntents).toHaveLength(0); // All mandatory intents covered
    });

    it('should identify missing mandatory intents', () => {
      const queries = [
        { category: 'CORE_CONCEPTS', suggestedFilters: { searchIntent: 'topic_coverage' } },
        { category: 'CORE_CONCEPTS', suggestedFilters: { searchIntent: 'topic_coverage' } }
      ];

      const coverage = (service as any).calculateCoverage(queries);
      
      // Should be missing several mandatory intents
      expect(coverage.missingIntents.length).toBeGreaterThan(0);
      expect(coverage.missingIntents).toContain('historical_foundational');
      expect(coverage.missingIntents).toContain('methodological');
    });
  });

  describe('Response Parsing', () => {
    it('should parse valid search plan JSON', () => {
      const validResponse = `{
        "breadth": "HIGH",
        "depth": "MEDIUM",
        "disciplineWeighting": "PRIMARY_HEAVY",
        "categoryPriority": {
          "CORE_CONCEPTS": "HIGH",
          "DOMAIN_APPLICATION": "MEDIUM",
          "METHODOLOGY": "HIGH",
          "THEORETICAL_FOUNDATION": "MEDIUM",
          "SURVEYS_REVIEWS": "LOW",
          "COMPETING_APPROACHES": "MEDIUM",
          "RECENT_ADVANCES": "LOW",
          "GAP_IDENTIFICATION": "LOW"
        },
        "reasoning": "Focus on methodology for empirical paper"
      }`;

      const parsed = (service as any).parseSearchPlanResponse(validResponse);
      
      expect(parsed).not.toBeNull();
      expect(parsed.breadth).toBe('HIGH');
      expect(parsed.reasoning).toContain('methodology');
    });

    it('should handle JSON with markdown code fences', () => {
      const responseWithFences = '```json\n{"breadth": "HIGH", "depth": "LOW"}\n```';

      const parsed = (service as any).parseSearchPlanResponse(responseWithFences);
      
      expect(parsed).not.toBeNull();
      expect(parsed.breadth).toBe('HIGH');
    });

    it('should return null for invalid JSON', () => {
      const invalidResponse = 'This is not valid JSON';

      const parsed = (service as any).parseSearchPlanResponse(invalidResponse);
      
      expect(parsed).toBeNull();
    });

    it('should parse valid queries JSON array', () => {
      const validQueries = `[
        {
          "queryText": "deep learning medical imaging review",
          "category": "SURVEYS_REVIEWS",
          "searchIntent": "historical_foundational",
          "description": "Find comprehensive reviews",
          "priority": 1,
          "suggestedSources": ["semantic_scholar"]
        }
      ]`;

      const parsed = (service as any).parseQueriesResponse(validQueries);
      
      expect(parsed).toHaveLength(1);
      expect(parsed[0].queryText).toContain('deep learning');
    });
  });
});

