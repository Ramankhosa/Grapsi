/**
 * Seed script for Publication Ideation (Paper Writing) workflow stages.
 *
 * This script seeds:
 * 1. Paper workflow stage registry entries
 * 2. Plan-stage model assignments
 * 3. Generous per-stage token limits tuned by workload size
 *
 * Run with:
 *   npx tsx scripts/seed-publication-ideation-stages.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FEATURE_CODE = 'PAPER_DRAFTING' as const
const MIN_STAGE_MAX_TOKENS_IN = 12_000
const MIN_STAGE_MAX_TOKENS_OUT = 8_000

type PlanCode = 'FREE_PLAN' | 'PRO_PLAN' | 'ENTERPRISE_PLAN'

interface StageDefinition {
  code: string
  displayName: string
  description: string
  sortOrder: number
}

interface StagePlanConfigInput {
  modelPreferences: string[]
  maxTokensIn: number
  maxTokensOut: number
}

interface StagePlanConfig extends StagePlanConfigInput {
  temperature: number
}

type StageRuntimeConfig = Record<PlanCode, StagePlanConfig>

const MODEL_PREFERENCE_REPLACEMENTS: Record<string, string> = {
  'gpt-5.1-thinking': 'gpt-5.2',
}

const PRO_PLAN_PRODUCTION_OVERRIDES: Partial<Record<string, StagePlanConfigInput>> = {
  PAPER_TOPIC_EXTRACT_FROM_FILE: { modelPreferences: ['gpt-5.2'], maxTokensIn: 96_000, maxTokensOut: 16_000 },
  PAPER_TOPIC_REFINE_QUESTION: { modelPreferences: ['gpt-5.2'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
  PAPER_TOPIC_SUGGEST_KEYWORDS: { modelPreferences: ['gpt-5-mini'], maxTokensIn: 16_000, maxTokensOut: 8_000 },
  PAPER_TOPIC_GENERATE_HYPOTHESIS: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 48_000, maxTokensOut: 16_000 },
  PAPER_TOPIC_DRAFT_ABSTRACT: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 48_000, maxTokensOut: 14_000 },
  PAPER_TOPIC_FORMULATE_QUESTION: { modelPreferences: ['gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
  PAPER_TOPIC_ENHANCE_ALL: { modelPreferences: ['gemini-2.5-flash-lite'], maxTokensIn: 64_000, maxTokensOut: 22_000 },
  PAPER_ABSTRACT_TITLE: { modelPreferences: ['gpt-5.2'], maxTokensIn: 32_000, maxTokensOut: 14_000 },
  PAPER_LITERATURE_SEARCH: { modelPreferences: ['gpt-5-mini'], maxTokensIn: 40_000, maxTokensOut: 9_000 },
  LITERATURE_SEARCH: { modelPreferences: ['gpt-5-mini'], maxTokensIn: 40_000, maxTokensOut: 9_000 },
  SEARCH_STRATEGY_PLANNING: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 48_000, maxTokensOut: 10_000 },
  SEARCH_QUERY_GENERATION: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 48_000, maxTokensOut: 10_000 },
  PAPER_LITERATURE_SUMMARIZE: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 200_000, maxTokensOut: 18_000 },
  PAPER_LITERATURE_GAP: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 96_000, maxTokensOut: 20_000 },
  LITERATURE_RELEVANCE: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 80_000, maxTokensOut: 25_000 },
  CITATION_BLUEPRINT_MAPPING: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 80_000, maxTokensOut: 12_000 },
  PAPER_LITERATURE_ANALYSIS: { modelPreferences: ['gpt-5.2'], maxTokensIn: 140_000, maxTokensOut: 20_000 },
  PAPER_BLUEPRINT_GEN: { modelPreferences: ['gpt-5.2'], maxTokensIn: 120_000, maxTokensOut: 24_000 },
  RESEARCH_INTENT_LOCK: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 64_000, maxTokensOut: 16_000 },
  ARGUMENT_PLAN: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 64_000, maxTokensOut: 16_000 },
  PAPER_ARCHETYPE_DETECTION: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 36_000, maxTokensOut: 12_000 },
  PAPER_SECTION_DRAFT: { modelPreferences: ['gpt-5.2'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
  PAPER_SECTION_GEN: { modelPreferences: ['gpt-5.2'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
  PAPER_SECTION_IMPROVE: { modelPreferences: ['gemini-2.5-flash-lite'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
  PAPER_CREATE_SECTIONS: { modelPreferences: ['gpt-5.2'], maxTokensIn: 24_000, maxTokensOut: 12_000 },
  PAPER_MEMORY_EXTRACT: { modelPreferences: ['gpt-5-mini'], maxTokensIn: 36_000, maxTokensOut: 8_000 },
  PAPER_CITATION_FORMAT: { modelPreferences: ['gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
  PAPER_CITATION_FORMATTING: { modelPreferences: ['gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
  PAPER_CONTENT_GENERATION: { modelPreferences: ['gpt-5.2'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
  PAPER_TEXT_ACTION: { modelPreferences: ['gpt-5.2'], maxTokensIn: 40_000, maxTokensOut: 12_000 },
  PAPER_REWRITER: { modelPreferences: ['gpt-5.2'], maxTokensIn: 64_000, maxTokensOut: 16_000 },
  PAPER_FIGURE_SUGGESTION: { modelPreferences: ['gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 12_000 },
  PAPER_CHART_GENERATOR: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 32_000, maxTokensOut: 8_000 },
  PAPER_DIAGRAM_GENERATOR: { modelPreferences: ['gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 12_000 },
  PAPER_DIAGRAM_FROM_TEXT: { modelPreferences: ['gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 12_000 },
  PAPER_SKETCH_GENERATION: { modelPreferences: ['gemini-3.1-flash-image'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
  PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY: { modelPreferences: ['gpt-5.2'], maxTokensIn: 32_000, maxTokensOut: 4_000 },
  PAPER_REVIEW_GAPS: { modelPreferences: ['gemini-2.5-pro'], maxTokensIn: 96_000, maxTokensOut: 20_000 },
  PAPER_REVIEW_COHERENCE: { modelPreferences: ['gpt-5.2'], maxTokensIn: 120_000, maxTokensOut: 20_000 },
  PAPER_AI_REVIEW: { modelPreferences: ['gpt-5.2'], maxTokensIn: 120_000, maxTokensOut: 20_000 },
  PAPER_AI_FIX: { modelPreferences: ['gpt-5.2'], maxTokensIn: 120_000, maxTokensOut: 24_000 },
  PAPER_EXPORT_EXTRACTION: { modelPreferences: ['gpt-5.2'], maxTokensIn: 32_000, maxTokensOut: 8_000 },
}

const stagePlan = (
  temperature: number,
  free: StagePlanConfigInput,
  pro: StagePlanConfigInput,
  enterprise: StagePlanConfigInput
): StageRuntimeConfig => ({
  FREE_PLAN: { ...free, temperature },
  PRO_PLAN: { ...pro, temperature },
  ENTERPRISE_PLAN: { ...enterprise, temperature },
})

function sanitizeModelPreferences(modelPreferences: string[]): string[] {
  const sanitized = new Set<string>()

  for (const preference of modelPreferences) {
    const replacement = MODEL_PREFERENCE_REPLACEMENTS[preference] ?? preference
    if (replacement) {
      sanitized.add(replacement)
    }
  }

  return Array.from(sanitized)
}

function normalizeStageConfig(
  config: StagePlanConfig,
  override?: StagePlanConfigInput
): StagePlanConfig {
  const mergedConfig = override
    ? {
        ...config,
        ...override,
        modelPreferences: override.modelPreferences,
      }
    : config

  return {
    ...mergedConfig,
    modelPreferences: sanitizeModelPreferences(mergedConfig.modelPreferences),
  }
}

const publicationStages: StageDefinition[] = [
  // Topic and framing
  {
    code: 'PAPER_TOPIC_EXTRACT_FROM_FILE',
    displayName: 'Paper Idea Normalization',
    description: 'Extract and normalize research topic details from uploaded documents.',
    sortOrder: 0,
  },
  {
    code: 'PAPER_TOPIC_REFINE_QUESTION',
    displayName: 'Refine Research Question',
    description: 'Improve research question clarity, scope, and testability.',
    sortOrder: 1,
  },
  {
    code: 'PAPER_TOPIC_SUGGEST_KEYWORDS',
    displayName: 'Suggest Keywords',
    description: 'Generate domain-relevant academic keywords.',
    sortOrder: 2,
  },
  {
    code: 'PAPER_TOPIC_GENERATE_HYPOTHESIS',
    displayName: 'Generate Hypothesis',
    description: 'Generate testable hypotheses aligned with question and method.',
    sortOrder: 3,
  },
  {
    code: 'PAPER_TOPIC_DRAFT_ABSTRACT',
    displayName: 'Draft Abstract',
    description: 'Draft abstract content from topic context.',
    sortOrder: 4,
  },
  {
    code: 'PAPER_TOPIC_FORMULATE_QUESTION',
    displayName: 'Help Formulate Question',
    description: 'Guide question formulation from broad research intent.',
    sortOrder: 5,
  },
  {
    code: 'PAPER_TOPIC_ENHANCE_ALL',
    displayName: 'Enhance All Topic Details',
    description: 'Improve all topic fields while preserving internal consistency.',
    sortOrder: 6,
  },

  // Legacy generic paper stages (kept for backward compatibility and fallbacks)
  {
    code: 'PAPER_ABSTRACT_TITLE',
    displayName: 'Abstract and Title Generation',
    description: 'Legacy generic stage for titles, abstracts, and keywords.',
    sortOrder: 7,
  },
  {
    code: 'PAPER_CONTENT_GENERATION',
    displayName: 'Section Content Generation',
    description: 'Legacy generic stage for long-form section generation.',
    sortOrder: 8,
  },
  {
    code: 'PAPER_CITATION_FORMATTING',
    displayName: 'Citation and References',
    description: 'Legacy generic stage for citation and bibliography formatting.',
    sortOrder: 9,
  },
  {
    code: 'PAPER_LITERATURE_ANALYSIS',
    displayName: 'Literature Analysis',
    description: 'Legacy generic stage for literature synthesis and analysis.',
    sortOrder: 10,
  },

  // Literature and search strategy
  {
    code: 'PAPER_LITERATURE_SEARCH',
    displayName: 'Literature Search',
    description: 'Assist literature retrieval planning and search setup.',
    sortOrder: 11,
  },
  {
    code: 'LITERATURE_SEARCH',
    displayName: 'Literature Search (Legacy Route)',
    description: 'Route-specific legacy literature search strategy generation.',
    sortOrder: 12,
  },
  {
    code: 'SEARCH_STRATEGY_PLANNING',
    displayName: 'Search Strategy Planning',
    description: 'Build search-plan breadth/depth and category priorities.',
    sortOrder: 13,
  },
  {
    code: 'SEARCH_QUERY_GENERATION',
    displayName: 'Search Query Generation',
    description: 'Generate structured search queries for literature acquisition.',
    sortOrder: 14,
  },
  {
    code: 'PAPER_LITERATURE_SUMMARIZE',
    displayName: 'Summarize Literature',
    description: 'Extract structured evidence cards from full-text references.',
    sortOrder: 15,
  },
  {
    code: 'PAPER_LITERATURE_GAP',
    displayName: 'Analyze Literature Gaps',
    description: 'Identify unresolved gaps and contribution opportunities.',
    sortOrder: 16,
  },
  {
    code: 'LITERATURE_RELEVANCE',
    displayName: 'Literature Relevance Analysis',
    description: 'Rank and filter citations against topic and blueprint fit.',
    sortOrder: 17,
  },
  {
    code: 'CITATION_BLUEPRINT_MAPPING',
    displayName: 'Citation Blueprint Mapping',
    description: 'Map citations to blueprint sections and dimensions.',
    sortOrder: 18,
  },

  // Blueprint, planning, routing
  {
    code: 'PAPER_BLUEPRINT_GEN',
    displayName: 'Generate Blueprint',
    description: 'Generate thesis, section plan, dimensions, and terminology policy.',
    sortOrder: 20,
  },
  {
    code: 'RESEARCH_INTENT_LOCK',
    displayName: 'Research Intent Lock',
    description: 'Create structured thesis guardrails and intent constraints.',
    sortOrder: 21,
  },
  {
    code: 'ARGUMENT_PLAN',
    displayName: 'Argument Plan',
    description: 'Build section-level argument skeletons with evidence constraints.',
    sortOrder: 22,
  },
  {
    code: 'PAPER_ARCHETYPE_DETECTION',
    displayName: 'Paper Archetype Detection',
    description: 'Classify the paper archetype and routing tags for downstream flows.',
    sortOrder: 23,
  },

  // Drafting and refinement
  {
    code: 'PAPER_SECTION_DRAFT',
    displayName: 'Draft Section (Pass 1)',
    description: 'Generate section base draft content.',
    sortOrder: 30,
  },
  {
    code: 'PAPER_SECTION_GEN',
    displayName: 'Generate Section with Memory (Pass 2)',
    description: 'Polish and finalize sections with memory-aware coherence.',
    sortOrder: 31,
  },
  {
    code: 'PAPER_SECTION_IMPROVE',
    displayName: 'Improve Section',
    description: 'Improve clarity, rigor, flow, and citation-grounded writing quality.',
    sortOrder: 32,
  },
  {
    code: 'PAPER_CREATE_SECTIONS',
    displayName: 'Create Sections from Selected Text',
    description: 'Reorganize selected plain text into headed sections with coherent paragraph flow.',
    sortOrder: 33,
  },
  {
    code: 'PAPER_MEMORY_EXTRACT',
    displayName: 'Extract Section Memory',
    description: 'Extract structured memory from edited sections.',
    sortOrder: 34,
  },
  {
    code: 'PAPER_CITATION_FORMAT',
    displayName: 'Format Citations',
    description: 'Format in-text citations and references according to style rules.',
    sortOrder: 35,
  },
  {
    code: 'PAPER_TEXT_ACTION',
    displayName: 'Text Action Transformations',
    description: 'Rewrite, expand, condense, simplify, and formalize selected text snippets.',
    sortOrder: 36,
  },
  {
    code: 'PAPER_REWRITER',
    displayName: 'Advanced Rewriter',
    description: 'Perform high-quality rewriting with stronger structure and academic tone.',
    sortOrder: 37,
  },
  {
    code: 'PAPER_FIGURE_SUGGESTION',
    displayName: 'Figure Suggestions',
    description: 'Generate figure ideas aligned with section content, claims, and narrative intent.',
    sortOrder: 38,
  },
  {
    code: 'PAPER_CHART_GENERATOR',
    displayName: 'Chart Generator',
    description: 'Generate chart plans and chart-spec outputs from quantitative descriptions.',
    sortOrder: 39,
  },
  {
    code: 'PAPER_DIAGRAM_GENERATOR',
    displayName: 'Diagram Generator',
    description: 'Generate diagram structures and renderable specs from textual descriptions.',
    sortOrder: 40,
  },
  {
    code: 'PAPER_DIAGRAM_FROM_TEXT',
    displayName: 'Diagram From Text',
    description: 'Convert selected text directly into a coherent diagram specification.',
    sortOrder: 41,
  },
  {
    code: 'PAPER_SKETCH_GENERATION',
    displayName: 'Sketch Generation',
    description: 'Create image-generation-ready prompts for scientific and technical figures.',
    sortOrder: 42,
  },
  {
    code: 'PAPER_FIGURE_METADATA_INFER',
    displayName: 'Figure Metadata Inference',
    description: 'Infer concise, evidence-safe metadata from generated figure images using a low-cost vision model.',
    sortOrder: 43,
  },
  {
    code: 'PAPER_EXPORT_EXTRACTION',
    displayName: 'Adaptive Export Extraction',
    description: 'Extract export formatting settings from DOCX, LaTeX, or pasted formatting guidance.',
    sortOrder: 44,
  },
  {
    code: 'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY',
    displayName: 'Review Context Summary',
    description: 'Extract compact structured summaries of neighboring sections for section-by-section review.',
    sortOrder: 45,
  },

  // Review and repair
  {
    code: 'PAPER_REVIEW_GAPS',
    displayName: 'Check for Gaps',
    description: 'Detect missing arguments, under-supported claims, and content gaps.',
    sortOrder: 50,
  },
  {
    code: 'PAPER_REVIEW_COHERENCE',
    displayName: 'Check Coherence',
    description: 'Map evidence to dimensions and validate cross-section coherence.',
    sortOrder: 51,
  },
  {
    code: 'PAPER_AI_REVIEW',
    displayName: 'AI Review',
    description: 'Run full-paper quality review with actionable issue reports.',
    sortOrder: 52,
  },
  {
    code: 'PAPER_AI_FIX',
    displayName: 'AI Fix',
    description: 'Apply targeted remediations from review findings.',
    sortOrder: 53,
  },
]

// Generous stage configs with quality-focused model routing.
// Critical quality stages prefer higher-reasoning models by plan tier.
const stageConfigs: Record<string, StageRuntimeConfig> = {
  PAPER_TOPIC_EXTRACT_FROM_FILE: stagePlan(
    0.2,
    { modelPreferences: ['gpt-5-mini', 'gpt-4o', 'gemini-2.5-pro'], maxTokensIn: 64_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5-mini', 'gpt-4o'], maxTokensIn: 96_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking', 'gpt-5.1'], maxTokensIn: 128_000, maxTokensOut: 20_000 }
  ),
  PAPER_TOPIC_REFINE_QUESTION: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-5-mini'], maxTokensIn: 24_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5-mini', 'gpt-5.1'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 16_000 }
  ),
  PAPER_TOPIC_SUGGEST_KEYWORDS: stagePlan(
    0.3,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini'], maxTokensIn: 12_000, maxTokensOut: 4_096 },
    { modelPreferences: ['gpt-5-mini', 'gemini-2.5-flash'], maxTokensIn: 16_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5-mini'], maxTokensIn: 24_000, maxTokensOut: 8_000 }
  ),
  PAPER_TOPIC_GENERATE_HYPOTHESIS: stagePlan(
    0.45,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 48_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 64_000, maxTokensOut: 24_000 }
  ),
  PAPER_TOPIC_DRAFT_ABSTRACT: stagePlan(
    0.4,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 10_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5-mini'], maxTokensIn: 48_000, maxTokensOut: 14_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking'], maxTokensIn: 64_000, maxTokensOut: 20_000 }
  ),
  PAPER_TOPIC_FORMULATE_QUESTION: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-5-mini'], maxTokensIn: 24_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5-mini', 'gpt-5.1'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 16_000 }
  ),
  PAPER_TOPIC_ENHANCE_ALL: stagePlan(
    0.4,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 40_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5.1-thinking'], maxTokensIn: 64_000, maxTokensOut: 22_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 96_000, maxTokensOut: 28_000 }
  ),
  PAPER_ABSTRACT_TITLE: stagePlan(
    0.4,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 24_000, maxTokensOut: 10_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 14_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking'], maxTokensIn: 48_000, maxTokensOut: 20_000 }
  ),

  PAPER_LITERATURE_SEARCH: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini'], maxTokensIn: 24_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5-mini', 'gemini-2.5-flash'], maxTokensIn: 40_000, maxTokensOut: 9_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 12_000 }
  ),
  LITERATURE_SEARCH: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini'], maxTokensIn: 24_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5-mini', 'gemini-2.5-flash'], maxTokensIn: 40_000, maxTokensOut: 9_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 12_000 }
  ),
  SEARCH_STRATEGY_PLANNING: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5-mini'], maxTokensIn: 48_000, maxTokensOut: 10_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  SEARCH_QUERY_GENERATION: stagePlan(
    0.45,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-5-mini'], maxTokensIn: 32_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5-mini', 'gpt-5.1'], maxTokensIn: 48_000, maxTokensOut: 10_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  PAPER_LITERATURE_SUMMARIZE: stagePlan(
    0,
    { modelPreferences: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gpt-5-mini'], maxTokensIn: 140_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5.1', 'gemini-2.5-flash'], maxTokensIn: 200_000, maxTokensOut: 18_000 },
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5.2', 'gemini-3-pro-preview'], maxTokensIn: 260_000, maxTokensOut: 24_000 }
  ),
  PAPER_LITERATURE_GAP: stagePlan(
    0.3,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 96_000, maxTokensOut: 20_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 128_000, maxTokensOut: 28_000 }
  ),
  LITERATURE_RELEVANCE: stagePlan(
    0.25,
    { modelPreferences: ['gemini-2.5-flash', 'gemini-2.5-pro'], maxTokensIn: 40_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 80_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gemini-2.5-pro'], maxTokensIn: 120_000, maxTokensOut: 18_000 }
  ),
  CITATION_BLUEPRINT_MAPPING: stagePlan(
    0.3,
    { modelPreferences: ['gemini-2.5-flash', 'gemini-2.5-pro'], maxTokensIn: 40_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5.1'], maxTokensIn: 80_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gemini-2.5-pro'], maxTokensIn: 120_000, maxTokensOut: 18_000 }
  ),
  PAPER_LITERATURE_ANALYSIS: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-pro', 'gemini-2.5-flash'], maxTokensIn: 96_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gemini-2.5-pro'], maxTokensIn: 140_000, maxTokensOut: 20_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gemini-2.5-pro'], maxTokensIn: 200_000, maxTokensOut: 28_000 }
  ),

  PAPER_BLUEPRINT_GEN: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 80_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1', 'gemini-2.5-pro'], maxTokensIn: 120_000, maxTokensOut: 24_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2', 'gemini-2.5-pro'], maxTokensIn: 160_000, maxTokensOut: 32_000 }
  ),
  RESEARCH_INTENT_LOCK: stagePlan(
    0.3,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 48_000, maxTokensOut: 10_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 64_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 96_000, maxTokensOut: 22_000 }
  ),
  ARGUMENT_PLAN: stagePlan(
    0.3,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 48_000, maxTokensOut: 10_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 64_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 96_000, maxTokensOut: 22_000 }
  ),
  PAPER_ARCHETYPE_DETECTION: stagePlan(
    0.1,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 24_000, maxTokensOut: 4_096 },
    { modelPreferences: ['gpt-5.1-thinking', 'gemini-2.5-pro'], maxTokensIn: 36_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 8_000 }
  ),

  PAPER_SECTION_DRAFT: stagePlan(
    0.62,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 96_000, maxTokensOut: 18_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5.1-thinking'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking'], maxTokensIn: 200_000, maxTokensOut: 32_000 }
  ),
  PAPER_SECTION_GEN: stagePlan(
    0.45,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 96_000, maxTokensOut: 18_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5.1-thinking'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking'], maxTokensIn: 200_000, maxTokensOut: 32_000 }
  ),
  PAPER_SECTION_IMPROVE: stagePlan(
    0.4,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 96_000, maxTokensOut: 18_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 200_000, maxTokensOut: 32_000 }
  ),
  PAPER_CREATE_SECTIONS: stagePlan(
    0.3,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 24_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 48_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  PAPER_MEMORY_EXTRACT: stagePlan(
    0.2,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini'], maxTokensIn: 24_000, maxTokensOut: 4_096 },
    { modelPreferences: ['gpt-5-mini', 'gemini-2.5-flash'], maxTokensIn: 36_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 8_000 }
  ),
  PAPER_CITATION_FORMAT: stagePlan(
    0.2,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini'], maxTokensIn: 16_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5-mini', 'gpt-4o'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  PAPER_CITATION_FORMATTING: stagePlan(
    0.2,
    { modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini'], maxTokensIn: 16_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5-mini', 'gpt-4o'], maxTokensIn: 32_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  PAPER_CONTENT_GENERATION: stagePlan(
    0.6,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 96_000, maxTokensOut: 18_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5.1-thinking'], maxTokensIn: 140_000, maxTokensOut: 26_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking'], maxTokensIn: 200_000, maxTokensOut: 32_000 }
  ),
  PAPER_TEXT_ACTION: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 24_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5.1', 'claude-sonnet-4', 'gpt-5-mini'], maxTokensIn: 40_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2', 'claude-sonnet-4'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  PAPER_REWRITER: stagePlan(
    0.4,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 40_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'claude-sonnet-4', 'gpt-5.1'], maxTokensIn: 64_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2', 'claude-sonnet-4'], maxTokensIn: 96_000, maxTokensOut: 24_000 }
  ),
  PAPER_FIGURE_SUGGESTION: stagePlan(
    0.35,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 48_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gemini-2.5-pro', 'gpt-5.1'], maxTokensIn: 80_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2', 'gemini-2.5-pro'], maxTokensIn: 128_000, maxTokensOut: 16_000 }
  ),
  PAPER_CHART_GENERATOR: stagePlan(
    0.2,
    { modelPreferences: ['gpt-5-mini', 'gpt-4o', 'gemini-2.5-pro'], maxTokensIn: 24_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5-mini', 'gpt-4o'], maxTokensIn: 40_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2', 'gpt-5.1'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  PAPER_DIAGRAM_GENERATOR: stagePlan(
    0.25,
    { modelPreferences: ['gpt-5-mini', 'gpt-4o', 'gemini-2.5-pro'], maxTokensIn: 32_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2', 'gpt-5.1-thinking'], maxTokensIn: 96_000, maxTokensOut: 16_000 }
  ),
  PAPER_DIAGRAM_FROM_TEXT: stagePlan(
    0.25,
    { modelPreferences: ['gpt-5-mini', 'gpt-4o', 'gemini-2.5-pro'], maxTokensIn: 32_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2', 'gpt-5.1-thinking'], maxTokensIn: 96_000, maxTokensOut: 16_000 }
  ),
  PAPER_SKETCH_GENERATION: stagePlan(
    0.35,
    { modelPreferences: ['gemini-3.1-flash-image', 'gemini-3-pro-image-preview', 'gemini-2.5-pro'], maxTokensIn: 24_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image', 'gpt-5-mini'], maxTokensIn: 40_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image', 'gpt-5.2'], maxTokensIn: 64_000, maxTokensOut: 16_000 }
  ),
  PAPER_FIGURE_METADATA_INFER: stagePlan(
    0.05,
    { modelPreferences: ['gpt-4o-mini', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'], maxTokensIn: 16_000, maxTokensOut: 2_000 },
    { modelPreferences: ['gpt-4o-mini', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'], maxTokensIn: 24_000, maxTokensOut: 2_500 },
    { modelPreferences: ['gpt-4o-mini', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'], maxTokensIn: 32_000, maxTokensOut: 3_000 }
  ),
  PAPER_EXPORT_EXTRACTION: stagePlan(
    0.1,
    { modelPreferences: ['gpt-5.2'], maxTokensIn: 24_000, maxTokensOut: 6_000 },
    { modelPreferences: ['gpt-5.2'], maxTokensIn: 32_000, maxTokensOut: 8_000 },
    { modelPreferences: ['gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 10_000 }
  ),
  PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY: stagePlan(
    0.05,
    { modelPreferences: ['gpt-5.2'], maxTokensIn: 24_000, maxTokensOut: 4_000 },
    { modelPreferences: ['gpt-5.2'], maxTokensIn: 32_000, maxTokensOut: 4_000 },
    { modelPreferences: ['gpt-5.2'], maxTokensIn: 48_000, maxTokensOut: 6_000 }
  ),

  PAPER_REVIEW_GAPS: stagePlan(
    0.3,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 64_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 96_000, maxTokensOut: 20_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 128_000, maxTokensOut: 28_000 }
  ),
  PAPER_REVIEW_COHERENCE: stagePlan(
    0.2,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 80_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gemini-2.5-pro'], maxTokensIn: 120_000, maxTokensOut: 20_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gemini-2.5-pro'], maxTokensIn: 160_000, maxTokensOut: 28_000 }
  ),
  PAPER_AI_REVIEW: stagePlan(
    0.2,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 80_000, maxTokensOut: 12_000 },
    { modelPreferences: ['gpt-5.1-thinking', 'gpt-5.1'], maxTokensIn: 120_000, maxTokensOut: 20_000 },
    { modelPreferences: ['gpt-5.2-thinking', 'gpt-5.2'], maxTokensIn: 160_000, maxTokensOut: 28_000 }
  ),
  PAPER_AI_FIX: stagePlan(
    0.2,
    { modelPreferences: ['gemini-2.5-pro', 'gpt-5-mini'], maxTokensIn: 80_000, maxTokensOut: 16_000 },
    { modelPreferences: ['gpt-5.1', 'gpt-5.1-thinking'], maxTokensIn: 120_000, maxTokensOut: 24_000 },
    { modelPreferences: ['gpt-5.2', 'gpt-5.2-thinking'], maxTokensIn: 160_000, maxTokensOut: 32_000 }
  ),
}

const defaultStageConfigByPlan: Record<PlanCode, StagePlanConfig> = {
  FREE_PLAN: {
    modelPreferences: ['gemini-2.5-flash', 'gpt-4o-mini', 'gemini-2.0-flash'],
    maxTokensIn: 24_000,
    maxTokensOut: 6_000,
    temperature: 0.4,
  },
  PRO_PLAN: {
    modelPreferences: ['gpt-5-mini', 'gemini-2.5-flash', 'gpt-4o'],
    maxTokensIn: 40_000,
    maxTokensOut: 10_000,
    temperature: 0.4,
  },
  ENTERPRISE_PLAN: {
    modelPreferences: ['gpt-5.2', 'gpt-5.1', 'gemini-2.5-pro'],
    maxTokensIn: 64_000,
    maxTokensOut: 16_000,
    temperature: 0.4,
  },
}

function applyTokenFloors(config: StagePlanConfig): StagePlanConfig {
  return {
    ...config,
    maxTokensIn: Math.max(config.maxTokensIn, MIN_STAGE_MAX_TOKENS_IN),
    maxTokensOut: Math.max(config.maxTokensOut, MIN_STAGE_MAX_TOKENS_OUT),
  }
}

function resolvePlanCode(planCode: string, planName: string): PlanCode {
  const code = String(planCode || '').toUpperCase()
  const name = String(planName || '').toUpperCase()

  if (code.includes('ENTERPRISE') || name.includes('ENTERPRISE')) {
    return 'ENTERPRISE_PLAN'
  }
  if (code.includes('PRO') || name.includes('PROFESSIONAL')) {
    return 'PRO_PLAN'
  }
  return 'FREE_PLAN'
}

async function main() {
  console.log('Seeding publication ideation workflow stages...')
  console.log(`Using feature: ${FEATURE_CODE}`)

  for (const stage of publicationStages) {
    await prisma.workflowStage.upsert({
      where: { code: stage.code },
      update: {
        displayName: stage.displayName,
        description: stage.description,
        sortOrder: stage.sortOrder,
        featureCode: FEATURE_CODE,
        isActive: true,
      },
      create: {
        code: stage.code,
        displayName: stage.displayName,
        description: stage.description,
        sortOrder: stage.sortOrder,
        featureCode: FEATURE_CODE,
        isActive: true,
      },
    })
    console.log(`  Stage seeded: ${stage.code}`)
  }

  const defaultModel = await prisma.lLMModel.findFirst({
    where: { isDefault: true, isActive: true },
  })

  if (!defaultModel) {
    console.log('No default active LLM model found. Skipping plan-stage configuration.')
    return
  }

  const plans = await prisma.plan.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  })

  if (!plans.length) {
    console.log('No active plans found. Stage registry seed complete.')
    return
  }

  const activeModels = await prisma.lLMModel.findMany({
    where: { isActive: true },
  })
  const modelsByCode = new Map(activeModels.map(model => [model.code.toLowerCase(), model]))

  const findModelByPreference = (preference: string) => {
    const normalized = String(preference || '').trim().toLowerCase()
    if (!normalized) return null

    const exact = modelsByCode.get(normalized)
    if (exact) return exact

    const startsWithMatch = activeModels.find(model => {
      const code = model.code.toLowerCase()
      return code.startsWith(`${normalized}-`) || code.startsWith(`${normalized}.`)
    })
    if (startsWithMatch) return startsWithMatch

    return activeModels.find(model => model.code.toLowerCase().includes(normalized)) || null
  }

  const resolveModel = (
    preferredCodes: string[],
    fallbackModel: typeof defaultModel
  ) => {
    for (const preferredCode of preferredCodes) {
      const matched = findModelByPreference(preferredCode)
      if (matched) {
        return matched
      }
    }
    return fallbackModel
  }

  const fallbackModelByPlan: Record<PlanCode, typeof defaultModel> = {
    FREE_PLAN: resolveModel(normalizeStageConfig(defaultStageConfigByPlan.FREE_PLAN).modelPreferences, defaultModel),
    PRO_PLAN: resolveModel(normalizeStageConfig(defaultStageConfigByPlan.PRO_PLAN).modelPreferences, defaultModel),
    ENTERPRISE_PLAN: resolveModel(normalizeStageConfig(defaultStageConfigByPlan.ENTERPRISE_PLAN).modelPreferences, defaultModel),
  }

  console.log(`Configuring ${plans.length} active plans with stage model/token settings...`)

  const stageByCode = new Map(
    (
      await prisma.workflowStage.findMany({
        where: { code: { in: publicationStages.map(stage => stage.code) } },
      })
    ).map(stage => [stage.code, stage])
  )

  for (const plan of plans) {
    const planCode = resolvePlanCode(plan.code, plan.name)
    const planFallbackModel = fallbackModelByPlan[planCode]

    for (const stage of publicationStages) {
      const workflowStage = stageByCode.get(stage.code)
      if (!workflowStage) continue

      const config =
        stageConfigs[stage.code]?.[planCode] ||
        defaultStageConfigByPlan[planCode]
      const override = planCode === 'PRO_PLAN' ? PRO_PLAN_PRODUCTION_OVERRIDES[stage.code] : undefined
      const normalizedConfig = applyTokenFloors(normalizeStageConfig(config, override))

      const selectedModel = resolveModel(normalizedConfig.modelPreferences, planFallbackModel)

      await prisma.planStageModelConfig.upsert({
        where: {
          planId_stageId: {
            planId: plan.id,
            stageId: workflowStage.id,
          },
        },
        update: {
          modelId: selectedModel.id,
          maxTokensIn: normalizedConfig.maxTokensIn,
          maxTokensOut: normalizedConfig.maxTokensOut,
          temperature: normalizedConfig.temperature,
          isActive: true,
        },
        create: {
          planId: plan.id,
          stageId: workflowStage.id,
          modelId: selectedModel.id,
          maxTokensIn: normalizedConfig.maxTokensIn,
          maxTokensOut: normalizedConfig.maxTokensOut,
          temperature: normalizedConfig.temperature,
          isActive: true,
        },
      })
    }

    console.log(`  Plan configured: ${plan.code} (${plan.name})`)
  }

  console.log('Publication ideation stage/model seeding completed.')
  console.log('Super Admin can review configs at: /super-admin/llm-config')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
