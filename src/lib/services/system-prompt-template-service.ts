/**
 * System Prompt Template Service
 *
 * Resolves pipeline-level prompts (polish rules, dimension directives, output
 * format, quality rules, guardrails) from the database, falling back to
 * hardcoded defaults when no DB row exists.
 *
 * Resolution order (highest specificity wins):
 *   1. templateKey + applicationMode + sectionScope + paperTypeScope
 *   2. templateKey + applicationMode + sectionScope
 *   3. templateKey + applicationMode + paperTypeScope
 *   4. templateKey + applicationMode (generic)
 *   5. null → caller uses its own hardcoded fallback
 */

import { prisma } from '@/lib/prisma';

// ============================================================================
// Types
// ============================================================================

export interface SystemPromptLookup {
  templateKey: string;
  applicationMode?: string;
  sectionScope?: string;
  paperTypeScope?: string;
}

interface CachedTemplate {
  content: string;
  priority: number;
  sectionScope: string;
  paperTypeScope: string;
}

// ============================================================================
// Service
// ============================================================================

class SystemPromptTemplateService {
  private cache: Map<string, CachedTemplate[]> = new Map();
  private cacheLoadedAt: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Resolve a system prompt template. Returns the content string if found,
   * or null if no matching row exists (caller should use its hardcoded default).
   */
  async resolve(lookup: SystemPromptLookup): Promise<string | null> {
    const mode = lookup.applicationMode || 'paper';
    const cacheKey = `${lookup.templateKey}::${mode}`;

    await this.ensureCacheLoaded();

    const candidates = this.cache.get(cacheKey);
    if (!candidates || candidates.length === 0) return null;

    const section = lookup.sectionScope?.trim().toLowerCase() || '*';
    const paperType = lookup.paperTypeScope?.trim().toLowerCase() || '*';

    let best: CachedTemplate | null = null;
    let bestScore = -1;

    for (const c of candidates) {
      const sMatch = c.sectionScope === '*' || c.sectionScope === section;
      const pMatch = c.paperTypeScope === '*' || c.paperTypeScope === paperType;
      if (!sMatch || !pMatch) continue;

      let score = c.priority;
      if (c.sectionScope !== '*' && c.sectionScope === section) score += 200;
      if (c.paperTypeScope !== '*' && c.paperTypeScope === paperType) score += 100;

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return best?.content ?? null;
  }

  /**
   * Resolve with a hardcoded fallback. Convenience wrapper.
   */
  async resolveWithFallback(lookup: SystemPromptLookup, fallback: string): Promise<string> {
    const result = await this.resolve(lookup);
    return result ?? fallback;
  }

  /**
   * Resolve multiple template keys at once (single DB round-trip via cache).
   */
  async resolveMany(
    lookups: SystemPromptLookup[],
    fallbacks: Record<string, string>
  ): Promise<Record<string, string>> {
    await this.ensureCacheLoaded();
    const results: Record<string, string> = {};
    for (const lookup of lookups) {
      const key = lookup.templateKey;
      const resolved = await this.resolve(lookup);
      results[key] = resolved ?? fallbacks[key] ?? '';
    }
    return results;
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheLoadedAt = 0;
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cache.size > 0 && Date.now() - this.cacheLoadedAt < this.CACHE_TTL_MS) {
      return;
    }

    try {
      const rows = await prisma.systemPromptTemplate.findMany({
        where: { status: 'ACTIVE' },
        select: {
          templateKey: true,
          applicationMode: true,
          sectionScope: true,
          paperTypeScope: true,
          content: true,
          priority: true,
        },
      });

      const newCache = new Map<string, CachedTemplate[]>();

      for (const row of rows) {
        const cacheKey = `${row.templateKey}::${row.applicationMode}`;
        const entry: CachedTemplate = {
          content: row.content,
          priority: row.priority,
          sectionScope: (row.sectionScope || '*').trim().toLowerCase(),
          paperTypeScope: (row.paperTypeScope || '*').trim().toLowerCase(),
        };

        const existing = newCache.get(cacheKey);
        if (existing) {
          existing.push(entry);
        } else {
          newCache.set(cacheKey, [entry]);
        }
      }

      this.cache = newCache;
      this.cacheLoadedAt = Date.now();
    } catch (err) {
      console.warn('[SystemPromptTemplateService] Failed to load templates from DB, using fallbacks:', err);
      this.cacheLoadedAt = Date.now();
    }
  }
}

// ============================================================================
// Singleton + Template Key Constants
// ============================================================================

export const TEMPLATE_KEYS = {
  POLISH_PERSONA: 'polish_persona',
  POLISH_CITATION_RULES: 'polish_citation_rules',
  POLISH_FACTUAL_FIDELITY: 'polish_factual_fidelity',
  POLISH_STRUCTURAL_RULES: 'polish_structural_rules',
  POLISH_IMPROVEMENT_DIRECTIVES: 'polish_improvement_directives',
  POLISH_HEDGING_RULES: 'polish_hedging_rules',
  POLISH_RHYTHM_RULES: 'polish_rhythm_rules',
  DIMENSION_ROLE_INTRODUCTION: 'dimension_role_introduction',
  DIMENSION_ROLE_BODY: 'dimension_role_body',
  DIMENSION_ROLE_CONCLUSION: 'dimension_role_conclusion',
  DIMENSION_ROLE_INTRO_CONCLUSION: 'dimension_role_intro_conclusion',
  DIMENSION_PROMPT_HEADER: 'dimension_prompt_header',
  DIMENSION_PROMPT_RULES: 'dimension_prompt_rules',
  OUTPUT_FORMAT_INSTRUCTIONS: 'output_format_instructions',
  INTELLECTUAL_RIGOR_BLOCK: 'intellectual_rigor_block',
  EVIDENCE_GAP_GUARDRAIL: 'evidence_gap_guardrail',
  SECTION_GUIDANCE: 'section_guidance',
  PERSUASION_BLOCK: 'persuasion_block',
  REVIEWER_LENS: 'reviewer_lens',
  ARGUMENTATIVE_ARC: 'argumentative_arc',
  FIGURE_GROUNDING_BLOCK: 'figure_grounding_block',
  TEXT_ACTION_CREATE_SECTIONS: 'text_action_create_sections',
  PAPER_MANUSCRIPT_REVIEW_QUICK: 'paper_manuscript_review_quick',
  PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY: 'paper_manuscript_review_context_summary',
  PAPER_MANUSCRIPT_REVIEW_SECTION: 'paper_manuscript_review_section',
  PAPER_MANUSCRIPT_REVIEW_AGGREGATION: 'paper_manuscript_review_aggregation',
  PAPER_MANUSCRIPT_IMPROVE_REWRITE: 'paper_manuscript_improve_rewrite',
  PAPER_EXPORT_EXTRACTION: 'paper_export_extraction',
} as const;

export const systemPromptTemplateService = new SystemPromptTemplateService();
