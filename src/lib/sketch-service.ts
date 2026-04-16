/**
 * Sketch Generation Service
 * 
 * Handles AI-powered sketch generation for patent figures using Gemini 3 (gemini-3-pro-image-preview).
 * Supports three modes: AUTO, GUIDED, and REFINE.
 * 
 * Key Features:
 * - Patent-style black-and-white line art generation
 * - Context-aware generation from invention data
 * - Multi-view support (combined or separate sketches)
 * - Modification chains with version tracking
 * - Anti-hallucination prompting
 * 
 * LLM Gateway Integration:
 * - Uses gateway for policy/quota enforcement (DIAGRAM_GENERATION feature)
 * - Uses gateway for model resolution (plan-configured models)
 * - Records usage through gateway metering system
 */

import { prisma } from './prisma'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { resolveModel } from '@/lib/metering/model-resolver'
import { llmGateway } from '@/lib/metering/gateway'
import { createMeteringSystem } from '@/lib/metering/system'
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge'
import type { TaskCode, FeatureCode } from '@prisma/client'

// Types
export type SketchMode = 'AUTO' | 'GUIDED' | 'REFINE'
export type SketchStatus = 'SUGGESTED' | 'PENDING' | 'SUCCESS' | 'FAILED'

export interface SketchContextFlags {
  useIdeaSummary?: boolean
  useClaims?: boolean
  useDiagrams?: boolean
  useComponents?: boolean
}

export interface SketchViewConfig {
  combinedView?: boolean
  separateViews?: string[] // e.g., ['top', 'front', 'side']
}

export interface SketchGenerationRequest {
  patentId: string
  sessionId?: string
  mode: SketchMode
  title?: string
  userPrompt?: string
  contextFlags?: SketchContextFlags
  viewsRequested?: SketchViewConfig
  sourceSketchId?: string // For REFINE mode or modification chains
  uploadedImageBase64?: string // For REFINE mode
  uploadedImageMimeType?: string
  language?: string // Primary language for labels/annotations (from Stage 0)
}

export interface SketchContextBundle {
  ideaSummary: string
  keyComponents: string[]
  claims: string[]
  diagramSummaries: string[]
  referenceNumerals: Record<string, string>
  inventionType: string
  language: string // Primary language for labels/annotations
}

export interface SketchGenerationResult {
  success: boolean
  sketchId?: string
  imagePath?: string
  imageUrl?: string
  error?: string
  attemptCount?: number
}

// Constants
const SKETCH_UPLOAD_DIR = 'public/uploads/sketches'
const MAX_MODIFY_ATTEMPTS = 10

// ============================================================================
// IMAGE GENERATION MODEL CONFIGURATION
// ============================================================================
// Model selection is controlled ENTIRELY through the Super Admin LLM Config panel.
// No hardcoded fallbacks - if model resolution fails, we fail with a clear error.
//
// Configure the sketch generation model in Super Admin → LLM Config:
// - Select your Plan
// - Find "Sketch Generation" stage under PATENT_DRAFTING feature
// - Assign a model that supports image OUTPUT (e.g., gemini-3-pro-image-preview)
//
// IMPORTANT: Only specific models support image generation:
// ✓ gemini-3-pro-image-preview (recommended)
// ✓ imagen-3.0-generate-002 (Imagen 3)
// ✗ gemini-2.0-flash, gemini-2.0-flash-exp (text/vision only - NO image output)
// ✗ gemini-2.0-flash-lite (text/vision only - NO image output)
// ============================================================================
const SKETCH_STAGE_CODE = 'DRAFT_SKETCH_GENERATION'
const SKETCH_TASK_CODE: TaskCode = 'LLM3_DIAGRAM' // Closest task for vision + drafting limits

/**
 * Resolve the active plan for a tenant (latest active, non-expired)
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
 * Resolve sketch model from database configuration ONLY.
 * No hardcoded fallbacks - model must be configured in Super Admin LLM Config.
 * 
 * Returns ordered list:
 * 1) Plan-specific stage model (from PlanStageModelConfig)
 * 2) Plan-configured fallbacks (from the same config)
 * 3) Environment override (GEMINI_SKETCH_MODEL) - for development/testing only
 * 
 * If no model is configured, returns empty array - caller should handle gracefully.
 */
async function resolveSketchModelCandidates(tenantId?: string | null): Promise<string[]> {
  const candidates: string[] = []

  try {
    const planId = await getActivePlanIdForTenant(tenantId)
    if (planId) {
      console.log(`[SketchService] Resolving model for planId=${planId}, stage=${SKETCH_STAGE_CODE}`)
      const resolved = await resolveModel(planId, SKETCH_TASK_CODE, SKETCH_STAGE_CODE)
      
      if (resolved?.modelCode) {
        console.log(`[SketchService] Model resolved from DB: ${resolved.modelCode} (source: ${resolved.source})`)
        candidates.push(resolved.modelCode)
        
        // Add plan-configured fallbacks (if any)
        if (resolved.fallbacks && resolved.fallbacks.length > 0) {
          console.log(`[SketchService] Fallbacks from DB: ${resolved.fallbacks.map(f => f.modelCode).join(', ')}`)
          resolved.fallbacks.forEach(fb => {
            if (fb?.modelCode) candidates.push(fb.modelCode)
          })
        }
      } else {
        console.warn(`[SketchService] No model configured for sketch generation in plan ${planId}`)
      }
    } else {
      console.warn(`[SketchService] No active plan found for tenant ${tenantId || 'unknown'}`)
    }
  } catch (e) {
    console.error('[SketchService] Model resolution failed:', e instanceof Error ? e.message : e)
  }

  // Environment override for development/testing (NOT for production)
  if (process.env.GEMINI_SKETCH_MODEL && candidates.length === 0) {
    console.log(`[SketchService] Using env override: ${process.env.GEMINI_SKETCH_MODEL}`)
    candidates.push(process.env.GEMINI_SKETCH_MODEL)
  }

  // NO hardcoded fallbacks - return only what's configured in the database
  // If empty, the caller should fail with a clear error message
  return Array.from(new Set(candidates.filter(Boolean)))
}

function normalizeSketchApiModelCode(modelCode: string): string {
  if (modelCode === 'gemini-3.1-flash-image') {
    return 'gemini-3.1-flash-image-preview'
  }

  return modelCode
}

// === CONTEXT BUNDLE BUILDER ===

/**
 * Builds a context bundle from invention data for sketch generation.
 * This bundle provides the AI with factual information to prevent hallucination.
 */
export async function buildSketchContextBundle(
  patentId: string,
  sessionId: string | undefined,
  flags: SketchContextFlags = { useIdeaSummary: true, useClaims: true, useDiagrams: true, useComponents: true },
  requestedLanguage?: string
): Promise<SketchContextBundle> {
  const bundle: SketchContextBundle = {
    ideaSummary: '',
    keyComponents: [],
    claims: [],
    diagramSummaries: [],
    referenceNumerals: {},
    inventionType: 'GENERAL',
    language: requestedLanguage || 'en'
  }

  // Get session with related data
  const session = sessionId ? await prisma.draftingSession.findUnique({
    where: { id: sessionId },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      annexureDrafts: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  }) : null

  // Extract figures language from session if not explicitly provided
  if (!requestedLanguage && session) {
    const status = (session as any)?.jurisdictionDraftStatus || {}
    if (typeof status.__figuresLanguage === 'string' && status.__figuresLanguage.trim()) {
      bundle.language = status.__figuresLanguage.trim().toLowerCase()
    } else {
      // Fallback to active jurisdiction's language
      const activeJurisdiction = ((session as any)?.activeJurisdiction || '').toUpperCase()
      if (activeJurisdiction && status?.[activeJurisdiction]?.language) {
        bundle.language = status[activeJurisdiction].language
      }
    }
  }

  // 1. Idea Summary
  if (flags.useIdeaSummary && session?.ideaRecord) {
    const idea = session.ideaRecord.normalizedData as any
    bundle.ideaSummary = [
      idea?.title && `Title: ${idea.title}`,
      idea?.problem && `Problem: ${idea.problem}`,
      idea?.objectives && `Objectives: ${idea.objectives}`,
      idea?.logic && `Core Logic: ${idea.logic}`,
      idea?.inputs && `Inputs: ${idea.inputs}`,
      idea?.outputs && `Outputs: ${idea.outputs}`
    ].filter(Boolean).join('\n')

    // Extract invention type
    const types = Array.isArray(idea?.inventionType) 
      ? idea.inventionType 
      : (idea?.inventionType ? [idea.inventionType] : [])
    bundle.inventionType = types.length > 0 ? types.join('+') : 'GENERAL'
  }

  // 2. Key Components from Reference Map
  if (flags.useComponents && session?.referenceMap) {
    const refMap = session.referenceMap.components as any
    if (Array.isArray(refMap)) {
      bundle.keyComponents = refMap.map((c: any) => c.name || c.label || c.component).filter(Boolean)
      // Build reference numerals map
      refMap.forEach((c: any) => {
        if (c.numeral && (c.name || c.label)) {
          bundle.referenceNumerals[c.numeral] = c.name || c.label
        }
      })
    }
  }

  // 3. Claims (independent + few dependent)
  if (flags.useClaims && session?.annexureDrafts?.[0]) {
    const claimsText = session.annexureDrafts[0].claims || ''
    // Extract first 5 claims for context (don't overwhelm)
    const claimMatches = claimsText.match(/\d+\.\s+[^.]+\./g)
    if (claimMatches) {
      bundle.claims = claimMatches.slice(0, 5)
    }
  }

  // 4. Diagram Summaries (titles & descriptions, not full PlantUML)
  if (flags.useDiagrams && session?.figurePlans) {
    bundle.diagramSummaries = session.figurePlans.map((fig: any) => 
      `Figure ${fig.figureNo}: ${fig.title}${fig.description ? ` - ${fig.description}` : ''}`
    )
  }

  return bundle
}

// === PROMPT BUILDERS ===

/**
 * Builds the system role prompt for sketch generation.
 * USPTO/EPO/WIPO-compliant patent line drawing rules with anti-hallucination.
 */
function buildSystemPrompt(): string {
  return `SYSTEM ROLE — USPTO/EPO/WIPO Patent Line Drawing Generator

Generate a USPTO/EPO/WIPO-compliant black-and-white line drawing. Follow ALL rules exactly. Do NOT interpret or add detail beyond the invention description.

═══════════════════════════════════════════════════════════════════════════════
DRAWING RULES (STRICT COMPLIANCE)
═══════════════════════════════════════════════════════════════════════════════
• Solid lines = visible features
• Dashed lines = internal/hidden features ONLY where explicitly specified
• Clean, precise lines suitable for patent filings
• Professional engineering/technical drawing style
• Clear component separation with distinct boundaries
• NO shading, gradients, textures, icons, dimension lines, motion marks, UI elements, or decorative curves

═══════════════════════════════════════════════════════════════════════════════
LABELING RULES (STRICT — NO EXCEPTIONS)
═══════════════════════════════════════════════════════════════════════════════
• ONLY numeric reference labels are allowed (#100, #200, #300, etc.)
• NO alphabetic words or text descriptions may appear ANYWHERE in the drawing
• NO part names, titles, or descriptors in the drawing
• NO figure numbers or "FIG." labels in the drawing
• Each component labeled once per view unless clarity requires repetition
• Labels must NOT overlap geometry — use leader lines to connect labels to components
• Place labels clearly near their corresponding components

═══════════════════════════════════════════════════════════════════════════════
PROHIBITED ELEMENTS (NO EXCEPTIONS)
═══════════════════════════════════════════════════════════════════════════════
❌ Text descriptions or part names
❌ Shading, gradients, or textures
❌ Icons or symbolic representations
❌ Arrows (except as explicit flow indicators when specified)
❌ Dimension lines or measurements
❌ Motion marks or rotation indicators
❌ UI elements or decorative curves
❌ Extra components not in the invention context
❌ Hidden assumptions or inferred mechanical details
❌ Symbolic embellishments
❌ Any element not explicitly described in the invention

═══════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION CONSTRAINTS
═══════════════════════════════════════════════════════════════════════════════
1. Use ONLY components explicitly provided in the invention context
2. Use ONLY reference numerals from the provided numeral list
3. Do NOT invent or add components, features, or structures
4. Do NOT assume internal mechanisms unless explicitly described
5. If information is ambiguous → use simplified block representation
6. When in doubt between detailed and simple → choose SIMPLE + TRUTHFUL

═══════════════════════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
1. MAIN VIEW: Primary assembled view (orientation based on invention context)
2. SECONDARY VIEW: Cross-section, exploded, or alternate view showing internal arrangement
   (Use cross-section if not otherwise specified)

═══════════════════════════════════════════════════════════════════════════════
ENFORCEMENT
═══════════════════════════════════════════════════════════════════════════════
If ANY rule would be violated, simplify the drawing until compliant.
If the invention description is too ambiguous to draw, use simplified block diagram.

═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
✔ Only listed components shown (no extras)
✔ Numeric labels only (#100, #200, etc.)
✔ Two views provided (main + secondary)
✔ Dashed lines used correctly (internal/hidden only)
✔ No forbidden elements present`
}

/**
 * Builds the user prompt for AUTO mode generation.
 */
function buildAutoModePrompt(context: SketchContextBundle, viewConfig?: SketchViewConfig): string {
  // Language labels mapping
  const languageLabels: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    ja: 'Japanese',
    zh: 'Chinese',
    ko: 'Korean',
    de: 'German',
    fr: 'French',
    es: 'Spanish',
    pt: 'Portuguese',
    ru: 'Russian',
    ar: 'Arabic',
    it: 'Italian',
    nl: 'Dutch',
    sv: 'Swedish',
  }
  const languageLabel = languageLabels[context.language] || context.language.toUpperCase()

  let prompt = `Generate a USPTO/EPO/WIPO-compliant patent line drawing for this invention:

═══════════════════════════════════════════════════════════════════════════════
LANGUAGE REQUIREMENT
═══════════════════════════════════════════════════════════════════════════════
PRIMARY LANGUAGE: ${languageLabel} (${context.language})
All labels, descriptions, and annotations in the drawing MUST be in ${languageLabel}.
${context.language !== 'en' ? `Use proper ${languageLabel} characters and terminology. Only use English for standard technical terms with no ${languageLabel} equivalent.` : ''}

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

`

  if (context.keyComponents.length > 0) {
    prompt += `KEY COMPONENTS (use ONLY these):
${context.keyComponents.map((c, i) => `- ${c}`).join('\n')}

`
  }

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `REFERENCE NUMERALS (use ONLY these numbers as labels):
${Object.entries(context.referenceNumerals).map(([num, name]) => `${num} → ${name}`).join('\n')}

IMPORTANT: In the drawing, use ONLY the numeric labels (#100, #200, etc. or as per component numbering provided), NOT the component names.
`
  }

  if (context.claims.length > 0) {
    prompt += `KEY CLAIMS (for structural reference only):
${context.claims.join('\n')}

`
  }

  if (context.diagramSummaries.length > 0) {
    prompt += `EXISTING DIAGRAMS (maintain consistency):
${context.diagramSummaries.join('\n')}

`
  }

  prompt += `INVENTION TYPE: ${context.inventionType}

`

  // View configuration
  if (viewConfig?.separateViews && viewConfig.separateViews.length > 0) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
REQUIRED VIEWS
═══════════════════════════════════════════════════════════════════════════════
Generate these specific views: ${viewConfig.separateViews.join(', ')}
`
  } else if (viewConfig?.combinedView) {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
REQUIRED VIEWS
═══════════════════════════════════════════════════════════════════════════════
Generate a combined multi-view figure showing multiple perspectives in one drawing.
Include: Main assembled view + one secondary view (cross-section, exploded, or alternate angle)
`
  } else {
    prompt += `═══════════════════════════════════════════════════════════════════════════════
REQUIRED VIEWS
═══════════════════════════════════════════════════════════════════════════════
1. MAIN VIEW: Primary assembled view showing the invention's key components and relationships
2. SECONDARY VIEW (if applicable): Cross-section OR exploded view showing internal arrangement
`
  }

  prompt += `
═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
✔ Only listed components shown (no extras)
✔ Numeric labels only (#100, #200, etc.)
✔ Two views provided (main + secondary)
✔ Dashed lines used correctly (internal/hidden only)
✔ No forbidden elements present

If ANY rule would be violated, simplify the drawing until compliant.`

  return prompt
}

/**
 * Builds the user prompt for GUIDED mode generation.
 */
function buildGuidedModePrompt(
  context: SketchContextBundle, 
  userPrompt: string,
  viewConfig?: SketchViewConfig
): string {
  const basePrompt = buildAutoModePrompt(context, viewConfig)
  
  return `${basePrompt}

═══════════════════════════════════════════════════════════════════════════════
USER INSTRUCTIONS (Apply within compliance rules)
═══════════════════════════════════════════════════════════════════════════════
${userPrompt}

═══════════════════════════════════════════════════════════════════════════════
INSTRUCTION PRIORITY (when user requests conflict with rules)
═══════════════════════════════════════════════════════════════════════════════
1. Patent office compliance rules ALWAYS override user preferences
2. Invention context accuracy ALWAYS override aesthetic requests
3. Apply user layout/view preferences ONLY if they don't violate rules

EXAMPLES OF WHAT TO IGNORE:
- User asks for color → Generate black and white only
- User asks for text labels → Use numeric labels only
- User asks for components not in context → Do not add them
- User asks for shading/gradients → Use line art only`
}

/**
 * Builds the language requirement section for sketch prompts.
 * Shared across all prompt modes for consistency.
 */
function buildLanguageRequirementSection(context: SketchContextBundle): string {
  const languageLabels: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    ja: 'Japanese',
    zh: 'Chinese',
    ko: 'Korean',
    de: 'German',
    fr: 'French',
    es: 'Spanish',
    pt: 'Portuguese',
    ru: 'Russian',
    ar: 'Arabic',
    it: 'Italian',
    nl: 'Dutch',
    sv: 'Swedish',
  }
  const languageLabel = languageLabels[context.language] || context.language.toUpperCase()
  
  return `═══════════════════════════════════════════════════════════════════════════════
LANGUAGE REQUIREMENT
═══════════════════════════════════════════════════════════════════════════════
PRIMARY LANGUAGE: ${languageLabel} (${context.language})
All labels, descriptions, and annotations in the drawing MUST be in ${languageLabel}.
${context.language !== 'en' ? `Use proper ${languageLabel} characters and terminology. Only use English for standard technical terms with no ${languageLabel} equivalent.` : ''}
`
}

/**
 * Builds the prompt for REFINE mode (cleaning up uploaded sketches).
 */
function buildRefineModePrompt(
  context: SketchContextBundle,
  userPrompt?: string
): string {
  let prompt = `Interpret and refine this user-uploaded sketch into a USPTO/EPO/WIPO-compliant patent line drawing.

${buildLanguageRequirementSection(context)}
═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT (Source of Truth for components and numerals)
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

`

  if (context.keyComponents.length > 0) {
    prompt += `OFFICIAL COMPONENTS (only these may appear):
${context.keyComponents.map((c, i) => `- ${c}`).join('\n')}

`
  }

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `OFFICIAL REFERENCE NUMERALS (replace any text labels with these):
${Object.entries(context.referenceNumerals).map(([num, name]) => `${num} → ${name}`).join('\n')}

CRITICAL: Convert ALL text labels in the uploaded sketch to numeric-only labels.
`
  }

  prompt += `═══════════════════════════════════════════════════════════════════════════════
REFINEMENT TASKS
═══════════════════════════════════════════════════════════════════════════════
1. Extract the structure and layout from the uploaded sketch
2. Identify components and map them to the official component list
3. REMOVE any components not in the invention context
4. REPLACE all text labels with numeric reference labels only
5. Convert to clean black-and-white line art (no shading/gradients)
6. Apply solid lines for visible features, dashed for internal/hidden
7. Remove any arrows, dimension lines, icons, or decorative elements

═══════════════════════════════════════════════════════════════════════════════
REFINEMENT RULES
═══════════════════════════════════════════════════════════════════════════════
- Preserve the user's intended LAYOUT and SPATIAL ARRANGEMENT
- Correct all labels to numeric-only format
- Remove any non-compliant elements (text, shading, icons)
- If sketch shows unlisted components → REMOVE them (don't invent numerals)
- If sketch is too noisy/unclear → Simplify to core components only
`

  if (userPrompt) {
    prompt += `
═══════════════════════════════════════════════════════════════════════════════
USER REFINEMENT INSTRUCTIONS (apply within compliance rules)
═══════════════════════════════════════════════════════════════════════════════
${userPrompt}
`
  }

  prompt += `
═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
✔ Only listed components shown (no extras)
✔ Numeric labels only (#100, #200, etc. or as per component numbering provided)
✔ Clean line art (no shading, gradients, textures)
✔ Dashed lines used correctly (internal/hidden only)
✔ No forbidden elements present`

  return prompt
}

/**
 * Builds the prompt for MODIFY operations.
 */
function buildModifyPrompt(
  context: SketchContextBundle,
  modifyInstructions: string,
  originalSketchTitle?: string,
  originalSketchDescription?: string
): string {
  let prompt = `Modify this existing patent sketch while maintaining USPTO/EPO/WIPO compliance.

═══════════════════════════════════════════════════════════════════════════════
ORIGINAL SKETCH INFO
═══════════════════════════════════════════════════════════════════════════════
Title: ${originalSketchTitle || 'Untitled'}
${originalSketchDescription ? `Description: ${originalSketchDescription}` : ''}

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT (Source of Truth - must remain accurate)
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

`

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `REFERENCE NUMERALS (use ONLY these numeric labels):
${Object.entries(context.referenceNumerals).map(([num, name]) => `${num} → ${name}`).join('\n')}

`
  }

  prompt += `═══════════════════════════════════════════════════════════════════════════════
MODIFICATION INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════════════
${modifyInstructions}

═══════════════════════════════════════════════════════════════════════════════
MODIFICATION RULES
═══════════════════════════════════════════════════════════════════════════════
✓ PRESERVE: Reference numerals from context
✓ PRESERVE: Essential invention components
✓ APPLY: Only the requested modifications
✓ OUTPUT: New clean sketch (not overlay on original)

✗ DO NOT: Add components not in invention context
✗ DO NOT: Remove components essential to the invention
✗ DO NOT: Add text labels (numeric only)
✗ DO NOT: Add shading, gradients, icons, or arrows
✗ DO NOT: Misrepresent the invention structure

═══════════════════════════════════════════════════════════════════════════════
IF MODIFICATION CONFLICTS WITH COMPLIANCE
═══════════════════════════════════════════════════════════════════════════════
If the requested modification would violate patent drawing rules:
1. Apply the closest compliant alternative
2. Maintain invention accuracy over user aesthetic preference
3. When in doubt, make minimal changes to preserve compliance`

  return prompt
}

// === GEMINI IMAGE GENERATION WITH GATEWAY INTEGRATION ===

// Response type for sketch generation - simplified, no metadata extraction
export interface SketchGenerationResponse {
  success: boolean
  imageBase64?: string
  error?: string
  tokensUsed?: number
  modelUsed?: string
  reservationId?: string
}

/**
 * Enforce sketch generation access through LLM Gateway.
 * This checks DIAGRAM_GENERATION feature access, quota, and creates a reservation.
 * 
 * @returns Enforcement decision with reservation ID if allowed, or error if denied
 */
async function enforceSketchAccess(
  tenantId: string | undefined,
  userId: string | undefined
): Promise<{ allowed: true; reservationId: string; modelCode?: string } | { allowed: false; error: string }> {
  if (!tenantId) {
    // No tenant context - allow but warn (for backwards compatibility)
    console.warn('[SketchService] No tenant context - skipping gateway enforcement')
    return { allowed: true, reservationId: '' }
  }

  try {
    const meteringSystem = createMeteringSystem()
    
    // Create feature request for DIAGRAM_GENERATION
    const featureRequest = {
      tenantId,
      featureCode: 'DIAGRAM_GENERATION' as FeatureCode,
      taskCode: SKETCH_TASK_CODE,
      userId,
      metadata: {
        idempotencyKey: `sketch-${Date.now()}-${crypto.randomUUID()}`
      }
    }

    // Evaluate access through policy service
    const decision = await meteringSystem.policy.evaluateAccess(featureRequest)

    if (!decision.allowed) {
      console.warn(`[SketchService] Access denied: ${decision.reason}`)
      return { 
        allowed: false, 
        error: decision.reason || 'Sketch generation not available for your plan'
      }
    }

    console.log(`[SketchService] Access granted - reservation: ${decision.reservationId}`)
    return { 
      allowed: true, 
      reservationId: decision.reservationId || '',
      modelCode: decision.modelClass as string | undefined
    }
  } catch (error) {
    console.error('[SketchService] Gateway enforcement error:', error)
    // On error, allow access (fail open) - the actual API call may still fail
    return { allowed: true, reservationId: '' }
  }
}

/**
 * Record sketch generation usage through the metering system.
 */
async function recordSketchUsage(
  reservationId: string,
  tokensUsed: number,
  modelCode: string,
  userId?: string
): Promise<void> {
  if (!reservationId) return // No reservation to record against

  try {
    const meteringSystem = createMeteringSystem()
    await meteringSystem.metering.recordUsage(reservationId, {
      inputTokens: Math.ceil(tokensUsed * 0.3), // Estimate: 30% input
      outputTokens: Math.ceil(tokensUsed * 0.7), // Estimate: 70% output (image)
      modelClass: modelCode as any,
      apiCalls: 1,
      metadata: {
        service: 'sketch-generation',
        stageCode: SKETCH_STAGE_CODE
      }
    }, userId)
    console.log(`[SketchService] Usage recorded: ${tokensUsed} tokens for reservation ${reservationId}`)
  } catch (error) {
    console.error('[SketchService] Failed to record usage:', error)
    // Don't fail the sketch generation if usage recording fails
  }
}

/**
 * Generates a sketch using Gemini image generation with retry logic.
 * 
 * GATEWAY INTEGRATION:
 * - Enforces DIAGRAM_GENERATION feature access before API call
 * - Uses plan-configured model from model resolver
 * - Records usage through metering system after successful generation
 * 
 * IMAGE GENERATION APPROACH:
 * - Primary: Use Gemini models with native image generation (responseModalities: ['Image', 'Text'])
 * - The model must support image OUTPUT (not just vision input)
 * - Currently supported: gemini-2.0-flash-exp-image-generation, imagen-3.0-generate-*
 * 
 * @param systemPrompt - System instructions for the model
 * @param userPrompt - User-provided prompt/instructions
 * @param modelCandidates - Ordered list of models to try (from model resolver)
 * @param inputImage - Optional input image for REFINE/MODIFY modes
 * @param gatewayContext - Tenant and user IDs for gateway enforcement
 */
export async function generateSketchWithGemini(
  systemPrompt: string,
  userPrompt: string,
  modelCandidates: string[],
  inputImage?: { base64: string; mimeType: string },
  gatewayContext?: { tenantId?: string; userId?: string }
): Promise<SketchGenerationResponse> {
  // 1. Enforce access through LLM Gateway
  const accessCheck = await enforceSketchAccess(
    gatewayContext?.tenantId,
    gatewayContext?.userId
  )
  
  if (!accessCheck.allowed) {
    return { success: false, error: accessCheck.error }
  }
  
  const reservationId = accessCheck.reservationId

  // Dynamic import to avoid client-side issues
  const { GoogleGenerativeAI } = require('@google/generative-ai')
  
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    return { success: false, error: 'Google AI API key not configured. Set GOOGLE_AI_API_KEY in .env' }
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  
  // Retry logic with exponential backoff per model candidate
  const maxRetries = 3
  let lastError: string = ''
  
  for (const modelCode of modelCandidates) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const apiModelCode = normalizeSketchApiModelCode(modelCode)
        // Determine generation config based on model type
        // Imagen models use different config than Gemini models
        const isImagenModel = apiModelCode.toLowerCase().includes('imagen')
        
        // For Gemini Nano Banana Pro image generation
        // Reference: https://ai.google.dev/gemini-api/docs/image-generation
        // Use responseModalities: ["TEXT", "IMAGE"] for native image generation
        const generationConfig: any = isImagenModel ? {} : {
          responseModalities: ["TEXT", "IMAGE"],  // Uppercase per Google API docs
        }
        
        const model = genAI.getGenerativeModel({
          model: apiModelCode,
          generationConfig,
        })

        // Build content parts - focused prompt for image generation only
        const fullPrompt = systemPrompt + '\n\n' + userPrompt
        const parts: any[] = [
          { text: fullPrompt }
        ]

        // Add input image for REFINE/MODIFY modes
        if (inputImage) {
          console.log(`[SketchService] Including source image for modification (${inputImage.mimeType})`)
          parts.push({
            inlineData: {
              mimeType: inputImage.mimeType,
              data: inputImage.base64
            }
          })
        }

        if (apiModelCode !== modelCode) {
          console.log(`[SketchService] Calling ${modelCode} via ${apiModelCode} (attempt ${attempt}/${maxRetries})${inputImage ? ' with source image' : ''}...`)
        } else {
          console.log(`[SketchService] Calling ${modelCode} (attempt ${attempt}/${maxRetries})${inputImage ? ' with source image' : ''}...`)
        }
        
        const result = await model.generateContent(parts)
        const response = result.response

        // Extract image from response
        const candidates = response.candidates
        if (!candidates || candidates.length === 0) {
          lastError = 'No response candidates from Gemini'
          if (attempt < maxRetries) {
            const delay = Math.min(2000 * attempt, 10000)
            console.log(`[SketchService] No candidates, waiting ${delay}ms before retry...`)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
          continue
        }

        // Look for image in response
        for (const candidate of candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData) {
                const tokensUsed = response.usageMetadata?.totalTokenCount || 0
                console.log(`[SketchService] Successfully generated image with ${modelCode}`)
                
                // 2. Record usage through gateway metering
                await recordSketchUsage(
                  reservationId,
                  tokensUsed,
                  modelCode,
                  gatewayContext?.userId
                )
                
                return {
                  success: true,
                  imageBase64: part.inlineData.data,
                  tokensUsed,
                  modelUsed: modelCode,
                  reservationId
                }
              }
            }
          }
        }

        // Check for text response (might be an error or explanation)
        const textResponse = response.text?.()
        if (textResponse) {
          console.log('[SketchService] Model returned text instead of image:', textResponse.substring(0, 300))
          lastError = `Model returned text instead of image: ${textResponse.substring(0, 150)}...`
          break
        }
        
        lastError = 'Model returned empty response'
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(`[SketchService] Attempt ${attempt} failed for ${modelCode}:`, errorMsg)
        lastError = errorMsg
        
        // If the model doesn't support image generation, try next candidate
        if (/does not support.*image|response modalities/i.test(errorMsg)) {
          console.warn(`[SketchService] Model ${modelCode} doesn't support image generation, trying next...`)
          break
        }
        
        // If the model is not found/unsupported, break and try the next candidate
        if (/not found|unsupported/i.test(errorMsg) || /404/.test(errorMsg)) {
          console.warn(`[SketchService] Model ${modelCode} unavailable, trying next fallback...`)
          break
        }

        // Check for quota/rate limit - wait longer
        if (errorMsg.includes('quota') || errorMsg.includes('rate limit') || /429/.test(errorMsg)) {
          console.log(`[SketchService] Rate limited, waiting ${5000 * attempt}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, 5000 * attempt))
          continue
        }
        
        // For network errors, retry with exponential backoff
        if (attempt < maxRetries) {
          const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000)
          console.log(`[SketchService] Network error, waiting ${delay}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
  }
  
  // All retries failed - provide helpful error message
  const triedModels = modelCandidates.join(', ')
  return { 
    success: false, 
    error: `Image generation failed after trying: ${triedModels}. Error: ${lastError}. 

TROUBLESHOOTING:
1. Ensure the configured model supports image OUTPUT (not just vision input)
2. Recommended model: gemini-3-pro-image-preview
3. Models that do NOT work: gemini-2.0-flash, gemini-2.0-flash-exp, gemini-2.0-flash-lite (these are text-only)
4. Configure the model in Super Admin → LLM Config → PATENT_DRAFTING → Sketch Generation`
  }
}

// === MAIN SKETCH GENERATION FUNCTION ===

/**
 * Main entry point for sketch generation.
 * Creates a SketchRecord and initiates generation based on mode.
 */
export async function generateSketch(
  request: SketchGenerationRequest,
  userId: string,
  tenantId?: string
): Promise<SketchGenerationResult> {
  const { patentId, sessionId, mode, title, userPrompt, contextFlags, viewsRequested, sourceSketchId, uploadedImageBase64, uploadedImageMimeType } = request

  // 1. Validate inputs based on mode
  if (mode === 'REFINE' && !uploadedImageBase64) {
    return { success: false, error: 'REFINE mode requires an uploaded image' }
  }

  // 2. Check modification chain limit
  if (sourceSketchId) {
    const sourceSketch = await prisma.sketchRecord.findUnique({
      where: { id: sourceSketchId }
    })
    if (sourceSketch && sourceSketch.attemptCount >= MAX_MODIFY_ATTEMPTS) {
      return { success: false, error: `Maximum modification attempts (${MAX_MODIFY_ATTEMPTS}) reached for this sketch chain` }
    }
  }

  // 3. Build context bundle
  const contextBundle = await buildSketchContextBundle(
    patentId,
    sessionId,
    contextFlags || { useIdeaSummary: true, useClaims: true, useDiagrams: true, useComponents: true }
  )

  // 3.1 Resolve model candidates from database (no hardcoded fallbacks)
  const modelCandidates = await resolveSketchModelCandidates(tenantId)
  
  if (modelCandidates.length === 0) {
    return {
      success: false,
      error: 'No sketch generation model configured. Please configure a model for "Sketch Generation" stage in Super Admin → LLM Config. Recommended model: gemini-3-pro-image-preview'
    }
  }
  
  const preferredModel = modelCandidates[0]
  console.log(`[SketchService] Using model: ${preferredModel} (${modelCandidates.length} candidates total)`)

  // 4. Check for minimum context
  if (!contextBundle.ideaSummary && contextBundle.keyComponents.length === 0) {
    return { success: false, error: 'Insufficient invention context. Please complete the Idea Entry stage first.' }
  }

  // 5. Create pending SketchRecord
  const sketchRecord = await prisma.sketchRecord.create({
    data: {
      patentId,
      sessionId,
      mode,
      status: 'PENDING',
      title: title || `Sketch - ${mode} Mode`,
      userPrompt,
      contextFlags: contextFlags as any,
      viewsRequested: viewsRequested as any,
      sourceSketchId,
      attemptCount: 0,
      aiModel: preferredModel
    }
  })

  try {
    // 6. Build prompts based on mode
    const systemPrompt = buildSystemPrompt()
    let userPromptFinal: string

    switch (mode) {
      case 'AUTO':
        userPromptFinal = buildAutoModePrompt(contextBundle, viewsRequested)
        break
      case 'GUIDED':
        userPromptFinal = buildGuidedModePrompt(contextBundle, userPrompt || '', viewsRequested)
        break
      case 'REFINE':
        userPromptFinal = buildRefineModePrompt(contextBundle, userPrompt)
        break
      default:
        throw new Error(`Unknown sketch mode: ${mode}`)
    }

    // 7. Prepare input image if present
    let inputImage: { base64: string; mimeType: string } | undefined
    if (mode === 'REFINE' && uploadedImageBase64 && uploadedImageMimeType) {
      inputImage = { base64: uploadedImageBase64, mimeType: uploadedImageMimeType }
      
      // Save original uploaded image
      const originalFilename = `original_${sketchRecord.id}.${uploadedImageMimeType.split('/')[1] || 'png'}`
      const originalPath = path.join(SKETCH_UPLOAD_DIR, originalFilename)
      await fs.mkdir(SKETCH_UPLOAD_DIR, { recursive: true })
      await fs.writeFile(originalPath, Buffer.from(uploadedImageBase64, 'base64'))
      
      await prisma.sketchRecord.update({
        where: { id: sketchRecord.id },
        data: {
          originalImagePath: `/uploads/sketches/${originalFilename}`,
          originalImageFilename: originalFilename
        }
      })
    }

    // For MODIFY mode (sourceSketchId present), load source sketch image
    if (sourceSketchId && mode !== 'REFINE') {
      const sourceSketch = await prisma.sketchRecord.findUnique({
        where: { id: sourceSketchId }
      })
      if (sourceSketch?.imagePath) {
        const imagePath = path.join('public', sourceSketch.imagePath)
        try {
          const imageBuffer = await fs.readFile(imagePath)
          inputImage = {
            base64: imageBuffer.toString('base64'),
            mimeType: 'image/png'
          }
          userPromptFinal = buildModifyPrompt(
            contextBundle,
            userPrompt || 'Improve the sketch',
            sourceSketch.title,
            sourceSketch.description || undefined
          )
        } catch (e) {
          console.warn('[SketchService] Could not load source sketch image:', e)
        }
      }
    }

    // Store prompt for debugging
    await prisma.sketchRecord.update({
      where: { id: sketchRecord.id },
      data: { aiPromptUsed: userPromptFinal }
    })

    // 8. Generate sketch with gateway enforcement for policy/quota/metering
    // Title and description are already set from suggestion or user input
    const result = await generateSketchWithGemini(
      systemPrompt, 
      userPromptFinal, 
      modelCandidates, 
      inputImage,
      { tenantId, userId } // Gateway context for DIAGRAM_GENERATION feature access
    )

    // 9. Update record based on result
    if (result.success && result.imageBase64) {
      // Save generated image
      const filename = `sketch_${sketchRecord.id}_${Date.now()}.png`
      const filePath = path.join(SKETCH_UPLOAD_DIR, filename)
      await fs.mkdir(SKETCH_UPLOAD_DIR, { recursive: true })
      const imageBuffer = Buffer.from(result.imageBase64, 'base64')
      await fs.writeFile(filePath, imageBuffer)

      // Get image dimensions from buffer
      const imageSize = require('image-size').default || require('image-size')
      let width: number | undefined
      let height: number | undefined
      try {
        // Pass buffer directly to imageSize for more reliable parsing
        const dimensions = imageSize(imageBuffer)
        width = dimensions.width
        height = dimensions.height
      } catch (e) {
        console.warn('[SketchService] Could not get image dimensions:', e)
      }

      // Calculate checksum
      const checksum = crypto.createHash('sha256').update(imageBuffer).digest('hex')

      console.log(`[SketchService] Sketch generated successfully`)

      await prisma.sketchRecord.update({
        where: { id: sketchRecord.id },
        data: {
          status: 'SUCCESS',
          imagePath: `/uploads/sketches/${filename}`,
        imageFilename: filename,
        imageWidth: width,
        imageHeight: height,
        imageChecksum: checksum,
        tokensUsed: result.tokensUsed,
        attemptCount: { increment: 1 },
        aiModel: result.modelUsed || preferredModel
      }
    })

      return {
        success: true,
        sketchId: sketchRecord.id,
        imagePath: `/uploads/sketches/${filename}`,
        imageUrl: `/uploads/sketches/${filename}`,
        attemptCount: 1
      }

    } else {
      // Mark as failed
      await prisma.sketchRecord.update({
        where: { id: sketchRecord.id },
        data: {
          status: 'FAILED',
          errorMessage: result.error || 'Unknown error',
          attemptCount: { increment: 1 }
        }
      })

      return {
        success: false,
        sketchId: sketchRecord.id,
        error: result.error || 'Sketch generation failed',
        attemptCount: 1
      }
    }

  } catch (error) {
    // Update record with error
    await prisma.sketchRecord.update({
      where: { id: sketchRecord.id },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        attemptCount: { increment: 1 }
      }
    })

    return {
      success: false,
      sketchId: sketchRecord.id,
      error: error instanceof Error ? error.message : 'Unknown error during sketch generation'
    }
  }
}

// === SKETCH MANAGEMENT FUNCTIONS ===

/**
 * Lists all sketches for a patent/session.
 */
export async function listSketches(
  patentId: string,
  sessionId?: string,
  options?: {
    includeDeleted?: boolean
    favoritesOnly?: boolean
    limit?: number
    offset?: number
  }
) {
  const where: any = {
    patentId,
    ...(sessionId && { sessionId }),
    ...(!options?.includeDeleted && { isDeleted: false }),
    ...(options?.favoritesOnly && { isFavorite: true })
  }

  const sketches = await prisma.sketchRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options?.limit || 50,
    skip: options?.offset || 0,
    include: {
      sourceSketch: {
        select: { id: true, title: true }
      }
    }
  })

  return sketches
}

/**
 * Gets a single sketch by ID.
 */
export async function getSketch(sketchId: string) {
  return prisma.sketchRecord.findUnique({
    where: { id: sketchId },
    include: {
      sourceSketch: true,
      derivedSketches: {
        select: { id: true, title: true, createdAt: true }
      }
    }
  })
}

/**
 * Deletes a sketch (soft delete).
 */
export async function deleteSketch(sketchId: string, userId: string): Promise<{ success: boolean; error?: string }> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId },
    include: { session: true }
  })

  if (!sketch) {
    return { success: false, error: 'Sketch not found' }
  }

  // Verify ownership via session
  if (sketch.session && sketch.session.userId !== userId) {
    return { success: false, error: 'Access denied' }
  }

  await prisma.sketchRecord.update({
    where: { id: sketchId },
    data: { isDeleted: true }
  })

  return { success: true }
}

/**
 * Toggles favorite status.
 */
export async function toggleSketchFavorite(sketchId: string): Promise<{ success: boolean; isFavorite?: boolean }> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId }
  })

  if (!sketch) {
    return { success: false }
  }

  const updated = await prisma.sketchRecord.update({
    where: { id: sketchId },
    data: { isFavorite: !sketch.isFavorite }
  })

  return { success: true, isFavorite: updated.isFavorite }
}

/**
 * Updates sketch metadata (title, description).
 */
export async function updateSketchMetadata(
  sketchId: string,
  data: { title?: string; description?: string }
): Promise<{ success: boolean }> {
  await prisma.sketchRecord.update({
    where: { id: sketchId },
    data
  })

  return { success: true }
}

/**
 * Retries a failed sketch generation.
 */
export async function retrySketchGeneration(
  sketchId: string,
  userId: string,
  tenantId?: string
): Promise<SketchGenerationResult> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId }
  })

  if (!sketch) {
    return { success: false, error: 'Sketch not found' }
  }

  if (sketch.status !== 'FAILED') {
    return { success: false, error: 'Can only retry failed sketches' }
  }

  // Create a new generation request from the existing sketch
  return generateSketch({
    patentId: sketch.patentId,
    sessionId: sketch.sessionId || undefined,
    mode: sketch.mode as SketchMode,
    title: sketch.title,
    userPrompt: sketch.userPrompt || undefined,
    contextFlags: sketch.contextFlags as SketchContextFlags,
    viewsRequested: sketch.viewsRequested as SketchViewConfig,
    sourceSketchId: sketch.sourceSketchId || undefined
  }, userId, tenantId)
}

// === SKETCH SUGGESTION FUNCTIONS ===

export interface SketchSuggestion {
  title: string
  description: string
}

/**
 * Creates sketch suggestion records from LLM-generated suggestions.
 * These are placeholders without images - user must explicitly generate.
 */
export async function createSketchSuggestions(
  patentId: string,
  sessionId: string,
  suggestions: SketchSuggestion[]
): Promise<{ created: number; sketchIds: string[] }> {
  const sketchIds: string[] = []
  
  for (const suggestion of suggestions) {
    // Validate suggestion has required fields
    if (!suggestion.title || !suggestion.description) {
      console.warn('[SketchService] Skipping invalid suggestion:', suggestion)
      continue
    }
    
    const sketch = await prisma.sketchRecord.create({
      data: {
        patentId,
        sessionId,
        mode: 'AUTO',
        status: 'SUGGESTED',
        title: suggestion.title.trim(),
        description: suggestion.description.trim(),
        attemptCount: 0
      }
    })
    
    sketchIds.push(sketch.id)
  }
  
  console.log(`[SketchService] Created ${sketchIds.length} sketch suggestions`)
  return { created: sketchIds.length, sketchIds }
}

/**
 * Generates image for a SUGGESTED sketch.
 * Uses the pre-defined title and description for focused image generation.
 */
export async function generateFromSuggestion(
  sketchId: string,
  userId: string,
  tenantId?: string
): Promise<SketchGenerationResult> {
  const sketch = await prisma.sketchRecord.findUnique({
    where: { id: sketchId },
    include: { session: true }
  })

  if (!sketch) {
    return { success: false, error: 'Sketch suggestion not found' }
  }

  if (sketch.status !== 'SUGGESTED' && sketch.status !== 'FAILED') {
    return { success: false, error: 'Can only generate from SUGGESTED or FAILED sketches' }
  }

  // Verify ownership
  if (sketch.session && sketch.session.userId !== userId) {
    return { success: false, error: 'Access denied' }
  }

  // Mark as pending
  await prisma.sketchRecord.update({
    where: { id: sketchId },
    data: { status: 'PENDING' }
  })

  try {
    // Build context bundle from session
    const contextBundle = await buildSketchContextBundle(
      sketch.patentId,
      sketch.sessionId || undefined,
      { useIdeaSummary: true, useClaims: true, useDiagrams: true, useComponents: true }
    )
    
    // Resolve model from database (no hardcoded fallbacks)
    const modelCandidates = await resolveSketchModelCandidates(tenantId)
    
    if (modelCandidates.length === 0) {
      await prisma.sketchRecord.update({
        where: { id: sketchId },
        data: {
          status: 'FAILED',
          errorMessage: 'No sketch generation model configured'
        }
      })
      return {
        success: false,
        sketchId,
        error: 'No sketch generation model configured. Please configure a model for "Sketch Generation" stage in Super Admin → LLM Config.'
      }
    }
    
    const preferredModel = modelCandidates[0]
    console.log(`[SketchService] Using model for suggestion: ${preferredModel}`)

    // Build focused prompt using the suggestion's title and description
    const systemPrompt = buildSystemPrompt()
    const userPrompt = buildPromptFromSuggestion(contextBundle, sketch.title, sketch.description || '')

    // Store prompt for debugging
    await prisma.sketchRecord.update({
      where: { id: sketchId },
      data: { aiPromptUsed: userPrompt }
    })

    // Generate image with gateway enforcement for policy/quota/metering
    const result = await generateSketchWithGemini(
      systemPrompt, 
      userPrompt, 
      modelCandidates,
      undefined, // No input image for suggestions
      { tenantId, userId } // Gateway context for DIAGRAM_GENERATION feature access
    )

    if (result.success && result.imageBase64) {
      // Save generated image
      const filename = `sketch_${sketchId}_${Date.now()}.png`
      const filePath = path.join(SKETCH_UPLOAD_DIR, filename)
      await fs.mkdir(SKETCH_UPLOAD_DIR, { recursive: true })
      const imageBuffer = Buffer.from(result.imageBase64, 'base64')
      await fs.writeFile(filePath, imageBuffer)

      // Get image dimensions
      const imageSize = require('image-size').default || require('image-size')
      let width: number | undefined
      let height: number | undefined
      try {
        const dimensions = imageSize(imageBuffer)
        width = dimensions.width
        height = dimensions.height
      } catch (e) {
        console.warn('[SketchService] Could not get image dimensions:', e)
      }

      // Calculate checksum
      const checksum = crypto.createHash('sha256').update(imageBuffer).digest('hex')

      await prisma.sketchRecord.update({
        where: { id: sketchId },
        data: {
          status: 'SUCCESS',
          imagePath: `/uploads/sketches/${filename}`,
          imageFilename: filename,
          imageWidth: width,
          imageHeight: height,
          imageChecksum: checksum,
          tokensUsed: result.tokensUsed,
          attemptCount: { increment: 1 },
          aiModel: result.modelUsed || preferredModel
        }
      })

      return {
        success: true,
        sketchId,
        imagePath: `/uploads/sketches/${filename}`,
        imageUrl: `/uploads/sketches/${filename}`,
        attemptCount: 1
      }
    } else {
      // Mark as failed
      await prisma.sketchRecord.update({
        where: { id: sketchId },
        data: {
          status: 'FAILED',
          errorMessage: result.error || 'Unknown error',
          attemptCount: { increment: 1 }
        }
      })

      return {
        success: false,
        sketchId,
        error: result.error || 'Image generation failed',
        attemptCount: 1
      }
    }
  } catch (error) {
    // Mark as failed on exception
    await prisma.sketchRecord.update({
      where: { id: sketchId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        attemptCount: { increment: 1 }
      }
    })

    return {
      success: false,
      sketchId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Builds a focused prompt from a sketch suggestion.
 * Uses the pre-defined title and description along with full invention context.
 */
function buildPromptFromSuggestion(
  context: SketchContextBundle,
  title: string,
  description: string
): string {
  let prompt = `Generate a USPTO/EPO/WIPO-compliant patent line drawing.

${buildLanguageRequirementSection(context)}
═══════════════════════════════════════════════════════════════════════════════
FIGURE TO GENERATE
═══════════════════════════════════════════════════════════════════════════════
Title: ${title}
Description: ${description}

═══════════════════════════════════════════════════════════════════════════════
INVENTION CONTEXT
═══════════════════════════════════════════════════════════════════════════════
${context.ideaSummary}

`

  if (context.keyComponents.length > 0) {
    prompt += `KEY COMPONENTS (use ONLY these):
${context.keyComponents.map(c => `- ${c}`).join('\n')}

`
  }

  if (Object.keys(context.referenceNumerals).length > 0) {
    prompt += `REFERENCE NUMERALS (use ONLY these numbers as labels):
${Object.entries(context.referenceNumerals).map(([num, name]) => `${num} → ${name}`).join('\n')}

IMPORTANT: In the drawing, use ONLY the numeric labels (#100, #200, etc.), NOT the component names.
`
  }

  if (context.claims.length > 0) {
    prompt += `KEY CLAIMS (for structural reference only):
${context.claims.join('\n')}

`
  }

  if (context.diagramSummaries.length > 0) {
    prompt += `EXISTING DIAGRAMS (maintain visual consistency):
${context.diagramSummaries.join('\n')}

`
  }

  prompt += `INVENTION TYPE: ${context.inventionType}

═══════════════════════════════════════════════════════════════════════════════
DRAWING REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════
Generate the sketch as described in the title and description above.
The drawing should clearly show the relevant components and their relationships.

═══════════════════════════════════════════════════════════════════════════════
COMPLIANCE CHECKLIST (Self-verify before output)
═══════════════════════════════════════════════════════════════════════════════
✔ Only listed components shown (no extras)
✔ Numeric labels only (#100, #200, etc.)
✔ Main view + secondary view provided
✔ Dashed lines used correctly (internal/hidden only)
✔ No forbidden elements present

If ANY rule would be violated, simplify the drawing until compliant.`

  return prompt
}

/**
 * Clears all SUGGESTED sketches for a session (e.g., before regenerating suggestions).
 */
export async function clearSketchSuggestions(sessionId: string): Promise<{ deleted: number }> {
  const result = await prisma.sketchRecord.deleteMany({
    where: {
      sessionId,
      status: 'SUGGESTED'
    }
  })
  
  console.log(`[SketchService] Cleared ${result.count} sketch suggestions for session ${sessionId}`)
  return { deleted: result.count }
}
