/**
 * Section Template Service
 * Manages section templates for different paper types with venue overrides
 * 
 * Now loads prompts from database (PaperSupersetSection, PaperTypeSectionPrompt)
 * instead of static code files for admin configurability.
 */

import { prisma } from '../prisma';
import { paperTypeService } from './paper-type-service';
import { systemPromptTemplateService, TEMPLATE_KEYS } from './system-prompt-template-service';
import type { PaperTypeDefinition, PaperSupersetSection, PaperTypeSectionPrompt } from '@prisma/client';

export interface SectionTemplate {
  sectionKey: string;
  displayName: string;
  description?: string;
  defaultPrompt: string;
  promptsByPaperType?: Record<string, string>;
  constraints: SectionConstraints;
  applicablePaperTypes: string[]; // PaperTypeDefinition codes
  orderWeight: number;
  isRequired: boolean;
}

export interface SectionConstraints {
  wordLimit?: number;
  citationRequirements?: {
    minimum?: number;
    recommended?: number;
    types?: string[]; // e.g., ['empirical', 'theoretical']
  };
  tenseRequirements?: string[]; // e.g., ['past', 'present']
  styleRequirements?: string[]; // e.g., ['formal', 'objective']
}

export interface VenueSectionOverride {
  venueId: string;
  sectionKey: string;
  customPrompt?: string;
  wordLimitOverride?: number;
  citationRequirements?: SectionConstraints['citationRequirements'];
  additionalConstraints?: Partial<SectionConstraints>;
}

export interface SectionPromptContext {
  researchTopic?: any;
  citationCount?: number;
  availableCitations?: any[];
  previousSections?: Record<string, string>;
  wordCount?: number;
  targetWordCount?: number;
}

export interface SectionContextPolicy {
  requiresBlueprint: boolean;
  requiresPreviousSections: boolean;
  requiresCitations: boolean;
}

class SectionTemplateService {
  private templateCache: Map<string, SectionTemplate[]> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get all section templates for a specific paper type
   */
  async getSectionsForPaperType(paperTypeCode: string): Promise<SectionTemplate[]> {
    const cacheKey = `paperType_${paperTypeCode}`;
    const now = Date.now();

    // Check cache
    if (this.templateCache.has(cacheKey)) {
      const cached = this.templateCache.get(cacheKey)!;
      if ((now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
        return cached;
      }
    }

    // Get paper type to understand its sections
    const paperType = await paperTypeService.getPaperType(paperTypeCode);
    if (!paperType) {
      throw new Error(`Paper type not found: ${paperTypeCode}`);
    }

    // Get all section templates that apply to this paper type
    const templates = await this.getAllSectionTemplates();
    const applicableTemplates = templates.filter(template =>
      template.applicablePaperTypes.includes(paperTypeCode) ||
      template.applicablePaperTypes.includes('*') // Wildcard for all types
    );

    // Order by the paper type's section order, then by template order weight
    const orderedTemplates = this.orderTemplatesByPaperType(applicableTemplates, paperType);

    // Cache and return
    this.templateCache.set(cacheKey, orderedTemplates);
    this.cacheTimestamp = now;

    return orderedTemplates;
  }

  /**
   * Get a specific section template for a paper type
   */
  async getSectionTemplate(sectionKey: string, paperTypeCode: string): Promise<SectionTemplate | null> {
    const allTemplates = await this.getSectionsForPaperType(paperTypeCode);
    const exact = allTemplates.find(template => template.sectionKey === sectionKey);
    if (exact) return exact;

    const normalizedRequested = this.normalizeSectionKey(sectionKey);
    return allTemplates.find(
      template => this.normalizeSectionKey(template.sectionKey) === normalizedRequested
    ) || null;
  }

  /**
   * Build a complete prompt for a section including context
   */
  async getPromptForSection(
    sectionKey: string,
    paperTypeCode: string,
    context: SectionPromptContext = {}
  ): Promise<string> {
    const template = await this.getSectionTemplate(sectionKey, paperTypeCode);
    if (!template) {
      throw new Error(`Section template not found: ${sectionKey} for paper type ${paperTypeCode}`);
    }

    // resolvePromptForPaperType is now async to support DB loading
    let prompt = await this.resolvePromptForPaperType(template, paperTypeCode);

    // Replace context variables
    prompt = this.injectContextVariables(prompt, context);

    // Add constraints information
    const constraintsBlock = this.buildConstraintsBlock(template.constraints, context);
    if (constraintsBlock) {
      prompt += `\n\n${constraintsBlock}`;
    }

    // Add section-specific guidance
    const guidanceBlock = await this.buildGuidanceBlock(sectionKey, context);
    if (guidanceBlock) {
      prompt += `\n\n${guidanceBlock}`;
    }

    return prompt;
  }

  /**
   * Get paper type override for a section (for debugging)
   * Returns just the override instruction, not combined with base
   */
  async getPaperTypeOverride(
    sectionKey: string,
    paperTypeCode: string
  ): Promise<string | null> {
    await this.loadFromDatabase();
    const dbOverride = this.findTypeOverride(paperTypeCode, sectionKey);
    if (dbOverride) {
      return dbOverride.instruction;
    }

    return null;
  }

  /**
   * Create or update a section template
   */
  async upsertSectionTemplate(template: SectionTemplate): Promise<SectionTemplate> {
    // Validate template
    this.validateSectionTemplate(template);

    await prisma.paperSupersetSection.upsert({
      where: { sectionKey: template.sectionKey },
      update: {
        label: template.displayName,
        description: template.description || null,
        instruction: template.defaultPrompt,
        constraints: template.constraints as any,
        displayOrder: template.orderWeight,
        isRequired: template.isRequired,
        isActive: true,
        updatedAt: new Date()
      },
      create: {
        sectionKey: template.sectionKey,
        label: template.displayName,
        description: template.description || null,
        instruction: template.defaultPrompt,
        constraints: template.constraints as any,
        displayOrder: template.orderWeight,
        isRequired: template.isRequired,
        isActive: true
      }
    });

    // Clear cache
    this.invalidateCache();

    return template;
  }

  /**
   * Get venue-specific overrides for a section
   */
  async getVenueOverrides(venueId: string, sectionKey: string): Promise<VenueSectionOverride | null> {
    // In a full implementation, this would query a VenueSectionOverride table
    // For now, return null (no overrides)
    return null;
  }

  /**
   * Apply venue overrides to a section template
   */
  applyVenueOverrides(template: SectionTemplate, overrides: VenueSectionOverride): SectionTemplate {
    const overridden = { ...template };

    if (overrides.customPrompt) {
      overridden.defaultPrompt = overrides.customPrompt;
    }

    if (overrides.wordLimitOverride) {
      overridden.constraints = {
        ...overridden.constraints,
        wordLimit: overrides.wordLimitOverride
      };
    }

    if (overrides.citationRequirements) {
      overridden.constraints = {
        ...overridden.constraints,
        citationRequirements: {
          ...overridden.constraints.citationRequirements,
          ...overrides.citationRequirements
        }
      };
    }

    if (overrides.additionalConstraints) {
      overridden.constraints = {
        ...overridden.constraints,
        ...overrides.additionalConstraints
      };
    }

    return overridden;
  }

  /**
   * Get section validation rules for a paper type
   */
  async getSectionValidationRules(paperTypeCode: string): Promise<Record<string, SectionConstraints>> {
    const templates = await this.getSectionsForPaperType(paperTypeCode);
    const rules: Record<string, SectionConstraints> = {};

    templates.forEach(template => {
      rules[template.sectionKey] = template.constraints;
    });

    return rules;
  }

  /**
   * Resolve runtime context/citation policy for a section based on:
   * 1) base PaperSupersetSection flags
   * 2) optional PaperTypeSectionPrompt constraints override
   */
  async getSectionContextPolicy(
    sectionKey: string,
    paperTypeCode: string
  ): Promise<SectionContextPolicy> {
    await this.loadFromDatabase();
    const base = this.findSupersetSection(sectionKey);

    const defaultPolicy: SectionContextPolicy = {
      requiresBlueprint: true,
      requiresPreviousSections: true,
      requiresCitations: false
    };

    if (!base) {
      return defaultPolicy;
    }

    const policy: SectionContextPolicy = {
      requiresBlueprint: Boolean(base.requiresBlueprint),
      requiresPreviousSections: Boolean(base.requiresPreviousSections),
      requiresCitations: Boolean(base.requiresCitations)
    };

    const override = this.findTypeOverride(paperTypeCode, sectionKey);
    const overrideRequiresCitations = this.extractBooleanOverride(override?.constraints, 'requiresCitations');
    if (typeof overrideRequiresCitations === 'boolean') {
      policy.requiresCitations = overrideRequiresCitations;
    }

    return policy;
  }

  /**
   * Resolve runtime policies for all sections in a paper type (or provided section keys).
   */
  async getSectionContextPolicyMap(
    paperTypeCode: string,
    sectionKeys?: string[]
  ): Promise<Record<string, SectionContextPolicy>> {
    const keys = Array.isArray(sectionKeys) && sectionKeys.length > 0
      ? sectionKeys
      : (await paperTypeService.getPaperType(paperTypeCode))?.sectionOrder || [];

    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
    const policyMap: Record<string, SectionContextPolicy> = {};

    for (const key of uniqueKeys) {
      policyMap[key] = await this.getSectionContextPolicy(key, paperTypeCode);
    }

    return policyMap;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  // DB-loaded templates cache
  private dbSupersetSections: Map<string, PaperSupersetSection> = new Map();
  private dbTypeOverrides: Map<string, PaperTypeSectionPrompt> = new Map();
  private dbCacheTimestamp: number = 0;
  private readonly DB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  
  // Lock to prevent race condition during cache refresh
  private dbLoadingPromise: Promise<boolean> | null = null;

  /**
   * Load prompts from database
   * Uses PaperSupersetSection (base) + PaperTypeSectionPrompt (overrides)
   * 
   * Race condition prevention: Uses a loading promise to ensure only one
   * database query runs at a time, even with concurrent requests.
   */
  private async loadFromDatabase(): Promise<boolean> {
    const now = Date.now();
    
    // Check if cache is still valid
    if ((now - this.dbCacheTimestamp) < this.DB_CACHE_TTL_MS && this.dbSupersetSections.size > 0) {
      return true; // Use cached data
    }

    // If already loading, wait for that to complete
    if (this.dbLoadingPromise) {
      return this.dbLoadingPromise;
    }

    // Start loading and store the promise
    this.dbLoadingPromise = this.doLoadFromDatabase(now);
    
    try {
      return await this.dbLoadingPromise;
    } finally {
      this.dbLoadingPromise = null;
    }
  }

  private async doLoadFromDatabase(now: number): Promise<boolean> {
    try {
      // Load superset sections (base prompts)
      const supersetSections = await prisma.paperSupersetSection.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' }
      });

      if (supersetSections.length === 0) {
        throw new Error('PaperSupersetSection table is empty. Seed paper section prompts before drafting.');
      }

      // Load type overrides
      const typeOverrides = await prisma.paperTypeSectionPrompt.findMany({
        where: { status: 'ACTIVE' }
      });

      // Build new caches (don't clear old ones until new data is ready)
      const newSupersetMap = new Map<string, PaperSupersetSection>();
      const newOverrideMap = new Map<string, PaperTypeSectionPrompt>();

      for (const ss of supersetSections) {
        newSupersetMap.set(ss.sectionKey, ss);
      }

      for (const to of typeOverrides) {
        const key = `${to.paperTypeCode}:${to.sectionKey}`;
        newOverrideMap.set(key, to);
      }

      // Atomic swap of caches
      this.dbSupersetSections = newSupersetMap;
      this.dbTypeOverrides = newOverrideMap;
      this.dbCacheTimestamp = now;
      
      return true;
    } catch (error) {
      console.error('Failed to load paper prompts from database:', error);
      throw error;
    }
  }

  /**
   * Resolve the prompt instruction for a paper type
   * Final-section drafting behavior:
   * - Start from the base section prompt.
   * - If a paper-type top-up exists, append it as an additive layer.
   */
  private async resolvePromptForPaperType(template: SectionTemplate, paperTypeCode: string): Promise<string> {
    await this.loadFromDatabase();
    const normalized = paperTypeCode.toUpperCase();
    const dbOverride = this.findTypeOverride(normalized, template.sectionKey);
    const dbBase = this.findSupersetSection(template.sectionKey);
    const baseInstruction = dbBase?.instruction?.trim()
      ? dbBase.instruction
      : template.defaultPrompt;

    // Top-up layering mode: base prompt remains authoritative; override adds
    // paper-type-specific modifications on top.
    if (dbOverride?.instruction?.trim()) {
      return `${baseInstruction}\n\n[PAPER TYPE TOP-UP: ${normalized}]\n${dbOverride.instruction}`;
    }

    return baseInstruction;
  }

  /**
   * Get just the base prompt without any additions
   */
  async getBasePrompt(sectionKey: string): Promise<string | null> {
    await this.loadFromDatabase();

    const dbBase = this.dbSupersetSections.get(sectionKey);
    if (dbBase) {
      return dbBase.instruction;
    }

    return null;
  }

  /**
   * Pass 1 prompt: base section instruction + context variable injection
   * + base constraints + guidance. No paper-type layering.
   *
   * In the two-pass strategy, Pass 1 is paper-type-agnostic and focuses on
   * evidence-grounded content generation. The paper-type-specific guidance
   * is deferred to Pass 2 (polish).
   */
  async getPass1PromptForSection(
    sectionKey: string,
    context: SectionPromptContext = {}
  ): Promise<string> {
    await this.loadFromDatabase();

    const dbBase = this.findSupersetSection(sectionKey);
    if (!dbBase) {
      throw new Error(`Base section template not found: ${sectionKey}. Seed PaperSupersetSection.`);
    }

    let prompt = dbBase.instruction;
    prompt = this.injectContextVariables(prompt, context);

    const constraints = (dbBase.constraints || {}) as SectionConstraints;
    const constraintsBlock = this.buildConstraintsBlock(constraints, context);
    if (constraintsBlock) {
      prompt += `\n\n${constraintsBlock}`;
    }

    const guidanceBlock = await this.buildGuidanceBlock(sectionKey, context);
    if (guidanceBlock) {
      prompt += `\n\n${guidanceBlock}`;
    }

    return prompt;
  }

  /**
   * Pass 2 prompt: paper-type-specific instruction from PaperTypeSectionPrompt.
   * Used by the polish pipeline as publication-type guidance.
   * Returns null if no override exists for this paper type + section combination.
   */
  async getPass2TypePrompt(
    sectionKey: string,
    paperTypeCode: string
  ): Promise<{ instruction: string; constraints: SectionConstraints; additions: string[] } | null> {
    await this.loadFromDatabase();
    const dbOverride = this.findTypeOverride(paperTypeCode, sectionKey);
    if (!dbOverride) return null;

    const additions = Array.isArray(dbOverride.additions)
      ? (dbOverride.additions as string[])
      : [];

    return {
      instruction: dbOverride.instruction,
      constraints: (dbOverride.constraints || {}) as SectionConstraints,
      additions,
    };
  }

  /**
   * Get just the paper type additions (for preview/editing)
   */
  async getPaperTypeAdditions(sectionKey: string, paperTypeCode: string): Promise<string | null> {
    await this.loadFromDatabase();
    const dbOverride = this.findTypeOverride(paperTypeCode, sectionKey);
    if (dbOverride) {
      return dbOverride.instruction;
    }

    return null;
  }

  private async getAllSectionTemplates(): Promise<SectionTemplate[]> {
    await this.loadFromDatabase();

    if (this.dbSupersetSections.size === 0) {
      throw new Error('Paper section prompts are unavailable. Seed PaperSupersetSection before generating drafts.');
    }

    // Convert DB records to SectionTemplate format
    const dbTemplates: SectionTemplate[] = [];
    for (const ss of Array.from(this.dbSupersetSections.values())) {
      const constraints = (ss.constraints || {}) as SectionConstraints;
      dbTemplates.push({
        sectionKey: ss.sectionKey,
        displayName: ss.label,
        description: ss.description || undefined,
        defaultPrompt: ss.instruction,
        promptsByPaperType: undefined, // Overrides handled separately
        constraints,
        applicablePaperTypes: ['*'], // All types (filtered by DB query)
        orderWeight: ss.displayOrder,
        isRequired: ss.isRequired
      });
    }

    return dbTemplates;
  }

  private orderTemplatesByPaperType(templates: SectionTemplate[], paperType: any): SectionTemplate[] {
    const sectionOrder = paperType.sectionOrder || [];
    const ordered: SectionTemplate[] = [];
    const remaining: SectionTemplate[] = [];

    // First, add templates in the paper type's specified order
    sectionOrder.forEach((sectionKey: string) => {
      const template = templates.find(t => t.sectionKey === sectionKey);
      if (template) {
        ordered.push(template);
      }
    });

    // Then add any remaining templates by their order weight
    templates.forEach(template => {
      if (!ordered.includes(template)) {
        remaining.push(template);
      }
    });

    remaining.sort((a, b) => a.orderWeight - b.orderWeight);

    return [...ordered, ...remaining];
  }

  private injectContextVariables(prompt: string, context: SectionPromptContext): string {
    let enhancedPrompt = prompt;
    const topic = context.researchTopic || {};

    const replaceToken = (token: string, value: string) => {
      enhancedPrompt = enhancedPrompt.split(token).join(value);
    };

    replaceToken('{{TITLE}}', this.formatValue(topic.title));
    replaceToken('{{RESEARCH_QUESTION}}', this.formatValue(topic.researchQuestion));
    replaceToken('{{HYPOTHESIS}}', this.formatValue(topic.hypothesis));
    replaceToken('{{METHODOLOGY}}', this.formatValue(topic.methodology));
    replaceToken('{{CONTRIBUTION_TYPE}}', this.formatValue(topic.contributionType));
    replaceToken('{{KEYWORDS}}', this.formatValue(topic.keywords));
    replaceToken('{{DATASET_DESCRIPTION}}', this.formatValue(topic.datasetDescription));
    replaceToken('{{ABSTRACT_DRAFT}}', this.formatValue(topic.abstractDraft));
    replaceToken('{{PREVIOUS_SECTIONS}}', this.formatPreviousSections(context.previousSections));

    if (context.citationCount !== undefined) {
      replaceToken('{{CITATION_COUNT}}', context.citationCount.toString());
    }

    if (context.wordCount !== undefined && context.targetWordCount !== undefined) {
      const remaining = Math.max(0, context.targetWordCount - context.wordCount);
      replaceToken('{{WORDS_REMAINING}}', remaining.toString());
      replaceToken('{{TARGET_WORD_COUNT}}', context.targetWordCount.toString());
    }

    return enhancedPrompt;
  }

  private formatValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean).join(', ');
    }
    return String(value);
  }

  private stripHtml(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private formatPreviousSections(previousSections?: Record<string, string>): string {
    if (!previousSections) return 'None';

    const entries = Object.entries(previousSections)
      .filter(([, text]) => typeof text === 'string' && text.trim().length > 0);

    if (entries.length === 0) return 'None';

    const lines: string[] = [];
    const maxTotal = 1200;
    let used = 0;

    for (const [key, raw] of entries) {
      const cleaned = this.stripHtml(String(raw));
      if (!cleaned) continue;
      const snippet = cleaned.slice(0, 400);
      lines.push(`${key.replace(/_/g, ' ')}: ${snippet}`);
      used += snippet.length;
      if (used >= maxTotal) break;
    }

    return lines.join('\n');
  }

  private buildConstraintsBlock(constraints: SectionConstraints, context: SectionPromptContext): string {
    const parts: string[] = [];

    if (constraints.wordLimit) {
      parts.push(`Word limit: ${constraints.wordLimit} words`);
    }

    if (constraints.citationRequirements) {
      const citeReq = constraints.citationRequirements;
      if (citeReq.minimum && citeReq.minimum > 0) {
        parts.push(`Minimum citations: ${citeReq.minimum}`);
      }
      if (citeReq.recommended) {
        parts.push(`Recommended citations: ${citeReq.recommended}`);
      }
    }

    if (constraints.tenseRequirements && constraints.tenseRequirements.length > 0) {
      parts.push(`Tense requirements: ${constraints.tenseRequirements.join(', ')}`);
    }

    if (constraints.styleRequirements && constraints.styleRequirements.length > 0) {
      parts.push(`Style requirements: ${constraints.styleRequirements.join(', ')}`);
    }

    return parts.length > 0 ? `CONSTRAINTS:\n${parts.map(part => `- ${part}`).join('\n')}` : '';
  }

  private async buildGuidanceBlock(sectionKey: string, _context: SectionPromptContext): Promise<string> {
    const FALLBACK_GUIDANCE: Record<string, string> = {
      abstract: `Remember: The abstract should be self-contained and include all key information. It should be understandable without reading the full paper.`,
      introduction: `Structure your introduction as an inverted pyramid: broad context -> specific problem -> your approach.`,
      literature_review: `Organize thematically rather than chronologically. Show how studies relate to each other and identify gaps.`,
      methodology: `Provide enough detail that another researcher could replicate your study. Justify methodological choices.`,
      results: `Present results first, interpret them in the Discussion section. Use tables/figures to enhance clarity.`,
      discussion: `Don't just restate results - interpret what they mean in the broader context of existing literature.`,
      conclusion: `Focus on contributions and implications, not just summarizing what you did.`
    };

    const normalized = this.normalizeSectionKey(sectionKey);
    const fallback = FALLBACK_GUIDANCE[normalized] || '';

    return systemPromptTemplateService.resolveWithFallback(
      { templateKey: TEMPLATE_KEYS.SECTION_GUIDANCE, applicationMode: 'paper', sectionScope: normalized },
      fallback
    );
  }

  private normalizeSectionKey(sectionKey: string): string {
    return sectionKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  private findSupersetSection(sectionKey: string): PaperSupersetSection | undefined {
    const exact = this.dbSupersetSections.get(sectionKey);
    if (exact) return exact;

    const normalized = this.normalizeSectionKey(sectionKey);
    let found: PaperSupersetSection | undefined;
    this.dbSupersetSections.forEach((section, key) => {
      if (!found && this.normalizeSectionKey(key) === normalized) {
        found = section;
      }
    });

    return found;
  }

  private findTypeOverride(
    paperTypeCode: string,
    sectionKey: string
  ): PaperTypeSectionPrompt | undefined {
    const normalizedType = paperTypeCode.toUpperCase();
    const exact = this.dbTypeOverrides.get(`${normalizedType}:${sectionKey}`);
    if (exact) return exact;

    const normalizedSection = this.normalizeSectionKey(sectionKey);
    let found: PaperTypeSectionPrompt | undefined;
    this.dbTypeOverrides.forEach((override) => {
      if (found) return;
      if (override.paperTypeCode !== normalizedType) return;
      if (this.normalizeSectionKey(override.sectionKey) === normalizedSection) {
        found = override;
      }
    });

    return found;
  }

  /**
   * Reads boolean override from:
   * - constraints.requiresCitations
   * - constraints.contextOverrides.requiresCitations
   * - constraints.context.requiresCitations
   */
  private extractBooleanOverride(
    constraints: unknown,
    key: 'requiresCitations'
  ): boolean | undefined {
    if (!constraints || typeof constraints !== 'object') return undefined;
    const record = constraints as Record<string, unknown>;

    if (typeof record[key] === 'boolean') {
      return record[key] as boolean;
    }

    const contextOverrides = record.contextOverrides;
    if (contextOverrides && typeof contextOverrides === 'object') {
      const ctx = contextOverrides as Record<string, unknown>;
      if (typeof ctx[key] === 'boolean') return ctx[key] as boolean;
    }

    const context = record.context;
    if (context && typeof context === 'object') {
      const ctx = context as Record<string, unknown>;
      if (typeof ctx[key] === 'boolean') return ctx[key] as boolean;
    }

    return undefined;
  }

  private validateSectionTemplate(template: SectionTemplate): void {
    if (!template.sectionKey || template.sectionKey.trim().length === 0) {
      throw new Error('Section key is required');
    }

    if (!template.displayName || template.displayName.trim().length === 0) {
      throw new Error('Display name is required');
    }

    if (!template.defaultPrompt || template.defaultPrompt.trim().length === 0) {
      throw new Error('Default prompt is required');
    }

    if (!Array.isArray(template.applicablePaperTypes) || template.applicablePaperTypes.length === 0) {
      throw new Error('At least one applicable paper type must be specified');
    }

    if (typeof template.orderWeight !== 'number') {
      throw new Error('Order weight must be a number');
    }
  }

  private invalidateCache(): void {
    this.templateCache.clear();
    this.cacheTimestamp = 0;
    // Also invalidate DB cache
    this.dbSupersetSections.clear();
    this.dbTypeOverrides.clear();
    this.dbCacheTimestamp = 0;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; oldestEntry: number; dbCacheSize: number } {
    return {
      size: this.templateCache.size,
      oldestEntry: this.cacheTimestamp,
      dbCacheSize: this.dbSupersetSections.size + this.dbTypeOverrides.size
    };
  }

  /**
   * Force refresh from database
   */
  async refreshFromDatabase(): Promise<void> {
    this.dbCacheTimestamp = 0;
    await this.loadFromDatabase();
    this.templateCache.clear();
    this.cacheTimestamp = 0;
  }
}

// Export singleton instance
export const sectionTemplateService = new SectionTemplateService();

// Export class for testing
export { SectionTemplateService };
