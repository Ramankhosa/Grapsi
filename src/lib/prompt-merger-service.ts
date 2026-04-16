/**
 * Prompt Merger Service
 * 
 * Merges base superset prompts with country-specific top-up prompts
 * to create jurisdiction-compliant patent drafting instructions.
 * 
 * ============================================================================
 * DATABASE IS THE ONLY SOURCE OF TRUTH - NO HARDCODED FALLBACKS
 * ============================================================================
 * 
 * Architecture:
 * 1. SupersetSection (DB) - Base generic prompts (country-neutral)
 * 2. CountrySectionPrompt (DB) - Top-up prompts (jurisdiction-specific)
 * 3. UserInstruction (DB) - User session-specific overrides (highest priority)
 * 
 * B+T+U Priority (lowest to highest):
 * - [B] BASE: SupersetSection table - universal patent drafting guidelines
 * - [T] TOP-UP: CountrySectionPrompt table - jurisdiction-specific rules
 * - [U] USER: UserInstruction table - session-specific customizations
 * 
 * If prompts are missing from database, an ERROR is thrown (no silent fallbacks).
 */

import { prisma } from './prisma'
import { getCountryProfile, getSectionRules, getBaseStyle } from './country-profile-service'
import { getSectionPrompt as getDbSectionPrompt } from './section-prompt-service'
import { getUserInstruction, buildUserInstructionBlock, type UserInstructionContext } from './user-instruction-service'
import { resolveCanonicalKey } from './section-alias-service'
import { getSupportedSectionKeys } from './metering/section-stage-mapping'

// NOTE: Hardcoded SUPERSET_PROMPTS removed - all prompts must come from database

// ============================================================================
// Types
// ============================================================================

export interface MergedPrompt {
  /** Combined instruction: base + country-specific + user */
  instruction: string
  /** Combined constraints from base and country top-up */
  constraints: string[]
  /** Country-specific instruction only (for debugging/transparency) */
  topUpInstruction?: string
  /** User-provided instruction (highest priority) */
  userInstruction?: UserInstructionContext
  /** User instruction block formatted for LLM */
  userInstructionBlock?: string
  /** Localized section heading for this jurisdiction */
  sectionLabel: string
  /** Canonical superset key (e.g., "background", "claims") */
  sectionKey: string
  /** Country-specific rules from JSON */
  countryRules?: any
  /** Base style from country profile */
  baseStyle?: {
    tone: string
    voice: string
    avoid: string[]
  }
  /** Merge strategy used */
  mergeStrategy: 'append' | 'prepend' | 'replace'
  /** When true, bypass LLM and import figure titles directly (for Brief Description of Drawings) */
  importFiguresDirectly?: boolean
  
  // Debug info for B+T+U panel
  /** Debug: Has base superset prompt */
  hasBase: boolean
  /** Debug: Has country-specific top-up prompt */
  hasTopUp: boolean
  /** Debug: Has user instruction */
  hasUser: boolean
  /** Debug: Source of top-up (db or json) */
  topUpSource?: 'db' | 'json' | null
  /** Debug: Base prompt preview (first 100 chars) */
  basePreview?: string
  /** Debug: TopUp prompt preview (first 100 chars) */
  topUpPreview?: string
}

export interface SectionLookup {
  supersetCode: string      // "01. Title", "05. Background"
  sectionKey: string        // "title", "background"
  countryHeading: string    // Country-specific heading
  jsonSectionId: string     // Key in prompts.sections
  isRequired: boolean
  isApplicable: boolean     // false if "(N/A)" or "(Implicit)"
}

export type MergeStrategy = 'append' | 'prepend' | 'replace'

// ============================================================================
// Section Key Resolution
// ============================================================================

// NOTE: Section aliases are now ONLY resolved via database (SupersetSection.aliases)
// No hardcoded alias maps - see section-alias-service.ts for database-driven resolution

/**
 * Map canonical drafting section keys (camelCase) to database prompt IDs.
 * Database prompt IDs use snake_case (e.g. "field", "best_mode"), while the app stores/queries
 * sections using canonical camelCase keys (e.g. "fieldOfInvention", "bestMethod").
 * This mapping ensures compatibility between the two naming conventions.
 */
const SECTION_KEY_TO_PROMPT_KEY: Record<string, string> = {
  title: 'title',
  preamble: 'preamble',
  crossReference: 'cross_reference',
  fieldOfInvention: 'field',
  background: 'background',
  objectsOfInvention: 'objects',
  summary: 'summary',
  technicalProblem: 'technical_problem',
  technicalSolution: 'technical_solution',
  advantageousEffects: 'advantageous_effects',
  briefDescriptionOfDrawings: 'brief_drawings',
  detailedDescription: 'detailed_description',
  bestMethod: 'best_mode',
  industrialApplicability: 'industrial_applicability',
  claims: 'claims',
  abstract: 'abstract',
  listOfNumerals: 'reference_numerals'
}

const PROMPT_KEY_TO_SECTION_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION_KEY_TO_PROMPT_KEY).map(([sectionKey, promptKey]) => [promptKey, sectionKey])
)

function isSupportedCanonicalSectionKey(sectionKey: string): boolean {
  return getSupportedSectionKeys().includes(sectionKey)
}

function getSupersetPromptKeyForCanonicalSectionKey(sectionKey: string): string {
  return SECTION_KEY_TO_PROMPT_KEY[sectionKey] || sectionKey
}

/**
 * Resolves any section identifier to its canonical superset key
 * 
 * DATABASE IS THE ONLY SOURCE OF TRUTH - No hardcoded fallbacks
 * 
 * Resolution order:
 * 1. Prompt-ID to canonical mapping (database prompt IDs like "field", "best_mode")
 * 2. Alias-to-canonical (SupersetSection.aliases; cached; DB-driven)
 * 3. Database mapping (CountrySectionMapping)
 */
export async function resolveSectionKey(
  countryCode: string,
  inputSectionId: string
): Promise<string | null> {
  const raw = (inputSectionId || '').trim()
  if (!raw) return null

  const lower = raw.toLowerCase()
  const normalizedNoPunct = lower.replace(/[^a-z0-9]/g, '')
  const normalizedUnderscore = lower
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  // 1. Direct mapping from database prompt IDs to canonical section keys
  // This maps prompt keys like "field" to canonical keys like "fieldOfInvention"
  for (const candidate of [lower, normalizedUnderscore]) {
    const mapped = PROMPT_KEY_TO_SECTION_KEY[candidate]
    if (mapped && isSupportedCanonicalSectionKey(mapped)) {
      return mapped
    }
  }

  // 2. Alias-to-canonical resolution (DB-driven via SupersetSection.aliases; cached)
  // This is the primary resolution path - uses database as source of truth
  for (const candidate of [raw, lower, normalizedUnderscore, normalizedNoPunct]) {
    const canonical = await resolveCanonicalKey(candidate)
    if (isSupportedCanonicalSectionKey(canonical)) {
      return canonical
    }
  }

  // 3. Database mapping (CountrySectionMapping) - final attempt
  const mapping = await prisma.countrySectionMapping.findFirst({
    where: {
      countryCode: countryCode.toUpperCase(),
      OR: [
        { sectionKey: raw },
        { sectionKey: { equals: lower, mode: 'insensitive' } },
        { sectionKey: { equals: normalizedNoPunct, mode: 'insensitive' } },
        { supersetCode: { contains: raw, mode: 'insensitive' } }
      ]
    }
  })
  
  if (mapping?.sectionKey && isSupportedCanonicalSectionKey(mapping.sectionKey)) {
    return mapping.sectionKey
  }
  
  return null
}

// ============================================================================
// Prompt Merging
// ============================================================================

/**
 * Get merged prompt combining base superset + country top-up + user instructions
 * 
 * This is the main entry point for getting jurisdiction-aware prompts.
 * 
 * Hierarchy (lowest to highest priority):
 * 1. SupersetSection (database) - Base universal prompts
 * 2. CountrySectionPrompt (database) - Country-specific top-up guidance
 * 3. UserInstruction (database) - Per-session user customizations (HIGHEST)
 * 
 * @param countryCode - ISO country code (e.g., "IN", "US")
 * @param sectionId - Section identifier
 * @param sessionId - Optional drafting session ID for user instructions
 */
export async function getMergedPrompt(
  countryCode: string,
  sectionId: string,
  sessionId?: string
): Promise<MergedPrompt | null> {
  const jurisdiction = countryCode.toUpperCase()
  
  console.log(`\n${'═'.repeat(80)}`)
  console.log(`🔍 [PromptMerger] LOADING PROMPTS FOR: ${jurisdiction}/${sectionId}`)
  console.log(`${'═'.repeat(80)}`)
  
  // Step 1: Resolve to canonical section key
  const canonicalKey = await resolveSectionKey(jurisdiction, sectionId)
  if (!canonicalKey) {
    console.error(`[PromptMerger] ✗ FAILED: No canonical key found for "${sectionId}" in ${jurisdiction}`)
    console.log(`${'═'.repeat(80)}\n`)
    return null
  }
  console.log(`[PromptMerger] Canonical key resolved: ${sectionId} → ${canonicalKey}`)
  
  // Step 2: Get TOP-UP prompt from CountrySectionPrompt table (JURISDICTION-SPECIFIC)
  let topUpPrompt: { instruction?: string; constraints?: string[]; additions?: string[]; importFiguresDirectly?: boolean } | null = null
  let importFiguresDirectly = false
  
  topUpPrompt = await getDbSectionPrompt(jurisdiction, canonicalKey)
  if (topUpPrompt && topUpPrompt.instruction) {
    importFiguresDirectly = topUpPrompt.importFiguresDirectly || false
    console.log(`[PromptMerger] [T] TOP-UP: ✓ LOADED from CountrySectionPrompt (${topUpPrompt.instruction.length} chars)`)
    console.log(`[PromptMerger]     Preview: "${topUpPrompt.instruction.substring(0, 100)}..."`)
  } else {
    console.log(`[PromptMerger] [T] TOP-UP: ✗ NOT FOUND in CountrySectionPrompt for ${jurisdiction}/${canonicalKey}`)
  }
  
  // Step 3: Get BASE prompt - TRY DATABASE FIRST (SupersetSection), NO HARDCODED FALLBACK
  let basePrompt: { instruction: string; constraints: string[] } | undefined
  
  // Try to load from SupersetSection table (database)
  try {
    const dbBaseSection = await prisma.supersetSection.findFirst({
      where: {
        sectionKey: { equals: canonicalKey, mode: 'insensitive' },
        isActive: true
      },
      select: {
        instruction: true,
        constraints: true
      }
    })
    
    if (dbBaseSection && dbBaseSection.instruction) {
      basePrompt = {
        instruction: dbBaseSection.instruction,
        constraints: Array.isArray(dbBaseSection.constraints) ? dbBaseSection.constraints as string[] : []
      }
      console.log(`[PromptMerger] [B] BASE: ✓ LOADED from SupersetSection database (${dbBaseSection.instruction.length} chars)`)
      console.log(`[PromptMerger]     Preview: "${dbBaseSection.instruction.substring(0, 100)}..."`)
    } else {
      console.log(`[PromptMerger] [B] BASE: ✗ NOT FOUND in SupersetSection for ${canonicalKey}`)
    }
  } catch (err) {
    console.error(`[PromptMerger] [B] BASE: ✗ DATABASE ERROR:`, err)
  }

  // CRITICAL: At least one prompt (base OR top-up) must exist - NO HARDCODED FALLBACKS
  if (!topUpPrompt?.instruction && !basePrompt?.instruction) {
    const errorMsg = `NO PROMPTS FOUND IN DATABASE for ${jurisdiction}/${canonicalKey}. Add prompts to SupersetSection (base) or CountrySectionPrompt (top-up) tables.`
    console.error(`[PromptMerger] ✗ ERROR: ${errorMsg}`)
    console.log(`${'═'.repeat(80)}\n`)
    throw new Error(errorMsg)
  }
  
  // Step 4: Get country profile
  const profile = await getCountryProfile(jurisdiction)
  
  // Step 5: Determine merge strategy
  // 'replace' = use only top-up prompt (ignore base)
  // 'append' = base first, then top-up additions - SAFE DEFAULT
  // 'prepend' = top-up first, then base
  const profileStrategy = profile?.profileData?.meta?.promptMergeStrategy
  const mergeStrategy: MergeStrategy = profileStrategy || 'append'
  
  console.log(`[PromptMerger] Merge Strategy: ${mergeStrategy} (profile: ${profileStrategy || 'default'})`)
  
  // Set topUp for backward compatibility with merge logic
  let topUp = topUpPrompt
  let topUpSource: 'db' | 'json' | null = topUpPrompt?.instruction ? 'db' : null
  
  // Step 6: Get localized heading from DB mapping
  let sectionLabel = getDefaultLabel(canonicalKey)
  try {
    const mapping = await prisma.countrySectionMapping.findFirst({
      where: {
        countryCode: jurisdiction,
        sectionKey: canonicalKey
      }
    })
    if (mapping?.heading && 
        mapping.heading !== '(N/A)' && 
        mapping.heading !== '(Implicit)' &&
        mapping.heading !== '(Recommended/NA)' &&
        mapping.heading !== '(Include in Detailed Desc)') {
      sectionLabel = mapping.heading
    }
  } catch (error) {
    console.warn('Error getting section mapping:', error)
  }
  
  // Step 7: Get country-specific rules
  const countryRules = await getCountryRulesForSection(jurisdiction, canonicalKey, profile)
  
  // Step 8: Get base style
  const baseStyle = await getBaseStyle(jurisdiction)
  
  // Step 9: Get user instructions (HIGHEST PRIORITY) if sessionId provided
  // Looks for jurisdiction-specific instruction first, then falls back to wildcard
  let userInstr: UserInstructionContext | null = null
  let userInstructionBlock = ''
  if (sessionId) {
    try {
      userInstr = await getUserInstruction(sessionId, canonicalKey, jurisdiction)
      if (userInstr) {
        userInstructionBlock = buildUserInstructionBlock(userInstr)
        console.log(`[PromptMerger] [U] USER: ✓ LOADED user instruction for session ${sessionId}`)
        console.log(`[PromptMerger]     Preview: "${userInstr.instruction?.substring(0, 100)}..."`)
      } else {
        console.log(`[PromptMerger] [U] USER: ✗ No user instruction for session ${sessionId}`)
      }
    } catch (error) {
      console.warn(`[PromptMerger] [U] USER: ✗ Error loading:`, error)
    }
  } else {
    console.log(`[PromptMerger] [U] USER: ✗ No session ID provided`)
  }
  
  // Step 10: MERGE prompts based on strategy
  const hasUser = !!userInstr
  const hasBase = !!basePrompt?.instruction
  const hasTopUp = !!topUp?.instruction
  
  // Log final B+T+U summary
  console.log(`[PromptMerger] ─────────────────────────────────────────`)
  console.log(`[PromptMerger] FINAL B+T+U STATUS:`)
  console.log(`[PromptMerger]   [B] BASE:   ${hasBase ? '✓' : '✗'}`)
  console.log(`[PromptMerger]   [T] TOP-UP: ${hasTopUp ? '✓' : '✗'} ${topUpSource ? `(${topUpSource})` : ''}`)
  console.log(`[PromptMerger]   [U] USER:   ${hasUser ? '✓' : '✗'}`)
  console.log(`[PromptMerger]   Strategy:   ${mergeStrategy}`)
  console.log(`[PromptMerger] ─────────────────────────────────────────`)
  
  let mergedInstruction: string
  let mergedConstraints: string[]
  
  if (hasTopUp && !hasBase) {
    // TOP-UP ONLY - use top-up prompt as primary (jurisdiction-specific)
    console.log(`[PromptMerger] → Using TOP-UP only (no base)`)
    const priorityHeader = buildPriorityHierarchyHeader(jurisdiction, false, true, hasUser)
    mergedInstruction = priorityHeader + `**[TOP-UP PROMPT - ${jurisdiction}]:**\n${topUp!.instruction}`
    mergedConstraints = [
      ...(topUp?.constraints || []),
      ...(topUp?.additions || []).map(a => `[${jurisdiction}] ${a}`)
    ]
  } else if (hasBase && !hasTopUp) {
    // BASE ONLY - use base prompt (country-neutral)
    console.log(`[PromptMerger] → Using BASE only (no top-up)`)
    const priorityHeader = buildPriorityHierarchyHeader(jurisdiction, true, false, hasUser)
    mergedInstruction = priorityHeader + `**[BASE PROMPT]:**\n${basePrompt!.instruction}`
    mergedConstraints = basePrompt?.constraints || []
  } else {
    // BOTH exist - merge based on strategy
    console.log(`[PromptMerger] → Merging BASE + TOP-UP with strategy: ${mergeStrategy}`)
    mergedInstruction = mergeInstructions(
      basePrompt?.instruction || '',
      topUp?.instruction,
      mergeStrategy,
      jurisdiction,
      sectionLabel,
      hasUser
    )
    mergedConstraints = mergeConstraints(
      basePrompt?.constraints || [],
      topUp?.constraints || [],
      topUp?.additions || [],
      jurisdiction
    )
  }
  
  // Append user instructions at the end (highest priority)
  if (userInstructionBlock) {
    mergedInstruction += userInstructionBlock
    console.log(`[PromptMerger] → User instruction appended to final prompt`)
  }
  
  console.log(`[PromptMerger] ✓ PROMPT MERGE COMPLETE for ${jurisdiction}/${canonicalKey}`)
  console.log(`[PromptMerger]   Final instruction length: ${mergedInstruction.length} chars`)
  console.log(`[PromptMerger]   Constraints count: ${mergedConstraints.length}`)
  console.log(`${'═'.repeat(80)}\n`)
  
  return {
    instruction: mergedInstruction,
    constraints: mergedConstraints,
    topUpInstruction: topUp?.instruction,
    userInstruction: userInstr || undefined,
    userInstructionBlock: userInstructionBlock || undefined,
    sectionLabel,
    sectionKey: canonicalKey,
    countryRules,
    baseStyle: baseStyle ? {
      tone: baseStyle.tone || 'technical, neutral, precise',
      voice: baseStyle.voice || 'impersonal_third_person',
      avoid: baseStyle.avoid || []
    } : undefined,
    mergeStrategy,
    importFiguresDirectly, // Special mode: bypass LLM and import figure titles directly
    // Debug fields for B+T+U panel
    hasBase,
    hasTopUp,
    hasUser,
    topUpSource,
    basePreview: basePrompt?.instruction?.substring(0, 100) + (basePrompt?.instruction && basePrompt.instruction.length > 100 ? '...' : ''),
    topUpPreview: topUp?.instruction?.substring(0, 100) + (topUp?.instruction && topUp.instruction.length > 100 ? '...' : '')
  }
}

/**
 * Build the priority hierarchy header for LLM prompt
 * This helps the LLM understand which instructions take precedence in case of conflicts
 */
function buildPriorityHierarchyHeader(
  jurisdiction: string,
  hasBase: boolean,
  hasTopUp: boolean,
  hasUser: boolean
): string {
  const activeLayers: string[] = []
  if (hasBase) activeLayers.push('BASE (universal)')
  if (hasTopUp) activeLayers.push(`COUNTRY-SPECIFIC (${jurisdiction})`)
  if (hasUser) activeLayers.push('USER CUSTOM (session)')
  
  return `
┌─────────────────────────────────────────────────────────────────────────────┐
│  INSTRUCTION PRIORITY HIERARCHY (follow in case of conflicts)               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Priority 1 (LOWEST):  BASE PROMPT - Universal patent drafting guidelines   │
│  Priority 2 (MEDIUM):  COUNTRY TOP-UP - ${jurisdiction.padEnd(3, ' ')} jurisdiction-specific rules      │
│  Priority 3 (HIGHEST): USER INSTRUCTIONS - Custom session instructions      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Active instruction layers: ${activeLayers.join(' → ').padEnd(44, ' ')} │
│  If instructions conflict, ALWAYS follow the HIGHER priority instruction.  │
└─────────────────────────────────────────────────────────────────────────────┘

`
}

/**
 * Merge base instruction with country-specific top-up
 */
function mergeInstructions(
  baseInstruction: string,
  topUpInstruction?: string,
  strategy: MergeStrategy = 'append',
  jurisdiction?: string,
  sectionLabel?: string,
  hasUser?: boolean
): string {
  const hasBase = !!baseInstruction
  const hasTopUp = !!topUpInstruction
  
  // Add priority hierarchy header
  const priorityHeader = buildPriorityHierarchyHeader(
    jurisdiction || 'UNIVERSAL',
    hasBase,
    hasTopUp,
    hasUser || false
  )
  
  if (!topUpInstruction) {
    return priorityHeader + `**[PRIORITY 1 - BASE PROMPT]:**\n${baseInstruction}`
  }
  
  const baseLabel = '**[PRIORITY 1 - BASE PROMPT]:**\n'
  const topUpLabel = `**[PRIORITY 2 - ${jurisdiction} COUNTRY TOP-UP]:**\n`
  
  switch (strategy) {
    case 'replace':
      // Country completely overrides base (still show hierarchy)
      return priorityHeader + `${topUpLabel}${topUpInstruction}\n\n(Note: Country prompt replaces base prompt for this section)`
      
    case 'prepend':
      // Country guidance comes first
      return priorityHeader + `${topUpLabel}${topUpInstruction}\n\n${baseLabel}${baseInstruction}`
      
    case 'append':
    default:
      // Base first, then country additions
      return priorityHeader + `${baseLabel}${baseInstruction}\n\n${topUpLabel}${topUpInstruction}`
  }
}

/**
 * Merge constraints arrays intelligently
 * - Deduplicates similar constraints
 * - Tags country-specific constraints
 * - Preserves order (base first, then country)
 */
function mergeConstraints(
  baseConstraints: string[],
  topUpConstraints: string[],
  additions: string[] = [],
  jurisdiction?: string
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  
  // Normalize for deduplication
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50)
  
  // Add base constraints first
  for (const c of baseConstraints) {
    const normalized = normalize(c)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      merged.push(c)
    }
  }
  
  // Add country-specific constraints with jurisdiction tag
  const countryConstraints = [...topUpConstraints, ...additions]
  for (const c of countryConstraints) {
    const normalized = normalize(c)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      // Tag with jurisdiction for transparency
      merged.push(jurisdiction ? `[${jurisdiction}] ${c}` : c)
    }
  }
  
  return merged
}

/**
 * Get country-specific rules for a section from profile
 */
async function getCountryRulesForSection(
  countryCode: string,
  sectionKey: string,
  profile: any
): Promise<any> {
  if (!profile?.profileData?.rules) return null
  
  const rules = profile.profileData.rules
  
  // Map section keys to rule blocks
  const ruleMap: Record<string, string[]> = {
    'title': ['title', 'global'],
    'abstract': ['abstract', 'global'],
    'claims': ['claims'],
    'detailedDescription': ['description', 'detailed_description'],
    'briefDescriptionOfDrawings': ['drawings'],
    'background': ['description'],
    'summary': ['description'],
    'industrialApplicability': ['procedural'],
    'bestMethod': ['description'],
    'preamble': ['global'],
    'crossReference': ['procedural']
  }
  
  const ruleKeys = ruleMap[sectionKey] || [sectionKey]
  
  // Collect all applicable rules
  const collectedRules: any = {}
  for (const key of ruleKeys) {
    if (rules[key]) {
      Object.assign(collectedRules, rules[key])
    }
  }
  
  return Object.keys(collectedRules).length > 0 ? collectedRules : null
}

// ============================================================================
// Section Lookup Utilities
// ============================================================================

/**
 * Get complete section lookup for a country
 * Returns all sections with their mapping and applicability status
 */
export async function getSectionLookup(
  countryCode: string
): Promise<SectionLookup[]> {
  const jurisdiction = countryCode.toUpperCase()
  
  try {
    // IMPORTANT: Order by displayOrder - this is the ONLY source of truth for section sequence
    const mappings = await prisma.countrySectionMapping.findMany({
      where: { countryCode: jurisdiction },
      orderBy: { displayOrder: 'asc' }
    })
    
    return mappings.map(m => ({
      supersetCode: m.supersetCode,
      sectionKey: m.sectionKey,
      countryHeading: m.heading,
      jsonSectionId: m.sectionKey, // Default to sectionKey
      isRequired: isRequiredSection(m.sectionKey),
      isApplicable: isApplicableHeading(m.heading)
    }))
  } catch (error) {
    console.error('Error getting section lookup:', error)
    return []
  }
}

/**
 * Get list of applicable section keys for a country
 * Filters out (N/A) and (Implicit) sections
 */
export async function getApplicableSectionsForCountry(
  countryCode: string
): Promise<string[]> {
  const lookup = await getSectionLookup(countryCode)
  return lookup
    .filter(s => s.isApplicable)
    .map(s => s.sectionKey)
}

/**
 * Get required section keys for a country
 */
export async function getRequiredSectionsForCountry(
  countryCode: string
): Promise<string[]> {
  const lookup = await getSectionLookup(countryCode)
  return lookup
    .filter(s => s.isApplicable && s.isRequired)
    .map(s => s.sectionKey)
}

// ============================================================================
// Helper Functions
// ============================================================================

function isRequiredSection(sectionKey: string): boolean {
  const optionalSections = [
    'preamble',
    'objectsOfInvention',
    'crossReference',
    'technicalProblem',
    'technicalSolution',
    'advantageousEffects',
    'bestMethod',
    'industrialApplicability'
  ]
  return !optionalSections.includes(sectionKey)
}

function isApplicableHeading(heading: string): boolean {
  if (!heading) return false
  const lowerHeading = heading.toLowerCase().trim()
  return lowerHeading !== '(n/a)' && 
         lowerHeading !== '(implicit)' && 
         lowerHeading !== 'n/a' &&
         heading.trim() !== ''
}

function getDefaultLabel(sectionKey: string): string {
  const labels: Record<string, string> = {
    title: 'Title of Invention',
    preamble: 'Preamble',
    crossReference: 'Cross-Reference to Related Applications',
    fieldOfInvention: 'Technical Field',
    background: 'Background',
    objectsOfInvention: 'Objects of the Invention',
    summary: 'Summary of the Invention',
    technicalProblem: 'Technical Problem',
    technicalSolution: 'Technical Solution',
    advantageousEffects: 'Advantageous Effects',
    briefDescriptionOfDrawings: 'Brief Description of the Drawings',
    detailedDescription: 'Detailed Description',
    bestMethod: 'Best Mode',
    industrialApplicability: 'Industrial Applicability',
    claims: 'Claims',
    abstract: 'Abstract',
    listOfNumerals: 'List of Reference Numerals'
  }
  return labels[sectionKey] || sectionKey
}

// ============================================================================
// Batch Operations (for drafting multiple sections efficiently)
// ============================================================================

/**
 * Get merged prompts for multiple sections at once
 * More efficient than calling getMergedPrompt multiple times
 * 
 * @param countryCode - ISO country code
 * @param sectionIds - Array of section identifiers
 * @param sessionId - Optional drafting session ID for user instructions
 */
export async function getMergedPromptsForSections(
  countryCode: string,
  sectionIds: string[],
  sessionId?: string
): Promise<Map<string, MergedPrompt>> {
  const results = new Map<string, MergedPrompt>()
  
  // Process in parallel
  const promises = sectionIds.map(async (sectionId) => {
    const merged = await getMergedPrompt(countryCode, sectionId, sessionId)
    if (merged) {
      results.set(sectionId, merged)
    }
  })
  
  await Promise.all(promises)
  return results
}

/**
 * Get all applicable merged prompts for a country
 * 
 * @param countryCode - ISO country code
 * @param sessionId - Optional drafting session ID for user instructions
 */
export async function getAllMergedPromptsForCountry(
  countryCode: string,
  sessionId?: string
): Promise<Map<string, MergedPrompt>> {
  const applicableSections = await getApplicableSectionsForCountry(countryCode)
  return getMergedPromptsForSections(countryCode, applicableSections, sessionId)
}
