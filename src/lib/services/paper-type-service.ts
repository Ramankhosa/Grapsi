/**
 * Paper Type Service
 * Manages paper type configurations from database for extensible academic writing
 */

import { prisma } from '../prisma';
import type { PaperTypeDefinition } from '@prisma/client';

export interface PaperTypeWithSections extends Omit<PaperTypeDefinition, 'requiredSections' | 'optionalSections' | 'sectionOrder' | 'defaultWordLimits'> {
  requiredSections: string[];
  optionalSections: string[];
  sectionOrder: string[];
  defaultWordLimits: Record<string, number>;
}

export interface SectionValidationResult {
  isValid: boolean;
  missingRequiredSections: string[];
  warnings: string[];
}

export interface CreatePaperTypeInput {
  code: string;
  name: string;
  description?: string;
  requiredSections: string[];
  optionalSections: string[];
  sectionOrder: string[];
  defaultWordLimits: Record<string, number>;
  defaultCitationStyle?: string;
  sortOrder?: number;
}

export interface UpdatePaperTypeInput extends Partial<CreatePaperTypeInput> {
  isActive?: boolean;
}

class PaperTypeService {
  private cache: Map<string, PaperTypeWithSections> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private allCache: PaperTypeWithSections[] | null = null;
  private allCacheTimestamp: number = 0;

  /**
   * Get all active paper types with caching
   */
  async getAllPaperTypes(): Promise<PaperTypeWithSections[]> {
    const now = Date.now();

    // Return cached data if still valid
    if (this.allCache && (now - this.allCacheTimestamp) < this.CACHE_TTL_MS) {
      return this.allCache;
    }

    const paperTypes = await prisma.paperTypeDefinition.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });

    const transformedTypes = paperTypes.map(this.transformPaperType);
    this.allCache = transformedTypes;
    this.allCacheTimestamp = now;

    return transformedTypes;
  }

  /**
   * Get single paper type by code with caching
   */
  async getPaperType(code: string): Promise<PaperTypeWithSections | null> {
    const now = Date.now();

    // Check cache first
    if (this.cache.has(code)) {
      const cached = this.cache.get(code)!;
      // Check if cache entry is still valid
      if ((now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
        return cached;
      }
    }

    const paperType = await prisma.paperTypeDefinition.findUnique({
      where: { code }
    });

    if (!paperType || !paperType.isActive) {
      return null;
    }

    const transformedType = this.transformPaperType(paperType);
    this.cache.set(code, transformedType);
    this.cacheTimestamp = now;

    return transformedType;
  }

  /**
   * Get ordered list of sections for a paper type
   */
  async getSectionsForPaperType(code: string): Promise<{
    required: string[];
    optional: string[];
    all: string[];
  } | null> {
    const paperType = await this.getPaperType(code);
    if (!paperType) {
      return null;
    }

    return {
      required: paperType.requiredSections,
      optional: paperType.optionalSections,
      all: paperType.sectionOrder
    };
  }

  /**
   * Validate if a paper has all required sections for its type
   */
  async validateSectionStructure(
    paperTypeCode: string,
    existingSections: string[]
  ): Promise<SectionValidationResult> {
    const paperType = await this.getPaperType(paperTypeCode);
    if (!paperType) {
      return {
        isValid: false,
        missingRequiredSections: [],
        warnings: [`Unknown paper type: ${paperTypeCode}`]
      };
    }

    const existingSectionsSet = new Set(existingSections.map(s => s.toLowerCase()));
    const missingRequiredSections = paperType.requiredSections.filter(
      section => !existingSectionsSet.has(section.toLowerCase())
    );

    const warnings: string[] = [];

    // Check for sections not in the defined section order
    const definedSections = new Set([...paperType.requiredSections, ...paperType.optionalSections].map(s => s.toLowerCase()));
    const undefinedSections = existingSections.filter(
      section => !definedSections.has(section.toLowerCase())
    );

    if (undefinedSections.length > 0) {
      warnings.push(`Undefined sections found: ${undefinedSections.join(', ')}`);
    }

    // Check if required sections appear in the correct order
    const requiredInOrder = paperType.sectionOrder.filter(
      section => paperType.requiredSections.includes(section)
    );

    const existingRequiredOrder = existingSections.filter(
      section => paperType.requiredSections.some(req => req.toLowerCase() === section.toLowerCase())
    );

    // Simple order validation - check if all required sections are present
    // More complex order validation could be added later if needed

    return {
      isValid: missingRequiredSections.length === 0,
      missingRequiredSections,
      warnings
    };
  }

  /**
   * Admin: Create new paper type
   */
  async createPaperType(input: CreatePaperTypeInput): Promise<PaperTypeWithSections> {
    // Validate input
    this.validatePaperTypeInput(input);

    const paperType = await prisma.paperTypeDefinition.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        requiredSections: input.requiredSections,
        optionalSections: input.optionalSections,
        sectionOrder: input.sectionOrder,
        defaultWordLimits: input.defaultWordLimits,
        defaultCitationStyle: input.defaultCitationStyle,
        sortOrder: input.sortOrder ?? 0
      }
    });

    // Clear cache
    this.invalidateCache();

    return this.transformPaperType(paperType);
  }

  /**
   * Admin: Update existing paper type
   */
  async updatePaperType(code: string, input: UpdatePaperTypeInput): Promise<PaperTypeWithSections | null> {
    const existingType = await prisma.paperTypeDefinition.findUnique({
      where: { code }
    });

    if (!existingType) {
      throw new Error(`Paper type not found: ${code}`);
    }

    // Validate input if sections are being updated
    if (input.requiredSections || input.optionalSections || input.sectionOrder) {
      const mergedInput = {
        code,
        name: input.name ?? existingType.name,
        description: input.description ?? existingType.description ?? undefined,
        requiredSections: input.requiredSections ?? (existingType.requiredSections as string[]),
        optionalSections: input.optionalSections ?? (existingType.optionalSections as string[]),
        sectionOrder: input.sectionOrder ?? (existingType.sectionOrder as string[]),
        defaultWordLimits: input.defaultWordLimits ?? (existingType.defaultWordLimits as Record<string, number>),
        defaultCitationStyle: input.defaultCitationStyle ?? existingType.defaultCitationStyle ?? undefined,
        sortOrder: input.sortOrder ?? existingType.sortOrder
      };
      this.validatePaperTypeInput(mergedInput);
    }

    const updatedType = await prisma.paperTypeDefinition.update({
      where: { code },
      data: {
        name: input.name,
        description: input.description,
        requiredSections: input.requiredSections,
        optionalSections: input.optionalSections,
        sectionOrder: input.sectionOrder,
        defaultWordLimits: input.defaultWordLimits,
        defaultCitationStyle: input.defaultCitationStyle,
        sortOrder: input.sortOrder,
        isActive: input.isActive
      }
    });

    // Clear cache
    this.invalidateCache();

    return this.transformPaperType(updatedType);
  }

  /**
   * Admin: Soft delete paper type (set inactive)
   */
  async deletePaperType(code: string): Promise<void> {
    const existingType = await prisma.paperTypeDefinition.findUnique({
      where: { code }
    });

    if (!existingType) {
      throw new Error(`Paper type not found: ${code}`);
    }

    // Check if paper type is being used by any sessions
    const usageCount = await prisma.draftingSession.count({
      where: { paperTypeId: existingType.id }
    });

    if (usageCount > 0) {
      throw new Error(`Cannot delete paper type: ${code} is being used by ${usageCount} sessions`);
    }

    await prisma.paperTypeDefinition.update({
      where: { code },
      data: { isActive: false }
    });

    // Clear cache
    this.invalidateCache();
  }

  /**
   * Get paper type usage statistics
   */
  async getPaperTypeUsageStats(): Promise<Array<{
    code: string;
    name: string;
    sessionCount: number;
  }>> {
    const stats = await prisma.paperTypeDefinition.findMany({
      where: { isActive: true },
      select: {
        code: true,
        name: true,
        _count: {
          select: {
            sessions: true
          }
        }
      }
    });

    return stats.map(stat => ({
      code: stat.code,
      name: stat.name,
      sessionCount: stat._count.sessions
    }));
  }

  /**
   * Transform database model to service interface
   */
  private transformPaperType(dbType: any): PaperTypeWithSections {
    return {
      ...dbType,
      requiredSections: Array.isArray(dbType.requiredSections)
        ? dbType.requiredSections
        : JSON.parse(dbType.requiredSections || '[]'),
      optionalSections: Array.isArray(dbType.optionalSections)
        ? dbType.optionalSections
        : JSON.parse(dbType.optionalSections || '[]'),
      sectionOrder: Array.isArray(dbType.sectionOrder)
        ? dbType.sectionOrder
        : JSON.parse(dbType.sectionOrder || '[]'),
      defaultWordLimits: typeof dbType.defaultWordLimits === 'object' && dbType.defaultWordLimits !== null
        ? dbType.defaultWordLimits
        : JSON.parse(dbType.defaultWordLimits || '{}')
    };
  }

  /**
   * Validate paper type input data
   */
  private validatePaperTypeInput(input: CreatePaperTypeInput): void {
    if (!input.code || input.code.trim().length === 0) {
      throw new Error('Paper type code is required');
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Paper type name is required');
    }

    if (!Array.isArray(input.requiredSections) || input.requiredSections.length === 0) {
      throw new Error('At least one required section must be specified');
    }

    if (!Array.isArray(input.sectionOrder) || input.sectionOrder.length === 0) {
      throw new Error('Section order must be specified');
    }

    // Validate that all required sections are in the section order
    const sectionOrderSet = new Set(input.sectionOrder);
    const missingFromOrder = input.requiredSections.filter(section => !sectionOrderSet.has(section));
    if (missingFromOrder.length > 0) {
      throw new Error(`Required sections missing from section order: ${missingFromOrder.join(', ')}`);
    }

    // Validate word limits object
    if (typeof input.defaultWordLimits !== 'object' || input.defaultWordLimits === null) {
      throw new Error('Default word limits must be an object');
    }

    // Validate that word limits are positive numbers
    for (const [section, limit] of Object.entries(input.defaultWordLimits)) {
      if (typeof limit !== 'number' || limit <= 0) {
        throw new Error(`Invalid word limit for section ${section}: must be a positive number`);
      }
    }
  }

  /**
   * Invalidate all caches
   */
  private invalidateCache(): void {
    this.cache.clear();
    this.allCache = null;
    this.cacheTimestamp = 0;
    this.allCacheTimestamp = 0;
  }

  /**
   * Get cache statistics (for monitoring/debugging)
   */
  getCacheStats(): {
    individualCacheSize: number;
    allCacheSize: number;
    cacheAge: number;
  } {
    return {
      individualCacheSize: this.cache.size,
      allCacheSize: this.allCache?.length ?? 0,
      cacheAge: Date.now() - Math.max(this.cacheTimestamp, this.allCacheTimestamp)
    };
  }
}

// Export singleton instance
export const paperTypeService = new PaperTypeService();

// Export class for testing
export { PaperTypeService };
