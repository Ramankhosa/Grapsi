import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the paper type service for validation
vi.mock('../../lib/services/paper-type-service', () => ({
  paperTypeService: {
    validateSectionStructure: vi.fn()
  }
}));

import { paperTypeService } from '../../lib/services/paper-type-service';

// Mock stage navigation logic
const mockStageNavigation = {
  stages: {
    TOPIC_ENTRY: 'topic_entry',
    LITERATURE_SEARCH: 'literature_search',
    OUTLINE_PLANNING: 'outline_planning',
    FIGURE_PLANNER: 'figure_planner',
    SECTION_DRAFTING: 'section_drafting',
    REVIEW_EXPORT: 'review_export'
  },

  stageOrder: [
    'TOPIC_ENTRY',
    'LITERATURE_SEARCH',
    'OUTLINE_PLANNING',
    'FIGURE_PLANNER',
    'SECTION_DRAFTING',
    'REVIEW_EXPORT'
  ],

  async canProceedToStage(currentStage: string, nextStage: string, sessionData: any) {
    const requirements = this.getStageRequirements(nextStage);

    for (const requirement of requirements) {
      const isMet = await this.checkRequirement(requirement, sessionData);
      if (!isMet) {
        return {
          canProceed: false,
          blockingRequirement: requirement,
          message: this.getRequirementMessage(requirement)
        };
      }
    }

    return { canProceed: true };
  },

  getStageRequirements(stage: string) {
    const requirements: Record<string, string[]> = {
      LITERATURE_SEARCH: ['topic_defined'],
      OUTLINE_PLANNING: ['citations_imported'],
      FIGURE_PLANNER: ['paper_type_selected'],
      SECTION_DRAFTING: ['sections_configured'],
      REVIEW_EXPORT: ['sections_completed']
    };

    return requirements[stage] || [];
  },

  async checkRequirement(requirement: string, sessionData: any) {
    switch (requirement) {
      case 'topic_defined':
        return sessionData.researchTopic &&
               sessionData.researchTopic.title &&
               sessionData.researchTopic.researchQuestion;

      case 'citations_imported':
        return sessionData.citations && sessionData.citations.length >= 5;

      case 'paper_type_selected':
        return sessionData.paperTypeId !== null;

      case 'sections_configured':
        return sessionData.paperTypeId !== null;

      case 'sections_completed':
        // Check if all required sections have content
        if (!sessionData.paperTypeId) return false;

        const validation = await paperTypeService.validateSectionStructure(
          sessionData.paperTypeCode,
          sessionData.completedSections || []
        );

        return validation.isValid;

      default:
        return true;
    }
  },

  getRequirementMessage(requirement: string) {
    const messages: Record<string, string> = {
      topic_defined: 'Please complete the research topic with title and research question',
      citations_imported: 'Please import at least 5 citations before proceeding',
      paper_type_selected: 'Please select a paper type',
      sections_configured: 'Please configure paper sections',
      sections_completed: 'Please complete all required sections before export'
    };

    return messages[requirement] || 'Requirement not met';
  },

  getNextStage(currentStage: string) {
    const currentIndex = this.stageOrder.indexOf(currentStage);
    if (currentIndex === -1 || currentIndex === this.stageOrder.length - 1) {
      return null;
    }

    return this.stageOrder[currentIndex + 1];
  },

  getPreviousStage(currentStage: string) {
    const currentIndex = this.stageOrder.indexOf(currentStage);
    if (currentIndex <= 0) {
      return null;
    }

    return this.stageOrder[currentIndex - 1];
  },

  calculateProgress(currentStage: string) {
    const currentIndex = this.stageOrder.indexOf(currentStage);
    if (currentIndex === -1) return 0;

    return Math.round(((currentIndex + 1) / this.stageOrder.length) * 100);
  }
};

describe('Stage Navigation Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stage Transitions', () => {
    it('should allow proceeding when all requirements are met', async () => {
      const sessionData = {
        researchTopic: {
          title: 'Test Paper',
          researchQuestion: 'What is the research question?'
        },
        citations: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }],
        paperTypeId: 'journal_article',
        paperTypeCode: 'JOURNAL_ARTICLE',
        completedSections: ['abstract', 'introduction', 'methodology', 'results', 'discussion', 'conclusion']
      };

      (paperTypeService.validateSectionStructure as any).mockResolvedValue({
        isValid: true,
        missingRequiredSections: [],
        warnings: []
      });

      const result = await mockStageNavigation.canProceedToStage('SECTION_DRAFTING', 'REVIEW_EXPORT', sessionData);

      expect(result.canProceed).toBe(true);
    });

    it('should block proceeding when topic is not defined', async () => {
      const sessionData = {
        researchTopic: null,
        citations: []
      };

      const result = await mockStageNavigation.canProceedToStage('TOPIC_ENTRY', 'LITERATURE_SEARCH', sessionData);

      expect(result.canProceed).toBe(false);
      expect(result.blockingRequirement).toBe('topic_defined');
      expect(result.message).toBe('Please complete the research topic with title and research question');
    });

    it('should block proceeding when insufficient citations', async () => {
      const sessionData = {
        researchTopic: { title: 'Test', researchQuestion: 'Question?' },
        citations: [{ id: '1' }, { id: '2' }] // Only 2 citations
      };

      const result = await mockStageNavigation.canProceedToStage('LITERATURE_SEARCH', 'OUTLINE_PLANNING', sessionData);

      expect(result.canProceed).toBe(false);
      expect(result.blockingRequirement).toBe('citations_imported');
      expect(result.message).toBe('Please import at least 5 citations before proceeding');
    });

    it('should block proceeding when paper type not selected', async () => {
      const sessionData = {
        researchTopic: { title: 'Test', researchQuestion: 'Question?' },
        citations: Array.from({ length: 5 }, (_, i) => ({ id: `${i}` })),
        paperTypeId: null
      };

      const result = await mockStageNavigation.canProceedToStage('OUTLINE_PLANNING', 'FIGURE_PLANNER', sessionData);

      expect(result.canProceed).toBe(false);
      expect(result.blockingRequirement).toBe('paper_type_selected');
      expect(result.message).toBe('Please select a paper type');
    });

    it('should block proceeding when sections are incomplete', async () => {
      const sessionData = {
        paperTypeId: 'journal_article',
        paperTypeCode: 'JOURNAL_ARTICLE',
        completedSections: ['abstract', 'introduction'] // Missing required sections
      };

      (paperTypeService.validateSectionStructure as any).mockResolvedValue({
        isValid: false,
        missingRequiredSections: ['methodology', 'results'],
        warnings: []
      });

      const result = await mockStageNavigation.canProceedToStage('SECTION_DRAFTING', 'REVIEW_EXPORT', sessionData);

      expect(result.canProceed).toBe(false);
      expect(result.blockingRequirement).toBe('sections_completed');
      expect(result.message).toBe('Please complete all required sections before export');
    });
  });

  describe('Stage Navigation', () => {
    it('should return next stage correctly', () => {
      expect(mockStageNavigation.getNextStage('TOPIC_ENTRY')).toBe('LITERATURE_SEARCH');
      expect(mockStageNavigation.getNextStage('LITERATURE_SEARCH')).toBe('OUTLINE_PLANNING');
      expect(mockStageNavigation.getNextStage('SECTION_DRAFTING')).toBe('REVIEW_EXPORT');
      expect(mockStageNavigation.getNextStage('REVIEW_EXPORT')).toBeNull();
    });

    it('should return previous stage correctly', () => {
      expect(mockStageNavigation.getPreviousStage('REVIEW_EXPORT')).toBe('SECTION_DRAFTING');
      expect(mockStageNavigation.getPreviousStage('LITERATURE_SEARCH')).toBe('TOPIC_ENTRY');
      expect(mockStageNavigation.getPreviousStage('TOPIC_ENTRY')).toBeNull();
    });

    it('should handle invalid stages', () => {
      expect(mockStageNavigation.getNextStage('INVALID_STAGE')).toBeNull();
      expect(mockStageNavigation.getPreviousStage('INVALID_STAGE')).toBeNull();
    });
  });

  describe('Progress Calculation', () => {
    it('should calculate progress correctly', () => {
      expect(mockStageNavigation.calculateProgress('TOPIC_ENTRY')).toBe(17); // 1/6 ≈ 17%
      expect(mockStageNavigation.calculateProgress('LITERATURE_SEARCH')).toBe(33); // 2/6 ≈ 33%
      expect(mockStageNavigation.calculateProgress('OUTLINE_PLANNING')).toBe(50); // 3/6 = 50%
      expect(mockStageNavigation.calculateProgress('SECTION_DRAFTING')).toBe(83); // 5/6 ≈ 83%
      expect(mockStageNavigation.calculateProgress('REVIEW_EXPORT')).toBe(100); // 6/6 = 100%
    });

    it('should return 0 for invalid stages', () => {
      expect(mockStageNavigation.calculateProgress('INVALID_STAGE')).toBe(0);
    });
  });

  describe('Stage Requirements', () => {
    it('should return correct requirements for each stage', () => {
      expect(mockStageNavigation.getStageRequirements('LITERATURE_SEARCH')).toEqual(['topic_defined']);
      expect(mockStageNavigation.getStageRequirements('OUTLINE_PLANNING')).toEqual(['citations_imported']);
      expect(mockStageNavigation.getStageRequirements('FIGURE_PLANNER')).toEqual(['paper_type_selected']);
      expect(mockStageNavigation.getStageRequirements('SECTION_DRAFTING')).toEqual(['sections_configured']);
      expect(mockStageNavigation.getStageRequirements('REVIEW_EXPORT')).toEqual(['sections_completed']);
    });

    it('should return empty requirements for unknown stages', () => {
      expect(mockStageNavigation.getStageRequirements('UNKNOWN_STAGE')).toEqual([]);
    });
  });
});
