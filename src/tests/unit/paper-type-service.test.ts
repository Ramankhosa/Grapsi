import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaperTypeService, type CreatePaperTypeInput, type UpdatePaperTypeInput } from '../../lib/services/paper-type-service';

// Mock prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    paperTypeDefinition: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn()
    },
    draftingSession: {
      count: vi.fn()
    }
  }
}));

import { prisma } from '../../lib/prisma';

describe('PaperTypeService', () => {
  let service: PaperTypeService;

  beforeEach(() => {
    service = new PaperTypeService();
    // Reset mocks
    vi.clearAllMocks();
  });

  describe('getAllPaperTypes', () => {
    it('should return all active paper types', async () => {
      const mockPaperTypes = [
        {
          id: 'type1',
          code: 'JOURNAL_ARTICLE',
          name: 'Journal Article',
          description: 'Academic journal article',
          requiredSections: JSON.stringify(['abstract', 'introduction', 'methodology']),
          optionalSections: JSON.stringify(['acknowledgments']),
          sectionOrder: JSON.stringify(['abstract', 'introduction', 'methodology', 'acknowledgments']),
          defaultWordLimits: JSON.stringify({ abstract: 250, introduction: 1000 }),
          defaultCitationStyle: 'APA7',
          sortOrder: 1,
          isActive: true
        }
      ];

      (prisma.paperTypeDefinition.findMany as any).mockResolvedValue(mockPaperTypes);

      const result = await service.getAllPaperTypes();

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('JOURNAL_ARTICLE');
      expect(result[0].requiredSections).toEqual(['abstract', 'introduction', 'methodology']);
      expect(result[0].optionalSections).toEqual(['acknowledgments']);
      expect(result[0].sectionOrder).toEqual(['abstract', 'introduction', 'methodology', 'acknowledgments']);
      expect(result[0].defaultWordLimits).toEqual({ abstract: 250, introduction: 1000 });
    });

    it('should return cached data when available', async () => {
      const mockPaperTypes = [{
        id: 'type1',
        code: 'JOURNAL_ARTICLE',
        name: 'Journal Article',
        requiredSections: JSON.stringify(['abstract']),
        optionalSections: JSON.stringify([]),
        sectionOrder: JSON.stringify(['abstract']),
        defaultWordLimits: JSON.stringify({}),
        isActive: true
      }];

      (prisma.paperTypeDefinition.findMany as any).mockResolvedValue(mockPaperTypes);

      // First call should hit database
      await service.getAllPaperTypes();
      // Second call should use cache
      await service.getAllPaperTypes();

      expect(prisma.paperTypeDefinition.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPaperType', () => {
    it('should return single paper type by code', async () => {
      const mockPaperType = {
        id: 'type1',
        code: 'JOURNAL_ARTICLE',
        name: 'Journal Article',
        description: 'Academic journal article',
        requiredSections: JSON.stringify(['abstract', 'introduction']),
        optionalSections: JSON.stringify(['acknowledgments']),
        sectionOrder: JSON.stringify(['abstract', 'introduction', 'acknowledgments']),
        defaultWordLimits: JSON.stringify({ abstract: 250, introduction: 1000 }),
        defaultCitationStyle: 'APA7',
        sortOrder: 1,
        isActive: true
      };

      (prisma.paperTypeDefinition.findUnique as any).mockResolvedValue(mockPaperType);

      const result = await service.getPaperType('JOURNAL_ARTICLE');

      expect(result?.code).toBe('JOURNAL_ARTICLE');
      expect(result?.requiredSections).toEqual(['abstract', 'introduction']);
    });

    it('should return null for inactive paper type', async () => {
      const mockPaperType = {
        id: 'type1',
        code: 'JOURNAL_ARTICLE',
        isActive: false
      };

      (prisma.paperTypeDefinition.findUnique as any).mockResolvedValue(mockPaperType);

      const result = await service.getPaperType('JOURNAL_ARTICLE');
      expect(result).toBeNull();
    });

    it('should return null for non-existent paper type', async () => {
      (prisma.paperTypeDefinition.findUnique as any).mockResolvedValue(null);

      const result = await service.getPaperType('NON_EXISTENT');
      expect(result).toBeNull();
    });
  });

  describe('getSectionsForPaperType', () => {
    it('should return ordered sections for paper type', async () => {
      const mockPaperType = {
        id: 'type1',
        code: 'JOURNAL_ARTICLE',
        name: 'Journal Article',
        requiredSections: ['abstract', 'introduction', 'methodology'],
        optionalSections: ['acknowledgments'],
        sectionOrder: ['abstract', 'introduction', 'methodology', 'acknowledgments'],
        defaultWordLimits: { abstract: 250, introduction: 1000 },
        isActive: true
      };

      // Mock getPaperType
      vi.spyOn(service, 'getPaperType').mockResolvedValue(mockPaperType as any);

      const result = await service.getSectionsForPaperType('JOURNAL_ARTICLE');

      expect(result).toEqual({
        required: ['abstract', 'introduction', 'methodology'],
        optional: ['acknowledgments'],
        all: ['abstract', 'introduction', 'methodology', 'acknowledgments']
      });
    });

    it('should return null for unknown paper type', async () => {
      vi.spyOn(service, 'getPaperType').mockResolvedValue(null);

      const result = await service.getSectionsForPaperType('UNKNOWN');
      expect(result).toBeNull();
    });
  });

  describe('validateSectionStructure', () => {
    it('should validate complete paper structure', async () => {
      const mockPaperType = {
        id: 'type1',
        code: 'JOURNAL_ARTICLE',
        name: 'Journal Article',
        requiredSections: ['abstract', 'introduction', 'methodology'],
        optionalSections: ['acknowledgments'],
        sectionOrder: ['abstract', 'introduction', 'methodology', 'acknowledgments'],
        defaultWordLimits: {},
        isActive: true
      };

      vi.spyOn(service, 'getPaperType').mockResolvedValue(mockPaperType as any);

      const result = await service.validateSectionStructure('JOURNAL_ARTICLE', ['abstract', 'introduction', 'methodology']);

      expect(result.isValid).toBe(true);
      expect(result.missingRequiredSections).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should identify missing required sections', async () => {
      const mockPaperType = {
        id: 'type1',
        code: 'JOURNAL_ARTICLE',
        name: 'Journal Article',
        requiredSections: ['abstract', 'introduction', 'methodology'],
        optionalSections: ['acknowledgments'],
        sectionOrder: ['abstract', 'introduction', 'methodology', 'acknowledgments'],
        defaultWordLimits: {},
        isActive: true
      };

      vi.spyOn(service, 'getPaperType').mockResolvedValue(mockPaperType as any);

      const result = await service.validateSectionStructure('JOURNAL_ARTICLE', ['abstract']);

      expect(result.isValid).toBe(false);
      expect(result.missingRequiredSections).toEqual(['introduction', 'methodology']);
    });

    it('should warn about undefined sections', async () => {
      const mockPaperType = {
        id: 'type1',
        code: 'JOURNAL_ARTICLE',
        name: 'Journal Article',
        requiredSections: ['abstract', 'introduction'],
        optionalSections: ['acknowledgments'],
        sectionOrder: ['abstract', 'introduction', 'acknowledgments'],
        defaultWordLimits: {},
        isActive: true
      };

      vi.spyOn(service, 'getPaperType').mockResolvedValue(mockPaperType as any);

      const result = await service.validateSectionStructure('JOURNAL_ARTICLE', ['abstract', 'introduction', 'unknown_section']);

      expect(result.warnings).toContain('Undefined sections found: unknown_section');
    });

    it('should handle unknown paper type', async () => {
      vi.spyOn(service, 'getPaperType').mockResolvedValue(null);

      const result = await service.validateSectionStructure('UNKNOWN', ['abstract']);

      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain('Unknown paper type: UNKNOWN');
    });
  });

  describe('createPaperType', () => {
    it('should create new paper type successfully', async () => {
      const input: CreatePaperTypeInput = {
        code: 'NEW_TYPE',
        name: 'New Paper Type',
        description: 'A new type of paper',
        requiredSections: ['abstract', 'introduction'],
        optionalSections: ['conclusion'],
        sectionOrder: ['abstract', 'introduction', 'conclusion'],
        defaultWordLimits: { abstract: 200, introduction: 800 },
        defaultCitationStyle: 'APA7',
        sortOrder: 5
      };

      const mockCreated = {
        id: 'new-type-id',
        ...input,
        requiredSections: JSON.stringify(input.requiredSections),
        optionalSections: JSON.stringify(input.optionalSections),
        sectionOrder: JSON.stringify(input.sectionOrder),
        defaultWordLimits: JSON.stringify(input.defaultWordLimits),
        isActive: true
      };

      (prisma.paperTypeDefinition.create as any).mockResolvedValue(mockCreated);

      const result = await service.createPaperType(input);

      expect(result.code).toBe('NEW_TYPE');
      expect(result.requiredSections).toEqual(['abstract', 'introduction']);
      expect(result.optionalSections).toEqual(['conclusion']);
      expect(result.sectionOrder).toEqual(['abstract', 'introduction', 'conclusion']);
      expect(result.defaultWordLimits).toEqual({ abstract: 200, introduction: 800 });
    });

    it('should validate required fields', async () => {
      const invalidInput = {
        code: '',
        name: 'Test',
        requiredSections: [],
        optionalSections: [],
        sectionOrder: [],
        defaultWordLimits: {}
      };

      await expect(service.createPaperType(invalidInput as any))
        .rejects.toThrow('Paper type code is required');
    });

    it('should validate section order includes required sections', async () => {
      const invalidInput: CreatePaperTypeInput = {
        code: 'INVALID',
        name: 'Invalid Type',
        requiredSections: ['abstract', 'introduction'],
        optionalSections: [],
        sectionOrder: ['abstract'], // Missing introduction
        defaultWordLimits: {}
      };

      await expect(service.createPaperType(invalidInput))
        .rejects.toThrow('Required sections missing from section order: introduction');
    });

    it('should validate word limits are positive numbers', async () => {
      const invalidInput: CreatePaperTypeInput = {
        code: 'INVALID',
        name: 'Invalid Type',
        requiredSections: ['abstract'],
        optionalSections: [],
        sectionOrder: ['abstract'],
        defaultWordLimits: { abstract: -100 }
      };

      await expect(service.createPaperType(invalidInput))
        .rejects.toThrow('Invalid word limit for section abstract: must be a positive number');
    });
  });

  describe('updatePaperType', () => {
    it('should update paper type successfully', async () => {
      const existingType = {
        id: 'existing-id',
        code: 'EXISTING',
        name: 'Existing Type',
        requiredSections: ['abstract'],
        optionalSections: [],
        sectionOrder: ['abstract'],
        defaultWordLimits: { abstract: 200 },
        defaultCitationStyle: 'APA7',
        sortOrder: 1
      };

      const updateInput: UpdatePaperTypeInput = {
        name: 'Updated Type',
        description: 'Updated description'
      };

      const updatedType = {
        ...existingType,
        name: 'Updated Type',
        description: 'Updated description',
        requiredSections: JSON.stringify(['abstract']),
        optionalSections: JSON.stringify([]),
        sectionOrder: JSON.stringify(['abstract']),
        defaultWordLimits: JSON.stringify({ abstract: 200 })
      };

      (prisma.paperTypeDefinition.findUnique as any).mockResolvedValue(existingType);
      (prisma.paperTypeDefinition.update as any).mockResolvedValue(updatedType);

      const result = await service.updatePaperType('EXISTING', updateInput);

      expect(result?.name).toBe('Updated Type');
      expect(result?.description).toBe('Updated description');
    });

    it('should throw error for non-existent paper type', async () => {
      (prisma.paperTypeDefinition.findUnique as any).mockResolvedValue(null);

      await expect(service.updatePaperType('NON_EXISTENT', { name: 'New Name' }))
        .rejects.toThrow('Paper type not found: NON_EXISTENT');
    });
  });

  describe('deletePaperType', () => {
    it('should soft delete paper type when not in use', async () => {
      const existingType = {
        id: 'existing-id',
        code: 'TO_DELETE'
      };

      (prisma.paperTypeDefinition.findUnique as any).mockResolvedValue(existingType);
      (prisma.draftingSession.count as any).mockResolvedValue(0);
      (prisma.paperTypeDefinition.update as any).mockResolvedValue({ ...existingType, isActive: false });

      await service.deletePaperType('TO_DELETE');

      expect(prisma.paperTypeDefinition.update).toHaveBeenCalledWith({
        where: { code: 'TO_DELETE' },
        data: { isActive: false }
      });
    });

    it('should prevent deletion when paper type is in use', async () => {
      const existingType = {
        id: 'existing-id',
        code: 'IN_USE'
      };

      (prisma.paperTypeDefinition.findUnique as any).mockResolvedValue(existingType);
      (prisma.draftingSession.count as any).mockResolvedValue(5);

      await expect(service.deletePaperType('IN_USE'))
        .rejects.toThrow('Cannot delete paper type: IN_USE is being used by 5 sessions');
    });
  });

  describe('getPaperTypeUsageStats', () => {
    it('should return usage statistics for all paper types', async () => {
      const mockStats = [
        {
          code: 'JOURNAL_ARTICLE',
          name: 'Journal Article',
          _count: { sessions: 10 }
        },
        {
          code: 'CONFERENCE_PAPER',
          name: 'Conference Paper',
          _count: { sessions: 5 }
        }
      ];

      (prisma.paperTypeDefinition.findMany as any).mockResolvedValue(mockStats);

      const result = await service.getPaperTypeUsageStats();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        code: 'JOURNAL_ARTICLE',
        name: 'Journal Article',
        sessionCount: 10
      });
      expect(result[1]).toEqual({
        code: 'CONFERENCE_PAPER',
        name: 'Conference Paper',
        sessionCount: 5
      });
    });
  });

  describe('caching', () => {
    it('should invalidate cache after create/update/delete operations', async () => {
      // Spy on invalidateCache method
      const invalidateSpy = vi.spyOn(service as any, 'invalidateCache');

      const input: CreatePaperTypeInput = {
        code: 'TEST_TYPE',
        name: 'Test Type',
        requiredSections: ['abstract'],
        optionalSections: [],
        sectionOrder: ['abstract'],
        defaultWordLimits: {}
      };

      (prisma.paperTypeDefinition.create as any).mockResolvedValue({
        id: 'test-id',
        ...input,
        requiredSections: JSON.stringify(input.requiredSections),
        optionalSections: JSON.stringify(input.optionalSections),
        sectionOrder: JSON.stringify(input.sectionOrder),
        defaultWordLimits: JSON.stringify(input.defaultWordLimits),
        isActive: true
      });

      await service.createPaperType(input);

      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  describe('transformPaperType', () => {
    it('should correctly transform database model to service interface', () => {
      const dbType = {
        id: 'test-id',
        code: 'TEST',
        name: 'Test Type',
        description: 'Test description',
        requiredSections: '["abstract","introduction"]',
        optionalSections: '["conclusion"]',
        sectionOrder: '["abstract","introduction","conclusion"]',
        defaultWordLimits: '{"abstract":250,"introduction":1000}',
        defaultCitationStyle: 'APA7',
        sortOrder: 1,
        isActive: true
      };

      const result = (service as any).transformPaperType(dbType);

      expect(result.requiredSections).toEqual(['abstract', 'introduction']);
      expect(result.optionalSections).toEqual(['conclusion']);
      expect(result.sectionOrder).toEqual(['abstract', 'introduction', 'conclusion']);
      expect(result.defaultWordLimits).toEqual({ abstract: 250, introduction: 1000 });
    });

    it('should handle array inputs (for tests)', () => {
      const dbType = {
        id: 'test-id',
        code: 'TEST',
        name: 'Test Type',
        requiredSections: ['abstract', 'introduction'],
        optionalSections: ['conclusion'],
        sectionOrder: ['abstract', 'introduction', 'conclusion'],
        defaultWordLimits: { abstract: 250, introduction: 1000 },
        isActive: true
      };

      const result = (service as any).transformPaperType(dbType);

      expect(result.requiredSections).toEqual(['abstract', 'introduction']);
      expect(result.optionalSections).toEqual(['conclusion']);
      expect(result.sectionOrder).toEqual(['abstract', 'introduction', 'conclusion']);
      expect(result.defaultWordLimits).toEqual({ abstract: 250, introduction: 1000 });
    });
  });
});
