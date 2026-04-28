import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { CitationMappingService, type PaperBlueprintMapping, type DimensionMapping, type CoverageReport } from '../../lib/services/citation-mapping-service';

// Mock dependencies
vi.mock('../../lib/prisma', () => ({
  prisma: {
    citation: {
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn()
    },
    citationUsage: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn()
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

import { prisma } from '../../lib/prisma';
import { llmGateway } from '../../lib/metering';
import { blueprintService } from '../../lib/services/blueprint-service';

describe('CitationMappingService', () => {
  let service: CitationMappingService;

  beforeEach(() => {
    service = new CitationMappingService();
    vi.clearAllMocks();
  });

  describe('Dimension Mapping Validation', () => {
    it('should validate dimension mappings correctly', () => {
      const validMappings = [
        { dimension: 'Performance metrics in deep learning', remark: 'Reports 95% accuracy on benchmark.', confidence: 'HIGH' },
        { dimension: 'Deployment challenges', remark: 'Identifies latency issues in production.', confidence: 'MEDIUM' }
      ];

      const validated = (service as any).validateDimensionMappings(validMappings);
      
      expect(validated).toHaveLength(2);
      expect(validated[0].dimension).toBe('Performance metrics in deep learning');
      expect(validated[0].confidence).toBe('HIGH');
    });

    it('should filter out invalid mappings', () => {
      const mixedMappings = [
        { dimension: 'Valid dimension', remark: 'Valid remark', confidence: 'HIGH' },
        { dimension: null, remark: 'Missing dimension', confidence: 'LOW' },
        { dimension: 'Missing remark', remark: null, confidence: 'MEDIUM' },
        { noFields: 'completely invalid' }
      ];

      const validated = (service as any).validateDimensionMappings(mixedMappings);
      
      // Should filter out items with null/undefined dimension or remark
      expect(validated.length).toBeLessThan(mixedMappings.length);
      // Should only have the valid mapping
      expect(validated).toHaveLength(1);
      expect(validated[0].dimension).toBe('Valid dimension');
    });

    it('should limit to maximum 4 dimensions per paper', () => {
      const tooManyMappings = Array.from({ length: 10 }, (_, i) => ({
        dimension: `Dimension ${i}`,
        remark: `Remark ${i}`,
        confidence: 'MEDIUM'
      }));

      const validated = (service as any).validateDimensionMappings(tooManyMappings);
      
      expect(validated.length).toBeLessThanOrEqual(4);
    });

    it('should truncate overly long remarks', () => {
      const longRemark = 'A'.repeat(1000);
      const mappings = [{
        dimension: 'Test dimension',
        remark: longRemark,
        confidence: 'HIGH'
      }];

      const validated = (service as any).validateDimensionMappings(mappings);
      
      expect(validated[0].remark.length).toBeLessThanOrEqual(500);
    });

    it('should default invalid confidence to MEDIUM', () => {
      const mappings = [{
        dimension: 'Test',
        remark: 'Test remark',
        confidence: 'INVALID'
      }];

      const validated = (service as any).validateDimensionMappings(mappings);
      
      expect(validated[0].confidence).toBe('MEDIUM');
    });
  });

  describe('Mapping Status Determination', () => {
    it('should return MAPPED when dimensions exist', () => {
      const item = {
        dimensionMappings: [
          { dimension: 'D1', remark: 'R1', confidence: 'HIGH' }
        ]
      };

      const status = (service as any).determineMappingStatus(item);
      
      expect(status).toBe('MAPPED');
    });

    it('should return UNMAPPED when no dimensions', () => {
      const item = {
        dimensionMappings: []
      };

      const status = (service as any).determineMappingStatus(item);
      
      expect(status).toBe('UNMAPPED');
    });

    it('should return WEAK when single LOW confidence mapping', () => {
      const item = {
        dimensionMappings: [
          { dimension: 'D1', remark: 'R1', confidence: 'LOW' }
        ]
      };

      const status = (service as any).determineMappingStatus(item);
      
      expect(status).toBe('WEAK');
    });

    it('should return MAPPED when multiple dimensions even with LOW confidence', () => {
      const item = {
        dimensionMappings: [
          { dimension: 'D1', remark: 'R1', confidence: 'LOW' },
          { dimension: 'D2', remark: 'R2', confidence: 'LOW' }
        ]
      };

      const status = (service as any).determineMappingStatus(item);
      
      expect(status).toBe('MAPPED'); // Multiple dimensions = MAPPED
    });
  });

  describe('Error Mapping Creation', () => {
    it('should create error mapping for failed papers', () => {
      const paper = {
        id: 'paper-123',
        citationKey: 'Smith2023',
        title: 'Test Paper',
        abstract: 'Test abstract',
        year: 2023,
        venue: 'Test Journal',
        authors: ['John Smith']
      };

      const errorMapping = (service as any).createErrorMapping(paper);
      
      expect(errorMapping.paperId).toBe('paper-123');
      expect(errorMapping.citationKey).toBe('Smith2023');
      expect(errorMapping.sectionKey).toBeNull();
      expect(errorMapping.dimensionMappings).toHaveLength(0);
      expect(errorMapping.mappingStatus).toBe('ERROR');
    });
  });

  describe('Coverage Report Generation', () => {
    it('should generate correct coverage statistics', () => {
      const blueprint = {
        id: 'blueprint-1',
        sectionPlan: [
          {
            sectionKey: 'literature_review',
            purpose: 'Review existing work',
            mustCover: ['State of the art', 'Key challenges', 'Research gaps'],
            mustAvoid: []
          },
          {
            sectionKey: 'methodology',
            purpose: 'Describe methods',
            mustCover: ['Data collection', 'Analysis approach'],
            mustAvoid: []
          }
        ]
      };

      const mappings: PaperBlueprintMapping[] = [
        {
          paperId: 'p1',
          citationKey: 'A2023',
          sectionKey: 'literature_review',
          dimensionMappings: [
            { dimension: 'State of the art', remark: 'Reviews current methods', confidence: 'HIGH' }
          ],
          mappingStatus: 'MAPPED'
        },
        {
          paperId: 'p2',
          citationKey: 'B2023',
          sectionKey: 'literature_review',
          dimensionMappings: [
            { dimension: 'Key challenges', remark: 'Discusses challenges', confidence: 'MEDIUM' }
          ],
          mappingStatus: 'MAPPED'
        },
        {
          paperId: 'p3',
          citationKey: 'C2023',
          sectionKey: null,
          dimensionMappings: [],
          mappingStatus: 'UNMAPPED'
        }
      ];

      const report = (service as any).generateCoverageReport(blueprint, mappings);
      
      expect(report.totalPapers).toBe(3);
      expect(report.mappedPapers).toBe(2);
      expect(report.unmappedPapers).toBe(1);
      expect(report.sectionCoverage.literature_review).toBe(2);
      
      // Should identify gaps (dimensions with no supporting papers)
      expect(report.gaps.length).toBeGreaterThan(0);
      
      // 'Research gaps' should be identified as a gap
      const researchGapsGap = report.gaps.find((g: { dimension: string }) => g.dimension.includes('Research gaps'));
      expect(researchGapsGap).toBeDefined();
    });

    it('should generate warnings for high unmapped rate', () => {
      const blueprint = {
        id: 'blueprint-1',
        sectionPlan: [
          {
            sectionKey: 'literature_review',
            purpose: 'Review',
            mustCover: ['Topic 1'],
            mustAvoid: []
          }
        ]
      };

      // 50% unmapped rate (> 30% threshold)
      const mappings: PaperBlueprintMapping[] = [
        { paperId: 'p1', citationKey: 'A', sectionKey: 'literature_review', dimensionMappings: [{ dimension: 'Topic 1', remark: 'R', confidence: 'HIGH' }], mappingStatus: 'MAPPED' },
        { paperId: 'p2', citationKey: 'B', sectionKey: null, dimensionMappings: [], mappingStatus: 'UNMAPPED' }
      ];

      const report = (service as any).generateCoverageReport(blueprint, mappings);
      
      expect(report.warnings.some((w: string) => w.includes('unmapped'))).toBe(true);
    });

    it('should generate empty coverage report when no citations', () => {
      const blueprint = {
        id: 'blueprint-1',
        sectionPlan: [
          {
            sectionKey: 'introduction',
            purpose: 'Introduce topic',
            mustCover: ['Background', 'Motivation'],
            mustAvoid: []
          }
        ]
      };

      const report = (service as any).generateEmptyCoverageReport(blueprint);
      
      expect(report.totalPapers).toBe(0);
      expect(report.mappedPapers).toBe(0);
      expect(report.gaps.length).toBe(2); // Both mustCover items should be gaps
      expect(report.warnings).toContain('No citations imported. Import citations before mapping.');
    });
  });

  describe('Response Parsing', () => {
    it('should parse valid mapping response', () => {
      const validResponse = `[
        {
          "paperId": "paper-1",
          "citationKey": "Smith2023",
          "sectionKey": "literature_review",
          "dimensionMappings": [
            {
              "dimension": "Current performance benchmarks",
              "remark": "Reports state-of-the-art results on ImageNet.",
              "confidence": "HIGH"
            }
          ]
        }
      ]`;

      const papers = [{ id: 'paper-1', citationKey: 'Smith2023', title: 'Test', abstract: null, year: 2023, venue: null, authors: [] }];
      const parsed = (service as any).parseMappingResponse(validResponse, papers);
      
      expect(parsed).toHaveLength(1);
      expect(parsed[0].paperId).toBe('paper-1');
      expect(parsed[0].sectionKey).toBe('literature_review');
      expect(parsed[0].dimensionMappings).toHaveLength(1);
    });

    it('should handle JSON with markdown code fences', () => {
      const responseWithFences = '```json\n[{"paperId": "p1", "sectionKey": "methodology", "dimensionMappings": []}]\n```';

      const papers = [{ id: 'p1', citationKey: 'A2023', title: 'Test', abstract: null, year: 2023, venue: null, authors: [] }];
      const parsed = (service as any).parseMappingResponse(responseWithFences, papers);
      
      expect(parsed).toHaveLength(1);
      expect(parsed[0].sectionKey).toBe('methodology');
    });

    it('should return error mappings for invalid JSON', () => {
      const invalidResponse = 'Not valid JSON at all';

      const papers = [
        { id: 'p1', citationKey: 'A2023', title: 'Test 1', abstract: null, year: 2023, venue: null, authors: [] },
        { id: 'p2', citationKey: 'B2023', title: 'Test 2', abstract: null, year: 2023, venue: null, authors: [] }
      ];

      const parsed = (service as any).parseMappingResponse(invalidResponse, papers);
      
      expect(parsed).toHaveLength(2);
      expect(parsed.every((p: { mappingStatus: string }) => p.mappingStatus === 'ERROR')).toBe(true);
    });

    it('should handle snake_case field names from LLM', () => {
      const snakeCaseResponse = `[
        {
          "paper_id": "paper-1",
          "citation_key": "Smith2023",
          "section_key": "discussion",
          "dimension_mappings": [
            { "dimension": "Future directions", "remark": "Suggests improvements", "confidence": "MEDIUM" }
          ]
        }
      ]`;

      const papers = [{ id: 'paper-1', citationKey: 'Smith2023', title: 'Test', abstract: null, year: 2023, venue: null, authors: [] }];
      const parsed = (service as any).parseMappingResponse(snakeCaseResponse, papers);
      
      expect(parsed[0].paperId).toBe('paper-1');
      expect(parsed[0].sectionKey).toBe('discussion');
    });
  });

  describe('Blueprint Mapping Prompt Construction', () => {
    it('should build comprehensive prompt with papers and blueprint', () => {
      const papers = [
        {
          id: 'p1',
          citationKey: 'Smith2023',
          title: 'Deep Learning for Medical Imaging',
          abstract: 'We present a novel approach...',
          year: 2023,
          venue: 'Nature Medicine',
          authors: ['John Smith']
        }
      ];

      const blueprint = {
        sectionPlan: [
          {
            sectionKey: 'literature_review',
            purpose: 'Review existing methods',
            mustCover: ['Performance benchmarks', 'Dataset limitations'],
            mustAvoid: ['Implementation details']
          }
        ]
      };

      const prompt = (service as any).buildBlueprintMappingPrompt(papers, blueprint);
      
      // Prompt should contain paper info
      expect(prompt).toContain('Deep Learning for Medical Imaging');
      expect(prompt).toContain('Smith2023');
      expect(prompt).toContain('Nature Medicine');
      
      // Prompt should contain blueprint info
      expect(prompt).toContain('literature_review');
      expect(prompt).toContain('Performance benchmarks');
      expect(prompt).toContain('Dataset limitations');
      
      // Prompt should contain mapping rules
      expect(prompt).toContain('MUST COVER');
      expect(prompt).toContain('dimension');
      expect(prompt).toContain('remark');
    });

    it('should handle papers with missing abstract', () => {
      const papers = [
        {
          id: 'p1',
          citationKey: 'Doe2023',
          title: 'Paper Without Abstract',
          abstract: null,
          year: 2023,
          venue: null,
          authors: []
        }
      ];

      const blueprint = {
        sectionPlan: [{
          sectionKey: 'intro',
          purpose: 'Introduction',
          mustCover: ['Background'],
          mustAvoid: []
        }]
      };

      const prompt = (service as any).buildBlueprintMappingPrompt(papers, blueprint);
      
      expect(prompt).toContain('Paper Without Abstract');
      expect(prompt).toContain('No abstract available');
    });

    it('should add grant persuasion guidance for grant-backed blueprints', () => {
      const papers = [
        {
          id: 'p1',
          citationKey: 'Grant2024',
          title: 'Implementation outcomes for mobile adherence support',
          abstract: 'A pilot implementation improved adherence by 24% and documented delivery barriers.',
          year: 2024,
          venue: 'Implementation Science',
          authors: ['A. Grant']
        }
      ];

      const blueprint = {
        paperTypeCode: 'GRANT_TEMPLATE::call-1',
        sectionPlan: [
          {
            sectionKey: 'problem_need',
            purpose: 'Establish need',
            mustCover: [],
            dimensions: ['Scale, burden, or urgency of medication non-adherence among older adults'],
            mustAvoid: []
          }
        ]
      };

      const prompt = (service as any).buildBlueprintMappingPrompt(papers, blueprint);

      expect(prompt).toContain('Evaluate persuasion value for a reviewer');
      expect(prompt).toContain('specific fact');
      expect(prompt).toContain('statistics, prevalence, incidence, costs, or baseline facts');
    });
  });

  describe('Confidence Validation', () => {
    it('should accept valid confidence levels', () => {
      expect((service as any).validateConfidence('HIGH')).toBe('HIGH');
      expect((service as any).validateConfidence('MEDIUM')).toBe('MEDIUM');
      expect((service as any).validateConfidence('LOW')).toBe('LOW');
    });

    it('should default invalid confidence to MEDIUM', () => {
      expect((service as any).validateConfidence('VERY_HIGH')).toBe('MEDIUM');
      expect((service as any).validateConfidence('invalid')).toBe('MEDIUM');
      expect((service as any).validateConfidence(null)).toBe('MEDIUM');
      expect((service as any).validateConfidence(undefined)).toBe('MEDIUM');
    });
  });
});
