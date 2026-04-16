/**
 * Section Injection Configuration (Hard-coded)
 * 
 * This file defines the Universal Drafting Bundle (UDB) injection rules per section.
 * UDB = Normalized Data (ND) + Claim 1 (C1)
 * 
 * Key Principles:
 * - No empty placeholders are ever emitted
 * - Omission is safer than emptiness
 * - Claim 1 is the legal truth once available
 */

export type Claim1Mode = 'bindingAnchor' | 'constraintOnly' | 'off'

export interface SectionInjectionConfig {
  injectNormalizedData: boolean
  injectClaim1: boolean
  claim1Mode: Claim1Mode
}

/**
 * Hard-coded injection matrix for all superset section keys.
 * This applies regardless of country mapping—country sections mapped to these
 * superset keys inherit these defaults.
 */
export const SECTION_INJECTION_CONFIG: Record<string, SectionInjectionConfig> = {
  // ND ON, C1 OFF sections
  title: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  preamble: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  fieldOfInvention: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  background: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  technicalProblem: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },
  briefDescriptionOfDrawings: { injectNormalizedData: true, injectClaim1: false, claim1Mode: 'off' },

  // ND ON, C1 ON (bindingAnchor) sections
  objectsOfInvention: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  summary: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  technicalSolution: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  advantageousEffects: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  detailedDescription: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  bestMode: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  bestMethod: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' }, // Alias for bestMode
  industrialApplicability: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },
  abstract: { injectNormalizedData: true, injectClaim1: true, claim1Mode: 'bindingAnchor' },

  // ND OFF, C1 OFF sections (these sections have their own specialized context)
  claims: { injectNormalizedData: false, injectClaim1: false, claim1Mode: 'off' },
  listOfNumerals: { injectNormalizedData: false, injectClaim1: false, claim1Mode: 'off' },
  crossReference: { injectNormalizedData: false, injectClaim1: false, claim1Mode: 'off' },
}

/**
 * Get injection config for a section key.
 * Falls back to safe defaults (ND ON, C1 OFF) for unknown keys.
 * Handles case-insensitive lookup.
 */
export function getSectionInjectionConfig(sectionKey: string): SectionInjectionConfig {
  if (!sectionKey) {
    console.warn(`[getSectionInjectionConfig] Empty section key, using safe defaults`)
    return {
      injectNormalizedData: true,
      injectClaim1: false,
      claim1Mode: 'off'
    }
  }

  // Try exact match first
  const config = SECTION_INJECTION_CONFIG[sectionKey]
  if (config) return config

  // Try lowercase match (handle case variations like "Abstract" vs "abstract")
  const lowerKey = sectionKey.toLowerCase()
  const lowerConfig = SECTION_INJECTION_CONFIG[lowerKey]
  if (lowerConfig) return lowerConfig

  // Try camelCase conversion (e.g., "field_of_invention" -> "fieldOfInvention")
  const camelKey = sectionKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  const camelConfig = SECTION_INJECTION_CONFIG[camelKey]
  if (camelConfig) return camelConfig

  // Safe fallback for unknown sections: ND ON, C1 OFF
  console.warn(`[getSectionInjectionConfig] Unknown section key "${sectionKey}", using safe defaults`)
  return {
    injectNormalizedData: true,
    injectClaim1: false,
    claim1Mode: 'off'
  }
}

/**
 * Sections that MUST have frozen Claim 1 available to generate.
 * If Claim 1 is required but missing/unfrozen, generation is BLOCKED.
 * 
 * RATIONALE: These are the "legally critical" sections that directly define
 * the scope of protection. Generating them without frozen Claim 1 could result
 * in inconsistent legal claims that harm the patent application.
 * 
 * Other sections (objectsOfInvention, technicalSolution, advantageousEffects,
 * bestMode, industrialApplicability) CAN use Claim 1 when available but
 * are NOT gated because they can be revised later without legal risk.
 * 
 * NOTE: Keys are stored in lowercase for case-insensitive matching.
 */
export const SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION = new Set([
  'abstract',           // Must align with Claim 1 scope per USPTO/EPO rules
  'summary',            // Must align with Claim 1 as it defines invention scope
  'detaileddescription' // Must provide basis for Claim 1 features (written description requirement)
])

/**
 * Normalize a section key for consistent comparison.
 * Removes underscores, hyphens, spaces, and converts to lowercase.
 * This handles alias variations like 'detailed_description' → 'detaileddescription'
 */
function normalizeSectionKeyForGating(key: string): string {
  if (!key) return ''
  return key.toLowerCase().replace(/[_\-\s.]/g, '')
}

/**
 * Check if a section should be gated (blocked) when Claim 1 is missing or not frozen.
 * 
 * Per SRS: Gated sections require FROZEN Claim 1, not just working claims.
 * 
 * @param sectionKey - The section being generated
 * @param normalizedData - The normalized data containing claims
 * @returns true if generation should be blocked
 */
export function shouldGateSection(
  sectionKey: string,
  normalizedData: Record<string, any> | null | undefined
): boolean {
  // Normalize section key for case-insensitive lookup
  // Also remove underscores/hyphens to handle aliases like 'detailed_description' vs 'detailedDescription'
  const normalizedKey = normalizeSectionKeyForGating(sectionKey)
  
  const config = getSectionInjectionConfig(sectionKey)
  if (!config.injectClaim1) return false // Section doesn't need C1
  
  // Check if this is a critical section that requires frozen Claim 1
  // SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION uses normalized lowercase keys without separators
  const isCriticalSection = SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION.has(normalizedKey)
  
  if (!isCriticalSection) return false // Non-critical sections don't gate
  
  // For critical sections: require FROZEN Claim 1
  const claim1FrozenAvailable = isClaim1AvailableAndFrozen(normalizedData)
  
  return !claim1FrozenAvailable
}

/**
 * Get the specific gating reason for a section.
 */
export function getGatingReason(
  sectionKey: string,
  normalizedData: Record<string, any> | null | undefined
): string | null {
  if (!shouldGateSection(sectionKey, normalizedData)) {
    return null
  }
  
  const hasClaim1 = isClaim1Available(normalizedData)
  const isFrozen = areClaimsFrozen(normalizedData)
  
  // Check if HTML claims exist (even without structured claims)
  const htmlClaims = normalizedData?.claimsFinal || normalizedData?.claims || normalizedData?.claimsProvisional || ''
  const hasHtmlClaims = typeof htmlClaims === 'string' && htmlClaims.trim().length > 0
  
  if (!hasClaim1 && !hasHtmlClaims) {
    return `Section "${sectionKey}" requires Claim 1 but no claims have been generated yet. Please complete the Claims Generation stage first.`
  }
  
  if (!isFrozen) {
    return `Section "${sectionKey}" requires frozen claims but claims are not yet frozen. Please freeze your claims in the CLAIM_REFINEMENT stage before generating this section.`
  }
  
  // If frozen but still gated (shouldn't happen after the isClaim1AvailableAndFrozen fix)
  return `Section "${sectionKey}" cannot be generated. Claims appear to be frozen but in an invalid format. Please try unfreezing and refreezing your claims, or regenerate them in the CLAIM_REFINEMENT stage.`
}

/**
 * Structured claim object from CLAIM_REFINEMENT stage
 */
export interface StructuredClaim {
  number: number
  type: 'independent' | 'dependent'
  dependsOn?: number
  category?: string
  text: string
}

/**
 * Decode HTML entities in text.
 */
function decodeHtmlEntities(text: string): string {
  if (!text) return ''
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
}

/**
 * Extract Claim 1 from frozen/structured claims.
 * Returns null if Claim 1 is not available.
 * 
 * DATA SOURCE PRIORITY INVARIANT:
 * The function uses claims from the MOST FINALIZED source available:
 * 1. claimsStructuredFinal - User-approved/frozen claims (highest authority)
 * 2. claimsStructured - Working/refined claims (actively being edited)
 * 3. claimsStructuredProvisional - Initial AI-generated claims (lowest authority)
 * 
 * IMPORTANT: claimsStructuredFinal is only populated AFTER user freezes claims
 * (sets claimsApprovedAt). Until then, the function uses working or provisional claims.
 * When requireFrozen=true, the function returns null unless claimsApprovedAt is set.
 * 
 * @param normalizedData - The normalized data object containing claims
 * @param requireFrozen - If true, only returns Claim 1 if claims are frozen (default: false)
 */
export function extractClaim1(
  normalizedData: Record<string, any> | null | undefined,
  requireFrozen: boolean = false
): string | null {
  if (!normalizedData) return null

  // Check if claims are frozen (user has approved them)
  const isFrozen = !!normalizedData.claimsApprovedAt
  
  // If frozen claims are required but not available, return null
  if (requireFrozen && !isFrozen) {
    return null
  }

  // Priority order for structured claims - most finalized source first
  // INVARIANT: claimsStructuredFinal is ONLY populated after user approval
  const structuredClaims: any[] =
    normalizedData.claimsStructuredFinal ||
    normalizedData.claimsStructured ||
    normalizedData.claimsStructuredProvisional ||
    []

  if (!Array.isArray(structuredClaims) || structuredClaims.length === 0) {
    return null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAIM 1 EXTRACTION - MULTI-STEP PRIORITY ALGORITHM
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Helper: Parse claim number with STRICT validation
  // Rejects "1a", "01a", "1.1" - only pure integers like "1", "01", 1
  const parseStrictClaimNumber = (num: any): number | null => {
    if (typeof num === 'number' && Number.isInteger(num) && num > 0) {
      return num
    }
    if (typeof num === 'string') {
      // STRICT: Must be all digits (allows leading zeros like "01" → 1)
      const trimmed = num.trim()
      if (/^\d+$/.test(trimmed)) {
        const parsed = parseInt(trimmed, 10)
        return parsed > 0 ? parsed : null
      }
    }
    return null
  }
  
  // Helper: Check if claim text looks like a dependent claim
  // Dependent claims typically start with "The [noun] of claim [X]" or reference earlier claims
  const looksLikeDependentClaim = (text: string): boolean => {
    if (!text) return false
    const normalized = text.trim().toLowerCase()
    // Pattern: "The [word] of claim [number]" at the start
    if (/^the\s+\w+\s+of\s+claim\s+\d/i.test(normalized)) return true
    // Pattern: Contains "according to claim [number]" early in text (first 100 chars)
    const earlyText = normalized.substring(0, 100)
    if (/according\s+to\s+claim\s+\d/i.test(earlyText)) return true
    if (/as\s+claimed\s+in\s+claim\s+\d/i.test(earlyText)) return true
    if (/of\s+any\s+(one\s+)?of\s+(the\s+)?preceding\s+claims?/i.test(earlyText)) return true
    return false
  }

  let claim1: any = null
  
  // STEP 1: Find claim with EXACT number === 1 (strict parsing)
  claim1 = structuredClaims.find((c) => {
    if (!c) return false
    const claimNum = parseStrictClaimNumber(c.number)
    return claimNum === 1
  })
  
  // STEP 2: If no claim #1, find the SMALLEST numbered claim
  if (!claim1) {
    let smallestNum = Infinity
    let smallestClaim: any = null
    
    for (const c of structuredClaims) {
      if (!c) continue
      const claimNum = parseStrictClaimNumber(c.number)
      if (claimNum !== null && claimNum < smallestNum) {
        smallestNum = claimNum
        smallestClaim = c
      }
    }
    
    if (smallestClaim) {
      claim1 = smallestClaim
      console.warn(`[extractClaim1] Claim #1 not found, using smallest numbered claim #${smallestNum}`)
    }
  }
  
  // STEP 3: If no numbered claims, find first INDEPENDENT claim that doesn't look dependent
  if (!claim1) {
    // First try: claims explicitly marked as independent
    const independentClaims = structuredClaims.filter((c) => 
      c && c.type === 'independent'
    )
    
    // Prefer independent claims whose text doesn't look dependent
    claim1 = independentClaims.find((c) => 
      c.text && typeof c.text === 'string' && !looksLikeDependentClaim(c.text)
    )
    
    // If all independent claims look dependent (data integrity issue), use first one anyway
    if (!claim1 && independentClaims.length > 0) {
      claim1 = independentClaims[0]
      console.warn(`[extractClaim1] All independent claims look dependent, using first one`)
    }
  }
  
  // STEP 4: Last resort - first claim that doesn't look dependent
  if (!claim1) {
    claim1 = structuredClaims.find((c) => 
      c && c.text && typeof c.text === 'string' && !looksLikeDependentClaim(c.text)
    )
    
    if (claim1) {
      console.warn(`[extractClaim1] No numbered or typed claims, using first non-dependent claim`)
    }
  }

  // Final validation: must have valid text
  if (!claim1 || !claim1.text || typeof claim1.text !== 'string') {
    return null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════
  
  let cleanedText = claim1.text
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/^\s*\d+\.\s*/, '') // Remove leading claim number if present (e.g., "1. ")
    .trim()
  
  // Decode HTML entities
  cleanedText = decodeHtmlEntities(cleanedText)
  
  // Final whitespace cleanup (collapse multiple spaces)
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim()

  if (!cleanedText) return null

  return cleanedText
}

/**
 * Check if Claim 1 is available (regardless of frozen status).
 */
export function isClaim1Available(normalizedData: Record<string, any> | null | undefined): boolean {
  return extractClaim1(normalizedData, false) !== null
}

/**
 * Check if Claim 1 is available AND frozen.
 * This is stricter - used for gating critical sections.
 * 
 * IMPORTANT: Returns true if claims are frozen AND claims exist in ANY form:
 * 1. Structured claims with extractable Claim 1 (preferred)
 * 2. HTML/text claims in claimsFinal or claims fields (fallback)
 * 
 * This handles cases where claims were manually entered or imported
 * without being parsed into structured format.
 */
export function isClaim1AvailableAndFrozen(normalizedData: Record<string, any> | null | undefined): boolean {
  if (!normalizedData) return false
  
  // First check: claims must be frozen
  const isFrozen = !!normalizedData.claimsApprovedAt
  if (!isFrozen) return false
  
  // Second check: try to extract Claim 1 from structured claims (preferred)
  const claim1FromStructured = extractClaim1(normalizedData, true)
  if (claim1FromStructured !== null) return true
  
  // Fallback check: if structured claims are empty but HTML claims exist, allow it
  // This handles cases where claims were frozen but not in structured format
  const htmlClaims = normalizedData.claimsFinal || normalizedData.claims || normalizedData.claimsProvisional || ''
  const hasHtmlClaims = typeof htmlClaims === 'string' && htmlClaims.trim().length > 0
  
  if (hasHtmlClaims) {
    console.warn('[isClaim1AvailableAndFrozen] Claims are frozen with HTML content but no structured claims. Allowing generation with reduced precision.')
    return true
  }
  
  return false
}

/**
 * Check if claims are frozen (approved by user).
 */
export function areClaimsFrozen(normalizedData: Record<string, any> | null | undefined): boolean {
  return !!(normalizedData?.claimsApprovedAt)
}

/**
 * Build the Normalized Data context block for injection into prompts.
 * Returns empty string if data is not available or injection is disabled.
 * 
 * CRITICAL: Never returns placeholder text like "Not available" or "None provided"
 */
export function buildNormalizedDataBlock(
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined
): string {
  if (!normalizedData && !idea) return ''

  const nd = normalizedData || {}
  const ideaData = idea || {}

  const parts: string[] = []

  // Title
  const title = ideaData.title || nd.title
  if (title && typeof title === 'string' && title.trim()) {
    parts.push(`Title: ${title.trim()}`)
  }

  // Problem Statement
  const problem = ideaData.problem || ideaData.problemStatement || nd.problem
  if (problem && typeof problem === 'string' && problem.trim()) {
    parts.push(`Problem: ${problem.trim()}`)
  }

  // Objectives
  const objectives = ideaData.objectives || nd.objectives
  if (objectives && typeof objectives === 'string' && objectives.trim()) {
    parts.push(`Objectives: ${objectives.trim()}`)
  }

  // Solution
  const solution = ideaData.solution || nd.solution || ideaData.description
  if (solution && typeof solution === 'string' && solution.trim()) {
    // Truncate very long solutions
    const truncated = solution.length > 500 ? solution.substring(0, 500) + '...' : solution
    parts.push(`Solution: ${truncated.trim()}`)
  }

  // Field of Relevance
  const field = ideaData.fieldOfRelevance || nd.fieldOfRelevance
  if (field && typeof field === 'string' && field.trim()) {
    parts.push(`Technical Field: ${field.trim()}`)
  }

  // Subfield
  const subfield = ideaData.subfield || nd.subfield
  if (subfield && typeof subfield === 'string' && subfield.trim()) {
    parts.push(`Subfield: ${subfield.trim()}`)
  }

  // Components (if array)
  const components = ideaData.components || nd.components
  if (Array.isArray(components) && components.length > 0) {
    const componentNames = components
      .map((c: any) => c?.name || c)
      .filter((n: any) => n && typeof n === 'string')
      .slice(0, 10) // Limit to 10 components
    if (componentNames.length > 0) {
      parts.push(`Key Components: ${componentNames.join(', ')}`)
    }
  }

  // Logic/Process Flow
  const logic = ideaData.logic || nd.logic
  if (logic && typeof logic === 'string' && logic.trim()) {
    const truncated = logic.length > 300 ? logic.substring(0, 300) + '...' : logic
    parts.push(`Process Logic: ${truncated.trim()}`)
  }

  // Inputs
  const inputs = ideaData.inputs || nd.inputs
  if (inputs && typeof inputs === 'string' && inputs.trim()) {
    parts.push(`Inputs: ${inputs.trim()}`)
  }

  // Outputs
  const outputs = ideaData.outputs || nd.outputs
  if (outputs && typeof outputs === 'string' && outputs.trim()) {
    parts.push(`Outputs: ${outputs.trim()}`)
  }

  // Best Method (brief)
  const bestMethod = ideaData.bestMethod || nd.bestMethod
  if (bestMethod && typeof bestMethod === 'string' && bestMethod.trim()) {
    const truncated = bestMethod.length > 200 ? bestMethod.substring(0, 200) + '...' : bestMethod
    parts.push(`Best Method: ${truncated.trim()}`)
  }

  // If no parts, return empty (no header, no placeholder)
  if (parts.length === 0) return ''

  // Build the block with header and instruction
  return `
════════════════════════════════════════════════════════════════════════════════
NORMALIZED DATA (READ-ONLY CONTEXT – DO NOT INVENT MISSING FIELDS)
════════════════════════════════════════════════════════════════════════════════
${parts.join('\n')}
`
}

/**
 * Build the Claim 1 context block for injection into prompts.
 * Returns empty string if Claim 1 is not available or injection is disabled.
 * 
 * CRITICAL: Never returns placeholder text like "Not available" or "None provided"
 */
export function buildClaim1Block(
  normalizedData: Record<string, any> | null | undefined,
  mode: Claim1Mode
): string {
  if (mode === 'off') return ''

  const claim1Text = extractClaim1(normalizedData)
  if (!claim1Text) return ''

  const isFrozen = areClaimsFrozen(normalizedData)
  const statusLabel = isFrozen ? '(FROZEN - LEGAL AUTHORITY)' : '(WORKING - FOR ALIGNMENT)'

  let modeInstruction = ''
  if (mode === 'bindingAnchor') {
    modeInstruction = `
CLAIM 1 BINDING INSTRUCTION:
- Do NOT add elements not supported by Claim 1
- Keep terminology EXACTLY consistent with Claim 1
- All features described must trace back to Claim 1 language`
  } else if (mode === 'constraintOnly') {
    modeInstruction = `
CLAIM 1 CONSTRAINT INSTRUCTION:
- Use Claim 1 ONLY for terminology consistency
- Do NOT enumerate or restate claim features
- Avoid contradiction with Claim 1 scope`
  }

  return `
════════════════════════════════════════════════════════════════════════════════
CLAIM 1 ${statusLabel}
════════════════════════════════════════════════════════════════════════════════
${claim1Text}
${modeInstruction}
`
}

/**
 * Build complete Universal Drafting Bundle (UDB) for a section.
 * Combines Normalized Data and Claim 1 based on section config.
 * 
 * Returns { block: string, gated: boolean, gateReason?: string }
 */
export function buildUniversalDraftingBundle(
  sectionKey: string,
  normalizedData: Record<string, any> | null | undefined,
  idea: Record<string, any> | null | undefined
): { block: string; gated: boolean; gateReason?: string } {
  // Validate inputs
  if (!sectionKey) {
    console.warn('[buildUniversalDraftingBundle] Empty sectionKey provided')
    return { block: '', gated: false }
  }

  const config = getSectionInjectionConfig(sectionKey)

  // Check gating first (uses the new function that checks normalizedData directly)
  if (shouldGateSection(sectionKey, normalizedData)) {
    const gateReason = getGatingReason(sectionKey, normalizedData)
    return {
      block: '',
      gated: true,
      gateReason: gateReason || `Section "${sectionKey}" cannot be generated due to missing Claim 1 context.`
    }
  }

  const parts: string[] = []

  // Add Normalized Data block if enabled
  if (config.injectNormalizedData) {
    const ndBlock = buildNormalizedDataBlock(normalizedData, idea)
    if (ndBlock && ndBlock.trim()) {
      parts.push(ndBlock)
    }
  }

  // Add Claim 1 block if enabled and available
  // Use non-frozen check here since we already passed gating (which checks frozen for critical sections)
  const claim1Available = isClaim1Available(normalizedData)
  if (config.injectClaim1 && claim1Available) {
    const c1Block = buildClaim1Block(normalizedData, config.claim1Mode)
    if (c1Block && c1Block.trim()) {
      parts.push(c1Block)
    }
  }

  return {
    block: parts.join('\n'),
    gated: false
  }
}

/**
 * Anti-hallucination guards for missing optional data.
 * These are injected automatically and are NOT admin-controlled.
 */
export function buildAntiHallucinationGuards(
  hasFigures: boolean,
  hasPriorArt: boolean,
  hasComponents: boolean
): string {
  const guards: string[] = []

  if (!hasFigures) {
    guards.push('• Do NOT invent figure numbers or titles that are not provided.')
  }

  if (!hasPriorArt) {
    guards.push('• Do NOT cite patent documents or publications that are not provided.')
  }

  if (!hasComponents) {
    guards.push('• Do NOT invent component names or reference numerals that are not provided.')
  }

  if (guards.length === 0) return ''

  return `
════════════════════════════════════════════════════════════════════════════════
ANTI-HALLUCINATION GUARDS (MANDATORY)
════════════════════════════════════════════════════════════════════════════════
${guards.join('\n')}
`
}

/**
 * Validate that a prompt does not contain empty placeholders.
 * Used for testing/debugging.
 */
export function validateNoEmptyPlaceholders(prompt: string): { valid: boolean; violations: string[] } {
  const forbiddenPatterns = [
    /not available/i,
    /none provided/i,
    /no .* available/i,
    /no .* specified/i,
    /data not available/i,
    /claims data not available/i,
    /full draft not available/i,
    /\{\{[A-Z_]+\}\}/g, // Unreplaced template variables
  ]

  const violations: string[] = []

  for (const pattern of forbiddenPatterns) {
    const match = prompt.match(pattern)
    if (match) {
      violations.push(`Found forbidden placeholder: "${match[0]}"`)
    }
  }

  return {
    valid: violations.length === 0,
    violations
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLAIMS INJECTION INVARIANTS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate full claims are being injected (not just Claim 1)
 */
const FULL_CLAIMS_PATTERNS = [
  /FROZEN CLAIMS/i,
  /FULL CLAIMS/i,
  /ALL CLAIMS/i,
  /claims?\s*\d+\s*[-–]\s*\d+/i, // "claims 1-20" or similar
  /claim\s*2\s*[.:,]/i, // Reference to claim 2 or beyond
  /claim\s*[3-9]\d*\s*[.:,]/i, // Reference to claim 3+ 
  /dependent\s+claim/i, // Reference to dependent claims
  /independent\s+claims/i, // Plural independent claims
]

/**
 * Patterns that indicate Claim 1 is being referenced (allowed)
 */
const CLAIM_1_PATTERNS = [
  /CLAIM 1/i,
  /claim\s*1\s*[.:,\s]/i,
  /first\s+independent\s+claim/i,
  /C1 Anchor/i,
]

/**
 * Validate claims injection invariants for a drafting prompt.
 * 
 * Invariants:
 * 1. Non-claims sections must never receive full claims
 * 2. Claim 1 and full claims must never appear together in a prompt
 * 3. Only the 'claims' section may contain full claims
 * 
 * @param prompt - The prompt to validate
 * @param sectionKey - The section this prompt is for
 * @returns Validation result with violations
 */
export function validateClaimsInjectionInvariants(
  prompt: string,
  sectionKey: string
): { valid: boolean; violations: string[] } {
  const violations: string[] = []
  const isClaimsSection = sectionKey === 'claims'
  
  // Check for full claims patterns
  const hasFullClaims = FULL_CLAIMS_PATTERNS.some(pattern => pattern.test(prompt))
  const hasClaim1 = CLAIM_1_PATTERNS.some(pattern => pattern.test(prompt))
  
  // Invariant 1: Non-claims sections must never receive full claims
  if (!isClaimsSection && hasFullClaims) {
    violations.push(
      `INVARIANT VIOLATION: Section "${sectionKey}" contains full claims. ` +
      `Only the 'claims' section may receive full claims. ` +
      `Non-claims sections should only use Claim 1 anchoring.`
    )
  }
  
  // Invariant 2: Claim 1 and full claims must never appear together
  if (hasClaim1 && hasFullClaims) {
    violations.push(
      `INVARIANT VIOLATION: Prompt contains both Claim 1 reference and full claims. ` +
      `These must not appear together. Use only Claim 1 for anchoring in drafting sections.`
    )
  }
  
  // Log violations for debugging
  if (violations.length > 0) {
    console.error(`[validateClaimsInjectionInvariants] ${violations.length} violation(s) for section "${sectionKey}":`)
    violations.forEach(v => console.error(`  - ${v}`))
  }
  
  return {
    valid: violations.length === 0,
    violations
  }
}

/**
 * Check if a prompt is safe for drafting (passes all invariants).
 * 
 * @param prompt - The prompt to validate
 * @param sectionKey - The section this prompt is for
 * @returns true if safe, false if invariants are violated
 */
export function isDraftingPromptSafe(prompt: string, sectionKey: string): boolean {
  const placeholderCheck = validateNoEmptyPlaceholders(prompt)
  const claimsCheck = validateClaimsInjectionInvariants(prompt, sectionKey)
  
  return placeholderCheck.valid && claimsCheck.valid
}

/**
 * Sanitize a prompt by removing any full claims that shouldn't be there.
 * This is a safety net - ideally invariants should prevent this from being needed.
 * 
 * @param prompt - The prompt to sanitize
 * @param sectionKey - The section this prompt is for
 * @returns Sanitized prompt with warnings logged
 */
export function sanitizeDraftingPrompt(prompt: string, sectionKey: string): string {
  if (sectionKey === 'claims') {
    // Claims section can have full claims
    return prompt
  }
  
  let sanitized = prompt
  let sanitizationApplied = false
  
  // Remove any "FROZEN CLAIMS" blocks if they appear
  const frozenClaimsBlockRegex = /FROZEN CLAIMS[\s\S]*?═{10,}/g
  if (frozenClaimsBlockRegex.test(sanitized)) {
    console.warn(`[sanitizeDraftingPrompt] Removing FROZEN CLAIMS block from "${sectionKey}" section`)
    // Reset regex lastIndex after test
    frozenClaimsBlockRegex.lastIndex = 0
    sanitized = sanitized.replace(frozenClaimsBlockRegex, '')
    sanitizationApplied = true
  }
  
  if (sanitizationApplied) {
    console.warn(`[sanitizeDraftingPrompt] Prompt for "${sectionKey}" was sanitized to remove full claims`)
  }
  
  return sanitized
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validates the configuration for internal consistency.
 * Call this during startup or in tests to catch configuration issues early.
 * 
 * Checks:
 * 1. All gated sections must have injectClaim1 = true in config
 * 2. Config keys are consistent (no duplicate meanings)
 * 3. Mode settings are valid for injectClaim1 value
 */
export function validateConfiguration(): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Check 1: All gated sections must have injectClaim1 = true
  const gatedSectionsList = Array.from(SECTIONS_REQUIRING_CLAIM1_FOR_GENERATION)
  for (const gatedSection of gatedSectionsList) {
    // Find the config for this section using same normalization as shouldGateSection
    const normalizedGated = normalizeSectionKeyForGating(gatedSection)
    let foundConfig = false
    let hasC1Injection = false
    
    for (const [key, config] of Object.entries(SECTION_INJECTION_CONFIG)) {
      // Use same normalization to match keys consistently
      if (normalizeSectionKeyForGating(key) === normalizedGated) {
        foundConfig = true
        hasC1Injection = config.injectClaim1
        break
      }
    }
    
    if (!foundConfig) {
      errors.push(`Gated section "${gatedSection}" not found in SECTION_INJECTION_CONFIG`)
    } else if (!hasC1Injection) {
      errors.push(`Gated section "${gatedSection}" has injectClaim1=false but requires Claim 1 for generation`)
    }
  }
  
  // Check 2: Mode settings are valid for injectClaim1 value
  for (const [key, config] of Object.entries(SECTION_INJECTION_CONFIG)) {
    if (!config.injectClaim1 && config.claim1Mode !== 'off') {
      errors.push(`Section "${key}" has injectClaim1=false but claim1Mode="${config.claim1Mode}" (should be "off")`)
    }
    if (config.injectClaim1 && config.claim1Mode === 'off') {
      errors.push(`Section "${key}" has injectClaim1=true but claim1Mode="off" (should be "bindingAnchor" or "constraintOnly")`)
    }
  }
  
  // Log results
  if (errors.length > 0) {
    console.error(`[validateConfiguration] Found ${errors.length} configuration error(s):`)
    errors.forEach(e => console.error(`  - ${e}`))
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Test helper: Validates that extracted Claim 1 is correct for given test data.
 */
export function validateClaim1Extraction(
  testNormalizedData: Record<string, any>,
  expectedClaim1Text: string | null
): { valid: boolean; actual: string | null; expected: string | null } {
  const actual = extractClaim1(testNormalizedData)
  const valid = actual === expectedClaim1Text
  
  if (!valid) {
    console.error(`[validateClaim1Extraction] Mismatch:`)
    console.error(`  Expected: ${expectedClaim1Text}`)
    console.error(`  Actual: ${actual}`)
  }
  
  return { valid, actual, expected: expectedClaim1Text }
}

