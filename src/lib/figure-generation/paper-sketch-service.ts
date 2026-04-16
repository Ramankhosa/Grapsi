/**
 * Paper Sketch Generation Service
 * 
 * Handles AI-powered sketch/illustration generation for research paper figures
 * using Gemini image generation models.
 * 
 * Supports three modes:
 * - SUGGEST: AI generates based on paper context (abstract, sections)
 * - GUIDED: User provides specific instructions
 * - REFINE: User uploads an image (hand-drawn or existing) for AI refinement
 */

import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { resolveModel } from '@/lib/metering/model-resolver'
import type { TaskCode } from '@prisma/client'
import type {
  IllustrationStructuredSpecV2,
  IllustrationFigureGenre,
  IllustrationRenderDirectives
} from './types'
import { getPaperFigureGenerationPrompt } from './paper-figure-record'

// Types
export type PaperSketchMode = 'SUGGEST' | 'GUIDED' | 'REFINE'
export type PaperSketchStatus = 'PENDING' | 'SUCCESS' | 'FAILED'

export interface PaperSketchRequest {
  paperId: string
  sessionId: string
  figureId?: string // Existing figure plan to update
  mode: PaperSketchMode
  title?: string
  userPrompt?: string
  illustrationSpecV2?: IllustrationStructuredSpecV2
  figureGenre?: IllustrationFigureGenre
  renderDirectives?: IllustrationRenderDirectives
  uploadedImageBase64?: string
  uploadedImageMimeType?: string
  sourceSketchId?: string // For modification chains
  modificationRequest?: string // User's modification feedback
  style?: 'academic' | 'scientific' | 'conceptual' | 'technical'
}

export interface PaperSketchContextBundle {
  paperTitle: string
  abstract: string
  sectionContent: string
  methodology: string
  keywords: string[]
  figureContext?: string // Existing figure description if modifying
}

export interface PaperSketchResult {
  success: boolean
  figureId?: string
  imagePath?: string
  error?: string
  attemptCount?: number
  qualityFlags?: string[]
}

// Constants
const SKETCH_UPLOAD_DIR = 'public/uploads/paper-sketches'
const SKETCH_STAGE_CODE = 'PAPER_SKETCH_GENERATION'
const SKETCH_TASK_CODE: TaskCode = 'LLM3_DIAGRAM'
const MAX_GENERATION_ATTEMPTS = 2

/**
 * Get active plan ID for tenant
 */
async function getActivePlanIdForTenant(tenantId?: string | null): Promise<string | null> {
  if (!tenantId) return null
  const now = new Date()
  const plan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { planId: true }
  })
  return plan?.planId || null
}

/**
 * Resolve sketch model from database configuration
 */
async function resolveSketchModelCandidates(tenantId?: string | null): Promise<string[]> {
  const candidates: string[] = []

  try {
    const planId = await getActivePlanIdForTenant(tenantId)
    if (planId) {
      console.log(`[PaperSketchService] Resolving model for planId=${planId}, stage=${SKETCH_STAGE_CODE}`)
      const resolved = await resolveModel(planId, SKETCH_TASK_CODE, SKETCH_STAGE_CODE)
      
      if (resolved?.modelCode) {
        console.log(`[PaperSketchService] Model resolved: ${resolved.modelCode}`)
        candidates.push(resolved.modelCode)
        
        if (resolved.fallbacks && resolved.fallbacks.length > 0) {
          resolved.fallbacks.forEach(fb => {
            if (fb?.modelCode) candidates.push(fb.modelCode)
          })
        }
      }
    }
  } catch (e) {
    console.error('[PaperSketchService] Model resolution failed:', e instanceof Error ? e.message : e)
  }

  // Fallback to environment variable for development
  const envModel = process.env.GEMINI_SKETCH_MODEL
  if (envModel && !candidates.includes(envModel)) {
    candidates.push(envModel)
  }

  // Default fallback - Nano Banana 2 (Gemini 3.1 Flash Image) for best quality/cost
  // Falls back to legacy Nano Banana Pro if NB2 is unavailable
  if (candidates.length === 0) {
    candidates.push('gemini-3.1-flash-image')
    candidates.push('gemini-3-pro-image-preview')
  }

  return candidates
}

/**
 * Build context bundle from paper data
 * Uses DraftingSession and ResearchTopic models
 */
async function buildPaperContextBundle(
  paperId: string,
  sessionId: string
): Promise<PaperSketchContextBundle> {
  // Defensive check for prisma
  if (!prisma || !prisma.draftingSession) {
    console.error('[PaperSketchService] Prisma client not initialized')
    return {
      paperTitle: 'Research Paper',
      abstract: '',
      sectionContent: '',
      methodology: '',
      keywords: []
    }
  }

  try {
    // Get session with research topic data
    const session = await prisma.draftingSession.findUnique({
      where: { id: sessionId },
      include: {
        researchTopic: true
      }
    })

    const researchTopic = session?.researchTopic
    
    // Extract relevant content for context
    const sections: string[] = []
    const methodology: string[] = []
    const keywords: string[] = researchTopic?.keywords || []
    
    // Add research question if available
    if (researchTopic?.researchQuestion) {
      sections.push(`Research Question: ${researchTopic.researchQuestion}`)
    }
    
    // Add hypothesis if available
    if (researchTopic?.hypothesis) {
      sections.push(`Hypothesis: ${researchTopic.hypothesis}`)
    }
    
    // Add methodology from research topic
    if (researchTopic?.methodology) {
      methodology.push(`Methodology: ${researchTopic.methodology}`)
    }
    
    // Add dataset description if available
    if (researchTopic?.datasetDescription) {
      sections.push(`Dataset: ${researchTopic.datasetDescription}`)
    }

    return {
      paperTitle: researchTopic?.title || 'Research Paper',
      abstract: researchTopic?.abstractDraft || '',
      sectionContent: sections.join('\n\n'),
      methodology: methodology.join('\n'),
      keywords
    }
  } catch (err) {
    console.error('[PaperSketchService] Failed to build context:', err)
    return {
      paperTitle: 'Research Paper',
      abstract: '',
      sectionContent: '',
      methodology: '',
      keywords: []
    }
  }
}

type EffectiveFigureGenre = IllustrationFigureGenre

interface EffectiveSketchSpec {
  specV2?: IllustrationStructuredSpecV2
  genre: EffectiveFigureGenre
  directives: IllustrationRenderDirectives
}

function resolveFigureGenre(
  explicitGenre?: IllustrationFigureGenre,
  specV2?: IllustrationStructuredSpecV2
): EffectiveFigureGenre {
  if (explicitGenre) return explicitGenre
  if (specV2?.figureGenre) return specV2.figureGenre

  const panelCount = Number(specV2?.panelCount || specV2?.panels?.length || 0)
  const layout = specV2?.layout
  if (layout === 'PANELS' || panelCount >= 2) return 'SCENARIO_STORYBOARD'
  return 'METHOD_BLOCK'
}

function defaultRenderDirectives(genre: EffectiveFigureGenre): IllustrationRenderDirectives {
  const base = {
    fillCanvasPercentMin: 85,
    whitespaceMaxPercent: 15,
    stylePolicy: { noGradients: true, no3D: true, noClipart: true, whiteBackground: true, paletteMode: 'academic_muted' },
  }

  switch (genre) {
    case 'SCENARIO_STORYBOARD':
      return {
        ...base,
        aspectRatio: '2.5:1',
        textPolicy: { maxLabelsTotal: 6, maxWordsPerLabel: 4, forbidAllCaps: true, titlesOnlyPreferred: true },
        compositionPolicy: { layoutMode: 'PANELS', equalPanels: true, noTextOutsidePanels: true }
      }
    case 'NEURAL_ARCHITECTURE':
      return {
        ...base,
        aspectRatio: '4:3',
        textPolicy: { maxLabelsTotal: 15, maxWordsPerLabel: 4, forbidAllCaps: true, titlesOnlyPreferred: false },
        stylePolicy: { ...base.stylePolicy, paletteMode: 'academic_color' },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: false, noTextOutsidePanels: false }
      }
    case 'EXPERIMENTAL_SETUP':
      return {
        ...base,
        aspectRatio: '3:2',
        textPolicy: { maxLabelsTotal: 12, maxWordsPerLabel: 5, forbidAllCaps: true, titlesOnlyPreferred: false },
        stylePolicy: { ...base.stylePolicy, paletteMode: 'academic_color' },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: false, noTextOutsidePanels: false }
      }
    case 'DATA_PIPELINE':
      return {
        ...base,
        aspectRatio: '3:1',
        textPolicy: { maxLabelsTotal: 12, maxWordsPerLabel: 4, forbidAllCaps: true, titlesOnlyPreferred: false },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: false, noTextOutsidePanels: false }
      }
    case 'COMPARISON_MATRIX':
      return {
        ...base,
        aspectRatio: '4:3',
        textPolicy: { maxLabelsTotal: 16, maxWordsPerLabel: 4, forbidAllCaps: true, titlesOnlyPreferred: false },
        stylePolicy: { ...base.stylePolicy, paletteMode: 'academic_color' },
        compositionPolicy: { layoutMode: 'PANELS', equalPanels: true, noTextOutsidePanels: false }
      }
    case 'PROCESS_MECHANISM':
      return {
        ...base,
        aspectRatio: '3:2',
        textPolicy: { maxLabelsTotal: 14, maxWordsPerLabel: 5, forbidAllCaps: true, titlesOnlyPreferred: false },
        stylePolicy: { ...base.stylePolicy, paletteMode: 'academic_color' },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: false, noTextOutsidePanels: false }
      }
    case 'SYSTEM_INTERACTION':
      return {
        ...base,
        aspectRatio: '3:2',
        textPolicy: { maxLabelsTotal: 12, maxWordsPerLabel: 4, forbidAllCaps: true, titlesOnlyPreferred: false },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: false, noTextOutsidePanels: false }
      }
    case 'CONCEPTUAL_FRAMEWORK':
      return {
        ...base,
        aspectRatio: '4:3',
        textPolicy: { maxLabelsTotal: 10, maxWordsPerLabel: 4, forbidAllCaps: true, titlesOnlyPreferred: false },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: false, noTextOutsidePanels: false }
      }
    case 'GRAPHICAL_ABSTRACT':
      return {
        ...base,
        aspectRatio: '16:9',
        textPolicy: { maxLabelsTotal: 10, maxWordsPerLabel: 5, forbidAllCaps: true, titlesOnlyPreferred: false },
        stylePolicy: { ...base.stylePolicy, paletteMode: 'academic_color' },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: false, noTextOutsidePanels: false }
      }
    case 'METHOD_BLOCK':
    default:
      return {
        ...base,
        aspectRatio: '3:1',
        textPolicy: { maxLabelsTotal: 10, maxWordsPerLabel: 4, forbidAllCaps: true, titlesOnlyPreferred: true },
        compositionPolicy: { layoutMode: 'STRIP', equalPanels: true, noTextOutsidePanels: true }
      }
  }
}

function normalizeSketchApiModelCode(modelCode: string): string {
  // Google currently exposes Nano Banana 2 on the public image-generation docs
  // as gemini-3.1-flash-image-preview. Keep the shorter internal code in DB config,
  // but call the documented API model name at runtime.
  if (modelCode === 'gemini-3.1-flash-image') {
    return 'gemini-3.1-flash-image-preview'
  }

  return modelCode
}

function mergeRenderDirectives(
  genre: EffectiveFigureGenre,
  override?: IllustrationRenderDirectives
): IllustrationRenderDirectives {
  const base = defaultRenderDirectives(genre)
  if (!override) return base
  return {
    ...base,
    ...override,
    textPolicy: { ...base.textPolicy, ...(override.textPolicy || {}) },
    stylePolicy: { ...base.stylePolicy, ...(override.stylePolicy || {}) },
    compositionPolicy: { ...base.compositionPolicy, ...(override.compositionPolicy || {}) }
  }
}

function buildEffectiveSketchSpec(
  specV2?: IllustrationStructuredSpecV2,
  explicitGenre?: IllustrationFigureGenre,
  explicitRenderDirectives?: IllustrationRenderDirectives
): EffectiveSketchSpec {
  const genre = resolveFigureGenre(explicitGenre, specV2)
  const directives = mergeRenderDirectives(genre, explicitRenderDirectives || specV2?.renderDirectives)
  return { specV2, genre, directives }
}

export function describeCanvasShape(aspectRatio?: string): string {
  const ratio = parseAspectRatio(aspectRatio)
  if (!ratio) return 'the requested publication canvas'
  if (ratio >= 2.2) return `an ultra-wide canvas matching ${aspectRatio}`
  if (ratio >= 1.65) return `a wide landscape canvas matching ${aspectRatio}`
  if (ratio >= 1.2) return `a landscape canvas matching ${aspectRatio}`
  if (ratio >= 0.9) return `a near-square canvas matching ${aspectRatio}`
  return `a tall portrait canvas matching ${aspectRatio}`
}

export function buildCanvasComplianceRules(directives: IllustrationRenderDirectives): string {
  const aspectRatio = directives.aspectRatio || 'the requested ratio'
  const canvasShape = describeCanvasShape(aspectRatio)
  const fillMin = Number(directives.fillCanvasPercentMin || 85)
  const whitespaceMax = Number(directives.whitespaceMaxPercent || 15)

  return [
    'CANVAS COMPLIANCE RULES (HARD):',
    `- Compose directly for ${canvasShape}.`,
    `- Final composition must visually match aspect ratio ${aspectRatio}; do not output a cinematic, square, or portrait frame when that ratio differs.`,
    `- Main content must occupy at least ${fillMin}% of the canvas and outer whitespace must stay below ${whitespaceMax}%.`,
    '- Do not place a small central illustration inside a larger blank canvas.',
    '- Push the composition to fill the intended width and height with balanced margins.',
    '- If the layout is a horizontal strip or storyboard, extend the content across the full width instead of compressing it into the center.'
  ].join('\n')
}

function buildStyleModeGuidance(style: string): string {
  switch ((style || 'academic').toLowerCase()) {
    case 'scientific':
      return [
        '- Style mode SCIENTIFIC: prioritize domain-faithful structures, precise labels, and rigorous technical clarity over decorative simplification.',
        '- Favor canonical scientific symbols, accurate relative relationships, and restrained annotations that look reviewer-ready.',
        '- If a tradeoff is required, choose scientific fidelity and legibility over stylistic flourish.'
      ].join('\n')
    case 'conceptual':
      return [
        '- Style mode CONCEPTUAL: preserve academic rigor, but use clearer grouping, stronger hierarchy, and cleaner visual storytelling for abstract relationships.',
        '- Make the main conceptual pathway immediately readable, while secondary dependencies stay lighter and quieter.',
        '- Prefer simple, elegant abstractions over literal scene-building or decorative metaphors.'
      ].join('\n')
    case 'technical':
      return [
        '- Style mode TECHNICAL: emphasize exact geometry, clean orthogonal alignment, disciplined spacing, and engineering-diagram precision.',
        '- Use an engineer-like drafting aesthetic with deliberate edge alignment, consistent block sizing, and minimal stylistic variance.',
        '- Prioritize exactness, topology clarity, and crisp schematic order over expressive illustration.'
      ].join('\n')
    case 'academic':
    default:
      return [
        '- Style mode ACADEMIC: restrained, reviewer-friendly, balanced, and conservative in color, typography, and composition.',
        '- Aim for the calm, authoritative look of a final journal figure rather than a conference poster or marketing graphic.',
        '- Keep the composition elegant, disciplined, and easy to parse in a manuscript layout.'
      ].join('\n')
  }
}

export function buildJournalQualityStandards(style: string, directives: IllustrationRenderDirectives): string {
  const textPolicy = directives.textPolicy || {}
  const stylePolicy = directives.stylePolicy || {}
  const compositionPolicy = directives.compositionPolicy || {}

  return [
    'JOURNAL-GRADE QUALITY BAR (HARD):',
    '- The image must look like a final accepted paper figure, not a draft, marketing graphic, poster, or slide.',
    '- Communicate one dominant scientific message immediately; every element must support that message.',
    '- Use a strict alignment grid with even gutters, consistent spacing, and deliberate grouping of related elements.',
    '- Keep stroke weights, corner radii, arrowheads, icon style, and visual rhythm consistent across the entire figure.',
    '- Create clear visual hierarchy: primary pathway or contribution darkest/most prominent, secondary context lighter and quieter.',
    '- Apply color semantically and sparingly. Similar concepts should share color families; decorative rainbow coloring is forbidden.',
    '- Use a restrained, color-blind-safe academic palette and ensure the figure still reads clearly if printed small or viewed in grayscale.',
    `- Typography must be minimal, high-contrast, and legible: max ${textPolicy.maxLabelsTotal || 'few'} labels, max ${textPolicy.maxWordsPerLabel || 4} words per label, no crowded or overlapping text.`,
    '- Labels must sit close to the structures they describe; avoid long floating callouts, tangled leader lines, and annotation crossings.',
    '- Avoid visual clutter, redundant symbols, repeated labels, ornamental icons, glossy effects, gradients, mock-3D, or cartoon styling.',
    '- Use subtle separators only: pale grouping tints, thin divider rules, and light neutral backgrounds. Avoid heavy black borders unless structurally necessary.',
    '- Use white or near-white background with crisp separation between panels, blocks, arrows, and annotations.',
    '- The composition must survive reduction to a typical journal column/page figure size without losing legibility or hierarchy.',
    '- Every panel, block, and annotation should feel intentionally placed; avoid accidental empty pockets, cramped corners, or inconsistent padding.',
    `- Composition mode: ${compositionPolicy.layoutMode || 'auto'}, equalPanels=${String(compositionPolicy.equalPanels ?? false)}, noTextOutsidePanels=${String(compositionPolicy.noTextOutsidePanels ?? false)}.`,
    `- Palette mode: ${stylePolicy.paletteMode || 'academic_muted'} with semantically consistent accents only.`,
    buildStyleModeGuidance(style),
    '- Before finalizing, self-check: would this look credible in a Nature, IEEE, Elsevier, or Springer paper without manual redesign?'
  ].join('\n')
}

/**
 * Build system prompt for genre-specific academic illustrations.
 * Each genre produces publication-grade scientific figures matching Q1 journal expectations.
 */
function buildSystemPrompt(
  genre: EffectiveFigureGenre,
  style: string = 'academic',
  directives?: IllustrationRenderDirectives
): string {
  const d = mergeRenderDirectives(genre, directives)
  const textPolicy = d.textPolicy || {}
  const stylePolicy = d.stylePolicy || {}

  const commonRules = `GLOBAL STYLE RULES:
- Publication-grade scientific illustration for Q1 journals (Nature, IEEE, Elsevier, Springer)
- Clean vector-style rendering with precise geometric shapes and sharp edges
- White or very light background; no photorealism, no 3D effects, no clip art
- Muted academic color palette: navy (#1F77B4), orange (#F28E2B), teal (#2CA02C), slate (#4E4E4E), coral (#E15759)
- Prefer color-blind-safe semantic color use and maintain clarity in grayscale or low-saturation print settings
- All text must be legible at the output resolution -- minimum ~10pt equivalent
- No figure numbers, no title overlays, no captions, no watermarks on the image
- If a figure title/focus is provided, use it only to guide composition and content. Never draw that title as text on the image.
- Use the same visual language across the whole figure: one icon family, one stroke system, one spacing rhythm, one annotation style
- Favor elegant scientific restraint over visual novelty; the result should feel editorial, deliberate, and camera-ready
- Aspect ratio target: ${d.aspectRatio}; fill >= ${d.fillCanvasPercentMin}%, whitespace <= ${d.whitespaceMaxPercent}%
- Text: max ${textPolicy.maxLabelsTotal} labels, max ${textPolicy.maxWordsPerLabel} words per label, no all-caps
- Generate ONLY an image with no accompanying text explanation`

  const canvasRules = buildCanvasComplianceRules(d)
  const qualityBar = buildJournalQualityStandards(style, d)

  const genrePrompts: Record<string, string> = {
    'METHOD_BLOCK': `You are an expert scientific illustrator generating a METHOD_BLOCK figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Show a left-to-right or top-to-bottom pipeline/workflow with modular rectangular blocks
- Connect blocks with clean directional arrows showing data/process flow
- Group related blocks with subtle background shading (light blue, light orange, light gray)
- Each block has a short title label (2-4 words) centered inside
- Use consistent block sizing; slight variations allowed for emphasis
- Annotation arrows or dashed lines for optional/feedback paths
- No people, no scenario illustrations; purely schematic
- Pattern: Input -> Processing stages -> Output/Evaluation`,

    'SCENARIO_STORYBOARD': `You are an expert scientific illustrator generating a SCENARIO_STORYBOARD figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Show 3 equal-width panels in a wide landscape strip composition
- Each panel depicts one stage of a real-world usage scenario
- Use simplified human silhouettes (non-identifying) or device outlines where relevant
- One short label per panel (2-3 words max)
- Panels separated by thin vertical dividers or subtle spacing
- Show temporal/causal flow from left to right
- No decorative elements; functional illustration only`,

    'NEURAL_ARCHITECTURE': `You are an expert scientific illustrator generating a NEURAL_ARCHITECTURE figure for a deep learning research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Show the network architecture as stacked layers flowing left-to-right or top-to-bottom
- Represent layers as labeled rectangles, trapezoids, or 3D cuboids (depth-stacked, flat perspective)
- Include tensor dimension annotations where relevant (e.g., "256x256", "512-d")
- Use color coding to distinguish layer types: convolution (blue), pooling (orange), FC (green), attention (purple), normalization (gray)
- Show skip connections and residual paths as curved arrows or dashed lines
- Include activation functions or operations as small rounded labels on connections
- Mark input/output tensors with their shapes
- Maintain architectural accuracy: layer ordering, connection patterns, and data flow must be correct
- This is a technical schematic, not an artistic rendering`,

    'EXPERIMENTAL_SETUP': `You are an expert scientific illustrator generating an EXPERIMENTAL_SETUP figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Show the physical or logical experimental arrangement as a schematic diagram
- Use simplified iconic representations of equipment, sensors, devices, and data collection points
- Label each component clearly with 2-4 word descriptors
- Show data flow paths, signal paths, or physical connections with labeled arrows
- Include measurement parameters and key specifications as small annotations
- Use dashed boxes to group subsystems (e.g., "Data Acquisition", "Processing Unit", "Display")
- Maintain spatial relationships that reflect the actual experimental configuration
- Include dimensions, distances, or configuration parameters where relevant
- No photorealistic equipment; use clean schematic symbols`,

    'DATA_PIPELINE': `You are an expert scientific illustrator generating a DATA_PIPELINE figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Show an end-to-end data processing pipeline as a horizontal strip
- Each stage is a rounded rectangle with a short label and optional icon
- Show data transformations between stages with labeled arrows (e.g., "filter", "encode", "aggregate")
- Include sample counts, data dimensions, or percentages at key points
- Use color to distinguish pipeline phases: collection (blue), preprocessing (orange), analysis (green), output (gray)
- Show parallel branches where processing splits and merges
- Include data format indicators (CSV, JSON, tensor shapes) at stage boundaries
- Highlight the key transformation steps that are novel or methodologically important`,

    'COMPARISON_MATRIX': `You are an expert scientific illustrator generating a COMPARISON_MATRIX figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Create a structured grid or matrix comparing methods, models, or approaches
- Rows represent different methods/systems; columns represent evaluation criteria or features
- Use checkmarks, X marks, circles, or color-coded cells to indicate support/performance
- Include a clear header row and header column with short descriptive labels
- Optionally include a small legend for the cell notation system
- Keep the grid clean and evenly spaced with consistent cell sizes
- Can also show side-by-side visual comparisons of outputs with labeled panels
- Focus on making the comparison instantly readable and scannable`,

    'PROCESS_MECHANISM': `You are an expert scientific illustrator generating a PROCESS_MECHANISM figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Illustrate a scientific process, mechanism, or phenomenon step-by-step
- Use numbered stages with descriptive labels showing causal or temporal progression
- Include relevant scientific symbols, molecular structures, waveforms, or domain-specific icons
- Show input conditions on the left, transformation in the center, output/results on the right
- Use arrows to indicate direction of process, energy transfer, information flow, or material movement
- Include key parameters, variables, or equations as small annotations near relevant stages
- Use color to distinguish different substances, signals, or phases in the process
- Suitable for biological pathways, chemical reactions, signal processing chains, or physical phenomena`,

    'SYSTEM_INTERACTION': `You are an expert scientific illustrator generating a SYSTEM_INTERACTION figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Show multiple systems, services, or components and their interactions
- Each system is a distinct labeled block with clear boundaries
- Arrows between systems show APIs, protocols, data exchange, or communication patterns
- Label arrows with protocol names, data types, or interaction descriptions
- Use swimlanes or spatial grouping to show system boundaries (cloud, edge, on-device)
- Include databases as cylinder shapes, queues as parallelograms where relevant
- Show both request and response paths where bidirectional
- Maintain a clean topology that reflects the actual system architecture`,

    'CONCEPTUAL_FRAMEWORK': `You are an expert scientific illustrator generating a CONCEPTUAL_FRAMEWORK figure for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Show the theoretical framework or conceptual model underlying the research
- Use boxes, circles, and labeled arrows to represent concepts and their relationships
- Hierarchical layout: foundational concepts at the bottom, derived concepts above
- Show causal relationships, dependencies, and feedback loops with different arrow styles
- Include key variables, constructs, or dimensions as labeled nodes
- Use subtle color coding to group related concepts (e.g., independent vs dependent variables)
- Maintain academic rigor: every arrow represents a theorized relationship
- Suitable for theoretical papers, systematic reviews, or framework proposals`,

    'GRAPHICAL_ABSTRACT': `You are an expert scientific illustrator generating a GRAPHICAL_ABSTRACT for a research paper.

${commonRules}
${canvasRules}
${qualityBar}

GENRE-SPECIFIC RULES:
- Create a single wide-format visual summary of the entire paper
- Layout: left third shows the problem/input, center shows the method/approach, right third shows results/impact
- Use a mix of simplified icons, small charts/graphs, and short text labels
- Include the key finding or metric prominently (e.g., "92% accuracy", "3x faster")
- Keep the visual flow clearly left-to-right with connecting arrows
- Use the full academic color palette for visual distinction between sections
- Must be self-explanatory: a reader should understand the paper's contribution at a glance
- No dense text; every element serves a communicative purpose`
  }

  return genrePrompts[genre] || genrePrompts['METHOD_BLOCK']
}

/**
 * Convert deterministic illustration specs into prompt text for Gemini.
 */
function buildIllustrationSpecBlock(effective: EffectiveSketchSpec): string {
  const spec = effective.specV2
  if (!spec) {
    return `ILLUSTRATION SPEC: none provided.
- figureGenre: ${effective.genre}
- fallback layout: ${effective.genre === 'SCENARIO_STORYBOARD' ? 'PANELS (3 panels)' : 'STRIP (5-7 blocks)'}`
  }

  const panels = Array.isArray(spec.panels)
    ? spec.panels.slice(0, 6).map((panel, idx) => (
        `${idx + 1}. ${panel.title || `Panel ${idx + 1}`} | elements: ${(panel.elements || []).join(', ') || 'n/a'}`
      )).join('\n')
    : 'none'
  const steps = Array.isArray(spec.steps) ? spec.steps.slice(0, 8).join(' -> ') : 'none'
  const elements = Array.isArray(spec.elements) ? spec.elements.slice(0, 12).join(', ') : 'none'
  const actors = Array.isArray((effective.specV2 as any)?.actors) ? (effective.specV2 as any).actors.join(', ') : 'none'
  const props = Array.isArray((effective.specV2 as any)?.props) ? (effective.specV2 as any).props.join(', ') : 'none'
  const forbidden = Array.isArray((effective.specV2 as any)?.forbiddenElements) ? (effective.specV2 as any).forbiddenElements.join(', ') : 'none'

  return `
ILLUSTRATION SPEC (follow deterministically):
- figureGenre: ${effective.genre}
- layout: ${spec.layout || (effective.genre === 'SCENARIO_STORYBOARD' ? 'PANELS' : 'STRIP')}
- panelCount: ${spec.panelCount || 'n/a'}
- stepCount: ${spec.stepCount || 'n/a'}
- flowDirection: ${spec.flowDirection || 'LR'}
- globalElements: ${elements}
- steps: ${steps}
- panels:
${panels}
- actors: ${actors}
- props: ${props}
- forbiddenElements: ${forbidden}
- captionDraft: ${spec.captionDraft || 'n/a'}

RENDER DIRECTIVES (hard):
- aspectRatio: ${effective.directives.aspectRatio}
- fillCanvasPercentMin: ${effective.directives.fillCanvasPercentMin}
- whitespaceMaxPercent: ${effective.directives.whitespaceMaxPercent}
- textPolicy: maxLabelsTotal=${effective.directives.textPolicy?.maxLabelsTotal}, maxWordsPerLabel=${effective.directives.textPolicy?.maxWordsPerLabel}, forbidAllCaps=${effective.directives.textPolicy?.forbidAllCaps}, titlesOnlyPreferred=${effective.directives.textPolicy?.titlesOnlyPreferred}
- stylePolicy: noGradients=${effective.directives.stylePolicy?.noGradients}, no3D=${effective.directives.stylePolicy?.no3D}, noClipart=${effective.directives.stylePolicy?.noClipart}, whiteBackground=${effective.directives.stylePolicy?.whiteBackground}, paletteMode=${effective.directives.stylePolicy?.paletteMode}
- compositionPolicy: layoutMode=${effective.directives.compositionPolicy?.layoutMode}, equalPanels=${effective.directives.compositionPolicy?.equalPanels}, noTextOutsidePanels=${effective.directives.compositionPolicy?.noTextOutsidePanels}
`.trim()
}

function buildGenreReminder(genre: EffectiveFigureGenre): string {
  const reminders: Record<string, string> = {
    'METHOD_BLOCK': 'GENRE: Method block/pipeline schematic. Modular blocks with directional arrows. No people. Short title labels only.',
    'SCENARIO_STORYBOARD': 'GENRE: Scenario storyboard (3 equal panels). Silhouettes allowed. One short label per panel max.',
    'NEURAL_ARCHITECTURE': 'GENRE: Neural network architecture diagram. Stacked layers with tensor dimensions, color-coded by layer type. Technical schematic.',
    'EXPERIMENTAL_SETUP': 'GENRE: Experimental setup schematic. Equipment/sensor icons, data flow arrows, measurement annotations. Clean technical diagram.',
    'DATA_PIPELINE': 'GENRE: Data pipeline strip. Horizontal stages with transformation labels, sample counts, and format indicators between stages.',
    'COMPARISON_MATRIX': 'GENRE: Comparison matrix/grid. Methods as rows, criteria as columns, checkmarks/colors for feature support.',
    'PROCESS_MECHANISM': 'GENRE: Scientific process mechanism. Numbered stages, domain-specific symbols, parameter annotations. Causal flow.',
    'SYSTEM_INTERACTION': 'GENRE: System interaction diagram. Distinct system blocks with labeled API/protocol arrows. Topology-accurate.',
    'CONCEPTUAL_FRAMEWORK': 'GENRE: Conceptual framework. Hierarchical layout of theoretical constructs with relationship arrows.',
    'GRAPHICAL_ABSTRACT': 'GENRE: Graphical abstract. Wide-format summary: problem (left) -> method (center) -> results (right). Self-explanatory.'
  }
  return reminders[genre] || reminders['METHOD_BLOCK']
}

/**
 * Build prompt for SUGGEST mode (AI-driven based on context)
 */
function buildSuggestModePrompt(
  context: PaperSketchContextBundle,
  effective: EffectiveSketchSpec,
  title?: string
): string {
  return `
Based on this research paper context, create a render-ready academic figure:

PAPER TITLE: ${context.paperTitle}

ABSTRACT:
${context.abstract || 'Not provided'}

METHODOLOGY:
${context.methodology || 'Not provided'}

KEY CONTENT:
${context.sectionContent || 'Not provided'}

${title ? `FIGURE TITLE/FOCUS: ${title}` : ''}
${buildGenreReminder(effective.genre)}
${buildIllustrationSpecBlock(effective)}
${buildCanvasComplianceRules(effective.directives)}

Create a clean, professional output that:
1. Strictly follows the genre and render directives above
2. Maps to real paper entities (input -> method -> output -> evaluation where applicable)
3. Uses minimal text (no microtext)
4. Uses the provided figure title only as semantic guidance and never renders that title, figure numbering, or caption text on the image
`.trim()
}

/**
 * Build prompt for GUIDED mode (user-directed)
 */
function buildGuidedModePrompt(
  context: PaperSketchContextBundle,
  effective: EffectiveSketchSpec,
  userPrompt: string,
  title?: string
): string {
  return `
Create an academic figure using the user's request and hard rendering rules:

USER REQUEST:
${userPrompt}

${title ? `FIGURE TITLE: ${title}` : ''}
${buildGenreReminder(effective.genre)}
${buildIllustrationSpecBlock(effective)}
${buildCanvasComplianceRules(effective.directives)}

PAPER CONTEXT (for grounding):
- Paper: ${context.paperTitle}
- Abstract: ${context.abstract?.substring(0, 300) || 'Not provided'}...

Apply user intent only if it does not violate genre/render directives.
Avoid tiny text and treat any provided title as semantic guidance only, never as overlaid text on the image.
`.trim()
}

/**
 * Build prompt for REFINE mode (from uploaded image or correction loop)
 */
function buildRefineModePrompt(
  context: PaperSketchContextBundle,
  effective: EffectiveSketchSpec,
  userPrompt?: string,
  modificationRequest?: string
): string {
  const instructions = modificationRequest || userPrompt || 'Refine this sketch for academic publication'

  return `
Refine and improve the provided image/sketch for use in a research paper.

REFINEMENT INSTRUCTIONS:
${instructions}

PAPER CONTEXT:
- Paper: ${context.paperTitle}
- Topic: ${context.abstract?.substring(0, 200) || 'Academic research'}

${buildGenreReminder(effective.genre)}
${buildIllustrationSpecBlock(effective)}
${buildCanvasComplianceRules(effective.directives)}

Please:
1. Enforce the target genre strictly
2. Remove tiny/garbled text; keep labels minimal and structural
3. Remove duplicated blocks/panels and fix alignment
4. Improve clarity and flow arrows
5. Ensure tight composition (fill canvas, low whitespace)
6. Do NOT add figure numbers or overlaid title/caption text; any provided title is guidance only
`.trim()
}

function parseAspectRatio(value?: string): number | null {
  if (!value) return null
  const m = value.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  const left = Number(m[1])
  const right = Number(m[2])
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= 0) return null
  return left / right
}

async function autoCropWhitespace(
  imageBuffer: Buffer,
  imageMimeType: string
): Promise<{
  buffer: Buffer
  mimeType: string
  changed: boolean
  width?: number
  height?: number
  fillPercent?: number
  whitespacePercent?: number
}> {
  try {
    const jimpMod: any = await import('jimp')
    const Jimp = jimpMod.default || jimpMod
    const image = await Jimp.read(imageBuffer)
    const { width, height, data } = image.bitmap
    if (!width || !height) {
      return { buffer: imageBuffer, mimeType: imageMimeType, changed: false }
    }

    const isContentPixel = (r: number, g: number, b: number, a: number): boolean => {
      if (a < 20) return false
      // Treat near-white as background.
      return !(r > 245 && g > 245 && b > 245)
    }

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let contentPixels = 0

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (width * y + x) << 2
        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        const a = data[idx + 3]
        if (!isContentPixel(r, g, b, a)) continue
        contentPixels += 1
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }

    const totalPixels = width * height
    const fillPercent = totalPixels > 0 ? (contentPixels / totalPixels) * 100 : 0
    const whitespacePercent = 100 - fillPercent

    if (maxX < minX || maxY < minY) {
      return { buffer: imageBuffer, mimeType: imageMimeType, changed: false, width, height, fillPercent, whitespacePercent }
    }

    const contentWidth = maxX - minX + 1
    const contentHeight = maxY - minY + 1
    const padX = Math.max(8, Math.round(contentWidth * 0.03))
    const padY = Math.max(8, Math.round(contentHeight * 0.03))
    const cropX = Math.max(0, minX - padX)
    const cropY = Math.max(0, minY - padY)
    const cropW = Math.min(width - cropX, contentWidth + padX * 2)
    const cropH = Math.min(height - cropY, contentHeight + padY * 2)

    // If crop is effectively full image, return original.
    if (cropW >= width * 0.98 && cropH >= height * 0.98) {
      return { buffer: imageBuffer, mimeType: imageMimeType, changed: false, width, height, fillPercent, whitespacePercent }
    }

    const cropped = image.clone().crop(cropX, cropY, cropW, cropH)
    const targetMime = imageMimeType.includes('png') ? Jimp.MIME_PNG : Jimp.MIME_JPEG
    const out = await cropped.getBufferAsync(targetMime)
    const croppedTotalPixels = cropW * cropH
    const croppedFillPercent = croppedTotalPixels > 0 ? (contentPixels / croppedTotalPixels) * 100 : fillPercent
    const croppedWhitespacePercent = 100 - croppedFillPercent

    return {
      buffer: out,
      mimeType: targetMime,
      changed: true,
      width: cropW,
      height: cropH,
      fillPercent: croppedFillPercent,
      whitespacePercent: croppedWhitespacePercent
    }
  } catch (err) {
    console.warn('[PaperSketchService] Auto-crop skipped (jimp unavailable or failed):', err instanceof Error ? err.message : err)
    return { buffer: imageBuffer, mimeType: imageMimeType, changed: false }
  }
}

function evaluateImageQuality(
  metrics: { width?: number; height?: number; fillPercent?: number; whitespacePercent?: number },
  effective: EffectiveSketchSpec
): string[] {
  const issues: string[] = []
  const width = metrics.width || 0
  const height = metrics.height || 0
  const ratio = width > 0 && height > 0 ? width / height : 0
  const targetRatio = parseAspectRatio(effective.directives.aspectRatio || '')
  const fillMin = Number(effective.directives.fillCanvasPercentMin || 85)
  const whitespaceMax = Number(effective.directives.whitespaceMaxPercent || 15)

  if (typeof metrics.fillPercent === 'number' && metrics.fillPercent < fillMin) {
    issues.push(`fill-too-low:${metrics.fillPercent.toFixed(1)}<${fillMin}`)
  }
  if (typeof metrics.whitespacePercent === 'number' && metrics.whitespacePercent > whitespaceMax) {
    issues.push(`whitespace-too-high:${metrics.whitespacePercent.toFixed(1)}>${whitespaceMax}`)
  }
  if (targetRatio && ratio > 0) {
    const ratioDiff = Math.abs(ratio - targetRatio) / targetRatio
    if (ratioDiff > 0.22) {
      issues.push(`aspect-ratio-mismatch:${ratio.toFixed(2)}!=${targetRatio.toFixed(2)}`)
    }
  }

  // Genre-specific aspect ratio heuristics
  const wideGenres = ['SCENARIO_STORYBOARD', 'DATA_PIPELINE', 'METHOD_BLOCK', 'GRAPHICAL_ABSTRACT']
  const squareishGenres = ['NEURAL_ARCHITECTURE', 'COMPARISON_MATRIX', 'CONCEPTUAL_FRAMEWORK', 'EXPERIMENTAL_SETUP', 'PROCESS_MECHANISM', 'SYSTEM_INTERACTION']
  if (wideGenres.includes(effective.genre) && ratio > 0 && ratio < 1.5) {
    issues.push(`genre-mismatch:${effective.genre.toLowerCase()}-not-wide`)
  }
  if (squareishGenres.includes(effective.genre) && ratio > 0 && ratio > 4.0) {
    issues.push(`genre-mismatch:${effective.genre.toLowerCase()}-too-wide`)
  }

  return issues
}

function buildCorrectiveRefineInstructions(
  issues: string[],
  effective: EffectiveSketchSpec
): string {
  const directives = effective.directives
  const genreInstruction = buildGenreReminder(effective.genre)

  return [
    'Correct the generated image while preserving core content.',
    genreInstruction,
    'Remove tiny/garbled text and remove duplicated blocks/panels.',
    'Ensure all labels are legible and properly positioned.',
    `Target aspect ratio: ${directives.aspectRatio}.`,
    `Increase canvas fill to at least ${directives.fillCanvasPercentMin}% and keep whitespace below ${directives.whitespaceMaxPercent}%.`,
    'Tight crop composition and center content.',
    `Detected issues: ${issues.join(', ') || 'n/a'}.`
  ].join(' ')
}

function buildPersistedIllustrationSpecV2(effective: EffectiveSketchSpec): IllustrationStructuredSpecV2 {
  const spec: IllustrationStructuredSpecV2 = { ...(effective.specV2 || {}) }
  const panelGenres: IllustrationFigureGenre[] = ['SCENARIO_STORYBOARD', 'COMPARISON_MATRIX']
  if (!spec.layout) {
    spec.layout = panelGenres.includes(effective.genre) ? 'PANELS' : 'STRIP'
  }
  if (!spec.panelCount && effective.genre === 'SCENARIO_STORYBOARD') {
    spec.panelCount = 3
  }
  if (!spec.panelCount && effective.genre === 'COMPARISON_MATRIX') {
    spec.panelCount = 4
  }
  if (!spec.stepCount) {
    const defaultSteps: Partial<Record<IllustrationFigureGenre, number>> = {
      'METHOD_BLOCK': 5,
      'DATA_PIPELINE': 6,
      'PROCESS_MECHANISM': 5,
      'NEURAL_ARCHITECTURE': 6,
      'GRAPHICAL_ABSTRACT': 4
    }
    if (defaultSteps[effective.genre]) {
      spec.stepCount = defaultSteps[effective.genre]
    }
  }
  spec.figureGenre = effective.genre
  spec.renderDirectives = effective.directives
  return spec
}

/**
 * Generate sketch using Gemini image generation
 */
export async function generateSketchWithGemini(
  systemPrompt: string,
  userPrompt: string,
  modelCandidates: string[],
  inputImage?: { base64: string; mimeType: string },
  tenantId?: string
): Promise<{ success: boolean; imageBase64?: string; imageMimeType?: string; error?: string }> {
  
  // Dynamic import
  const { GoogleGenerativeAI } = require('@google/generative-ai')
  
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    return { success: false, error: 'Google AI API key not configured' }
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const maxRetries = 3
  let lastError = ''

  for (const modelCode of modelCandidates) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const apiModelCode = normalizeSketchApiModelCode(modelCode)
        const isImagenModel = apiModelCode.toLowerCase().includes('imagen')

        const generationConfig: any = isImagenModel ? {} : {
          responseModalities: ["TEXT", "IMAGE"],
        }

        const model = genAI.getGenerativeModel({
          model: apiModelCode,
          generationConfig,
        })

        const fullPrompt = systemPrompt + '\n\n' + userPrompt
        const parts: any[] = [{ text: fullPrompt }]

        // Add input image for REFINE mode
        if (inputImage) {
          console.log(`[PaperSketchService] Including source image for refinement`)
          parts.push({
            inlineData: {
              mimeType: inputImage.mimeType,
              data: inputImage.base64
            }
          })
        }

        if (apiModelCode !== modelCode) {
          console.log(`[PaperSketchService] Calling ${modelCode} via ${apiModelCode} (attempt ${attempt}/${maxRetries})...`)
        } else {
          console.log(`[PaperSketchService] Calling ${modelCode} (attempt ${attempt}/${maxRetries})...`)
        }
        
        const result = await model.generateContent(parts)
        const response = result.response

        const candidates = response.candidates
        if (!candidates || candidates.length === 0) {
          throw new Error('No candidates in response')
        }

        const content = candidates[0].content
        if (!content || !content.parts) {
          throw new Error('No content parts in response')
        }

        // Extract image from response
        for (const part of content.parts) {
          if (part.inlineData && part.inlineData.data) {
            console.log(`[PaperSketchService] Successfully generated image with ${modelCode}`)
            return {
              success: true,
              imageBase64: part.inlineData.data,
              imageMimeType: part.inlineData.mimeType || 'image/png'
            }
          }
        }

        throw new Error('No image data in response')
        
      } catch (err: any) {
        lastError = err.message || 'Unknown error'
        console.warn(`[PaperSketchService] ${modelCode} attempt ${attempt} failed:`, lastError)

        const normalizedError = lastError.toLowerCase()
        const isPermanentPayloadError =
          normalizedError.includes('invalid json payload') ||
          normalizedError.includes('unknown name') ||
          normalizedError.includes('cannot find field')

        if (isPermanentPayloadError) {
          console.warn(`[PaperSketchService] ${modelCode} request shape was rejected by Gemini; trying next fallback model.`)
          break
        }
        
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt))
        }
      }
    }
  }

  return { success: false, error: `Generation failed: ${lastError}` }
}

/**
 * Main entry point for paper sketch generation
 */
export async function generatePaperSketch(
  request: PaperSketchRequest,
  userId: string,
  tenantId?: string
): Promise<PaperSketchResult> {
  const {
    paperId,
    sessionId,
    figureId,
    mode,
    title,
    userPrompt,
    illustrationSpecV2,
    figureGenre,
    renderDirectives,
    uploadedImageBase64,
    uploadedImageMimeType,
    modificationRequest,
    style = 'academic'
  } = request

  // Validate REFINE mode
  if (mode === 'REFINE' && !uploadedImageBase64) {
    return { success: false, error: 'REFINE mode requires an uploaded image' }
  }

  // Build context
  const contextBundle = await buildPaperContextBundle(paperId, sessionId)
  
  // Resolve model
  const modelCandidates = await resolveSketchModelCandidates(tenantId)
  
  if (modelCandidates.length === 0) {
    return {
      success: false,
      error: 'No sketch generation model configured. Please configure PAPER_SKETCH_GENERATION in Super Admin.'
    }
  }

  console.log(`[PaperSketchService] Using model: ${modelCandidates[0]}`)

  const effective = buildEffectiveSketchSpec(
    illustrationSpecV2,
    figureGenre,
    renderDirectives
  )
  const persistedSpecV2 = buildPersistedIllustrationSpecV2(effective)
  const systemPrompt = buildSystemPrompt(effective.genre, style, effective.directives)

  if (mode === 'GUIDED' && !userPrompt?.trim()) {
    return { success: false, error: 'GUIDED mode requires a user prompt' }
  }

  let basePrompt: string
  switch (mode) {
    case 'SUGGEST':
      basePrompt = buildSuggestModePrompt(contextBundle, effective, title)
      break
    case 'GUIDED':
      basePrompt = buildGuidedModePrompt(contextBundle, effective, userPrompt || '', title)
      break
    case 'REFINE':
      basePrompt = buildRefineModePrompt(contextBundle, effective, userPrompt, modificationRequest)
      break
    default:
      return { success: false, error: `Unknown mode: ${mode}` }
  }

  // Prepare input image if present
  let inputImage: { base64: string; mimeType: string } | undefined
  if (mode === 'REFINE' && uploadedImageBase64 && uploadedImageMimeType) {
    inputImage = {
      base64: uploadedImageBase64,
      mimeType: uploadedImageMimeType
    }
  } else if (mode === 'REFINE' && uploadedImageBase64) {
    inputImage = {
      base64: uploadedImageBase64,
      mimeType: 'image/png'
    }
  }

  let workingPrompt = basePrompt
  let workingInputImage = inputImage
  let finalImageBuffer: Buffer | undefined
  let finalMimeType = 'image/png'
  let qualityFlags: string[] = []
  let attemptCount = 0

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    attemptCount = attempt
    const genResult = await generateSketchWithGemini(
      systemPrompt,
      workingPrompt,
      modelCandidates,
      workingInputImage,
      tenantId
    )
    if (!genResult.success || !genResult.imageBase64) {
      return { success: false, error: genResult.error || 'Image generation failed', attemptCount }
    }

    const rawMimeType = genResult.imageMimeType || 'image/png'
    const rawBuffer = Buffer.from(genResult.imageBase64, 'base64')
    const cropped = await autoCropWhitespace(rawBuffer, rawMimeType)

    finalImageBuffer = cropped.buffer
    finalMimeType = cropped.mimeType || rawMimeType
    qualityFlags = evaluateImageQuality(cropped, effective)

    if (qualityFlags.length === 0 || attempt >= MAX_GENERATION_ATTEMPTS) {
      break
    }

    const correctiveInstructions = buildCorrectiveRefineInstructions(qualityFlags, effective)
    console.log(`[PaperSketchService] Quality issues detected (${qualityFlags.join(', ')}). Running corrective refine attempt ${attempt + 1}/${MAX_GENERATION_ATTEMPTS}.`)
    workingPrompt = buildRefineModePrompt(contextBundle, effective, userPrompt, correctiveInstructions)
    workingInputImage = {
      base64: finalImageBuffer.toString('base64'),
      mimeType: finalMimeType
    }
  }

  if (!finalImageBuffer) {
    return { success: false, error: 'Image generation failed', attemptCount }
  }

  // Save image to disk
  try {
    const uploadDir = path.join(process.cwd(), SKETCH_UPLOAD_DIR)
    await fs.mkdir(uploadDir, { recursive: true })

    const extension = finalMimeType.includes('png') ? 'png' : 'jpg'
    const filename = `sketch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`
    const filePath = path.join(uploadDir, filename)
    
    await fs.writeFile(filePath, finalImageBuffer)

    const publicPath = `/uploads/paper-sketches/${filename}`
    console.log(`[PaperSketchService] Saved sketch to: ${publicPath}`)

    // Update or create figure plan
    let resultFigureId = figureId

    if (figureId) {
      // Update existing figure
      const existing = await prisma.figurePlan.findUnique({
        where: { id: figureId }
      })
      
      if (existing) {
        const existingNodes = (existing.nodes as any) || {}
        await prisma.figurePlan.update({
          where: { id: figureId },
          data: {
            nodes: {
              ...existingNodes,
              caption: (typeof existingNodes.caption === 'string' && existingNodes.caption.trim())
                ? existingNodes.caption
                : (persistedSpecV2.captionDraft || undefined),
              generationPrompt: userPrompt || existingNodes.generationPrompt || undefined,
              status: 'GENERATED',
              imagePath: publicPath,
              sketchMode: mode,
              figureGenre: effective.genre,
              renderDirectives: effective.directives,
              illustrationSpecV2: persistedSpecV2,
              qualityFlags,
              attemptCount,
              generatedAt: new Date().toISOString()
            } as any
          }
        })
      }
    } else {
      // Create new figure plan
      const maxFigureNo = await prisma.figurePlan.aggregate({
        where: { sessionId },
        _max: { figureNo: true }
      })
      
      const newFigureNo = (maxFigureNo._max.figureNo || 0) + 1
      
      const initialCaption = persistedSpecV2.captionDraft || ''
      const newFigure = await prisma.figurePlan.create({
        data: {
          sessionId,
          figureNo: newFigureNo,
          title: title || `Sketch ${newFigureNo}`,
          description: initialCaption,
          nodes: {
            status: 'GENERATED',
            category: 'ILLUSTRATED_FIGURE',
            figureType: 'sketch',
            caption: initialCaption,
            generationPrompt: userPrompt || undefined,
            imagePath: publicPath,
            sketchMode: mode,
            figureGenre: effective.genre,
            renderDirectives: effective.directives,
            illustrationSpecV2: persistedSpecV2,
            qualityFlags,
            attemptCount,
            generatedAt: new Date().toISOString()
          } as any,
          edges: [] // Required field - empty array for sketches
        }
      })
      
      resultFigureId = newFigure.id
    }

    return {
      success: true,
      figureId: resultFigureId,
      imagePath: publicPath,
      attemptCount,
      qualityFlags
    }

  } catch (saveError: any) {
    console.error('[PaperSketchService] Failed to save image:', saveError)
    return { success: false, error: `Failed to save image: ${saveError.message}` }
  }
}

/**
 * Modify an existing sketch with user feedback
 */
export async function modifyPaperSketch(
  figureId: string,
  modificationRequest: string,
  userId: string,
  tenantId?: string
): Promise<PaperSketchResult> {
  // Get existing figure - FigurePlan relates to DraftingSession
  const figure = await prisma.figurePlan.findUnique({
    where: { id: figureId }
  })

  if (!figure) {
    return { success: false, error: 'Figure not found' }
  }

  const nodes = (figure.nodes as any) || {}
  const existingImagePath = nodes.imagePath

  if (!existingImagePath) {
    return { success: false, error: 'No existing image to modify' }
  }

  // Read existing image
  let imageBase64: string
  let imageMimeType: string

  try {
    const relativeImagePath = existingImagePath.startsWith('/')
      ? existingImagePath.slice(1)
      : existingImagePath
    const fullPath = path.join(process.cwd(), 'public', relativeImagePath)
    const imageBuffer = await fs.readFile(fullPath)
    imageBase64 = imageBuffer.toString('base64')
    imageMimeType = existingImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'
  } catch (err) {
    return { success: false, error: 'Could not read existing image' }
  }

  const generationPrompt = getPaperFigureGenerationPrompt((nodes as Record<string, unknown>) || {}, figure.description || '')
  const storedSpecV2 = (nodes.illustrationSpecV2 as IllustrationStructuredSpecV2 | undefined)
  const storedGenre = (nodes.figureGenre as IllustrationFigureGenre | undefined)
  const storedDirectives = (nodes.renderDirectives as IllustrationRenderDirectives | undefined)

  // Generate modified sketch
  return generatePaperSketch({
    paperId: figure.sessionId,
    sessionId: figure.sessionId,
    figureId,
    mode: 'REFINE',
    title: figure.title,
    userPrompt: generationPrompt || undefined,
    illustrationSpecV2: storedSpecV2,
    figureGenre: storedGenre,
    renderDirectives: storedDirectives,
    uploadedImageBase64: imageBase64,
    uploadedImageMimeType: imageMimeType,
    modificationRequest,
    style: 'academic'
  }, userId, tenantId)
}

