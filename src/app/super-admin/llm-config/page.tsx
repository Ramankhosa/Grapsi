'use client'

/**
 * Super Admin LLM Configuration Page
 * 
 * Allows super admin to:
 * - View/manage all LLM models
 * - View/manage workflow stages
 * - Configure which model to use for each stage per plan
 * - Set fallback models and token limits
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { unstable_noStore as noStore } from 'next/cache'

interface LLMModel {
  id: string
  code: string
  displayName: string
  provider: string
  contextWindow: number
  supportsVision: boolean
  supportsStreaming: boolean
  inputCostPer1M: number
  outputCostPer1M: number
  isActive: boolean
  isDefault: boolean
}

interface WorkflowStage {
  id: string
  code: string
  displayName: string
  featureCode: string
  description: string | null
  sortOrder: number
  isActive: boolean
}

interface Plan {
  id: string
  code: string
  name: string
}

interface StageConfig {
  id: string
  plan: { id: string; code: string; name: string }
  stage: { id: string; code: string; displayName: string; featureCode: string }
  model: { id: string; code: string; displayName: string; provider: string }
  fallbackModelIds: string | null
  maxTokensIn: number | null
  maxTokensOut: number | null
  temperature: number | null
}

interface ProviderInfo {
  name: string
  modelCount: number
  hasApiKey: boolean
}

const PROVIDER_COLORS: Record<string, string> = {
  google: 'bg-blue-100 text-blue-800 border-blue-200',
  openai: 'bg-green-100 text-green-800 border-green-200',
  anthropic: 'bg-orange-100 text-orange-800 border-orange-200',
  deepseek: 'bg-purple-100 text-purple-800 border-purple-200',
  groq: 'bg-pink-100 text-pink-800 border-pink-200'
}

const RETIRED_MODEL_CODES = new Set(['gpt-5.1-thinking'])

// Show only actively used drafting features in admin LLM control.
const FEATURE_LABELS: Record<string, string> = {
  PAPER_DRAFTING: 'Paper Drafting',
  PATENT_DRAFTING: 'Patent Drafting'
}

// Stages that DO NOT use LLMs (excluded from LLM control)
const NON_LLM_STAGES = [
  'DRAFT_COMPONENT_PLANNER',  // Manual UI - no LLM
  'DRAFT_EXPORT'              // Document generation - no LLM
]

const VISIBLE_STAGE_CODES_BY_FEATURE: Partial<Record<string, Set<string>>> = {
  PAPER_DRAFTING: new Set([
    'PAPER_TOPIC_EXTRACT_FROM_FILE',
    'PAPER_TOPIC_REFINE_QUESTION',
    'PAPER_CREATE_SECTIONS',
    'PAPER_FIGURE_SUGGESTION',
    'PAPER_TOPIC_SUGGEST_KEYWORDS',
    'PAPER_TOPIC_GENERATE_HYPOTHESIS',
    'PAPER_CHART_GENERATOR',
    'PAPER_TOPIC_DRAFT_ABSTRACT',
    'PAPER_DIAGRAM_GENERATOR',
    'PAPER_DIAGRAM_FROM_TEXT',
    'PAPER_TOPIC_FORMULATE_QUESTION',
    'PAPER_TOPIC_ENHANCE_ALL',
    'PAPER_SKETCH_GENERATION',
    'PAPER_ABSTRACT_TITLE',
    'PAPER_CONTENT_GENERATION',
    'PAPER_CITATION_FORMATTING',
    'PAPER_LITERATURE_ANALYSIS',
    'PAPER_LITERATURE_SEARCH',
    'LITERATURE_SEARCH',
    'SEARCH_STRATEGY_PLANNING',
    'SEARCH_QUERY_GENERATION',
    'PAPER_LITERATURE_SUMMARIZE',
    'PAPER_LITERATURE_GAP',
    'LITERATURE_RELEVANCE',
    'CITATION_BLUEPRINT_MAPPING',
    'PAPER_BLUEPRINT_GEN',
    'RESEARCH_INTENT_LOCK',
    'ARGUMENT_PLAN',
    'PAPER_ARCHETYPE_DETECTION',
    'PAPER_SECTION_DRAFT',
    'PAPER_SECTION_GEN',
    'PAPER_SECTION_IMPROVE',
    'PAPER_MEMORY_EXTRACT',
    'PAPER_CITATION_FORMAT',
    'PAPER_TEXT_ACTION',
    'PAPER_REWRITER',
    'PAPER_REVIEW_GAPS',
    'PAPER_REVIEW_COHERENCE',
    'PAPER_MANUSCRIPT_REVIEW',
    'PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY',
    'PAPER_MANUSCRIPT_IMPROVE',
    'PAPER_EXPORT_EXTRACTION',
  ])
}

// Ideation stage metadata - helps Super Admin choose appropriate models
// Stages marked as 'lightweight' can use faster, cheaper models (Flash, Mini, Haiku)
// Stages marked as 'advanced' benefit from more capable models (Pro, Sonnet, GPT-4o)
const IDEATION_STAGE_INFO: Record<string, { complexity: 'lightweight' | 'advanced'; tip: string }> = {
  'IDEATION_NORMALIZE': {
    complexity: 'lightweight',
    tip: 'Quick structured extraction with contradiction detection - Flash/Mini models work well'
  },
  'IDEATION_CLASSIFY': {
    complexity: 'lightweight',
    tip: 'Simple classification task - Flash/Mini models sufficient'
  },
  'IDEATION_CONTRADICTION_MAPPING': {
    complexity: 'lightweight',
    tip: 'Maps contradictions to TRIZ principles - Flash/Mini models sufficient'
  },
  'IDEATION_EXPAND': {
    complexity: 'lightweight',
    tip: 'Dimension expansion - Flash/Mini models handle this well'
  },
  'IDEATION_OBVIOUSNESS_FILTER': {
    complexity: 'lightweight',
    tip: 'Pre-generation novelty check - Flash/Mini models sufficient'
  },
  'IDEATION_GENERATE': {
    complexity: 'advanced',
    tip: 'Complex idea synthesis with inventive logic - Recommend Pro/Sonnet/GPT-4o for quality'
  },
  'IDEATION_NOVELTY': {
    complexity: 'advanced',
    tip: 'Novelty reasoning with PHOSITA test - Recommend Pro/Sonnet/GPT-4o for accuracy'
  }
}

// ============================================================================
// PAPER SECTION TO STAGE MAPPING
// Maps paper sections (from PaperTypeDefinition) to generic workflow stages
// This allows a single set of 4 stages to serve ALL paper types
// ============================================================================

// Paper section categories - maps any section to one of the 4 generic stages
const PAPER_SECTION_TO_STAGE_MAP: Record<string, string> = {
  // Abstract & Title stage - short-form, high-precision content
  'TITLE': 'PAPER_ABSTRACT_TITLE',
  'ABSTRACT': 'PAPER_ABSTRACT_TITLE',
  'KEYWORDS': 'PAPER_ABSTRACT_TITLE',
  
  // Content Generation stage - all main sections
  'INTRODUCTION': 'PAPER_CONTENT_GENERATION',
  'BACKGROUND': 'PAPER_CONTENT_GENERATION',
  'METHODOLOGY': 'PAPER_CONTENT_GENERATION',
  'METHODS': 'PAPER_CONTENT_GENERATION',
  'RESULTS': 'PAPER_CONTENT_GENERATION',
  'DISCUSSION': 'PAPER_CONTENT_GENERATION',
  'CONCLUSION': 'PAPER_CONTENT_GENERATION',
  'CONCLUSIONS': 'PAPER_CONTENT_GENERATION',
  'ANALYSIS': 'PAPER_CONTENT_GENERATION',
  'FINDINGS': 'PAPER_CONTENT_GENERATION',
  'THEORETICAL_FRAMEWORK': 'PAPER_CONTENT_GENERATION',
  'CASE_STUDY': 'PAPER_CONTENT_GENERATION',
  'IMPLICATIONS': 'PAPER_CONTENT_GENERATION',
  'LIMITATIONS': 'PAPER_CONTENT_GENERATION',
  'FUTURE_WORK': 'PAPER_CONTENT_GENERATION',
  'ACKNOWLEDGMENTS': 'PAPER_CONTENT_GENERATION',
  
  // Literature Analysis stage - for synthesizing sources
  'LITERATURE_REVIEW': 'PAPER_LITERATURE_ANALYSIS',
  'RELATED_WORK': 'PAPER_LITERATURE_ANALYSIS',
  'STATE_OF_THE_ART': 'PAPER_LITERATURE_ANALYSIS',
  'PRIOR_WORK': 'PAPER_LITERATURE_ANALYSIS',
  
  // Citation & References stage - bibliography handling
  'REFERENCES': 'PAPER_CITATION_FORMATTING',
  'BIBLIOGRAPHY': 'PAPER_CITATION_FORMATTING',
  'CITATIONS': 'PAPER_CITATION_FORMATTING',
}

// Helper function to get the stage code for any paper section (local to this page)
function getPaperStageForSectionLocal(sectionCode: string): string {
  const normalized = sectionCode.toUpperCase().replace(/-/g, '_')
  return PAPER_SECTION_TO_STAGE_MAP[normalized] || 'PAPER_CONTENT_GENERATION'
}

interface StageHelpInfo {
  summary: string
  responsibility: string
  tip: string
}

interface QuickAccessStage {
  code: string
  passLabel: string
  title: string
  description: string
}

const QUICK_ACCESS_BY_FEATURE: Record<string, QuickAccessStage[]> = {
  PAPER_DRAFTING: [
    {
      code: 'PAPER_SECTION_DRAFT',
      passLabel: 'Pass 1',
      title: 'Base Content Generation',
      description: 'Initial evidence-grounded section draft generation.'
    },
    {
      code: 'PAPER_SECTION_GEN',
      passLabel: 'Pass 2',
      title: 'Polish and Finalization',
      description: 'Section polish and publication-ready refinement.'
    }
  ],
  PATENT_DRAFTING: [
    {
      code: 'DRAFT_REFERENCE_DRAFT_PASS1',
      passLabel: 'Pass 1',
      title: 'Reference Draft Base',
      description: 'Country-neutral reference draft generation.'
    },
    {
      code: 'DRAFT_ANNEXURE_DESCRIPTION',
      passLabel: 'Pass 2',
      title: 'Jurisdiction Top-Up',
      description: 'Pass 2 adaptation/polish for jurisdiction specifics.'
    }
  ]
}

// Human-friendly help text for super-admin LLM controls.
// Covers all paper drafting stage codes and deep-analysis linked operations.
const STAGE_CONTROL_HELP: Record<string, StageHelpInfo> = {
  DRAFT_REFERENCE_DRAFT_PASS1: {
    summary: 'Reference draft generation pass 1.',
    responsibility: 'Builds the country-neutral master reference draft before any jurisdiction top-up is applied.',
    tip: 'Use a high-reasoning model here (default seeded to Claude Opus 4.5 alias).'
  },
  DRAFT_ANNEXURE_DESCRIPTION: {
    summary: 'Reference draft generation pass 2 and detailed-description support.',
    responsibility: 'Adapts pass 1 reference content to jurisdiction-specific requirements using top-up instructions and also backs detailed-description generation flows.',
    tip: 'Tune for instruction-following and reliability with structured section output.'
  },
  PAPER_TOPIC_EXTRACT_FROM_FILE: {
    summary: 'Paper idea normalization from uploaded files.',
    responsibility: 'Extracts and structures topic details from PDF/DOCX/text into normalized drafting fields.',
    tip: 'Use strong extraction models with high input limits for long source files.'
  },
  PAPER_ABSTRACT_TITLE: {
    summary: 'Short-form title, abstract, and keyword generation.',
    responsibility: 'Produces concise front-matter content requiring high precision and language quality.',
    tip: 'Prefer models that are strong at concise academic writing.'
  },
  PAPER_TOPIC_REFINE_QUESTION: {
    summary: 'Research question refinement.',
    responsibility: 'Improves the user-provided question for clarity, scope, and testability.',
    tip: 'Medium context and reasoning are usually sufficient.'
  },
  PAPER_CONTENT_GENERATION: {
    summary: 'Long-form section writing.',
    responsibility: 'Generates main paper sections such as Introduction, Methods, Results, and Discussion.',
    tip: 'Use high-capability models with large output limits for better structure and coherence.'
  },
  PAPER_TOPIC_SUGGEST_KEYWORDS: {
    summary: 'Academic keyword suggestion.',
    responsibility: 'Suggests domain-relevant search and indexing keywords from topic context.',
    tip: 'Cost-efficient models are usually enough for this stage.'
  },
  PAPER_CITATION_FORMATTING: {
    summary: 'Reference and bibliography formatting (legacy generic stage).',
    responsibility: 'Handles citation style normalization and bibliography formatting tasks.',
    tip: 'Consistency matters most; deterministic and cheaper models generally work well.'
  },
  PAPER_TOPIC_GENERATE_HYPOTHESIS: {
    summary: 'Hypothesis generation.',
    responsibility: 'Generates testable hypotheses aligned to question, methods, and expected outcomes.',
    tip: 'Choose reasoning-strong models to reduce generic hypotheses.'
  },
  PAPER_TOPIC_DRAFT_ABSTRACT: {
    summary: 'Topic-level abstract drafting.',
    responsibility: 'Drafts an initial abstract from early topic and methodology context.',
    tip: 'Balanced reasoning and writing quality works best here.'
  },
  PAPER_LITERATURE_ANALYSIS: {
    summary: 'Literature synthesis and analysis (legacy generic stage).',
    responsibility: 'Synthesizes multiple papers to summarize patterns, evidence, and research direction.',
    tip: 'Prefer larger context windows for multi-paper inputs.'
  },
  PAPER_TOPIC_FORMULATE_QUESTION: {
    summary: 'Guided question formulation.',
    responsibility: 'Assists users in forming a viable research question from broad topic intent.',
    tip: 'Fast models are usually enough unless topic complexity is high.'
  },
  PAPER_FIGURE_SUGGESTION: {
    summary: 'Figure and visualization planning.',
    responsibility: 'Suggests useful charts, diagrams, and visual artifacts based on paper content.',
    tip: 'Use reasoning-capable models for better relevance to section goals.'
  },
  PAPER_TOPIC_ENHANCE_ALL: {
    summary: 'Full topic enhancement.',
    responsibility: 'Improves all topic fields together for consistency across question, scope, and framing.',
    tip: 'Stronger models reduce contradictions across fields.'
  },
  PAPER_CHART_GENERATOR: {
    summary: 'Chart specification generation.',
    responsibility: 'Creates structured chart configurations (e.g., Chart.js) from prompts or data.',
    tip: 'Favor models with strong structured-output reliability.'
  },
  PAPER_DIAGRAM_GENERATOR: {
    summary: 'Diagram code generation.',
    responsibility: 'Generates Mermaid or PlantUML diagrams from requirements or prose.',
    tip: 'Use models with good syntax reliability to minimize repair passes.'
  },
  PAPER_SKETCH_GENERATION: {
    summary: 'AI sketch and illustration generation.',
    responsibility: 'Generates paper visuals using image-capable models from textual guidance.',
    tip: 'Ensure the selected model supports image generation.'
  },
  PAPER_FIGURE_METADATA_INFER: {
    summary: 'Low-cost figure metadata inference.',
    responsibility: 'Reads a generated figure image and extracts concise, evidence-safe metadata for downstream drafting.',
    tip: 'Prefer reliable vision models with low latency and strong JSON adherence.'
  },
  PAPER_TEXT_ACTION: {
    summary: 'Targeted text transformations.',
    responsibility: 'Applies rewrite, expand, condense, formalize, or simplify actions on selected text.',
    tip: 'Choose models with controllable style behavior and low latency.'
  },
  PAPER_CREATE_SECTIONS: {
    summary: 'Section structuring from selected text.',
    responsibility: 'Transforms a selected paragraph or block into headed subsections with coherent body text.',
    tip: 'Prefer models that are strong at structural organization and markdown heading discipline.'
  },
  PAPER_REWRITER: {
    summary: 'Full rewrite with academic tone.',
    responsibility: 'Rewrites larger passages while preserving meaning and improving clarity and flow.',
    tip: 'Prefer higher-quality writing models for this stage.'
  },
  PAPER_LITERATURE_SEARCH: {
    summary: 'Literature search assistance.',
    responsibility: 'Supports retrieval-oriented prompting for finding relevant academic references.',
    tip: 'Fast, cost-efficient models are usually sufficient.'
  },
  PAPER_LITERATURE_SUMMARIZE: {
    summary: 'Deep Analysis: Full-Text Evidence Extraction.',
    responsibility: 'Deep analysis extraction step that builds structured Evidence Cards from full text with claims, metrics, boundaries, and verbatim source fragments.',
    tip: 'Primary Deep Analysis extraction gateway; keep generous token limits for full papers.'
  },
  PAPER_DIAGRAM_FROM_TEXT: {
    summary: 'Diagram generation from selected text.',
    responsibility: 'Transforms highlighted document text into diagram specifications automatically.',
    tip: 'Structured-output accuracy is more important than creative writing quality.'
  },
  PAPER_LITERATURE_GAP: {
    summary: 'Research gap analysis.',
    responsibility: 'Identifies missing evidence, unresolved questions, and contribution opportunities from reviewed literature.',
    tip: 'Use reasoning-strong models for higher-quality gap statements.'
  },
  LITERATURE_RELEVANCE: {
    summary: 'Relevance scoring for discovered papers.',
    responsibility: 'Ranks and filters candidate papers by fit with the active research topic and blueprint intent.',
    tip: 'A balance of speed and ranking quality is ideal.'
  },
  PAPER_BLUEPRINT_GEN: {
    summary: 'Blueprint generation.',
    responsibility: 'Builds thesis, section plan, must-cover dimensions, and terminology policy.',
    tip: 'Critical planning stage; use a top-tier reasoning model.'
  },
  PAPER_SECTION_GEN: {
    summary: 'Section generation with memory.',
    responsibility: 'Generates section drafts using blueprint constraints and cross-section memory.',
    tip: 'Higher reasoning and long-context support improve global coherence.'
  },
  PAPER_MEMORY_EXTRACT: {
    summary: 'Section memory extraction.',
    responsibility: 'Extracts compact structured memory from edited sections for downstream drafting consistency.',
    tip: 'Fast models are often enough for this structured extraction.'
  },
  PAPER_SECTION_DRAFT: {
    summary: 'Legacy section drafting endpoint.',
    responsibility: 'Generates section content in drafting routes that still use the legacy stage code.',
    tip: 'Keep aligned with the primary section generation model to avoid style drift.'
  },
  PAPER_SECTION_IMPROVE: {
    summary: 'Deep Analysis support: Section improvement and citation-repair pass.',
    responsibility: 'Runs post-draft improvement tasks, including Deep Analysis aware citation whitelist correction in drafting flow.',
    tip: 'Used as a Deep Analysis downstream support stage during citation repair.'
  },
  PAPER_CITATION_FORMAT: {
    summary: 'Citation formatting (newer stage code).',
    responsibility: 'Formats in-text citations and references to target style rules.',
    tip: 'Deterministic formatting quality is more important than deep reasoning.'
  },
  PAPER_REVIEW_GAPS: {
    summary: 'Draft gap review.',
    responsibility: 'Reviews draft sections for missing arguments, evidence gaps, and under-supported claims.',
    tip: 'Use reasoning-focused models for more actionable critique.'
  },
  PAPER_REVIEW_COHERENCE: {
    summary: 'Deep Analysis: Evidence card to dimension mapping.',
    responsibility: 'Deep analysis mapping step that maps extracted Evidence Cards to blueprint dimensions (sectionKey/dimension/useAs) and also supports coherence-oriented review tasks.',
    tip: 'Primary Deep Analysis mapping gateway; prioritize structured JSON reliability and reasoning.'
  },
  PAPER_MANUSCRIPT_REVIEW: {
    summary: 'Structured manuscript review.',
    responsibility: 'Runs the post-drafting review stage and produces the persisted review report used by the Improve stage.',
    tip: 'Prefer high-reasoning, long-context models because the full manuscript, citations, and figure context may be inspected together.'
  },
  PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY: {
    summary: 'Neighbor-section context summarization.',
    responsibility: 'Extracts compact structured summaries of nearby sections so section-by-section review can keep full text only for the active section.',
    tip: 'Structured-output reliability matters most; keep this aligned to the summary prompt and current review strategy.'
  },
  PAPER_MANUSCRIPT_IMPROVE: {
    summary: 'Review-driven manuscript improvement.',
    responsibility: 'Executes approved rewrite-fixable recommendations from the latest manuscript review and updates draft sections.',
    tip: 'Use models with strong edit fidelity and instruction-following to avoid collateral rewrites.'
  },
  PAPER_EXPORT_EXTRACTION: {
    summary: 'Adaptive export profile extraction.',
    responsibility: 'Reads an uploaded DOCX or LaTeX reference, or pasted formatting guidelines, and converts them into the structured export profile used by DOCX and LaTeX exporters.',
    tip: 'Prioritize structured JSON reliability and formatting inference quality over creative output.'
  },
  PAPER_ARCHETYPE_DETECTION: {
    summary: 'Reference archetype detection.',
    responsibility: 'Classifies papers into archetypes for downstream extraction and mapping logic.',
    tip: 'Reliable classification is more important than creative output.'
  },
  PAPER_DIAGRAM_REPAIR: {
    summary: 'Diagram repair and retry.',
    responsibility: 'Fixes invalid diagram syntax after generation failures.',
    tip: 'Use models with high syntax discipline for repair iterations.'
  }
}

function getStageHelpInfo(stage: WorkflowStage): StageHelpInfo {
  const mapped = STAGE_CONTROL_HELP[stage.code]
  if (mapped) return mapped

  return {
    summary: stage.description?.trim() || 'No explicit description configured for this stage.',
    responsibility: 'Controls model selection, fallback order, and token limits for this workflow operation.',
    tip: 'Use larger models for reasoning-heavy synthesis and smaller models for deterministic transforms.'
  }
}

function isStageVisibleInAdmin(stage: WorkflowStage): boolean {
  if (!stage.isActive || NON_LLM_STAGES.includes(stage.code)) return false
  const visibleCodes = VISIBLE_STAGE_CODES_BY_FEATURE[stage.featureCode]
  return !visibleCodes || visibleCodes.has(stage.code)
}

function getStageCodeBadgeClasses(stageCode: string): string {
  if (/^PAPER_TOPIC_|^PAPER_ABSTRACT_TITLE$/.test(stageCode)) {
    return 'border-sky-700/50 bg-sky-900/30 text-sky-200'
  }
  if (/FIGURE|DIAGRAM|SKETCH/.test(stageCode)) {
    return 'border-fuchsia-700/50 bg-fuchsia-900/25 text-fuchsia-200'
  }
  if (/LITERATURE|SEARCH|CITATION_BLUEPRINT_MAPPING/.test(stageCode)) {
    return 'border-emerald-700/50 bg-emerald-900/25 text-emerald-200'
  }
  if (/BLUEPRINT|INTENT|ARGUMENT|ARCHETYPE/.test(stageCode)) {
    return 'border-amber-700/50 bg-amber-900/25 text-amber-200'
  }
  if (/SECTION|CONTENT|MEMORY|TEXT_ACTION|REWRITER|CITATION_FORMAT/.test(stageCode)) {
    return 'border-cyan-700/50 bg-cyan-900/25 text-cyan-200'
  }
  if (/REVIEW|FIX|IMPROVE|EXPORT/.test(stageCode)) {
    return 'border-rose-700/50 bg-rose-900/25 text-rose-200'
  }
  return 'border-slate-600 bg-slate-700/60 text-slate-200'
}

function isModelAssignable(model: LLMModel): boolean {
  return model.isActive && !RETIRED_MODEL_CODES.has(model.code)
}

export default function LLMConfigPage() {
  noStore()

  const { user, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<'overview' | 'models' | 'stages' | 'configs'>('overview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshingCache, setRefreshingCache] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Data states
  const [models, setModels] = useState<LLMModel[]>([])
  const [stages, setStages] = useState<WorkflowStage[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [stageConfigs, setStageConfigs] = useState<StageConfig[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])

  // Selection states
  const [selectedPlan, setSelectedPlan] = useState<string>('')
  const [selectedFeature, setSelectedFeature] = useState<string>('PAPER_DRAFTING')
  const stageRowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Edit states
  const [editingConfig, setEditingConfig] = useState<{
    stageId: string
    modelId: string
    fallbacks: string[]
    maxTokensIn?: number
    maxTokensOut?: number
  } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/super-admin/llm-config?section=all', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch LLM configuration')
      }

      const data = await response.json()
      setModels(data.models || [])
      setStages(data.stages || [])
      setPlans(data.plans || [])
      setStageConfigs(data.stageConfigs || [])
      setProviders(data.providers || [])

      if (data.plans?.length > 0) {
        setSelectedPlan(current => current || data.plans[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (!user.roles?.includes('SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }

    fetchData()
  }, [user, fetchData])

  const handleSetStageModel = async (stageId: string, modelId: string, fallbacks: string[] = [], maxTokensIn?: number, maxTokensOut?: number) => {
    if (!selectedPlan) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'set_stage_model',
          planId: selectedPlan,
          stageId,
          modelId,
          fallbackModelIds: fallbacks.length > 0 ? fallbacks : undefined,
          maxTokensIn,
          maxTokensOut
        })
      })

      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || 'Failed to update configuration')
      }

      setSuccess('Configuration updated successfully')
      setEditingConfig(null)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleModel = async (modelId: string, isActive: boolean) => {
    try {
      setSaving(true)
      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'toggle_model',
          id: modelId,
          isActive
        })
      })

      if (!response.ok) throw new Error('Failed to toggle model')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle')
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (modelId: string) => {
    try {
      setSaving(true)
      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'set_default_model',
          id: modelId
        })
      })

      if (!response.ok) throw new Error('Failed to set default')
      setSuccess('Default model updated')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default')
    } finally {
      setSaving(false)
    }
  }

  const handleCopyConfig = async (sourcePlanId: string, targetPlanId: string) => {
    try {
      setSaving(true)
      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'copy_plan_config',
          sourcePlanId,
          targetPlanId
        })
      })

      if (!response.ok) throw new Error('Failed to copy configuration')
      setSuccess('Configuration copied successfully')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy')
    } finally {
      setSaving(false)
    }
  }

  const handleRefreshCache = async () => {
    try {
      setRefreshingCache(true)
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/super-admin/llm-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`
        },
        body: JSON.stringify({
          action: 'refresh_cache'
        })
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to refresh LLM cache')
      }

      setSuccess(body?.message || 'LLM cache refreshed successfully')
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh cache')
    } finally {
      setRefreshingCache(false)
    }
  }

  const formatCost = (costPer1M: number) => {
    return `$${(costPer1M / 100).toFixed(2)}`
  }

  const getConfigForStage = (stageId: string): StageConfig | undefined => {
    return stageConfigs.find(c => c.stage.id === stageId && c.plan.id === selectedPlan)
  }

  const beginStageEdit = (stage: WorkflowStage) => {
    const config = getConfigForStage(stage.id)
    setEditingConfig({
      stageId: stage.id,
      modelId: config?.model.id || '',
      fallbacks: config?.fallbackModelIds ? JSON.parse(config.fallbackModelIds) : [],
      maxTokensIn: config?.maxTokensIn || undefined,
      maxTokensOut: config?.maxTokensOut || undefined
    })
  }

  const jumpToStageRow = (stageCode: string) => {
    const target = stageRowRefs.current[stageCode]
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Filter stages by feature and exclude stages that don't use LLMs
  const filteredStages = stages.filter(s =>
    s.featureCode === selectedFeature && isStageVisibleInAdmin(s)
  )
  const assignableModels = models.filter(isModelAssignable)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-white">LLM Model Configuration</h1>
              <p className="text-slate-400 text-sm mt-1">
                Configure which AI models to use for each stage and plan
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">Super Admin: {user?.email}</span>
              <button
                onClick={() => logout()}
                className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'models', label: 'Models Registry' },
              { id: 'stages', label: 'Workflow Stages' },
              { id: 'configs', label: 'Plan Configurations' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                  activeTab === tab.id
                    ? 'border-cyan-400 text-cyan-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="float-right">&times;</button>
          </div>
        </div>
      )}
      {success && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded-lg">
            {success}
            <button onClick={() => setSuccess(null)} className="float-right">&times;</button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Provider Status */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4">Provider Status</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {providers.map(p => (
                  <div
                    key={p.name}
                    className={`p-4 rounded-lg border ${
                      p.hasApiKey ? 'bg-slate-700 border-slate-600' : 'bg-slate-800 border-slate-700 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2 h-2 rounded-full ${p.hasApiKey ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="font-medium capitalize">{p.name}</span>
                    </div>
                    <div className="text-sm text-slate-400">
                      {p.modelCount} models
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {p.hasApiKey ? 'API Key configured' : 'No API Key'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-cyan-400">{models.length}</div>
                <div className="text-slate-400">Total Models</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-green-400">{models.filter(m => m.isActive).length}</div>
                <div className="text-slate-400">Active Models</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-purple-400">{stages.length}</div>
                <div className="text-slate-400">Workflow Stages</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <div className="text-3xl font-bold text-orange-400">{stageConfigs.length}</div>
                <div className="text-slate-400">Stage Configurations</div>
              </div>
            </div>

            {/* System Default */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-lg font-semibold mb-4">System Default Model</h2>
              <p className="text-sm text-slate-400 mb-4">
                This model is used when no specific configuration is found for a plan/stage combination.
              </p>
              {models.find(m => m.isDefault) ? (
                <div className="flex items-center gap-4 p-4 bg-slate-700 rounded-lg">
                  <div className={`px-3 py-1 rounded-full text-xs font-medium border ${PROVIDER_COLORS[models.find(m => m.isDefault)!.provider] || 'bg-slate-600'}`}>
                    {models.find(m => m.isDefault)!.provider}
                  </div>
                  <div>
                    <div className="font-medium">{models.find(m => m.isDefault)!.displayName}</div>
                    <div className="text-sm text-slate-400">{models.find(m => m.isDefault)!.code}</div>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">No default model set</div>
              )}
            </div>
          </div>
        )}

        {/* Models Tab */}
        {activeTab === 'models' && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold">LLM Models Registry</h2>
              <p className="text-sm text-slate-400">All available models that can be assigned to stages</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Model</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Provider</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Context</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Features</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Cost/1M</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {models.map(model => (
                    <tr key={model.id} className={`hover:bg-slate-700/30 ${!model.isActive ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{model.displayName}</div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span>{model.code}</span>
                          {RETIRED_MODEL_CODES.has(model.code) && (
                            <span className="rounded-full border border-amber-700/50 bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                              Retired
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${PROVIDER_COLORS[model.provider] || 'bg-slate-600'}`}>
                          {model.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {(model.contextWindow / 1000).toFixed(0)}K
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {model.supportsVision && (
                            <span className="px-2 py-0.5 bg-blue-900/50 text-blue-300 text-xs rounded">Vision</span>
                          )}
                          {model.supportsStreaming && (
                            <span className="px-2 py-0.5 bg-green-900/50 text-green-300 text-xs rounded">Stream</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div>In: {formatCost(model.inputCostPer1M)}</div>
                        <div className="text-slate-400">Out: {formatCost(model.outputCostPer1M)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${model.isActive ? 'bg-green-400' : 'bg-red-400'}`} />
                          <span className="text-sm">{model.isActive ? 'Active' : 'Inactive'}</span>
                          {model.isDefault && (
                            <span className="px-2 py-0.5 bg-cyan-900/50 text-cyan-300 text-xs rounded">Default</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleToggleModel(model.id, !model.isActive)}
                            disabled={saving}
                            className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded transition"
                          >
                            {model.isActive ? 'Disable' : 'Enable'}
                          </button>
                          {!model.isDefault && model.isActive && (
                            <button
                              onClick={() => handleSetDefault(model.id)}
                              disabled={saving}
                              className="px-2 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 rounded transition"
                            >
                              Set Default
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stages Tab */}
        {activeTab === 'stages' && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold">Workflow Stages</h2>
              <p className="text-sm text-slate-400">All stages that can have model configurations</p>
            </div>
            <div className="p-4">
              {Object.entries(FEATURE_LABELS).map(([featureCode, featureLabel]) => {
                const featureStages = stages.filter(s => s.featureCode === featureCode && isStageVisibleInAdmin(s))
                if (featureStages.length === 0) return null

                return (
                  <div key={featureCode} className="mb-6">
                    <h3 className="text-md font-medium text-slate-300 mb-3">{featureLabel}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {featureStages.map(stage => {
                        const stageHelp = getStageHelpInfo(stage)

                        return (
                          <div
                            key={stage.id}
                            className={`p-4 rounded-lg border ${
                              stage.isActive ? 'bg-slate-700 border-slate-600' : 'bg-slate-800 border-slate-700 opacity-50'
                            }`}
                          >
                            <div className="font-medium">{stage.displayName}</div>
                            <div className="mt-1">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStageCodeBadgeClasses(stage.code)}`}>
                                {stage.code}
                              </span>
                            </div>
                            <div className="text-sm text-slate-300 mt-2">{stageHelp.summary}</div>
                            <div className="mt-2 p-2 rounded border border-cyan-700/40 bg-cyan-900/20">
                              <div className="text-xs text-cyan-200">
                                <span className="font-semibold text-cyan-100">What this controls:</span>{' '}
                                {stageHelp.responsibility}
                              </div>
                              <div className="text-xs text-cyan-300 mt-1">{stageHelp.tip}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Configurations Tab */}
        {activeTab === 'configs' && (
          <div className="space-y-6">
            {/* Plan & Feature Selection */}
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Select Plan</label>
                <select
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white"
                >
                  {plans.map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.name} ({plan.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Feature</label>
                <select
                  value={selectedFeature}
                  onChange={(e) => setSelectedFeature(e.target.value)}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white"
                >
                  {Object.entries(FEATURE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="ml-auto">
                <label className="block text-sm text-slate-400 mb-1">Copy Config From</label>
                <select
                  onChange={(e) => {
                    if (e.target.value && selectedPlan) {
                      handleCopyConfig(e.target.value, selectedPlan)
                      e.target.value = ''
                    }
                  }}
                  className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white"
                >
                  <option value="">Select plan to copy from...</option>
                  {plans.filter(p => p.id !== selectedPlan).map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Model Cache</label>
                <button
                  onClick={handleRefreshCache}
                  disabled={refreshingCache || saving}
                  className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg px-4 py-2 text-white text-sm font-medium transition"
                >
                  {refreshingCache ? 'Refreshing...' : 'Refresh Cache'}
                </button>
              </div>
            </div>

            {/* Pass 1 / Pass 2 Quick Access */}
            {(() => {
              const quickAccess = QUICK_ACCESS_BY_FEATURE[selectedFeature] || []
              if (quickAccess.length === 0) return null

              const quickRows = quickAccess
                .map(item => {
                  const stage = filteredStages.find(s => s.code === item.code)
                  if (!stage) return null
                  const config = getConfigForStage(stage.id)
                  return { item, stage, config }
                })
                .filter(Boolean) as Array<{ item: QuickAccessStage; stage: WorkflowStage; config?: StageConfig }>

              if (quickRows.length === 0) return null

              return (
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                  <div className="p-4 border-b border-slate-700">
                    <h2 className="text-lg font-semibold">Pass 1 / Pass 2 Quick Access</h2>
                    <p className="text-sm text-slate-400">
                      Jump directly to pass-stage model controls without searching the full list.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                    {quickRows.map(({ item, stage, config }) => (
                      <div key={stage.code} className="rounded-lg border border-slate-600 bg-slate-700/40 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="px-2 py-1 rounded text-xs font-semibold bg-cyan-900/40 text-cyan-200 border border-cyan-700/40">
                            {item.passLabel}
                          </span>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStageCodeBadgeClasses(stage.code)}`}>
                            {stage.code}
                          </span>
                        </div>
                        <div className="mt-2 font-medium text-white">{item.title}</div>
                        <div className="text-sm text-slate-300 mt-1">{item.description}</div>
                        <div className="mt-3 text-sm">
                          {config ? (
                            <span className="text-slate-200">
                              Model: <span className="font-medium">{config.model.displayName}</span>
                            </span>
                          ) : (
                            <span className="text-amber-300">Model not configured</span>
                          )}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => jumpToStageRow(stage.code)}
                            className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm transition"
                          >
                            Jump
                          </button>
                          <button
                            onClick={() => beginStageEdit(stage)}
                            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-sm transition"
                          >
                            {config ? 'Edit' : 'Configure'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Stage Configurations */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="p-4 border-b border-slate-700">
                <h2 className="text-lg font-semibold">
                  {FEATURE_LABELS[selectedFeature]} - {plans.find(p => p.id === selectedPlan)?.name || 'Select Plan'}
                </h2>
                <p className="text-sm text-slate-400">Configure which model to use for each stage</p>
              </div>
              <div className="divide-y divide-slate-700">
                {filteredStages.map(stage => {
                  const config = getConfigForStage(stage.id)
                  const isEditing = editingConfig?.stageId === stage.id
                  const stageHelp = getStageHelpInfo(stage)

                  return (
                    <div
                      key={stage.id}
                      ref={(el) => { stageRowRefs.current[stage.code] = el }}
                      className="p-4 hover:bg-slate-700/30"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{stage.displayName}</div>
                          <div className="mt-1">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStageCodeBadgeClasses(stage.code)}`}>
                              {stage.code}
                            </span>
                          </div>
                          <div className="text-sm text-slate-300 mt-1">{stageHelp.summary}</div>
                          <div className="mt-2 p-2 rounded border border-cyan-700/40 bg-cyan-900/20 max-w-3xl">
                            <div className="text-xs text-cyan-200">
                              <span className="font-semibold text-cyan-100">What this controls:</span>{' '}
                              {stageHelp.responsibility}
                            </div>
                            <div className="text-xs text-cyan-300 mt-1">{stageHelp.tip}</div>
                          </div>
                          {/* Show model recommendation for ideation stages (if enabled) */}
                          {IDEATION_STAGE_INFO[stage.code] && (
                            <div className={`text-xs mt-2 px-2 py-1 rounded inline-flex items-center gap-1 ${
                              IDEATION_STAGE_INFO[stage.code].complexity === 'lightweight' 
                                ? 'bg-green-900/30 text-green-400 border border-green-700/50' 
                                : 'bg-amber-900/30 text-amber-400 border border-amber-700/50'
                            }`}>
                              <span>{IDEATION_STAGE_INFO[stage.code].complexity === 'lightweight' ? '⚡' : '🧠'}</span>
                              <span>{IDEATION_STAGE_INFO[stage.code].tip}</span>
                            </div>
                          )}
                        </div>

                        {isEditing ? (
                            <div className="flex flex-col gap-3">
                                            <div className="flex items-center gap-4">
                                              <div className="flex-1">
                                                <label className="block text-xs text-slate-400 mb-1">Primary Model</label>
                                                <select
                                                  value={editingConfig.modelId}
                                                  onChange={(e) => setEditingConfig({ ...editingConfig, modelId: e.target.value })}
                                                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
                                                >
                                                  <option value="">Select model...</option>
                                                  {assignableModels.map(model => (
                                                    <option key={model.id} value={model.id}>
                                                      {model.displayName} ({model.provider})
                                                    </option>
                                                  ))}
                                                </select>
                                              </div>
                                              <div className="w-36">
                                                <label className="block text-xs text-slate-400 mb-1">Max Input Tokens</label>
                                                <input
                                                  type="number"
                                                  placeholder="e.g. 4000"
                                                  value={editingConfig.maxTokensIn || ''}
                                                  onChange={(e) => setEditingConfig({ 
                                                    ...editingConfig, 
                                                    maxTokensIn: e.target.value ? parseInt(e.target.value) : undefined 
                                                  })}
                                                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
                                                />
                                              </div>
                                              <div className="w-36">
                                                <label className="block text-xs text-slate-400 mb-1">Max Output Tokens</label>
                                                <input
                                                  type="number"
                                                  placeholder="e.g. 4096"
                                                  value={editingConfig.maxTokensOut || ''}
                                                  onChange={(e) => setEditingConfig({ 
                                                    ...editingConfig, 
                                                    maxTokensOut: e.target.value ? parseInt(e.target.value) : undefined 
                                                  })}
                                                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
                                                />
                                              </div>
                                            </div>
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">Fallback Models (up to 3)</label>
                              <div className="flex flex-wrap gap-2">
                                {assignableModels.filter(m => m.id !== editingConfig.modelId).slice(0, 10).map(model => {
                                  const isSelected = editingConfig.fallbacks.includes(model.id)
                                  const canSelect = editingConfig.fallbacks.length < 3 || isSelected
                                  return (
                                    <button
                                      key={model.id}
                                      type="button"
                                      disabled={!canSelect && !isSelected}
                                      onClick={() => {
                                        if (isSelected) {
                                          setEditingConfig({
                                            ...editingConfig,
                                            fallbacks: editingConfig.fallbacks.filter(id => id !== model.id)
                                          })
                                        } else if (canSelect) {
                                          setEditingConfig({
                                            ...editingConfig,
                                            fallbacks: [...editingConfig.fallbacks, model.id]
                                          })
                                        }
                                      }}
                                      className={`px-2 py-1 text-xs rounded border transition ${
                                        isSelected 
                                          ? 'bg-cyan-600 border-cyan-500 text-white' 
                                          : canSelect
                                            ? 'bg-slate-700 border-slate-600 hover:border-slate-500'
                                            : 'bg-slate-800 border-slate-700 opacity-50 cursor-not-allowed'
                                      }`}
                                    >
                                      {model.displayName}
                                    </button>
                                  )
                                })}
                              </div>
                              {editingConfig.fallbacks.length > 0 && (
                                <div className="text-xs text-slate-400 mt-1">
                                  Fallback order: {editingConfig.fallbacks.map(id => 
                                    models.find(m => m.id === id)?.displayName
                                  ).join(' → ')}
                                </div>
                              )}
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setEditingConfig(null)}
                                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                              >
                                Cancel
                              </button>
                              <button
                                                onClick={() => handleSetStageModel(
                                                  stage.id,
                                                  editingConfig.modelId,
                                                  editingConfig.fallbacks,
                                                  editingConfig.maxTokensIn,
                                                  editingConfig.maxTokensOut
                                                )}
                                                disabled={saving || !editingConfig.modelId}
                                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-medium disabled:opacity-50"
                                              >
                                                {saving ? 'Saving...' : 'Save'}
                                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4">
                            {config ? (
                                              <div className="flex flex-col gap-1">
                                              <div className="flex flex-wrap items-center gap-2">
                                                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${PROVIDER_COLORS[config.model.provider] || 'bg-slate-600'}`}>
                                                    {config.model.provider}
                                                  </span>
                                                  <span className="rounded-full border border-slate-600 bg-slate-700/60 px-2.5 py-1 text-sm font-semibold text-white">
                                                    {config.model.displayName}
                                                  </span>
                                                  {config.maxTokensIn && (
                                                    <span className="rounded-full border border-cyan-700/40 bg-cyan-900/20 px-2 py-1 text-[11px] font-medium text-cyan-200">
                                                      In {config.maxTokensIn.toLocaleString()}
                                                    </span>
                                                  )}
                                                  {config.maxTokensOut && (
                                                    <span className="rounded-full border border-violet-700/40 bg-violet-900/20 px-2 py-1 text-[11px] font-medium text-violet-200">
                                                      Out {config.maxTokensOut.toLocaleString()}
                                                    </span>
                                                  )}
                                                </div>
                                {config.fallbackModelIds && (() => {
                                  try {
                                    const fallbackIds = JSON.parse(config.fallbackModelIds)
                                    if (Array.isArray(fallbackIds) && fallbackIds.length > 0) {
                                      const fallbackNames = fallbackIds
                                        .map((id: string) => models.find(m => m.id === id)?.displayName)
                                        .filter(Boolean)
                                      if (fallbackNames.length > 0) {
                                        return (
                                          <div className="text-xs text-slate-500">
                                            Fallbacks: {fallbackNames.join(' → ')}
                                          </div>
                                        )
                                      }
                                    }
                                    return null
                                  } catch { return null }
                                })()}
                              </div>
                            ) : (
                              <span className="text-slate-500 italic">Not configured</span>
                            )}
                            <button
                                              onClick={() => beginStageEdit(stage)}
                                              className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm transition"
                                            >
                                              {config ? 'Edit' : 'Configure'}
                                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
