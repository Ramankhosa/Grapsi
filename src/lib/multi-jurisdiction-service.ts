/**
 * Multi-Jurisdiction Filing Service
 * 
 * Handles:
 * 1. Reference Draft generation (superset sections)
 * 2. Section-by-section translation to target jurisdictions
 * 3. Diagram compatibility across jurisdictions
 * 4. Validation per jurisdiction
 */

import { prisma } from '@/lib/prisma'
import { llmGateway } from '@/lib/metering'
import type { LLMRequest } from '@/lib/metering'
import { getCountryProfile } from '@/lib/country-profile-service'
import { getSectionStageCode } from '@/lib/metering/section-stage-mapping'
import {
  buildUniversalDraftingBundle,
  buildAntiHallucinationGuards,
  shouldGateSection,
  isClaim1Available,
  getSectionInjectionConfig
} from '@/lib/section-injection-config'
import crypto from 'crypto'

const REFERENCE_DRAFT_PASS1_STAGE_CODE = 'DRAFT_REFERENCE_DRAFT_PASS1'
const REFERENCE_DRAFT_PASS2_STAGE_CODE = 'DRAFT_ANNEXURE_DESCRIPTION'

// ============================================================================
// Types
// ============================================================================

export interface ReferenceDraftResult {
  success: boolean
  draft?: Record<string, string>
  error?: string
  tokensUsed?: number
  // Warnings about missing context (prior art, figures, components) - non-blocking
  warnings?: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }>
}

export interface TranslationResult {
  success: boolean
  translatedContent?: string
  error?: string
  tokensUsed?: number
}

export interface DiagramCompatibilityResult {
  mostRestrictiveRules: {
    colorAllowed: boolean
    paperSize: string
    lineStyle: string
    minReferenceTextSizePt: number
  }
  compatibilityNotes: string[]
}

export interface SectionMapping {
  supersetKey: string
  countryKey: string
  countryHeading: string
  isApplicable: boolean
}

// Context injection requirements for a section
export interface SectionContextRequirements {
  requiresPriorArt: boolean
  requiresFigures: boolean
  requiresClaims: boolean
  requiresComponents: boolean
}

// ============================================================================
// Section Context Requirements (Database-Driven)
// ============================================================================

// NOTE: Context requirements MUST come from database (SupersetSection + CountrySectionMapping)
// If database doesn't have the data, we use SAFE DEFAULTS (all false) and log a warning
// This is different from section mapping which throws an error - context requirements are 
// optimization hints, not structural requirements

const SAFE_DEFAULT_CONTEXT: SectionContextRequirements = {
  requiresPriorArt: false,
  requiresFigures: false,
  requiresClaims: false,
  requiresComponents: false
}

// ============================================================================
// Jurisdiction Language Mapping
// ============================================================================

/**
 * Map jurisdiction code to ISO 639-1 language code
 * Used for selecting language-specific figures
 */
const JURISDICTION_LANGUAGE_MAP: Record<string, string> = {
  // Asia
  JP: 'ja',    // Japan → Japanese
  CN: 'zh',    // China → Chinese
  KR: 'ko',    // Korea → Korean
  IN: 'en',    // India → English (official patent language)
  TW: 'zh',    // Taiwan → Chinese
  MY: 'en',    // Malaysia → English
  SG: 'en',    // Singapore → English
  
  // Europe
  EP: 'en',    // European Patent → English (primary)
  DE: 'de',    // Germany → German
  FR: 'fr',    // France → French
  ES: 'es',    // Spain → Spanish
  IT: 'it',    // Italy → Italian
  NL: 'nl',    // Netherlands → Dutch
  CH: 'de',    // Switzerland → German (primary)
  AT: 'de',    // Austria → German
  SE: 'sv',    // Sweden → Swedish
  PL: 'pl',    // Poland → Polish
  
  // Americas
  US: 'en',    // United States → English
  CA: 'en',    // Canada → English (primary)
  BR: 'pt',    // Brazil → Portuguese
  MX: 'es',    // Mexico → Spanish
  AR: 'es',    // Argentina → Spanish
  
  // Other
  AU: 'en',    // Australia → English
  NZ: 'en',    // New Zealand → English
  RU: 'ru',    // Russia → Russian
  IL: 'he',    // Israel → Hebrew
  SA: 'ar',    // Saudi Arabia → Arabic
  UAE: 'ar',   // UAE → Arabic
  ZA: 'en',    // South Africa → English
  
  // International
  PCT: 'en',   // PCT → English (default)
  WIPO: 'en',  // WIPO → English
}

/**
 * Get language code for a jurisdiction
 */
export function getJurisdictionLanguage(jurisdiction: string): string {
  return JURISDICTION_LANGUAGE_MAP[jurisdiction.toUpperCase()] || 'en'
}

// ============================================================================
// Language-Aware Figure Selection
// ============================================================================

interface FigureInfo {
  figureNo: number
  title: string
  description?: string
  type?: string
  language?: string
}

/**
 * Get figures for a jurisdiction with language fallback
 * 
 * Priority:
 * 1. Figures in jurisdiction's language
 * 2. English figures (fallback)
 * 3. Any available figures (last resort)
 * 
 * @param session - The drafting session with figure data
 * @param jurisdiction - Target jurisdiction code
 * @returns Array of figures with language preference applied
 */
export function getFiguresForJurisdiction(
  session: any,
  jurisdiction: string
): FigureInfo[] {
  // Validate inputs
  if (!session) {
    console.warn('[getFiguresForJurisdiction] Session is null/undefined - returning empty figures')
    return []
  }
  
  const safeJurisdiction = jurisdiction || 'US'
  const targetLanguage = getJurisdictionLanguage(safeJurisdiction)
  
  // Collect all diagram sources with language info (with warnings for missing data)
  const diagramSources = Array.isArray(session.diagramSources) ? session.diagramSources : []
  const figurePlans = Array.isArray(session.figurePlans) ? session.figurePlans : []
  const sketchRecords = Array.isArray(session.sketchRecords) 
    ? session.sketchRecords.filter((s: any) => s.status === 'SUCCESS' && !s.isDeleted)
    : []
  
  // Log warnings for debugging if figure data seems missing but was expected
  if (!session.diagramSources && !session.figurePlans && !session.sketchRecords) {
    console.warn('[getFiguresForJurisdiction] No figure data found in session - this may be intentional or indicate missing includes')
  }
  
  // Group diagrams by figureNo and language
  const diagramsByFigure = new Map<number, Map<string, any>>()
  for (const source of diagramSources) {
    const figNo = source.figureNo
    const lang = source.language || 'en'
    if (!diagramsByFigure.has(figNo)) {
      diagramsByFigure.set(figNo, new Map())
    }
    diagramsByFigure.get(figNo)!.set(lang, source)
  }
  
  // Build figure list with language preference
  const figures: FigureInfo[] = []
  
  // Use finalized sequence if available
  if (session.figureSequenceFinalized && Array.isArray(session.figureSequence) && session.figureSequence.length > 0) {
    const figureSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
    
    for (const seqItem of figureSequence) {
      if (seqItem.type === 'diagram') {
        const plan = figurePlans.find((f: any) => f.id === seqItem.sourceId)
        const diagramLangs = diagramsByFigure.get(seqItem.finalFigNo)
        
        // Select best language version
        let selectedSource: any = null
        let selectedLanguage = 'en'
        
        if (diagramLangs) {
          // Priority: target language → English → any
          if (diagramLangs.has(targetLanguage)) {
            selectedSource = diagramLangs.get(targetLanguage)
            selectedLanguage = targetLanguage
          } else if (diagramLangs.has('en')) {
            selectedSource = diagramLangs.get('en')
            selectedLanguage = 'en'
          } else {
            // Use first available
            const firstEntry = diagramLangs.entries().next().value
            if (firstEntry) {
              selectedLanguage = firstEntry[0]
              selectedSource = firstEntry[1]
            }
          }
        }
        
        figures.push({
          figureNo: seqItem.finalFigNo,
          title: plan?.title || `Figure ${seqItem.finalFigNo}`,
          description: plan?.description || '',
          type: 'diagram',
          language: selectedLanguage
        })
      } else if (seqItem.type === 'sketch') {
        const sketch = sketchRecords.find((s: any) => s.id === seqItem.sourceId)
        if (sketch) {
          figures.push({
            figureNo: seqItem.finalFigNo,
            title: sketch.title || `Figure ${seqItem.finalFigNo}`,
            description: sketch.description || '',
            type: 'sketch',
            language: 'en' // Sketches are typically language-neutral
          })
        }
      }
    }
  } else {
    // Fallback: use figurePlans directly
    for (const plan of figurePlans) {
      const diagramLangs = diagramsByFigure.get(plan.figureNo)
      let selectedLanguage = 'en'
      
      if (diagramLangs) {
        if (diagramLangs.has(targetLanguage)) {
          selectedLanguage = targetLanguage
        } else if (diagramLangs.has('en')) {
          selectedLanguage = 'en'
        } else {
          const firstEntry = diagramLangs.entries().next().value
          if (firstEntry) selectedLanguage = firstEntry[0]
        }
      }
      
      figures.push({
        figureNo: plan.figureNo,
        title: plan.title || `Figure ${plan.figureNo}`,
        description: plan.description || '',
        type: 'diagram',
        language: selectedLanguage
      })
    }
  }
  
  // Log language selection
  const langCounts = figures.reduce((acc, f) => {
    acc[f.language || 'unknown'] = (acc[f.language || 'unknown'] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log(`[getFiguresForJurisdiction] ${jurisdiction} (target: ${targetLanguage}): ${figures.length} figures`, langCounts)
  
  return figures
}

// ============================================================================
// Batch Context Requirements Helper
// ============================================================================

/**
 * Check what context types are needed by any section in a batch
 * Used to determine what data to include in the prompt for batch generation
 * Also validates for obvious misconfigurations
 */
export function getBatchContextNeeds(
  contextRequirements: Record<string, SectionContextRequirements>
): { needsPriorArt: boolean; needsFigures: boolean; needsClaims: boolean; needsComponents: boolean } {
  let needsPriorArt = false
  let needsFigures = false
  let needsClaims = false
  let needsComponents = false
  
  for (const [sectionKey, req] of Object.entries(contextRequirements)) {
    if (req.requiresPriorArt) needsPriorArt = true
    if (req.requiresFigures) needsFigures = true
    if (req.requiresClaims) needsClaims = true
    if (req.requiresComponents) needsComponents = true
    
    // Warn about obvious misconfigurations that could produce empty/broken sections
    if (sectionKey === 'briefDescriptionOfDrawings' && !req.requiresFigures) {
      console.warn(`[ContextValidation] briefDescriptionOfDrawings has requiresFigures=false - section may be empty`)
    }
    if (sectionKey === 'listOfNumerals' && !req.requiresComponents) {
      console.warn(`[ContextValidation] listOfNumerals has requiresComponents=false - section may be empty`)
    }
  }
  
  return { needsPriorArt, needsFigures, needsClaims, needsComponents }
}

/**
 * Get context requirements for a section from database with fallback
 * 
 * Priority:
 * 1. CountrySectionMapping override (jurisdiction-specific)
 * 2. SupersetSection defaults (universal)
 * 3. Fallback constants (hardcoded safe defaults)
 * 
 * @param sectionKey - The canonical superset section key
 * @param jurisdiction - Optional jurisdiction code for country-specific overrides
 */
export async function getSectionContextRequirements(
  sectionKey: string,
  jurisdiction?: string
): Promise<SectionContextRequirements> {
  // Default result
  let result: SectionContextRequirements = {
    requiresPriorArt: false,
    requiresFigures: false,
    requiresClaims: false,
    requiresComponents: false
  }

  // 1. Check CountrySectionMapping for jurisdiction-specific override
  if (jurisdiction) {
    try {
      const mapping = await prisma.countrySectionMapping.findFirst({
        where: { 
          countryCode: jurisdiction.toUpperCase(), 
          sectionKey,
          isEnabled: true
        }
      })
      
      if (mapping) {
        // Use overrides if explicitly set (not null)
        if ((mapping as any).requiresPriorArtOverride !== null) {
          result.requiresPriorArt = (mapping as any).requiresPriorArtOverride ?? false
        }
        if ((mapping as any).requiresFiguresOverride !== null) {
          result.requiresFigures = (mapping as any).requiresFiguresOverride ?? false
        }
        if ((mapping as any).requiresClaimsOverride !== null) {
          result.requiresClaims = (mapping as any).requiresClaimsOverride ?? false
        }
        if ((mapping as any).requiresComponentsOverride !== null) {
          result.requiresComponents = (mapping as any).requiresComponentsOverride ?? false
        }
        
        // If any override was set, we have a valid result
        const hasOverride = [
          (mapping as any).requiresPriorArtOverride,
          (mapping as any).requiresFiguresOverride,
          (mapping as any).requiresClaimsOverride,
          (mapping as any).requiresComponentsOverride
        ].some(v => v !== null && v !== undefined)
        
        if (hasOverride) {
          return result
        }
      }
    } catch (err) {
      console.warn(`[getSectionContextRequirements] Error checking CountrySectionMapping for ${jurisdiction}/${sectionKey}:`, err)
    }
  }

  // 2. Check SupersetSection for universal defaults
  try {
    const supersetSection = await prisma.supersetSection.findUnique({
      where: { sectionKey }
    })
    
    if (supersetSection) {
      return {
        requiresPriorArt: (supersetSection as any).requiresPriorArt ?? false,
        requiresFigures: (supersetSection as any).requiresFigures ?? false,
        requiresClaims: (supersetSection as any).requiresClaims ?? false,
        requiresComponents: (supersetSection as any).requiresComponents ?? false
      }
    }
  } catch (err) {
    console.warn(`[getSectionContextRequirements] Error checking SupersetSection for ${sectionKey}:`, err)
  }

  // 3. DATABASE IS THE ONLY SOURCE OF TRUTH - Use safe defaults and log warning
  console.warn(`[getSectionContextRequirements] Section "${sectionKey}" not found in database (SupersetSection). Using safe defaults (all false). Please configure SupersetSection table.`)
  return { ...SAFE_DEFAULT_CONTEXT }
}

/**
 * Batch fetch context requirements for multiple sections
 * More efficient than calling getSectionContextRequirements for each section
 */
export async function getBatchSectionContextRequirements(
  sectionKeys: string[],
  jurisdiction?: string
): Promise<Record<string, SectionContextRequirements>> {
  const result: Record<string, SectionContextRequirements> = {}
  
  try {
    // Fetch all SupersetSections at once
    const supersetSections = await prisma.supersetSection.findMany({
      where: { sectionKey: { in: sectionKeys } }
    })
    
    const supersetMap = new Map(supersetSections.map(s => [s.sectionKey, s]))
    
    // Fetch CountrySectionMappings if jurisdiction provided
    // IMPORTANT: Order by displayOrder - this is the ONLY source of truth for section sequence
    let mappingsMap = new Map<string, any>()
    if (jurisdiction) {
      const mappings = await prisma.countrySectionMapping.findMany({
        where: {
          countryCode: jurisdiction.toUpperCase(),
          sectionKey: { in: sectionKeys },
          isEnabled: true
        },
        orderBy: { displayOrder: 'asc' }
      })
      mappingsMap = new Map(mappings.map(m => [m.sectionKey, m]))
    }
    
    // Build result for each section - DATABASE IS THE ONLY SOURCE OF TRUTH
    const missingSections: string[] = []
    
    for (const key of sectionKeys) {
      const mapping = mappingsMap.get(key)
      const superset = supersetMap.get(key)
      
      // Start with safe defaults (all false)
      let requirements: SectionContextRequirements = { ...SAFE_DEFAULT_CONTEXT }
      
      // Apply SupersetSection defaults from database
      if (superset) {
        requirements = {
          requiresPriorArt: (superset as any).requiresPriorArt ?? false,
          requiresFigures: (superset as any).requiresFigures ?? false,
          requiresClaims: (superset as any).requiresClaims ?? false,
          requiresComponents: (superset as any).requiresComponents ?? false
        }
      } else {
        missingSections.push(key)
      }
      
      // Apply jurisdiction-specific overrides from database
      if (mapping) {
        if ((mapping as any).requiresPriorArtOverride !== null && (mapping as any).requiresPriorArtOverride !== undefined) {
          requirements.requiresPriorArt = (mapping as any).requiresPriorArtOverride
        }
        if ((mapping as any).requiresFiguresOverride !== null && (mapping as any).requiresFiguresOverride !== undefined) {
          requirements.requiresFigures = (mapping as any).requiresFiguresOverride
        }
        if ((mapping as any).requiresClaimsOverride !== null && (mapping as any).requiresClaimsOverride !== undefined) {
          requirements.requiresClaims = (mapping as any).requiresClaimsOverride
        }
        if ((mapping as any).requiresComponentsOverride !== null && (mapping as any).requiresComponentsOverride !== undefined) {
          requirements.requiresComponents = (mapping as any).requiresComponentsOverride
        }
      }
      
      result[key] = requirements
    }
    
    // Log warning for sections not found in database
    if (missingSections.length > 0) {
      console.warn(`[getBatchSectionContextRequirements] Sections not found in SupersetSection table (using safe defaults): ${missingSections.join(', ')}`)
    }
  } catch (err) {
    console.error('[getBatchSectionContextRequirements] Database error:', err)
    
    // Use safe defaults for all sections on error
    for (const key of sectionKeys) {
      result[key] = { ...SAFE_DEFAULT_CONTEXT }
    }
  }
  
  return result
}

// ============================================================================
// Superset Section Keys (Reference Draft uses these)
// 
// DATABASE IS THE ONLY SOURCE OF TRUTH
// All section keys and ordering come from SupersetSection table
// See /super-admin/superset-sections for configuration
// ============================================================================

// Cache for superset section keys from database
let supersetSectionsCache: string[] | null = null
let supersetSectionsCacheTimestamp = 0
const SUPERSET_CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Get all superset section keys from database, ordered by displayOrder
 * DATABASE IS THE ONLY SOURCE OF TRUTH - No hardcoded fallbacks
 */
export async function getSupersetSectionKeys(): Promise<string[]> {
  const now = Date.now()
  
  if (supersetSectionsCache && (now - supersetSectionsCacheTimestamp) < SUPERSET_CACHE_DURATION) {
    return supersetSectionsCache
  }
  
  const sections = await prisma.supersetSection.findMany({
    where: { isActive: true },
    select: { sectionKey: true },
    orderBy: { displayOrder: 'asc' }
  })
  
  if (sections.length === 0) {
    throw new Error(
      '[MultiJurisdictionService] CRITICAL: No SupersetSection entries found in database. ' +
      'Please seed the superset_sections table via /super-admin/superset-sections.'
    )
  }
  
  supersetSectionsCache = sections.map(s => s.sectionKey)
  supersetSectionsCacheTimestamp = now
  
  return supersetSectionsCache
}

/**
 * Check if a section key is a valid superset key
 * Queries database to validate
 */
export async function isValidSupersetKey(sectionKey: string): Promise<boolean> {
  const keys = await getSupersetSectionKeys()
  return keys.includes(sectionKey)
}

/**
 * Invalidate the superset sections cache
 * Call after database updates
 */
export function invalidateSupersetSectionsCache(): void {
  supersetSectionsCache = null
  supersetSectionsCacheTimestamp = 0
}

// ============================================================================
// N/A Heading Detection - CENTRALIZED for consistency across all functions
// ============================================================================

/**
 * Headings that indicate a section is NOT applicable for a jurisdiction.
 * Used consistently across:
 * - getSectionMapping()
 * - computeDynamicSuperset()
 * - buildSectionDefinitions() in drafting-service.ts
 * - by-jurisdiction API route
 */
export const NA_HEADINGS = [
  '(N/A)', '(n/a)', 'N/A', 'n/a', 'NA', 'na',
  '(Implicit)', '(implicit)', 'Implicit', 'implicit',
  '(Recommended/NA)', '(recommended/na)', 'Recommended/NA',
  '(Include in Detailed Desc)', '(include in detailed desc)',
  'Include in Detailed Desc', 'Include in Detailed Description'
]

/**
 * Check if a heading indicates the section is NOT applicable.
 * Case-insensitive comparison for robustness.
 */
export function isNonApplicableHeading(heading: string | null | undefined): boolean {
  if (!heading || typeof heading !== 'string') return false
  const trimmed = heading.trim()
  if (trimmed === '') return true // Empty heading = not applicable
  
  // Case-insensitive check against known N/A patterns
  const lowerHeading = trimmed.toLowerCase()
  return NA_HEADINGS.some(na => na.toLowerCase() === lowerHeading)
}

// NOTE: Section aliases are now ONLY resolved via database (SupersetSection.aliases)
// No hardcoded alias maps - see section-alias-service.ts for database-driven resolution

/**
 * Normalize a section key to its canonical superset key
 * Uses database-driven alias resolution via section-alias-service
 * 
 * DATABASE IS THE ONLY SOURCE OF TRUTH - No hardcoded fallbacks
 */
export async function normalizeToSupersetKey(key: string): Promise<string> {
  if (!key) return key
  const trimmed = key.trim()
  
  // Import the database-driven alias resolver
  const { resolveCanonicalKey } = await import('./section-alias-service')
  
  // Get valid superset keys from database
  const validKeys = await getSupersetSectionKeys()
  const validKeySet = new Set(validKeys)
  
  // Check if it's already a valid superset key (exact match)
  if (validKeySet.has(trimmed)) {
    return trimmed
  }
  
  // Try database-driven alias resolution
  const lowercased = trimmed.toLowerCase()
  const cleaned = lowercased.replace(/[.\s_-]/g, '')
  
  for (const candidate of [trimmed, lowercased, cleaned]) {
    const resolved = await resolveCanonicalKey(candidate)
    if (validKeySet.has(resolved)) {
      return resolved
    }
  }
  
  // Try to match against superset sections (case-insensitive)
  for (const section of validKeys) {
    if (section.toLowerCase() === lowercased || section.toLowerCase() === cleaned) {
      return section
    }
  }
  
  // Log unmatched keys for debugging
  console.warn(`[normalizeToSupersetKey] Could not normalize key: "${key}" - returning as-is`)
  
  return trimmed
}

// ============================================================================
// Diagram Compatibility
// ============================================================================

/**
 * Get the most restrictive diagram rules across all selected jurisdictions
 * Used when generating diagrams for multi-jurisdiction filing
 */
export async function getDiagramCompatibility(
  jurisdictions: string[]
): Promise<DiagramCompatibilityResult> {
  const notes: string[] = []
  
  // Default most restrictive values
  let colorAllowed = true
  let paperSize = 'A4'
  let lineStyle = 'black_and_white_solid'
  let minReferenceTextSizePt = 8

  for (const code of jurisdictions) {
    try {
      // Try database first
      const dbConfig = await prisma.countryDiagramConfig.findUnique({
        where: { countryCode: code.toUpperCase() }
      })

      if (dbConfig) {
        // Color: if ANY jurisdiction disallows color, no color
        if (!dbConfig.colorAllowed) {
          colorAllowed = false
          notes.push(`${code} requires black & white diagrams`)
        }
        
        // Paper size: prefer A4 as more universal
        if (dbConfig.paperSize === 'LETTER' && paperSize === 'A4') {
          // Keep A4 as it's more universally accepted
        }
        
        // Min text size: use the largest minimum
        if (dbConfig.minReferenceTextSizePt > minReferenceTextSizePt) {
          minReferenceTextSizePt = dbConfig.minReferenceTextSizePt
          notes.push(`${code} requires minimum ${dbConfig.minReferenceTextSizePt}pt text`)
        }
        
        continue
      }

      // Fallback to JSON profile
      const profile = await getCountryProfile(code)
      const drawings = profile?.profileData?.rules?.drawings
      
      if (drawings) {
        if (drawings.colorAllowed === false) {
          colorAllowed = false
          notes.push(`${code} requires black & white diagrams`)
        }
        if (drawings.minReferenceTextSizePt && drawings.minReferenceTextSizePt > minReferenceTextSizePt) {
          minReferenceTextSizePt = drawings.minReferenceTextSizePt
        }
      }
    } catch (err) {
      console.warn(`Failed to get diagram rules for ${code}:`, err)
    }
  }

  return {
    mostRestrictiveRules: {
      colorAllowed,
      paperSize,
      lineStyle,
      minReferenceTextSizePt
    },
    compatibilityNotes: notes
  }
}

/**
 * Build diagram generation prompt that respects all jurisdiction rules
 */
export function buildMultiJurisdictionDiagramPrompt(
  basePrompt: string,
  jurisdictions: string[],
  compatibility: DiagramCompatibilityResult
): string {
  const rules = compatibility.mostRestrictiveRules
  
  const jurisdictionList = jurisdictions.join(', ')
  const colorRule = rules.colorAllowed 
    ? 'Color may be used where helpful' 
    : 'MUST be BLACK AND WHITE ONLY - no colors, grayscale, or shading'
  
  return `${basePrompt}

MULTI-JURISDICTION COMPATIBILITY REQUIREMENTS:
This patent will be filed in: ${jurisdictionList}

DIAGRAM RULES (most restrictive across all jurisdictions):
- Color: ${colorRule}
- Paper size: ${rules.paperSize}
- Minimum reference text size: ${rules.minReferenceTextSizePt}pt
- Line style: Solid black lines only

${compatibility.compatibilityNotes.length > 0 ? `
SPECIFIC NOTES:
${compatibility.compatibilityNotes.map(n => `- ${n}`).join('\n')}
` : ''}

Generate diagrams that comply with ALL jurisdiction requirements.`
}

// ============================================================================
// Dynamic Superset Computation
// ============================================================================

/**
 * Compute the dynamic superset of sections needed for the selected jurisdictions
 * 
 * DIRECTLY QUERIES CountrySectionMapping table - the database is the ONLY source of truth.
 * The sectionKey field in the database IS the canonical superset key.
 * NO JSON fallbacks, NO normalization - database data must be correct.
 * 
 * @param jurisdictions - Array of country codes (e.g., ['US', 'EP', 'JP'])
 * @returns Object containing the dynamic sections array and per-jurisdiction mappings
 */
export async function computeDynamicSuperset(
  jurisdictions: string[]
): Promise<{
  sections: string[]
  sectionDetails: Record<string, { label: string; requiredBy: string[] }>
  jurisdictionMappings: Record<string, SectionMapping[]>
}> {
  const uniqueSections = new Set<string>()
  const sectionDetails: Record<string, { label: string; requiredBy: string[] }> = {}
  const jurisdictionMappings: Record<string, SectionMapping[]> = {}

  // Filter out REFERENCE pseudo-jurisdiction
  const validJurisdictions = jurisdictions
    .map(j => j.toUpperCase())
    .filter(j => j !== 'REFERENCE')

  if (validJurisdictions.length === 0) {
    console.warn('[computeDynamicSuperset] No valid jurisdictions provided')
    return { sections: [], sectionDetails: {}, jurisdictionMappings: {} }
  }

  // DIRECTLY query the database CountrySectionMapping table
  // This is the ONLY source of truth - no JSON, no fallbacks
  const dbMappings = await prisma.countrySectionMapping.findMany({
    where: {
      countryCode: { in: validJurisdictions },
      isEnabled: true
    },
    orderBy: [
      { countryCode: 'asc' },
      { displayOrder: 'asc' }
    ]
  })

  console.log(`[computeDynamicSuperset] Found ${dbMappings.length} mappings from CountrySectionMapping table for: ${validJurisdictions.join(', ')}`)
  
  // DATABASE IS THE ONLY SOURCE OF TRUTH - No fallbacks
  if (dbMappings.length === 0) {
    console.error(`[computeDynamicSuperset] CRITICAL: No CountrySectionMapping entries found for jurisdictions: ${validJurisdictions.join(', ')}. Database must be configured.`)
    throw new Error(`None of the selected jurisdictions (${validJurisdictions.join(', ')}) are configured in the database. Please add section mappings in CountrySectionMapping table.`)
  }

  // Get valid superset keys from database (with ordering)
  const validSupersetKeys = await getSupersetSectionKeys()
  const validSupersetKeySet = new Set(validSupersetKeys)
  
  // Track invalid section keys for debugging
  const invalidSectionKeys: Array<{ countryCode: string; sectionKey: string }> = []
  
  // Process database mappings - sectionKey SHOULD be a canonical superset key
  for (const mapping of dbMappings) {
    const countryCode = mapping.countryCode
    const sectionKey = mapping.sectionKey // This SHOULD be a canonical superset key from database
    const heading = mapping.heading || ''
    
    // Skip N/A, Implicit, or other non-applicable sections (use centralized check)
    if (isNonApplicableHeading(heading)) {
      continue
    }

    // VALIDATE: Check if sectionKey is a valid superset key (database-driven)
    if (!validSupersetKeySet.has(sectionKey)) {
      invalidSectionKeys.push({ countryCode, sectionKey })
      console.warn(`[computeDynamicSuperset] Invalid sectionKey "${sectionKey}" for ${countryCode} - not in SupersetSection table. Skipping.`)
      continue // Skip invalid keys
    }

    // Add to unique sections set - only valid superset keys
    uniqueSections.add(sectionKey)

    // Track which jurisdictions need this section
    if (!sectionDetails[sectionKey]) {
      sectionDetails[sectionKey] = {
        label: heading,
        requiredBy: []
      }
    }
    if (!sectionDetails[sectionKey].requiredBy.includes(countryCode)) {
      sectionDetails[sectionKey].requiredBy.push(countryCode)
    }

    // Build jurisdiction mappings for translation later
    if (!jurisdictionMappings[countryCode]) {
      jurisdictionMappings[countryCode] = []
    }
    jurisdictionMappings[countryCode].push({
      supersetKey: sectionKey,
      countryKey: sectionKey,
      countryHeading: heading,
      isApplicable: true
    })
  }

  // Sort sections by database displayOrder (validSupersetKeys is already ordered)
  // Only include sections that are needed by at least one jurisdiction
  const orderedSections: string[] = []
  
  for (const key of validSupersetKeys) {
    if (uniqueSections.has(key)) {
      orderedSections.push(key)
    }
  }

  console.log(`[computeDynamicSuperset] Result: ${orderedSections.length} sections from database for ${validJurisdictions.length} jurisdictions:`, orderedSections)
  
  // Warn about any invalid sectionKeys found in database
  if (invalidSectionKeys.length > 0) {
    console.warn(`[computeDynamicSuperset] Found ${invalidSectionKeys.length} invalid sectionKey(s) in CountrySectionMapping that don't match SupersetSection table:`, 
      invalidSectionKeys.map(k => `${k.countryCode}:${k.sectionKey}`).join(', '))
  }

  // DATABASE IS THE ONLY SOURCE OF TRUTH - Fail if no valid sections found
  if (orderedSections.length === 0) {
    console.error(`[computeDynamicSuperset] CRITICAL: No valid superset sections found after filtering. All sectionKeys in database may be invalid.`)
    throw new Error(`No valid sections found for jurisdictions (${validJurisdictions.join(', ')}). Check that CountrySectionMapping.sectionKey values match SupersetSection.sectionKey.`)
  }

  return {
    sections: orderedSections,
    sectionDetails,
    jurisdictionMappings
  }
}

/**
 * Get a human-readable summary of which sections are needed and why
 */
export function formatDynamicSupersetSummary(
  sectionDetails: Record<string, { label: string; requiredBy: string[] }>
): string {
  const lines: string[] = []
  for (const [key, detail] of Object.entries(sectionDetails)) {
    const countries = detail.requiredBy.join(', ')
    lines.push(`- ${detail.label} (${key}): Required by ${countries}`)
  }
  return lines.join('\n')
}

// ============================================================================
// Section Mapping
// ============================================================================

/**
 * Get section mapping from superset to country-specific sections
 * DIRECTLY from CountrySectionMapping database table - the ONLY source of truth
 */
export async function getSectionMapping(
  countryCode: string
): Promise<SectionMapping[]> {
  const code = countryCode.toUpperCase()

  // Query database directly - no JSON fallback
  const dbMappings = await prisma.countrySectionMapping.findMany({
    where: { countryCode: code, isEnabled: true },
    orderBy: { displayOrder: 'asc' }
  })

  // DATABASE IS THE ONLY SOURCE OF TRUTH - No fallbacks
  if (dbMappings.length === 0) {
    console.error(`[getSectionMapping] CRITICAL: No CountrySectionMapping entries found for jurisdiction "${code}". Database must be configured.`)
    throw new Error(`Jurisdiction "${code}" is not configured in the database. Please add section mappings in CountrySectionMapping table.`)
  }

  // Map database records to SectionMapping interface
  // sectionKey IS the canonical superset key
  return dbMappings.map(m => ({
    supersetKey: m.sectionKey,
    countryKey: m.sectionKey,
    countryHeading: m.heading || m.sectionKey,
    // Use centralized N/A check for consistency across all functions
    isApplicable: !isNonApplicableHeading(m.heading)
  }))
}

function extractSupersetKey(supersetCode: string): string {
  // "01. Title" -> "title"
  // "02. Field of Invention" -> "field"
  const match = supersetCode.match(/^\d+\.\s*(.+)$/)
  const label = match ? match[1].trim() : supersetCode
  return labelToKey(label)
}

function labelToKey(label: string): string {
  // Map display labels to canonical superset keys
  const mapping: Record<string, string> = {
    'Title': 'title',
    'Title of the Invention': 'title',
    'Preamble': 'preamble',
    'Field of Invention': 'fieldOfInvention',
    'Field of the Invention': 'fieldOfInvention',
    'Technical Field': 'fieldOfInvention',
    'Field': 'fieldOfInvention',
    'Background': 'background',
    'Background of the Invention': 'background',
    'Background of Invention': 'background',
    'Prior Art': 'background',
    'Objects of Invention': 'objectsOfInvention',
    'Objects of the Invention': 'objectsOfInvention',
    'Technical Problem': 'technicalProblem',
    'Technical Problem Solved': 'technicalProblem',
    'Technical Solution': 'technicalSolution',
    'Advantageous Effects': 'advantageousEffects',
    'Summary': 'summary',
    'Summary of Invention': 'summary',
    'Summary of the Invention': 'summary',
    'Disclosure of Invention': 'summary',
    'Brief Description of Drawings': 'briefDescriptionOfDrawings',
    'Brief Description of the Drawings': 'briefDescriptionOfDrawings',
    'Detailed Description': 'detailedDescription',
    'Detailed Description of the Invention': 'detailedDescription',
    'Best Mode': 'bestMethod',
    'Best Method': 'bestMethod',
    'Best Method of Performing the Invention': 'bestMethod',
    'Industrial Applicability': 'industrialApplicability',
    'Industrial Application': 'industrialApplicability',
    'Utility': 'industrialApplicability',
    'Claims': 'claims',
    'Abstract': 'abstract',
    'List of Reference Numerals': 'listOfNumerals',
    'Reference Signs': 'listOfNumerals',
    'Cross-Reference': 'crossReference',
    'Cross-Reference to Related Applications': 'crossReference'
  }
  if (mapping[label]) return mapping[label]
  // Fallback to async normalization
  return label.toLowerCase().replace(/\s+/g, '')
}

async function normalizeToSuperset(key: string): Promise<string> {
  // Use the canonical normalization function (async - uses database)
  return await normalizeToSupersetKey(key)
}

async function getDefaultHeading(key: string): Promise<string> {
  // Map canonical superset keys to display headings
  const headings: Record<string, string> = {
    'title': 'Title of the Invention',
    'preamble': 'Preamble',
    'fieldOfInvention': 'Field of the Invention',
    'background': 'Background of the Invention',
    'objectsOfInvention': 'Objects of the Invention',
    'summary': 'Summary of the Invention',
    'technicalProblem': 'Technical Problem',
    'technicalSolution': 'Technical Solution',
    'advantageousEffects': 'Advantageous Effects',
    'briefDescriptionOfDrawings': 'Brief Description of the Drawings',
    'detailedDescription': 'Detailed Description of the Invention',
    'bestMethod': 'Best Mode',
    'industrialApplicability': 'Industrial Applicability',
    'claims': 'Claims',
    'abstract': 'Abstract',
    'listOfNumerals': 'List of Reference Numerals',
    'crossReference': 'Cross-Reference to Related Applications'
  }
  if (headings[key]) return headings[key]
  const normalized = await normalizeToSupersetKey(key)
  return headings[normalized] || key
}

// ============================================================================
// Reference Draft Generation
// ============================================================================

// ============================================================================
// PROMPTS MUST COME FROM DATABASE ONLY - NO HARDCODED FALLBACKS
// ============================================================================
// SupersetSection table = Base prompts for reference draft generation
// CountrySectionPrompt table = Top-up prompts for jurisdiction-specific drafting
// If prompts are missing from database, an ERROR is thrown (no silent fallbacks)

/**
 * Fetch BASE PROMPTS (country-neutral) for reference draft generation.
 * 
 * DATABASE IS THE ONLY SOURCE OF TRUTH - NO HARDCODED FALLBACKS
 * 
 * Source: SupersetSection table (admin-configurable via Super Admin panel)
 * If prompts are missing, throws an error instead of silently falling back.
 */
async function getSupersetSectionPrompts(sectionKeys: string[]): Promise<Record<string, {
  instruction: string
  constraints: string[]
  label: string
  description?: string
}>> {
  const prompts: Record<string, any> = {}
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`[getSupersetSectionPrompts] LOADING BASE PROMPTS FROM DATABASE`)
  console.log(`[getSupersetSectionPrompts] Requested sections: ${sectionKeys.join(', ')}`)
  console.log(`${'='.repeat(80)}`)
  
  // Load from DATABASE ONLY (SupersetSection table)
  try {
    const dbSections = await prisma.supersetSection.findMany({
      where: {
        sectionKey: { in: sectionKeys, mode: 'insensitive' },
        isActive: true
      },
      select: {
        sectionKey: true,
        instruction: true,
        constraints: true,
        label: true,
        description: true
      }
    })

    for (const section of dbSections) {
      if (section.instruction && section.instruction.trim()) {
        prompts[section.sectionKey] = {
          instruction: section.instruction,
          constraints: Array.isArray(section.constraints) ? section.constraints : [],
          label: section.label,
          description: section.description || undefined
        }
        console.log(`[getSupersetSectionPrompts] ✓ LOADED: ${section.sectionKey} (${section.instruction.length} chars)`)
      } else {
        console.warn(`[getSupersetSectionPrompts] ✗ EMPTY: ${section.sectionKey} exists but has no instruction`)
      }
    }

    console.log(`[getSupersetSectionPrompts] Database result: ${Object.keys(prompts).length}/${sectionKeys.length} prompts loaded`)
  } catch (err) {
    console.error('[getSupersetSectionPrompts] DATABASE ERROR:', err)
    throw new Error(`Failed to load base prompts from SupersetSection database: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Check for missing sections - THROW ERROR instead of falling back
  const missingSections = sectionKeys.filter(key => !prompts[key])
  if (missingSections.length > 0) {
    const errorMsg = `MISSING BASE PROMPTS IN DATABASE (SupersetSection table): ${missingSections.join(', ')}. Please add these prompts via the Super Admin panel.`
    console.error(`[getSupersetSectionPrompts] ✗ ERROR: ${errorMsg}`)
    console.log(`${'='.repeat(80)}\n`)
    throw new Error(errorMsg)
  }

  console.log(`[getSupersetSectionPrompts] ✓ All ${sectionKeys.length} base prompts loaded successfully from database`)
  console.log(`${'='.repeat(80)}\n`)

  return prompts
}

async function parseReferenceDraftResponse(output: string, sectionKeys: string[]): Promise<Record<string, string> | null> {
  if (!output) return null

  const text = output.trim()
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi
  let merged: Record<string, any> = {}
  let fenceMatch: RegExpExecArray | null

  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    let block = (fenceMatch[1] || '').trim()
    if (!block) continue
    block = block.replace(/,(\s*[}\]])/g, '$1')
    try {
      const obj = JSON.parse(block)
      if (obj && typeof obj === 'object') {
        merged = { ...merged, ...obj }
      }
    } catch {
      try {
        const fallback = JSON.parse(block.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'))
        if (fallback && typeof fallback === 'object') {
          merged = { ...merged, ...fallback }
        }
      } catch {
        continue
      }
    }
  }

  let parsed: any = Object.keys(merged).length > 0 ? merged : null

  if (!parsed) {
    let jsonText = text
    const start = jsonText.indexOf('{')
    if (start !== -1) {
      jsonText = jsonText.slice(start)
    }
    jsonText = jsonText.replace(/```/g, '').replace(/,(\s*[}\]])/g, '$1')
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return null
    }
  }

  const normalized: Record<string, string> = {}
  if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = await normalizeToSupersetKey(key)
      if (typeof value === 'string' && !normalized[normalizedKey]) {
        normalized[normalizedKey] = value.trim()
      }
    }
  }

  const draft: Record<string, string> = {}
  for (const key of sectionKeys) {
    draft[key] = normalized[key] || ''
  }

  return draft
}

/**
 * Extended result type that includes dynamic superset info
 */
export interface ReferenceDraftResultExtended extends ReferenceDraftResult {
  dynamicSections?: string[]
  sectionDetails?: Record<string, { label: string; requiredBy: string[] }>
  jurisdictionMappings?: Record<string, SectionMapping[]>
}

/**
 * Generate reference draft with ONLY the sections needed by selected jurisdictions
 * Uses database-based prompts from SupersetSection table for consistency.
 * This optimizes cost and time by not generating unused sections.
 * 
 * @param session - The drafting session with ideaRecord, referenceMap, figurePlans
 * @param jurisdictions - Array of selected jurisdiction codes (e.g., ['US', 'EP', 'JP'])
 * @param tenantId - Optional tenant ID for metering
 * @param requestHeaders - Optional request headers
 */
export async function generateReferenceDraft(
  session: any,
  jurisdictions?: string[],
  tenantId?: string,
  requestHeaders?: Record<string, string>,
  frozenClaimsText?: string
): Promise<ReferenceDraftResultExtended> {
  try {
    const idea = session.ideaRecord || {}
    const referenceMap = session.referenceMap || { components: [] }
    const components = Array.isArray(referenceMap.components) ? referenceMap.components : []
    
    // ======================================================================
    // PRIOR ART EXTRACTION - Critical for background and crossReference sections
    // Follows same logic as DraftingService.generateSections()
    // ======================================================================
    const manualPriorArt = (session as any).manualPriorArt || null
    const rawRelatedArtSelections = Array.isArray(session.relatedArtSelections)
      ? session.relatedArtSelections
      : []
    const aiAnalysis = (session as any).aiAnalysisData || {}
    
    // Check for prior art selections from Stage 3.5 workflow
    const priorArtConfig = (session as any).priorArtConfig || {}
    const priorArtForDraftingConfig = priorArtConfig.priorArtForDrafting || {}
    const configSelectedPatents = Array.isArray(priorArtForDraftingConfig.selectedPatents) 
      ? priorArtForDraftingConfig.selectedPatents 
      : []
    
    // Strategy: Use user-selected patents first; fallback to any available related art
    let selectedPriorArtPatents: any[] = []
    let priorArtSource: 'explicit' | 'priorArtConfig' | 'relatedArtSelections' | 'manual_only' | 'none' = 'none'
    
    // Helper: Normalize patent number for consistent matching
    const normalizePN = (pn: string | undefined | null): string => 
      pn ? pn.replace(/[-\s]/g, '').toUpperCase().trim() : ''
    
    // Helper: Safe sort by score
    const safeScoreSort = (a: any, b: any): number => {
      const aScore = typeof a.score === 'number' ? a.score : 0
      const bScore = typeof b.score === 'number' ? b.score : 0
      return bScore - aScore
    }
    
    // Helper: Process and deduplicate patents
    const processPatents = (patents: any[], enrichSource: any[], preferConfigData: boolean = false): any[] => {
      const uniqueMap = new Map<string, any>()
      for (const sel of patents) {
        const rawPN = sel.patentNumber || sel.pn || ''
        const normalizedPN = normalizePN(rawPN)
        if (!normalizedPN || uniqueMap.has(normalizedPN)) continue
        
        const fullPatentData = enrichSource.find((r: any) => normalizePN(r.patentNumber) === normalizedPN) || {}
        const merged = {
          ...fullPatentData,
          ...(preferConfigData ? sel : {}),
          patentNumber: rawPN || fullPatentData.patentNumber,
          aiSummary: sel.aiSummary || fullPatentData.aiSummary || aiAnalysis[rawPN]?.aiSummary || '',
          noveltyComparison: sel.noveltyComparison || fullPatentData.noveltyComparison || aiAnalysis[rawPN]?.noveltyComparison || '',
          noveltyThreat: sel.noveltyThreat || fullPatentData.noveltyThreat || aiAnalysis[rawPN]?.noveltyThreat || 'unknown'
        }
        uniqueMap.set(normalizedPN, merged)
      }
      return Array.from(uniqueMap.values()).sort(safeScoreSort)
    }
    
    // Determine prior art source and process patents
    const userSelectedPool = rawRelatedArtSelections.filter(
      (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
    )
    const fallbackPool = userSelectedPool.length ? userSelectedPool : rawRelatedArtSelections
    
    if (configSelectedPatents.length > 0) {
      priorArtSource = 'priorArtConfig'
      selectedPriorArtPatents = processPatents(configSelectedPatents, rawRelatedArtSelections, true)
      console.log(`[generateReferenceDraft] Using ${selectedPriorArtPatents.length} patents from priorArtConfig.priorArtForDrafting`)
    } else if (manualPriorArt?.useOnlyManualPriorArt) {
      priorArtSource = 'manual_only'
      selectedPriorArtPatents = []
    } else if (fallbackPool.length > 0) {
      priorArtSource = 'relatedArtSelections'
      selectedPriorArtPatents = processPatents(fallbackPool, [], false)
      console.log(`[generateReferenceDraft] Using ${selectedPriorArtPatents.length} patents from relatedArtSelections`)
    }
    
    console.log(`[generateReferenceDraft] Prior art source: ${priorArtSource}, Manual: ${!!manualPriorArt}, Patents: ${selectedPriorArtPatents.length}`)
    
    // Build figures list - use finalized sequence if available (includes both diagrams and sketches)
    let figures: Array<{ figureNo: number; title: string; description?: string; type?: string }> = []
    
    if (session.figureSequenceFinalized && Array.isArray(session.figureSequence) && session.figureSequence.length > 0) {
      const figureSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
      const sequencedSourceIds = new Set(figureSequence.map(s => s.sourceId))
      
      for (const seqItem of figureSequence) {
        if (seqItem.type === 'diagram') {
          const plan = (session.figurePlans || []).find((f: any) => f.id === seqItem.sourceId)
          if (plan) {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: plan.title || `Figure ${seqItem.finalFigNo}`,
              description: plan.description || '',
              type: 'diagram'
            })
          } else {
            console.warn(`[ReferenceDraft] Diagram in sequence not found: sourceId=${seqItem.sourceId}`)
          }
        } else if (seqItem.type === 'sketch') {
          const sketch = (session.sketchRecords || []).find((s: any) => s.id === seqItem.sourceId)
          if (sketch && sketch.status === 'SUCCESS') {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: sketch.title || `Figure ${seqItem.finalFigNo}`,
              description: sketch.description || '',
              type: 'sketch'
            })
          } else {
            console.warn(`[ReferenceDraft] Sketch in sequence not found: sourceId=${seqItem.sourceId}`)
          }
        }
      }
      
      // Auto-append figures added after sequence was finalized
      for (const plan of (session.figurePlans || [])) {
        if (!sequencedSourceIds.has(plan.id)) {
          figures.push({
            figureNo: figures.length + 1,
            title: plan.title || `Figure ${figures.length + 1}`,
            description: plan.description || '',
            type: 'diagram'
          })
        }
      }
      for (const sketch of (session.sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')) {
        if (!sequencedSourceIds.has(sketch.id)) {
          console.log(`[ReferenceDraft] Adding sketch ${sketch.id} as fallback figure ${figures.length + 1}`)
          figures.push({
            figureNo: figures.length + 1,
            title: sketch.title || `Figure ${figures.length + 1}`,
            description: sketch.description || '',
            type: 'sketch'
          })
        }
      }
    } else {
      // Fallback: use figurePlans AND sketches directly (legacy behavior)
      const planFigures = Array.isArray(session.figurePlans) ? session.figurePlans.map((f: any) => ({
        figureNo: f.figureNo,
        title: f.title || `Figure ${f.figureNo}`,
        description: f.description || '',
        type: 'diagram'
      })) : []
      
      // Also include sketches in fallback mode
      const sketchRecords = (session.sketchRecords || []).filter((s: any) => s.status === 'SUCCESS')
      const maxPlanNo = planFigures.length > 0 ? Math.max(...planFigures.map((f: any) => f.figureNo)) : 0
      const sketchFigures = sketchRecords.map((s: any, index: number) => ({
        figureNo: maxPlanNo + index + 1,
        title: s.title || `Figure ${maxPlanNo + index + 1}`,
        description: s.description || '',
        type: 'sketch'
      }))
      
      figures = [...planFigures, ...sketchFigures]
      console.log(`[ReferenceDraft] Fallback mode: ${planFigures.length} diagrams + ${sketchFigures.length} sketches`)
    }

    // Determine the dynamic superset based on selected jurisdictions
    const selectedJurisdictions = jurisdictions?.length 
      ? jurisdictions 
      : (session.draftingJurisdictions || ['US']) // Fallback to session jurisdictions or US
    
    const { sections: dynamicSections, sectionDetails, jurisdictionMappings } = 
      await computeDynamicSuperset(selectedJurisdictions)

    console.log(`[generateReferenceDraft] Generating ${dynamicSections.length} sections for jurisdictions: ${selectedJurisdictions.join(', ')}`)

    // Fetch database-based prompts for the dynamic sections
    let sectionPrompts: Record<string, any>
    try {
      sectionPrompts = await getSupersetSectionPrompts(dynamicSections)
    } catch (err) {
      console.error('[generateReferenceDraft] Failed to load prompts:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Database configuration error: missing base prompts'
      }
    }
    console.log(`[generateReferenceDraft] Loaded ${Object.keys(sectionPrompts).length} section prompts from database`)

    // Fetch context requirements for all sections from database (batch query for efficiency)
    const contextRequirements = await getBatchSectionContextRequirements(dynamicSections)
    
    // Calculate what context is needed by the batch of sections
    const batchNeeds = getBatchContextNeeds(contextRequirements)
    
    const priorArtSections = dynamicSections.filter(key => contextRequirements[key]?.requiresPriorArt)
    const figureSections = dynamicSections.filter(key => contextRequirements[key]?.requiresFigures)
    const componentSections = dynamicSections.filter(key => contextRequirements[key]?.requiresComponents)
    const claimsSections = dynamicSections.filter(key => contextRequirements[key]?.requiresClaims)
    
    console.log(`[generateReferenceDraft] Context needs (database-driven):`)
    console.log(`  - Prior Art: ${priorArtSections.join(', ') || 'none'}`)
    console.log(`  - Figures: ${figureSections.join(', ') || 'none'}`)
    console.log(`  - Components: ${componentSections.join(', ') || 'none'}`)
    console.log(`  - Claims: ${claimsSections.join(', ') || 'none'}`)

    // ======================================================================
    // PRE-CALCULATE PRIOR ART COUNT (needed before sectionInstructions map)
    // This fixes the bug where priorArtCount was used before being defined
    // ======================================================================
    let priorArtCount = 0
    if (batchNeeds.needsPriorArt) {
      if (manualPriorArt) {
        const manualText = manualPriorArt.manualPriorArtText || manualPriorArt.text || ''
        if (manualPriorArt.useOnlyManualPriorArt && manualText) {
          priorArtCount = 1
        } else if (manualPriorArt.useManualAndAISearch) {
          priorArtCount = 1 + selectedPriorArtPatents.length
        }
      } else if (selectedPriorArtPatents.length > 0) {
        priorArtCount = selectedPriorArtPatents.length
      }
    }

    // Build section instructions using database prompts
    // Add section-specific context based on database-driven requirements
    const sectionInstructions = dynamicSections.map((key, idx) => {
      const prompt = sectionPrompts[key]
      const requiredBy = sectionDetails[key]?.requiredBy.join(', ') || 'General'
      const constraints = prompt.constraints.length > 0 
        ? `\n   Constraints: ${prompt.constraints.join('; ')}`
        : ''
      
      let instructionText = prompt.instruction
      let contextAddendum = ''
      
      // Get database-driven context requirements for this section
      const requirements = contextRequirements[key] || { requiresPriorArt: false, requiresFigures: false, requiresClaims: false, requiresComponents: false }
      
      // Special handling for claims - use frozen claims
      if (key === 'claims' && frozenClaimsText) {
        instructionText = 'Use the frozen claims provided in the context below verbatim. Do NOT regenerate or modify numbering/text; simply return the approved claims.'
      }
      // Database-driven: Add context-specific instructions based on requirements
      else {
        // Prior Art instructions
        if (requirements.requiresPriorArt && priorArtCount > 0) {
          if (key === 'background') {
            contextAddendum += `
   
   CRITICAL PRIOR ART REQUIREMENTS (database-driven):
   - You MUST reference ALL ${priorArtCount} prior art patents/references provided in the PRIOR ART REFERENCES section.
   - Para 1: Establish the technical context and problem space.
   - Para 2+: Discuss EACH prior art reference, identifying its approach and limitations/gaps.
   - Final paragraph: Segue to the present invention without claiming novelty.
   - Do NOT skip any prior art reference - discuss ALL ${priorArtCount} references.`
          } else if (key === 'technicalProblem') {
            contextAddendum += `
   
   PRIOR ART CONTEXT (database-driven):
   - Frame the technical problem in terms of what was lacking in the prior art.
   - Reference specific limitations from the PRIOR ART REFERENCES section.`
          }
        }
        
        // Figures instructions
        if (requirements.requiresFigures && figures.length > 0) {
          if (key === 'briefDescriptionOfDrawings') {
            contextAddendum += `
   
   FIGURES CONTEXT (database-driven):
   - Use the FIGURES list provided in the INVENTION CONTEXT section.
   - Generate one line per figure in format: "FIG. X is [description]."
   - Include ALL ${figures.length} figures listed.`
          } else if (key === 'detailedDescription') {
            contextAddendum += `
   
   FIGURES CONTEXT (database-driven):
   - Reference figures using format: "As shown in FIG. X, ...".
   - Use reference numerals from the COMPONENTS list when referring to elements.`
          }
        }
        
        // Components instructions
        if (requirements.requiresComponents && components.length > 0) {
          if (key === 'detailedDescription' || key === 'briefDescriptionOfDrawings') {
            contextAddendum += `
   
   COMPONENTS CONTEXT (database-driven):
   - Use reference numerals from the COMPONENTS list when describing elements.
   - Format: "component name (numeral)", e.g., "processor (102)".`
          } else if (key === 'claims') {
            contextAddendum += `
   
   COMPONENTS CONTEXT (database-driven):
   - Use consistent terminology matching the COMPONENTS list.
   - Maintain proper antecedent basis throughout claims.`
          }
        }
        
        // Claim 1 anchoring/avoidance instructions (config-driven)
        // Per SRS: Each section has specific rules about whether to use Claim 1
        const sectionConfig = getSectionInjectionConfig(key)
        
        if (sectionConfig.injectClaim1 && sectionConfig.claim1Mode === 'bindingAnchor') {
          // Section SHOULD use Claim 1 as binding anchor
          contextAddendum += `
   
   CLAIM 1 ANCHORING (REQUIRED for this section):
   - Align all content with Claim 1 provided in the context.
   - Do NOT add elements not supported by Claim 1.
   - Keep terminology EXACTLY consistent with Claim 1 language.
   - All features described must trace back to Claim 1.`
        } else if (sectionConfig.injectClaim1 && sectionConfig.claim1Mode === 'constraintOnly') {
          // Section uses Claim 1 for terminology consistency only
          contextAddendum += `
   
   CLAIM 1 CONSTRAINT:
   - Use Claim 1 ONLY for terminology consistency.
   - Do NOT enumerate or restate claim features.
   - Avoid contradiction with Claim 1 scope.`
        } else if (!sectionConfig.injectClaim1) {
          // Section should NOT use Claim 1 - add explicit avoidance instruction
          contextAddendum += `
   
   NOTE: Do NOT reference Claim 1 for this section. Write based on the normalized invention context only.`
        }
      }
      
      return `==== SECTION ${idx + 1}: ${prompt.label} (key: "${key}") ====
Required by: ${requiredBy}
${instructionText}${constraints}${contextAddendum}`
    }).join('\n\n')

    // ======================================================================
    // BUILD CONTEXT DATA - ONLY INCLUDE WHAT'S NEEDED BY SECTIONS
    // ======================================================================
    
    // ══════════════════════════════════════════════════════════════════════════════
    // IMPORTANT: Full claims are NOT injected for drafting sections.
    // Claim 1 anchoring is handled by UDB (Universal Drafting Bundle).
    // Full claims are only used:
    // 1. For the 'claims' section itself (verbatim return)
    // 2. For AI review/validation AFTER draft generation
    // ══════════════════════════════════════════════════════════════════════════════
    const claimsContext = '' // Full claims injection disabled for drafting - use UDB Claim 1 anchoring

    // Prior Art context - only if any section needs it
    // Note: priorArtCount is pre-calculated above for use in sectionInstructions
    let priorArtContext = ''
    
    if (batchNeeds.needsPriorArt) {
      if (manualPriorArt) {
        const manualText = manualPriorArt.manualPriorArtText || manualPriorArt.text || ''
        if (manualPriorArt.useOnlyManualPriorArt && manualText) {
          priorArtContext = `
PRIOR ART REFERENCES (for sections: ${priorArtSections.join(', ')}):
MANUAL PRIOR ART ANALYSIS (user-provided - treat as highly relevant):
${manualText}
`
          priorArtCount = 1
        } else if (manualPriorArt.useManualAndAISearch) {
          const aiPatentLines = selectedPriorArtPatents.map((patent: any) => {
            const pn = patent.patentNumber || patent.pn || 'Unknown'
            const title = patent.title ? ` - ${String(patent.title).substring(0, 100)}` : ''
            const summary = patent.aiSummary ? `\n   Relevance: ${String(patent.aiSummary).substring(0, 200)}...` : ''
            const novelty = patent.noveltyComparison ? `\n   Novelty Analysis: ${String(patent.noveltyComparison).substring(0, 200)}...` : ''
            return `- ${pn}${title}${summary}${novelty}`
          }).join('\n')
          
          priorArtContext = `
PRIOR ART REFERENCES (for sections: ${priorArtSections.join(', ')}):
MANUAL PRIOR ART ANALYSIS (user-provided):
${manualText}

AI-IDENTIFIED RELATED PATENTS (${selectedPriorArtPatents.length} references):
${aiPatentLines || 'No AI-selected patents'}
`
          priorArtCount = 1 + selectedPriorArtPatents.length
        }
      } else if (selectedPriorArtPatents.length > 0) {
        const patentLines = selectedPriorArtPatents.map((patent: any) => {
          const pn = patent.patentNumber || patent.pn || 'Unknown'
          const title = patent.title ? ` - ${String(patent.title).substring(0, 100)}` : ''
          const summary = patent.aiSummary ? `\n   Relevance: ${String(patent.aiSummary).substring(0, 200)}...` : ''
          const novelty = patent.noveltyComparison ? `\n   Novelty Analysis: ${String(patent.noveltyComparison).substring(0, 200)}...` : ''
          return `- ${pn}${title}${summary}${novelty}`
        }).join('\n')
        
        priorArtContext = `
PRIOR ART REFERENCES (for sections: ${priorArtSections.join(', ')}):
RELATED PATENTS (${selectedPriorArtPatents.length} references - discuss ALL in Background section):
${patentLines}
`
        priorArtCount = selectedPriorArtPatents.length
      }
      console.log(`[generateReferenceDraft] Prior art context: ${priorArtCount} references available`)
    }
    
    // Figures context - only if any section needs it (use language-aware selection)
    let figuresContext = ''
    if (batchNeeds.needsFigures && figures.length > 0) {
      // Use language-aware figure selection for primary jurisdiction
      const primaryJurisdiction = selectedJurisdictions[0] || 'US'
      const languageAwareFigures = getFiguresForJurisdiction(session, primaryJurisdiction)
      
      figuresContext = `
FIGURES (for sections: ${figureSections.join(', ')}):
${languageAwareFigures.map((f: FigureInfo) => `  Fig.${f.figureNo}: ${f.title}${f.description ? ` - ${f.description}` : ''}${f.language && f.language !== 'en' ? ` [${f.language}]` : ''}`).join('\n')}
`
      console.log(`[generateReferenceDraft] Figures context: ${languageAwareFigures.length} figures included`)
    }
    
    // Components context - only if any section needs it
    let componentsContext = ''
    if (batchNeeds.needsComponents && components.length > 0) {
      componentsContext = `
COMPONENTS (for sections: ${componentSections.join(', ')}):
${components.map((c: any) => `  - ${c.name} (${c.numeral})`).join('\n')}
`
      console.log(`[generateReferenceDraft] Components context: ${components.length} components included`)
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // CONTEXT AVAILABILITY WARNINGS (Non-blocking)
    // ══════════════════════════════════════════════════════════════════════════════
    const contextWarnings: Array<{ section: string; type: 'priorArt' | 'figures' | 'components'; message: string; impact: string }> = []
    
    // Check prior art requirements
    if (priorArtSections.length > 0 && priorArtCount === 0) {
      for (const section of priorArtSections) {
        contextWarnings.push({
          section,
          type: 'priorArt',
          message: `Section "${section}" requires prior art references for best results. Consider adding prior art in the Prior Art Selection stage.`,
          impact: 'Section will be generated with generic background. Quality may be reduced.'
        })
      }
      console.warn(`[generateReferenceDraft] ⚠️ Prior art required by [${priorArtSections.join(', ')}] but none provided`)
    }
    
    // Check figures requirements
    if (figureSections.length > 0 && figures.length === 0) {
      for (const section of figureSections) {
        contextWarnings.push({
          section,
          type: 'figures',
          message: `Section "${section}" requires figures/drawings for best results. Consider adding figures in the Figures & Sketches stage.`,
          impact: 'Section will be generated without figure references. Quality may be reduced.'
        })
      }
      console.warn(`[generateReferenceDraft] ⚠️ Figures required by [${figureSections.join(', ')}] but none provided`)
    }
    
    // Check components requirements
    if (componentSections.length > 0 && components.length === 0) {
      for (const section of componentSections) {
        contextWarnings.push({
          section,
          type: 'components',
          message: `Section "${section}" requires component reference numerals for best results. Consider adding components in the Reference Numerals stage.`,
          impact: 'Section will be generated without reference numerals. Quality may be reduced.'
        })
      }
      console.warn(`[generateReferenceDraft] ⚠️ Components required by [${componentSections.join(', ')}] but none provided`)
    }

    // ══════════════════════════════════════════════════════════════════════════════
    // UNIVERSAL DRAFTING BUNDLE (UDB) for batch generation
    // ══════════════════════════════════════════════════════════════════════════════
    const normalizedData = idea.normalizedData || {}
    
    // Check gating for critical sections that require frozen Claim 1
    const gatedSections = dynamicSections.filter(key => shouldGateSection(key, normalizedData))
    
    if (gatedSections.length > 0) {
      // Build specific error messages for each gated section
      const gateErrors = gatedSections.map(key => {
        const hasClaim = isClaim1Available(normalizedData)
        if (!hasClaim) {
          return `"${key}" requires claims to be generated first`
        }
        return `"${key}" requires claims to be frozen`
      })
      const gateError = `Cannot generate sections: ${gateErrors.join('; ')}. Please complete CLAIM_REFINEMENT stage and freeze claims first.`
      console.error(`[generateReferenceDraft] GATED: ${gateError}`)
      return {
        success: false,
        error: gateError
      }
    }
    
    // Build UDB for batch context
    // Determine the "most demanding" section to get proper UDB context:
    // - If ANY section needs C1, use a C1-requiring section as representative
    // - Otherwise, use a ND-only section
    const sectionsNeedingClaim1 = dynamicSections.filter(key => {
      const config = getSectionInjectionConfig(key)
      return config.injectClaim1
    })
    const representativeSection = sectionsNeedingClaim1.length > 0 
      ? sectionsNeedingClaim1[0] // Use first C1-requiring section
      : (dynamicSections[0] || 'detailedDescription') // Fallback to first section or default
    
    const udbResult = buildUniversalDraftingBundle(representativeSection, normalizedData, idea)
    const claim1Available = isClaim1Available(normalizedData)
    console.log(`[generateReferenceDraft] UDB batch injection:`, {
      hasUDBBlock: !!udbResult.block,
      blockLength: udbResult.block?.length || 0,
      claim1Available,
      representativeSection,
      sectionsNeedingClaim1Count: sectionsNeedingClaim1.length
    })
    
    // ══════════════════════════════════════════════════════════════════════════════
    // ANTI-HALLUCINATION GUARDS (automatic)
    // ══════════════════════════════════════════════════════════════════════════════
    const hasFigures = figures.length > 0
    const hasPriorArt = !!(manualPriorArt?.manualPriorArtText || manualPriorArt?.text || selectedPriorArtPatents.length > 0)
    const hasComponents = components.length > 0
    const antiHallucinationBlock = buildAntiHallucinationGuards(hasFigures, hasPriorArt, hasComponents)

    // ══════════════════════════════════════════════════════════════════════════════
    // BUILD PROMPT - CRITICAL: No empty placeholders
    // ══════════════════════════════════════════════════════════════════════════════
    const promptParts: string[] = []
    
    promptParts.push(`You are generating a REFERENCE PATENT DRAFT that will be translated to these specific jurisdictions: ${selectedJurisdictions.join(', ')}.

This draft must be COUNTRY-NEUTRAL and contain ONLY the ${dynamicSections.length} sections required by the selected jurisdictions.
The reference draft serves as the master source from which jurisdiction-specific drafts will be derived.`)

    // Add UDB block (Normalized Data + Claim 1) - only if non-empty
    if (udbResult.block) {
      promptParts.push(udbResult.block)
    }

    // Add additional context (components, figures, claims, prior art) - only if non-empty
    const additionalContextParts: string[] = []
    if (componentsContext) additionalContextParts.push(componentsContext)
    if (figuresContext) additionalContextParts.push(figuresContext)
    if (claimsContext) additionalContextParts.push(claimsContext)
    if (priorArtContext) additionalContextParts.push(priorArtContext)
    
    if (additionalContextParts.length > 0) {
      promptParts.push(`
==============================================================================
ADDITIONAL CONTEXT
==============================================================================
${additionalContextParts.join('\n')}`)
    }

    // Add anti-hallucination guards
    if (antiHallucinationBlock) {
      promptParts.push(antiHallucinationBlock)
    }

    // Section instructions and output format
    promptParts.push(`
==============================================================================
SECTION-BY-SECTION INSTRUCTIONS (generate EXACTLY these ${dynamicSections.length} sections)
==============================================================================

${sectionInstructions}

==============================================================================
OUTPUT FORMAT
==============================================================================
- Return ONLY a JSON object with these exact keys: ${dynamicSections.map(k => `"${k}"`).join(', ')}
- Each value should be the complete section content following the instructions above
- Do not include markdown code fences or explanations
- Write in clear, technical English suitable for international filing
- Do NOT generate sections not listed above`)

    const prompt = promptParts.join('\n')

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      stageCode: REFERENCE_DRAFT_PASS1_STAGE_CODE, // Pass 1 model config for reference draft generation
      prompt,
      parameters: { tenantId, purpose: 'reference_draft' },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        patentId: session.patentId,
        sessionId: session.id,
        purpose: 'reference_draft_generation',
        jurisdictions: selectedJurisdictions,
        sectionCount: dynamicSections.length
      }
    })

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || 'Reference draft generation failed'
      }
    }

    // Parse response using dynamic sections
    const draft = await parseReferenceDraftResponse(result.response.output, dynamicSections)
    
    if (!draft) {
      return {
        success: false,
        error: 'Failed to parse reference draft response'
      }
    }

    // Validate completeness - warn about missing sections
    const missingSections = dynamicSections.filter(key => !draft[key] || draft[key].trim() === '')
    if (missingSections.length > 0) {
      console.warn(`[generateReferenceDraft] Missing or empty sections: ${missingSections.join(', ')}`)
    }

    // Post-process: Ensure briefDescriptionOfDrawings includes ALL figures (diagrams + sketches)
    // This guarantees that sketches don't get lost during LLM generation
    if (figures.length > 0 && dynamicSections.includes('briefDescriptionOfDrawings')) {
      const generatedBDOD = draft.briefDescriptionOfDrawings || ''
      const figureLines: string[] = []
      
      for (const fig of figures) {
        let title = fig.title || `a view of Figure ${fig.figureNo}`
        // Clean up title
        title = title.replace(/^(FIG\.?\s*\d+\s*(is\s*)?|Figure\s*\d+\s*(is\s*)?)/i, '').trim()
        // Ensure title starts with an article
        if (!/^(a|an|the)\s/i.test(title)) {
          const firstWord = title.split(/\s+/)[0]?.toLowerCase() || ''
          const needsAn = /^[aeiou]/i.test(firstWord)
          title = `${needsAn ? 'an' : 'a'} ${title}`
        }
        const line = `FIG. ${fig.figureNo} is ${title}.`
        figureLines.push(line)
      }
      
      // Replace the LLM-generated briefDescriptionOfDrawings with our accurate version
      // to ensure ALL figures (including sketches) are included
      draft.briefDescriptionOfDrawings = figureLines.join('\n\n')
      console.log(`[generateReferenceDraft] Replaced briefDescriptionOfDrawings with ${figureLines.length} figures (${figures.filter((f:any)=>f.type==='sketch').length} sketches)`)
    }

    if (frozenClaimsText) {
      draft.claims = frozenClaimsText
    }

    return {
      success: true,
      draft,
      tokensUsed: result.response.outputTokens,
      dynamicSections,
      sectionDetails,
      jurisdictionMappings,
      warnings: contextWarnings.length > 0 ? contextWarnings : undefined
    }
  } catch (error) {
    console.error('Reference draft generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Reference draft generation failed'
    }
  }
}

/**
 * Generate a SINGLE section of the reference draft
 * This allows section-by-section generation with user approval to avoid JSON errors
 * and enable iterative refinement where earlier sections inform later ones.
 * 
 * @param session - The drafting session with ideaRecord, referenceMap, figurePlans
 * @param sectionKey - The superset section key to generate (e.g., 'title', 'background')
 * @param jurisdictions - Array of selected jurisdiction codes
 * @param existingSections - Already generated sections (for context in subsequent sections)
 * @param tenantId - Optional tenant ID for metering
 * @param requestHeaders - Optional request headers
 * @param frozenClaimsText - Optional frozen claims text (for claims section)
 */
export async function generateReferenceDraftSection(
  session: any,
  sectionKey: string,
  jurisdictions?: string[],
  existingSections?: Record<string, string>,
  tenantId?: string,
  requestHeaders?: Record<string, string>,
  frozenClaimsText?: string
): Promise<{
  success: boolean
  content?: string
  sectionKey?: string
  error?: string
}> {
  try {
    const idea = session.ideaRecord || {}
    const referenceMap = session.referenceMap || { components: [] }
    const components = Array.isArray(referenceMap.components) ? referenceMap.components : []
    
    // ======================================================================
    // PRIOR ART EXTRACTION - Same logic as generateReferenceDraft
    // Critical for background and crossReference sections
    // ======================================================================
    const manualPriorArt = (session as any).manualPriorArt || null
    const rawRelatedArtSelections = Array.isArray(session.relatedArtSelections)
      ? session.relatedArtSelections
      : []
    const aiAnalysis = (session as any).aiAnalysisData || {}
    
    const priorArtConfig = (session as any).priorArtConfig || {}
    const priorArtForDraftingConfig = priorArtConfig.priorArtForDrafting || {}
    const configSelectedPatents = Array.isArray(priorArtForDraftingConfig.selectedPatents) 
      ? priorArtForDraftingConfig.selectedPatents 
      : []
    
    let selectedPriorArtPatents: any[] = []
    
    // Helper functions
    const normalizePN = (pn: string | undefined | null): string => 
      pn ? pn.replace(/[-\s]/g, '').toUpperCase().trim() : ''
    const safeScoreSort = (a: any, b: any): number => {
      const aScore = typeof a.score === 'number' ? a.score : 0
      const bScore = typeof b.score === 'number' ? b.score : 0
      return bScore - aScore
    }
    const processPatents = (patents: any[], enrichSource: any[], preferConfigData: boolean = false): any[] => {
      const uniqueMap = new Map<string, any>()
      for (const sel of patents) {
        const rawPN = sel.patentNumber || sel.pn || ''
        const normalizedPN = normalizePN(rawPN)
        if (!normalizedPN || uniqueMap.has(normalizedPN)) continue
        const fullPatentData = enrichSource.find((r: any) => normalizePN(r.patentNumber) === normalizedPN) || {}
        const merged = {
          ...fullPatentData,
          ...(preferConfigData ? sel : {}),
          patentNumber: rawPN || fullPatentData.patentNumber,
          aiSummary: sel.aiSummary || fullPatentData.aiSummary || aiAnalysis[rawPN]?.aiSummary || '',
          noveltyComparison: sel.noveltyComparison || fullPatentData.noveltyComparison || aiAnalysis[rawPN]?.noveltyComparison || ''
        }
        uniqueMap.set(normalizedPN, merged)
      }
      return Array.from(uniqueMap.values()).sort(safeScoreSort)
    }
    
    const userSelectedPool = rawRelatedArtSelections.filter(
      (sel: any) => Array.isArray(sel.tags) && sel.tags.includes('USER_SELECTED')
    )
    const fallbackPool = userSelectedPool.length ? userSelectedPool : rawRelatedArtSelections
    
    if (configSelectedPatents.length > 0) {
      selectedPriorArtPatents = processPatents(configSelectedPatents, rawRelatedArtSelections, true)
    } else if (!manualPriorArt?.useOnlyManualPriorArt && fallbackPool.length > 0) {
      selectedPriorArtPatents = processPatents(fallbackPool, [], false)
    }
    
    // Build figures list (same logic as generateReferenceDraft)
    let figures: Array<{ figureNo: number; title: string; description?: string; type?: string }> = []
    
    if (session.figureSequenceFinalized && Array.isArray(session.figureSequence) && session.figureSequence.length > 0) {
      const figureSequence = session.figureSequence as Array<{ id: string; type: string; sourceId: string; finalFigNo: number }>
      for (const seqItem of figureSequence) {
        if (seqItem.type === 'diagram') {
          const plan = (session.figurePlans || []).find((f: any) => f.id === seqItem.sourceId)
          if (plan) {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: plan.title || `Figure ${seqItem.finalFigNo}`,
              description: plan.description || '',
              type: 'diagram'
            })
          }
        } else if (seqItem.type === 'sketch') {
          const sketch = (session.sketchRecords || []).find((s: any) => s.id === seqItem.sourceId)
          if (sketch && sketch.status === 'SUCCESS') {
            figures.push({
              figureNo: seqItem.finalFigNo,
              title: sketch.title || `Figure ${seqItem.finalFigNo}`,
              description: sketch.description || '',
              type: 'sketch'
            })
          }
        }
      }
    } else {
      // Fallback: use figurePlans directly
      const planFigures = Array.isArray(session.figurePlans) ? session.figurePlans.map((f: any) => ({
        figureNo: f.figureNo,
        title: f.title || `Figure ${f.figureNo}`,
        description: f.description || '',
        type: 'diagram'
      })) : []
      figures = planFigures
    }

    // Get dynamic superset sections and prompts
    const selectedJurisdictions = jurisdictions?.length 
      ? jurisdictions 
      : (session.draftingJurisdictions || ['US'])
    
    const { sections: dynamicSections, sectionDetails } = await computeDynamicSuperset(selectedJurisdictions)

    // Verify the requested section is in the dynamic superset
    if (!dynamicSections.includes(sectionKey)) {
      return {
        success: false,
        error: `Section "${sectionKey}" is not required for the selected jurisdictions: ${selectedJurisdictions.join(', ')}`
      }
    }

    // Get the prompt for this section
    const sectionPrompts = await getSupersetSectionPrompts([sectionKey])
    const sectionPrompt = sectionPrompts[sectionKey]
    
    if (!sectionPrompt) {
      return {
        success: false,
        error: `No prompt found for section: ${sectionKey}`
      }
    }

    const requiredBy = sectionDetails[sectionKey]?.requiredBy.join(', ') || 'General'

    // Build context from existing sections (for continuity)
    let existingSectionsContext = ''
    if (existingSections && Object.keys(existingSections).length > 0) {
      const contextParts: string[] = []
      for (const [key, content] of Object.entries(existingSections)) {
        if (content && content.trim()) {
          // Truncate very long sections for context
          const truncated = content.length > 1500 ? content.slice(0, 1500) + '...[truncated]' : content
          contextParts.push(`### ${key}\n${truncated}`)
        }
      }
      if (contextParts.length > 0) {
        existingSectionsContext = `
==============================================================================
PREVIOUSLY GENERATED SECTIONS (for context and consistency)
==============================================================================
${contextParts.join('\n\n')}
`
      }
    }

    // Special handling for claims - use frozen claims if provided
    if (sectionKey === 'claims' && frozenClaimsText) {
      return {
        success: true,
        content: frozenClaimsText,
        sectionKey
      }
    }

    // Build section-specific instruction
    const constraints = sectionPrompt.constraints?.length > 0 
      ? `\nConstraints: ${sectionPrompt.constraints.join('; ')}`
      : ''

    // Get database-driven context requirements for this section
    const contextRequirements = await getSectionContextRequirements(sectionKey, selectedJurisdictions[0])
    console.log(`[generateReferenceDraftSection] Section "${sectionKey}" context requirements (from DB):`, {
      requiresPriorArt: contextRequirements.requiresPriorArt,
      requiresFigures: contextRequirements.requiresFigures,
      requiresComponents: contextRequirements.requiresComponents,
      requiresClaims: contextRequirements.requiresClaims
    })

    // ══════════════════════════════════════════════════════════════════════════════
    // UNIVERSAL DRAFTING BUNDLE (UDB) - Normalized Data + Claim 1
    // ══════════════════════════════════════════════════════════════════════════════
    const normalizedData = idea.normalizedData || {}
    const udbResult = buildUniversalDraftingBundle(sectionKey, normalizedData, idea)
    
    // Check gating: if section requires Claim 1 but it's missing, return error
    if (udbResult.gated) {
      console.error(`[generateReferenceDraftSection] GATED: ${udbResult.gateReason}`)
      return {
        success: false,
        error: udbResult.gateReason || `Section "${sectionKey}" requires Claim 1 but claims are not available.`
      }
    }
    
    console.log(`[generateReferenceDraftSection] UDB injection for "${sectionKey}":`, {
      hasUDBBlock: !!udbResult.block,
      blockLength: udbResult.block?.length || 0,
      claim1Available: isClaim1Available(normalizedData)
    })

    // ======================================================================
    // BUILD CONTEXT DATA - ONLY INCLUDE WHAT THIS SECTION NEEDS
    // ======================================================================
    
    // Prior Art context - only if this section needs it
    let priorArtContext = ''
    let priorArtCount = 0
    
    if (contextRequirements.requiresPriorArt && (manualPriorArt || selectedPriorArtPatents.length > 0)) {
      if (manualPriorArt) {
        const manualText = manualPriorArt.manualPriorArtText || manualPriorArt.text || ''
        if (manualPriorArt.useOnlyManualPriorArt && manualText) {
          priorArtContext = `
PRIOR ART REFERENCES (REQUIRED for this section):
${manualText}
`
          priorArtCount = 1
        } else if (manualPriorArt.useManualAndAISearch) {
          const aiPatentLines = selectedPriorArtPatents.map((patent: any) => {
            const pn = patent.patentNumber || patent.pn || 'Unknown'
            const title = patent.title ? ` - ${String(patent.title).substring(0, 100)}` : ''
            const summary = patent.aiSummary ? `\n   Relevance: ${String(patent.aiSummary).substring(0, 200)}...` : ''
            return `- ${pn}${title}${summary}`
          }).join('\n')
          
          priorArtContext = `
PRIOR ART REFERENCES (REQUIRED for this section):
MANUAL ANALYSIS: ${manualText}
AI-IDENTIFIED PATENTS:
${aiPatentLines || 'No AI-selected patents'}
`
          priorArtCount = 1 + selectedPriorArtPatents.length
        }
      } else if (selectedPriorArtPatents.length > 0) {
        const patentLines = selectedPriorArtPatents.map((patent: any) => {
          const pn = patent.patentNumber || patent.pn || 'Unknown'
          const title = patent.title ? ` - ${String(patent.title).substring(0, 100)}` : ''
          const summary = patent.aiSummary ? `\n   Relevance: ${String(patent.aiSummary).substring(0, 200)}...` : ''
          return `- ${pn}${title}${summary}`
        }).join('\n')
        
        priorArtContext = `
PRIOR ART REFERENCES (REQUIRED for this section - ${selectedPriorArtPatents.length} references):
${patentLines}
`
        priorArtCount = selectedPriorArtPatents.length
      }
      console.log(`[generateReferenceDraftSection] Prior art context: ${priorArtCount} references`)
    }
    
    // Figures context - only if this section needs it (use language-aware selection)
    let figuresContext = ''
    if (contextRequirements.requiresFigures && figures.length > 0) {
      const primaryJurisdiction = selectedJurisdictions[0] || 'US'
      const languageAwareFigures = getFiguresForJurisdiction(session, primaryJurisdiction)
      figuresContext = `
FIGURES (REQUIRED for this section):
${languageAwareFigures.map((f: FigureInfo) => `  Fig.${f.figureNo}: ${f.title}${f.description ? ` - ${f.description}` : ''}${f.language && f.language !== 'en' ? ` [${f.language}]` : ''}`).join('\n')}
`
      console.log(`[generateReferenceDraftSection] Figures context: ${languageAwareFigures.length} figures`)
    }
    
    // Components context - only if this section needs it
    let componentsContext = ''
    if (contextRequirements.requiresComponents && components.length > 0) {
      componentsContext = `
COMPONENTS (REQUIRED for this section):
${components.map((c: any) => `  - ${c.name} (${c.numeral})`).join('\n')}
`
      console.log(`[generateReferenceDraftSection] Components context: ${components.length} components`)
    }
    
    // ══════════════════════════════════════════════════════════════════════════════
    // IMPORTANT: Full claims are NOT injected for drafting sections.
    // Claim 1 anchoring is handled by UDB (Universal Drafting Bundle) above.
    // Full claims are only used:
    // 1. For the 'claims' section itself (verbatim return)
    // 2. For AI review/validation AFTER draft generation
    // ══════════════════════════════════════════════════════════════════════════════
    // Legacy claimsContext removed - replaced by Claim 1 anchoring in UDB
    const claimsContext = '' // Intentionally empty - full claims injection disabled for drafting

    // Build section-specific instructions based on requirements
    let contextInstructions = ''
    
    // Prior art instructions
    if (contextRequirements.requiresPriorArt && priorArtCount > 0) {
      if (sectionKey === 'background') {
        contextInstructions += `

PRIOR ART REQUIREMENTS:
- You MUST reference ALL ${priorArtCount} prior art patents/references provided above.
- Para 1: Establish the technical context and problem space.
- Para 2+: Discuss EACH prior art reference, identifying its approach and limitations.
- Final paragraph: Segue to the present invention without claiming novelty.`
      } else if (sectionKey === 'technicalProblem') {
        contextInstructions += `

PRIOR ART REQUIREMENTS:
- Frame the technical problem based on limitations identified in the prior art above.`
      }
    }
    
    // Figures instructions
    if (contextRequirements.requiresFigures && figures.length > 0) {
      if (sectionKey === 'briefDescriptionOfDrawings') {
        contextInstructions += `

FIGURES REQUIREMENTS:
- Generate one line per figure in format: "FIG. X is [description]."
- Include ALL ${figures.length} figures listed above.`
      } else if (sectionKey === 'detailedDescription') {
        contextInstructions += `

FIGURES REQUIREMENTS:
- Reference figures using format: "As shown in FIG. X, ...".
- Describe each figure's content in detail.`
      }
    }
    
    // Components instructions
    if (contextRequirements.requiresComponents && components.length > 0) {
      contextInstructions += `

COMPONENTS REQUIREMENTS:
- Use reference numerals from the COMPONENTS list when describing elements.
- Format: "component name (numeral)", e.g., "processor (102)".`
    }
    
    // Claims instructions (now handled by UDB claim1Mode)
    // Legacy claims alignment instructions removed - UDB provides consistent claim handling

    // ══════════════════════════════════════════════════════════════════════════════
    // ANTI-HALLUCINATION GUARDS (automatic, not admin-controlled)
    // ══════════════════════════════════════════════════════════════════════════════
    const hasFigures = figures.length > 0
    const hasPriorArt = !!(manualPriorArt?.manualPriorArtText || manualPriorArt?.text || selectedPriorArtPatents.length > 0)
    const hasComponents = components.length > 0
    const antiHallucinationBlock = buildAntiHallucinationGuards(hasFigures, hasPriorArt, hasComponents)

    // ══════════════════════════════════════════════════════════════════════════════
    // BUILD PROMPT - CRITICAL: No empty placeholders
    // ══════════════════════════════════════════════════════════════════════════════
    const promptParts: string[] = []
    
    promptParts.push(`You are generating a SINGLE SECTION of a REFERENCE PATENT DRAFT for these jurisdictions: ${selectedJurisdictions.join(', ')}.`)

    // Add UDB block (Normalized Data + Claim 1) - only if non-empty
    if (udbResult.block) {
      promptParts.push(udbResult.block)
    }

    // Add additional context (components, figures, prior art, existing sections) - only if non-empty
    const additionalContextParts: string[] = []
    if (componentsContext) additionalContextParts.push(componentsContext)
    if (figuresContext) additionalContextParts.push(figuresContext)
    if (priorArtContext) additionalContextParts.push(priorArtContext)
    if (existingSectionsContext) additionalContextParts.push(existingSectionsContext)
    
    if (additionalContextParts.length > 0) {
      promptParts.push(`
==============================================================================
ADDITIONAL CONTEXT
==============================================================================
${additionalContextParts.join('\n')}`)
    }

    // Add anti-hallucination guards
    if (antiHallucinationBlock) {
      promptParts.push(antiHallucinationBlock)
    }

    // Section generation instructions
    promptParts.push(`
==============================================================================
SECTION TO GENERATE: ${sectionPrompt.label} (key: "${sectionKey}")
==============================================================================
Required by: ${requiredBy}

${sectionPrompt.instruction}${constraints}${contextInstructions}

==============================================================================
OUTPUT REQUIREMENTS
==============================================================================
- Write ONLY the content for the "${sectionKey}" section
- Do NOT include section headers, JSON formatting, or markdown code fences
- Write in clear, technical English suitable for international filing
- Be comprehensive but concise
- Maintain consistency with previously generated sections (if any)
- Return ONLY the section content text, nothing else`)

    const prompt = promptParts.join('\n')

    // Get the stage code for model resolution
    // This maps section key to workflow stage (e.g., 'background' -> 'DRAFT_ANNEXURE_BACKGROUND')
    // The admin configures which LLM model to use for each stage in the LLM Config page
    const stageCode = getSectionStageCode(sectionKey)

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, {
      taskCode: 'LLM2_DRAFT',
      stageCode, // Pass stage code for section-specific model resolution
      prompt,
      parameters: { tenantId, purpose: 'reference_draft_section' },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        patentId: session.patentId,
        sessionId: session.id,
        purpose: 'reference_draft_section_generation',
        sectionKey,
        stageCode, // Include in metadata for debugging
        jurisdictions: selectedJurisdictions
      }
    })

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || `Failed to generate section: ${sectionKey}`
      }
    }

    // Clean up the response (remove any accidental markdown or JSON formatting)
    let content = (result.response.output || '').trim()
    
    // Remove markdown code fences if present
    content = content.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '').trim()
    
    // Remove JSON-like wrapping if present
    if (content.startsWith('{') && content.includes(`"${sectionKey}"`)) {
      try {
        const parsed = JSON.parse(content)
        if (parsed[sectionKey]) {
          content = parsed[sectionKey]
        }
      } catch {
        // Not valid JSON, use as-is
      }
    }

    console.log(`[generateReferenceDraftSection] Generated "${sectionKey}" section (${content.length} chars)`)

    return {
      success: true,
      content,
      sectionKey
    }
  } catch (error) {
    console.error(`[generateReferenceDraftSection] Error generating ${sectionKey}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : `Failed to generate section: ${sectionKey}`
    }
  }
}

/**
 * Get the list of sections needed for the reference draft based on selected jurisdictions
 * This allows the UI to know which sections to show for sequential generation
 */
export async function getReferenceDraftSections(
  jurisdictions: string[]
): Promise<{
  sections: string[]
  sectionDetails: Record<string, { label: string; requiredBy: string[] }>
}> {
  const { sections, sectionDetails } = await computeDynamicSuperset(jurisdictions)
  return { sections, sectionDetails }
}


// Interface for section translation tasks
interface SectionToTranslate {
  supersetKey: string
  countryKey: string
  countryHeading: string
  content: string
}

/**
 * Translate entire reference draft to a target jurisdiction
 * 
 * OPTIMIZATION: Uses BATCH MODE to translate all sections in a SINGLE LLM call,
 * significantly reducing token costs by avoiding repeated system prompts and instructions.
 * 
 * Token Savings Example:
 * - Individual calls (8 sections): ~8,000 input tokens (1000 per section with overhead)
 * - Batch call (8 sections): ~3,500 input tokens (one-time overhead + content)
 * - Savings: ~56% reduction in input tokens
 * 
 * @param referenceDraft - The reference draft with superset sections (may be dynamic subset)
 * @param targetJurisdiction - The target country code (e.g., 'DE', 'JP', 'CN')
 * @param targetLanguage - The target language for translation (optional, derived from jurisdiction if not provided)
 * @param tenantId - Optional tenant ID for metering
 * @param requestHeaders - Optional request headers
 * @param useBatchMode - Whether to use batch mode (default: true for token savings)
 */
export async function translateReferenceDraft(
  referenceDraft: Record<string, string>,
  targetJurisdiction: string,
  targetLanguage?: string,
  tenantId?: string,
  requestHeaders?: Record<string, string>,
  useBatchMode: boolean = true
): Promise<{ 
  success: boolean
  draft?: Record<string, string>
  errors?: string[]
  language?: string
  stats?: { translated: number; skipped: number; failed: number; batchMode: boolean; tokensUsed?: number }
  warning?: string
}> {
  const code = targetJurisdiction.toUpperCase()
  const mappings = await getSectionMapping(code)
  
  // Resolve the target language
  const profile = await getCountryProfile(code)
  const availableLanguages: string[] = Array.isArray(profile?.profileData?.meta?.languages)
    ? profile.profileData.meta.languages
    : ['English']
  const resolvedLanguage = targetLanguage && availableLanguages.includes(targetLanguage)
    ? targetLanguage
    : availableLanguages[0] || 'English'
  
  // Warn if requested language is not available
  if (targetLanguage && !availableLanguages.includes(targetLanguage)) {
    console.warn(`[translateReferenceDraft] Requested language '${targetLanguage}' not available for ${code}. Using '${resolvedLanguage}' instead. Available: ${availableLanguages.join(', ')}`)
  }

  const translatedDraft: Record<string, string> = {}
  const errors: string[] = []
  let skippedCount = 0
  let translatedCount = 0
  let totalTokensUsed = 0

  // Log the translation mapping for debugging
  console.log(`[translateReferenceDraft] Translating to ${code} (${resolvedLanguage}) - Batch Mode: ${useBatchMode}`)
  console.log(`[translateReferenceDraft] Section mappings: ${mappings.length}, Reference sections: ${Object.keys(referenceDraft).length}`)

  // Collect sections that need translation
  const sectionsToTranslate: SectionToTranslate[] = []
  
  // Track skipped sections for debugging
  const skippedSections: Array<{ key: string; reason: string }> = []
  
  for (const mapping of mappings) {
    if (!mapping.isApplicable) {
      // Section not applicable for this jurisdiction (N/A, Implicit, etc.)
      translatedDraft[mapping.countryKey] = ''
      skippedCount++
      skippedSections.push({ key: mapping.supersetKey, reason: 'Not applicable (N/A heading)' })
      continue
    }

    // Try to get content from reference draft using the superset key
    // Also check for aliased keys for backward compatibility
    let referenceContent = referenceDraft[mapping.supersetKey]
    if (!referenceContent) {
      // Try to find content using aliases (database-driven)
      const normalizedKey = await normalizeToSupersetKey(mapping.supersetKey)
      referenceContent = referenceDraft[normalizedKey] || ''
    }
    
    if (!referenceContent || !referenceContent.trim()) {
      // Section exists in mapping but not in reference draft (dynamic superset optimization)
      translatedDraft[mapping.countryKey] = ''
      skippedCount++
      skippedSections.push({ key: mapping.supersetKey, reason: 'Not in reference draft (dynamic optimization)' })
      continue
    }

    sectionsToTranslate.push({
      supersetKey: mapping.supersetKey,
      countryKey: mapping.countryKey,
      countryHeading: mapping.countryHeading,
      content: referenceContent
    })
  }

  console.log(`[translateReferenceDraft] ${sectionsToTranslate.length} sections to translate, ${skippedSections.length} skipped, Batch Mode: ${useBatchMode}`)
  if (skippedSections.length > 0) {
    console.log(`[translateReferenceDraft] Skipped sections:`, skippedSections.map(s => `${s.key} (${s.reason})`).join(', '))
  }

  // Early return if no sections need translation
  if (sectionsToTranslate.length === 0) {
    console.log(`[translateReferenceDraft] No sections to translate - returning with skipped sections only`)
    return {
      success: true,
      draft: translatedDraft,
      language: resolvedLanguage,
      stats: {
        translated: 0,
        skipped: skippedCount,
        failed: 0,
        batchMode: useBatchMode,
        tokensUsed: 0
      }
    }
  }

  // Use CHUNKED BATCH MODE for optimal cost/reliability balance
  // Adapts batch size based on content length to avoid output truncation
  if (useBatchMode) {
    // Calculate adaptive batch size based on total content length
    // Smaller batches for larger content to avoid truncation
    const totalContentLength = sectionsToTranslate.reduce((sum, s) => sum + (s.content?.length || 0), 0)
    // Safe division - sectionsToTranslate.length is guaranteed > 0 at this point
    const avgContentLength = totalContentLength / sectionsToTranslate.length
    
    // Adaptive batch sizing:
    // - Very large sections (>3000 chars avg): 2 sections per batch
    // - Large sections (>1500 chars avg): 3 sections per batch
    // - Medium sections (>500 chars avg): 4 sections per batch
    // - Small sections: 5 sections per batch
    let BATCH_CHUNK_SIZE: number
    if (avgContentLength > 3000) {
      BATCH_CHUNK_SIZE = 2
    } else if (avgContentLength > 1500) {
      BATCH_CHUNK_SIZE = 3
    } else if (avgContentLength > 500) {
      BATCH_CHUNK_SIZE = 4
    } else {
      BATCH_CHUNK_SIZE = 5
    }
    
    const totalBatches = Math.ceil(sectionsToTranslate.length / BATCH_CHUNK_SIZE)
    console.log(`[translateReferenceDraft] Using CHUNKED BATCH MODE - ${totalBatches} batches of ~${BATCH_CHUNK_SIZE} sections (avg content: ${Math.round(avgContentLength)} chars)`)
    
    // Process sections in chunks
    for (let batchIndex = 0; batchIndex < sectionsToTranslate.length; batchIndex += BATCH_CHUNK_SIZE) {
      const chunk = sectionsToTranslate.slice(batchIndex, batchIndex + BATCH_CHUNK_SIZE)
      const batchNumber = Math.floor(batchIndex / BATCH_CHUNK_SIZE) + 1
      
      console.log(`[translateReferenceDraft] Processing batch ${batchNumber}/${totalBatches}: ${chunk.map(s => s.countryKey).join(', ')}`)
      
      try {
        const batchResult = await translateSectionsBatch(
          chunk,
          code,
          resolvedLanguage,
          tenantId,
          requestHeaders
        )

        if (batchResult.success && batchResult.translations) {
          // Apply batch translations
          for (const section of chunk) {
            const translated = batchResult.translations[section.countryKey]
            if (translated && translated.trim()) {
              translatedDraft[section.countryKey] = translated
              translatedCount++
            } else {
              // Fallback to reference content if translation is empty
              translatedDraft[section.countryKey] = section.content
              errors.push(`Empty translation for ${section.supersetKey} → ${section.countryKey} (batch ${batchNumber})`)
            }
          }
          totalTokensUsed += batchResult.tokensUsed || 0
          console.log(`[translateReferenceDraft] Batch ${batchNumber}/${totalBatches} completed successfully`)
        } else {
          // This batch failed - try individual translation for these sections
          console.warn(`[translateReferenceDraft] Batch ${batchNumber} failed: ${batchResult.error}. Falling back to individual mode for this batch.`)
          
          // Fallback: translate individually for failed batch
          for (const section of chunk) {
            try {
              const individualResult = await translateSection(
                section.content,
                section.supersetKey,
                code,
                section.countryKey,
                section.countryHeading,
                resolvedLanguage,
                tenantId,
                requestHeaders
              )
              
              if (individualResult.success && individualResult.translatedContent) {
                translatedDraft[section.countryKey] = individualResult.translatedContent
                translatedCount++
                totalTokensUsed += individualResult.tokensUsed || 0
              } else {
                translatedDraft[section.countryKey] = section.content
                errors.push(`Failed ${section.supersetKey} → ${section.countryKey}: ${individualResult.error}`)
              }
            } catch (err) {
              translatedDraft[section.countryKey] = section.content
              errors.push(`Failed ${section.supersetKey} → ${section.countryKey}: ${err instanceof Error ? err.message : 'Unknown error'}`)
            }
          }
        }
      } catch (batchError) {
        // Batch call itself threw an error - fallback to reference content
        console.error(`[translateReferenceDraft] Batch ${batchNumber} threw error:`, batchError)
        for (const section of chunk) {
          translatedDraft[section.countryKey] = section.content
          errors.push(`Batch ${batchNumber} error for ${section.countryKey}: ${batchError instanceof Error ? batchError.message : 'Unknown error'}`)
        }
      }
      
      // Small delay between batches to avoid rate limiting
      if (batchIndex + BATCH_CHUNK_SIZE < sectionsToTranslate.length) {
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }
  } 
  // INDIVIDUAL MODE - separate LLM call per section (parallel execution for speed)
  else if (sectionsToTranslate.length > 0) {
    console.log(`[translateReferenceDraft] Using INDIVIDUAL MODE - parallel execution (${sectionsToTranslate.length} LLM calls)`)
    
    // Execute translations in parallel batches of 3 for rate limiting
    const PARALLEL_BATCH_SIZE = 3
    for (let i = 0; i < sectionsToTranslate.length; i += PARALLEL_BATCH_SIZE) {
      const batch = sectionsToTranslate.slice(i, i + PARALLEL_BATCH_SIZE)
      
      const results = await Promise.all(
        batch.map(async (section) => {
          try {
            const result = await translateSection(
              section.content,
              section.supersetKey,
              code,
              section.countryKey,
              section.countryHeading,
              resolvedLanguage,
              tenantId,
              requestHeaders
            )
            return { section, result }
          } catch (err) {
            console.error(`[translateReferenceDraft] Error translating ${section.supersetKey}:`, err)
            return { 
              section, 
              result: { 
                success: false, 
                error: err instanceof Error ? err.message : 'Unknown error' 
              } 
            }
          }
        })
      )

      // Process results
      for (const { section, result } of results) {
        if (result.success && result.translatedContent) {
          translatedDraft[section.countryKey] = result.translatedContent
          translatedCount++
          totalTokensUsed += result.tokensUsed || 0
        } else {
          errors.push(`Failed to translate ${section.supersetKey} → ${section.countryKey}: ${result.error || 'Unknown error'}`)
          translatedDraft[section.countryKey] = section.content
        }
      }
    }
  }

  const stats = {
    translated: translatedCount,
    skipped: skippedCount,
    failed: errors.length,
    batchMode: useBatchMode,
    tokensUsed: totalTokensUsed
  }

  // Check fallback rate - warn if more than 20% of sections used fallback content
  const totalAttempted = sectionsToTranslate.length
  const fallbackRate = totalAttempted > 0 ? (errors.length / totalAttempted) * 100 : 0
  const hasHighFallbackRate = fallbackRate > 20
  
  if (hasHighFallbackRate) {
    console.warn(`[translateReferenceDraft] HIGH FALLBACK RATE: ${fallbackRate.toFixed(1)}% of sections (${errors.length}/${totalAttempted}) used reference content instead of translation`)
  }

  console.log(`[translateReferenceDraft] Complete. Translated: ${stats.translated}, Skipped: ${stats.skipped}, Failed: ${stats.failed}, Tokens: ${stats.tokensUsed}`)

  return {
    // Success if no errors OR if we got at least 80% translated (partial success is acceptable)
    success: errors.length === 0 || !hasHighFallbackRate,
    draft: translatedDraft,
    errors: errors.length > 0 ? errors : undefined,
    language: resolvedLanguage,
    stats,
    // Include warning for UI to display if needed
    warning: hasHighFallbackRate 
      ? `${errors.length} of ${totalAttempted} sections (${fallbackRate.toFixed(0)}%) could not be translated and used reference content instead.`
      : undefined
  }
}

// ============================================================================
// Section Translation Functions
// ============================================================================

/**
 * Translate sections in batch mode (single LLM call for all sections)
 * Uses CountrySectionMapping for section mappings and CountrySectionPrompt for top-up prompts
 */
async function translateSectionsBatch(
  sectionsToTranslate: SectionToTranslate[],
  targetJurisdiction: string,
  targetLanguage: string,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<{
  success: boolean
  translations?: Record<string, string>
  error?: string
  tokensUsed?: number
}> {
  try {
    const code = targetJurisdiction.toUpperCase()
    
    // Fetch top-up prompts for this jurisdiction from CountrySectionPrompt table
    const topUpPrompts = await prisma.countrySectionPrompt.findMany({
      where: {
        countryCode: { equals: code, mode: 'insensitive' },
        status: 'ACTIVE'
      }
    })
    
    // Create a map of sectionKey -> topUp instruction (lowercase keys for case-insensitive lookup)
    const topUpMap: Record<string, { instruction: string; constraints: string[] }> = {}
    for (const prompt of topUpPrompts) {
      // Store with lowercase key for case-insensitive matching
      topUpMap[prompt.sectionKey.toLowerCase()] = {
        instruction: prompt.instruction || '',
        constraints: Array.isArray(prompt.constraints) ? prompt.constraints as string[] : []
      }
    }
    
    console.log(`[translateSectionsBatch] Found ${topUpPrompts.length} top-up prompts for ${code}`)
    
    // Build the batch prompt with all sections
    const sectionInstructions = sectionsToTranslate.map((section, idx) => {
      // Use lowercase for case-insensitive lookup
      const topUp = topUpMap[section.countryKey.toLowerCase()] || topUpMap[section.supersetKey.toLowerCase()]
      const topUpInstruction = topUp?.instruction ? `\nJURISDICTION-SPECIFIC REQUIREMENTS:\n${topUp.instruction}` : ''
      const topUpConstraints = topUp?.constraints?.length ? `\nCONSTRAINTS: ${topUp.constraints.join('; ')}` : ''
      
      return `
=== SECTION ${idx + 1}: ${section.countryHeading} (key: "${section.countryKey}") ===
ORIGINAL CONTENT FROM REFERENCE DRAFT:
${section.content}
${topUpInstruction}${topUpConstraints}
`
    }).join('\n')

    const prompt = `You are translating a patent reference draft to ${code} jurisdiction format in ${targetLanguage}.

TASK: Translate/adapt the following ${sectionsToTranslate.length} sections according to ${code} patent office requirements.

IMPORTANT RULES:
1. Apply jurisdiction-specific formatting and terminology for ${code}
2. Output MUST be in ${targetLanguage}
3. Maintain technical accuracy while adapting to local patent practice
4. Apply any section-specific constraints provided below
5. Keep reference numerals consistent with the original

${sectionInstructions}

OUTPUT FORMAT:
Return a JSON object with the translated sections. Each key should be the section key, and the value should be the translated content.
Example: {"${sectionsToTranslate[0]?.countryKey || 'sectionKey'}": "translated content...", ...}

Return ONLY the JSON object, no markdown code fences or explanations.`

    const llmRequest: LLMRequest & { stageCode?: string } = {
      taskCode: 'LLM2_DRAFT',
      stageCode: REFERENCE_DRAFT_PASS2_STAGE_CODE, // Pass 2 model config for top-up translation
      prompt,
      parameters: { tenantId, purpose: 'translate_sections_batch', temperature: 0 },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        purpose: 'translate_sections_batch',
        targetJurisdiction: code,
        targetLanguage,
        sectionCount: sectionsToTranslate.length
      }
    }

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, llmRequest)

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || 'Batch translation LLM call failed'
      }
    }

    // Parse the JSON response
    const output = (result.response.output || '').trim()
    let translations: Record<string, string> = {}
    
    try {
      // Try to extract JSON from the response
      const jsonMatch = output.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        translations = JSON.parse(jsonMatch[0])
      } else {
        return {
          success: false,
          error: 'Could not parse JSON from batch translation response'
        }
      }
    } catch (parseErr) {
      console.error('[translateSectionsBatch] JSON parse error:', parseErr)
      return {
        success: false,
        error: 'Failed to parse batch translation response as JSON'
      }
    }

    return {
      success: true,
      translations,
      tokensUsed: (llmRequest.inputTokens || 0) + (result.response.outputTokens || 0)
    }
  } catch (error) {
    console.error('[translateSectionsBatch] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Batch translation failed'
    }
  }
}

/**
 * Translate a single section from reference draft to jurisdiction-specific format
 * Uses CountrySectionPrompt for top-up prompts
 */
async function translateSection(
  referenceContent: string,
  supersetKey: string,
  targetJurisdiction: string,
  countryKey: string,
  countryHeading: string,
  targetLanguage: string,
  tenantId?: string,
  requestHeaders?: Record<string, string>
): Promise<{
  success: boolean
  translatedContent?: string
  error?: string
  tokensUsed?: number
}> {
  try {
    const code = targetJurisdiction.toUpperCase()
    
    // Fetch top-up prompt for this section from CountrySectionPrompt table (case-insensitive)
    const topUpPrompt = await prisma.countrySectionPrompt.findFirst({
      where: {
        countryCode: { equals: code, mode: 'insensitive' },
        sectionKey: { equals: countryKey, mode: 'insensitive' },
        status: 'ACTIVE'
      }
    })
    
    // If no prompt found for countryKey, try supersetKey (case-insensitive)
    const fallbackPrompt = !topUpPrompt ? await prisma.countrySectionPrompt.findFirst({
      where: {
        countryCode: { equals: code, mode: 'insensitive' },
        sectionKey: { equals: supersetKey, mode: 'insensitive' },
        status: 'ACTIVE'
      }
    }) : null
    
    const effectivePrompt = topUpPrompt || fallbackPrompt
    const constraintList = Array.isArray(effectivePrompt?.constraints)
      ? effectivePrompt?.constraints as string[]
      : []
    
    const topUpInstruction = effectivePrompt?.instruction 
      ? `\nJURISDICTION-SPECIFIC REQUIREMENTS (${code}):\n${effectivePrompt.instruction}` 
      : ''
    const topUpConstraints = constraintList.length 
      ? `\nCONSTRAINTS: ${constraintList.join('; ')}` 
      : ''
    
    console.log(`[translateSection] Translating ${supersetKey} -> ${countryKey} for ${code}, TopUp: ${effectivePrompt ? 'YES' : 'NO'}`)

    const prompt = `You are translating a patent section from reference draft to ${code} jurisdiction format.

TASK: Translate/adapt the following section according to ${code} patent office requirements.

SECTION: ${countryHeading} (${countryKey})

ORIGINAL CONTENT FROM REFERENCE DRAFT:
${referenceContent}
${topUpInstruction}${topUpConstraints}

IMPORTANT RULES:
1. Apply jurisdiction-specific formatting and terminology for ${code}
2. Output MUST be in ${targetLanguage}
3. Maintain technical accuracy while adapting to local patent practice
4. Apply the jurisdiction-specific requirements above if provided
5. Keep reference numerals consistent with the original

OUTPUT: Return ONLY the translated section content, no headers or formatting markers.`

    const llmRequest: LLMRequest & { stageCode?: string } = {
      taskCode: 'LLM2_DRAFT',
      stageCode: REFERENCE_DRAFT_PASS2_STAGE_CODE, // Pass 2 model config for top-up translation
      prompt,
      parameters: { tenantId, purpose: 'translate_section', temperature: 0 },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        purpose: 'translate_section',
        targetJurisdiction: code,
        targetLanguage,
        sectionKey: countryKey,
        supersetKey,
        stageCode: REFERENCE_DRAFT_PASS2_STAGE_CODE // Include for debugging
      }
    }

    const result = await llmGateway.executeLLMOperation({ headers: requestHeaders || {} }, llmRequest)

    if (!result.success || !result.response) {
      return {
        success: false,
        error: result.error?.message || 'Section translation LLM call failed'
      }
    }

    const translatedContent = (result.response.output || '').trim()

    return {
      success: true,
      translatedContent,
      tokensUsed: (llmRequest.inputTokens || 0) + (result.response.outputTokens || 0)
    }
  } catch (error) {
    console.error(`[translateSection] Error translating ${supersetKey}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Section translation failed'
    }
  }
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationIssue {
  sectionKey: string
  type: 'error' | 'warning' | 'info'
  rule: string
  message: string
  actual?: number
  limit?: number
}

/**
 * Validate a draft against jurisdiction-specific rules
 */
export async function validateDraft(
  draft: Record<string, string>,
  jurisdiction: string
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  const code = jurisdiction.toUpperCase()

  // Get validation rules from database
  const validations = await prisma.countrySectionValidation.findMany({
    where: { countryCode: code, status: 'ACTIVE' }
  })

  for (const v of validations) {
    const content = draft[v.sectionKey] || ''
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length
    const charCount = content.length

    // Word limit checks
    if (v.maxWords && wordCount > v.maxWords) {
      issues.push({
        sectionKey: v.sectionKey,
        type: (v.wordLimitSeverity as 'error' | 'warning' | 'info') || 'warning',
        rule: 'maxWords',
        message: v.wordLimitMessage || `Exceeds ${v.maxWords} word limit`,
        actual: wordCount,
        limit: v.maxWords
      })
    }

    if (v.minWords && wordCount < v.minWords) {
      issues.push({
        sectionKey: v.sectionKey,
        type: 'warning',
        rule: 'minWords',
        message: `Below recommended ${v.minWords} word minimum`,
        actual: wordCount,
        limit: v.minWords
      })
    }

    // Character limit checks
    if (v.maxChars && charCount > v.maxChars) {
      issues.push({
        sectionKey: v.sectionKey,
        type: (v.charLimitSeverity as 'error' | 'warning' | 'info') || 'warning',
        rule: 'maxChars',
        message: v.charLimitMessage || `Exceeds ${v.maxChars} character limit`,
        actual: charCount,
        limit: v.maxChars
      })
    }

    // Claim count checks
    if (v.sectionKey === 'claims' && v.maxCount) {
      const claimCount = (content.match(/^\s*\d+\./gm) || []).length
      if (claimCount > v.maxCount) {
        issues.push({
          sectionKey: v.sectionKey,
          type: (v.countLimitSeverity as 'error' | 'warning' | 'info') || 'warning',
          rule: 'maxCount',
          message: v.countLimitMessage || `Exceeds ${v.maxCount} claims`,
          actual: claimCount,
          limit: v.maxCount
        })
      }
    }
  }

  return issues
}

// ============================================================================
// Session Helpers
// ============================================================================

/**
 * Check if reference draft is required (multi-jurisdiction mode)
 */
export function isReferenceDraftRequired(session: any): boolean {
  return session?.isMultiJurisdiction === true
}

/**
 * Check if reference draft is complete
 */
export function isReferenceDraftComplete(session: any): boolean {
  return session?.referenceDraftComplete === true
}

/**
 * Check if a jurisdiction draft can be generated
 */
export function canGenerateJurisdictionDraft(session: any, jurisdiction: string): boolean {
  // If single jurisdiction mode, always allowed
  if (!session?.isMultiJurisdiction) {
    return true
  }
  
  // If multi-jurisdiction, reference draft must be complete first
  // Unless this IS the reference draft
  if (jurisdiction.toUpperCase() === 'REFERENCE') {
    return true
  }
  
  return session?.referenceDraftComplete === true
}
