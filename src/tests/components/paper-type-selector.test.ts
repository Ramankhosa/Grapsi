import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the paper type service
vi.mock('../../lib/services/paper-type-service', () => ({
  paperTypeService: {
    getAllPaperTypes: vi.fn(),
    getPaperType: vi.fn()
  }
}));

import { paperTypeService } from '../../lib/services/paper-type-service';

// Mock React components (simplified for testing)
const mockPaperTypeSelector = {
  // Simulate component props and behavior
  async loadPaperTypes() {
    return await paperTypeService.getAllPaperTypes();
  },

  validateSelection(selectedType: string) {
    if (!selectedType) {
      return { isValid: false, error: 'Paper type is required' };
    }

    // Check if it's a valid paper type code
    const validTypes = ['JOURNAL_ARTICLE', 'CONFERENCE_PAPER', 'BOOK_CHAPTER', 'THESIS_MASTERS', 'THESIS_PHD', 'CASE_STUDY'];
    if (!validTypes.includes(selectedType)) {
      return { isValid: false, error: 'Invalid paper type selected' };
    }

    return { isValid: true };
  },

  getPaperTypeDisplayInfo(typeCode: string) {
    const typeInfo: Record<string, any> = {
      'JOURNAL_ARTICLE': {
        name: 'Journal Article',
        description: 'Traditional academic journal article with full research methodology',
        typicalLength: '6000-8000 words',
        sections: ['Abstract', 'Introduction', 'Methodology', 'Results', 'Discussion', 'Conclusion']
      },
      'CONFERENCE_PAPER': {
        name: 'Conference Paper',
        description: 'Shorter format paper for academic conferences',
        typicalLength: '4000-6000 words',
        sections: ['Abstract', 'Introduction', 'Related Work', 'Methodology', 'Results', 'Conclusion']
      }
    };

    return typeInfo[typeCode] || null;
  }
};

describe('PaperTypeSelector Component Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Paper Type Loading', () => {
    it('should load all active paper types', async () => {
      const mockPaperTypes = [
        {
          id: 'type1',
          code: 'JOURNAL_ARTICLE',
          name: 'Journal Article',
          description: 'Academic journal article',
          requiredSections: ['abstract', 'introduction', 'methodology'],
          optionalSections: ['acknowledgments'],
          sectionOrder: ['abstract', 'introduction', 'methodology', 'acknowledgments'],
          defaultWordLimits: { abstract: 250, introduction: 1000 },
          isActive: true
        }
      ];

      (paperTypeService.getAllPaperTypes as any).mockResolvedValue(mockPaperTypes);

      const result = await mockPaperTypeSelector.loadPaperTypes();

      expect(paperTypeService.getAllPaperTypes).toHaveBeenCalled();
      expect(result).toEqual(mockPaperTypes);
    });

    it('should handle loading errors gracefully', async () => {
      (paperTypeService.getAllPaperTypes as any).mockRejectedValue(new Error('Database error'));

      await expect(mockPaperTypeSelector.loadPaperTypes())
        .rejects.toThrow('Database error');
    });
  });

  describe('Selection Validation', () => {
    it('should validate required paper type selection', () => {
      const result = mockPaperTypeSelector.validateSelection('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Paper type is required');
    });

    it('should accept valid paper type selections', () => {
      const validTypes = ['JOURNAL_ARTICLE', 'CONFERENCE_PAPER', 'BOOK_CHAPTER', 'THESIS_MASTERS'];

      validTypes.forEach(type => {
        const result = mockPaperTypeSelector.validateSelection(type);
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });

    it('should reject invalid paper type selections', () => {
      const result = mockPaperTypeSelector.validateSelection('INVALID_TYPE');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid paper type selected');
    });
  });

  describe('Display Information', () => {
    it('should provide correct display information for journal articles', () => {
      const info = mockPaperTypeSelector.getPaperTypeDisplayInfo('JOURNAL_ARTICLE');

      expect(info).toEqual({
        name: 'Journal Article',
        description: 'Traditional academic journal article with full research methodology',
        typicalLength: '6000-8000 words',
        sections: ['Abstract', 'Introduction', 'Methodology', 'Results', 'Discussion', 'Conclusion']
      });
    });

    it('should provide correct display information for conference papers', () => {
      const info = mockPaperTypeSelector.getPaperTypeDisplayInfo('CONFERENCE_PAPER');

      expect(info).toEqual({
        name: 'Conference Paper',
        description: 'Shorter format paper for academic conferences',
        typicalLength: '4000-6000 words',
        sections: ['Abstract', 'Introduction', 'Related Work', 'Methodology', 'Results', 'Conclusion']
      });
    });

    it('should return null for unknown paper types', () => {
      const info = mockPaperTypeSelector.getPaperTypeDisplayInfo('UNKNOWN_TYPE');
      expect(info).toBeNull();
    });
  });
});
