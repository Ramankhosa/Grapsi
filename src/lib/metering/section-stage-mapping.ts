/**
 * Section to Stage Mapping Utility
 * 
 * Maps superset section keys to their corresponding workflow stage codes.
 * This mapping enables the admin-configured LLM models to be used for each section.
 * 
 * When the admin configures a model for "DRAFT_ANNEXURE_BACKGROUND" stage,
 * any request to generate the "background" section will use that model.
 * 
 * This mapping follows the superset sections defined in Countries/MasterSeed.js
 * and the workflow stages defined in Seed/seed-llm-models.js
 */

/**
 * Maps superset section keys to workflow stage codes
 * 
 * The workflow stage code determines which LLM model is used based on:
 * - PlanStageModelConfig (configured by super admin in LLM Config page)
 * - Falls back to PlanTaskModelConfig, then PlanLLMAccess, then system default
 */
export const SECTION_TO_STAGE_MAP: Record<string, string> = {
  // Core sections (all jurisdictions)
  'title': 'DRAFT_ANNEXURE_TITLE',
  'abstract': 'DRAFT_ANNEXURE_ABSTRACT',
  'claims': 'DRAFT_ANNEXURE_CLAIMS',
  'detailedDescription': 'DRAFT_ANNEXURE_DESCRIPTION',
  'detailed_description': 'DRAFT_ANNEXURE_DESCRIPTION', // alias
  
  // Field/Background sections
  'fieldOfInvention': 'DRAFT_ANNEXURE_FIELD',
  'field_of_invention': 'DRAFT_ANNEXURE_FIELD', // alias
  'technicalField': 'DRAFT_ANNEXURE_FIELD', // alias
  'technical_field': 'DRAFT_ANNEXURE_FIELD', // alias
  'field': 'DRAFT_ANNEXURE_FIELD', // alias
  
  'background': 'DRAFT_ANNEXURE_BACKGROUND',
  'backgroundOfInvention': 'DRAFT_ANNEXURE_BACKGROUND', // alias
  'background_of_invention': 'DRAFT_ANNEXURE_BACKGROUND', // alias
  'priorArt': 'DRAFT_ANNEXURE_BACKGROUND', // alias
  'prior_art': 'DRAFT_ANNEXURE_BACKGROUND', // alias
  'background_art': 'DRAFT_ANNEXURE_BACKGROUND', // alias
  
  // Summary sections
  'summary': 'DRAFT_ANNEXURE_SUMMARY',
  'summaryOfInvention': 'DRAFT_ANNEXURE_SUMMARY', // alias
  'summary_of_invention': 'DRAFT_ANNEXURE_SUMMARY', // alias
  'disclosure_of_invention': 'DRAFT_ANNEXURE_SUMMARY', // alias
  'disclosureOfInvention': 'DRAFT_ANNEXURE_SUMMARY', // alias
  
  // Objects (India, some jurisdictions)
  'objectsOfInvention': 'DRAFT_ANNEXURE_OBJECTS',
  'objects': 'DRAFT_ANNEXURE_OBJECTS', // alias
  'objects_of_invention': 'DRAFT_ANNEXURE_OBJECTS', // alias
  'objectOfInvention': 'DRAFT_ANNEXURE_OBJECTS', // alias
  
  // Technical Problem/Solution (EP, JP)
  'technicalProblem': 'DRAFT_ANNEXURE_TECHNICAL_PROBLEM',
  'technical_problem': 'DRAFT_ANNEXURE_TECHNICAL_PROBLEM', // alias
  
  'technicalSolution': 'DRAFT_ANNEXURE_TECHNICAL_SOLUTION',
  'technical_solution': 'DRAFT_ANNEXURE_TECHNICAL_SOLUTION', // alias
  
  // Advantageous Effects (JP)
  'advantageousEffects': 'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS',
  'advantageous_effects': 'DRAFT_ANNEXURE_ADVANTAGEOUS_EFFECTS', // alias
  
  // Drawings
  'briefDescriptionOfDrawings': 'DRAFT_ANNEXURE_DRAWINGS',
  'brief_description_of_drawings': 'DRAFT_ANNEXURE_DRAWINGS', // alias
  'drawings': 'DRAFT_ANNEXURE_DRAWINGS', // alias
  'figures': 'DRAFT_ANNEXURE_DRAWINGS', // alias
  'brief_drawings': 'DRAFT_ANNEXURE_DRAWINGS', // alias
  
  // Best Mode (AU, US)
  'bestMode': 'DRAFT_ANNEXURE_BEST_MODE',
  'best_mode': 'DRAFT_ANNEXURE_BEST_MODE', // alias
  'bestMethod': 'DRAFT_ANNEXURE_BEST_MODE', // alias
  'best_method': 'DRAFT_ANNEXURE_BEST_MODE', // alias
  
  // Industrial Applicability (PCT, JP)
  'industrialApplicability': 'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY',
  'industrial_applicability': 'DRAFT_ANNEXURE_INDUSTRIAL_APPLICABILITY', // alias
  
  // Reference Numerals
  'listOfNumerals': 'DRAFT_ANNEXURE_NUMERALS',
  'list_of_numerals': 'DRAFT_ANNEXURE_NUMERALS', // alias
  'numeralList': 'DRAFT_ANNEXURE_NUMERALS', // alias
  'numeral_list': 'DRAFT_ANNEXURE_NUMERALS', // alias
  'referenceNumerals': 'DRAFT_ANNEXURE_NUMERALS', // alias
  'reference_numerals': 'DRAFT_ANNEXURE_NUMERALS', // alias
  
  // Cross-Reference
  'crossReference': 'DRAFT_ANNEXURE_CROSS_REFERENCE',
  'cross_reference': 'DRAFT_ANNEXURE_CROSS_REFERENCE', // alias
  'crossReferences': 'DRAFT_ANNEXURE_CROSS_REFERENCE', // alias
  'cross_references': 'DRAFT_ANNEXURE_CROSS_REFERENCE', // alias
  'relatedApplications': 'DRAFT_ANNEXURE_CROSS_REFERENCE', // alias
  'related_applications': 'DRAFT_ANNEXURE_CROSS_REFERENCE', // alias
  
  // Preamble (some jurisdictions)
  'preamble': 'DRAFT_ANNEXURE_PREAMBLE',
}

/**
 * Get the workflow stage code for a section key
 * Returns undefined if no mapping exists (will use task-level or system default model)
 * 
 * @param sectionKey - The superset section key (e.g., 'background', 'claims')
 * @returns The workflow stage code (e.g., 'DRAFT_ANNEXURE_BACKGROUND') or undefined
 * 
 * @example
 * const stageCode = getSectionStageCode('background')
 * // Returns: 'DRAFT_ANNEXURE_BACKGROUND'
 * 
 * const stageCode = getSectionStageCode('background_of_invention')
 * // Returns: 'DRAFT_ANNEXURE_BACKGROUND' (alias mapped)
 */
export function getSectionStageCode(sectionKey: string): string | undefined {
  // Try exact match first
  if (SECTION_TO_STAGE_MAP[sectionKey]) {
    return SECTION_TO_STAGE_MAP[sectionKey]
  }
  
  // Try lowercase version
  const lowerKey = sectionKey.toLowerCase()
  if (SECTION_TO_STAGE_MAP[lowerKey]) {
    return SECTION_TO_STAGE_MAP[lowerKey]
  }
  
  // Try snake_case conversion
  const snakeCase = sectionKey.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
  if (SECTION_TO_STAGE_MAP[snakeCase]) {
    return SECTION_TO_STAGE_MAP[snakeCase]
  }
  
  return undefined
}

/**
 * Get the workflow stage code with fallback logging
 * Useful when you want to track unmapped sections
 * 
 * @param sectionKey - The superset section key
 * @returns The workflow stage code or 'DRAFT_ANNEXURE_DESCRIPTION' as fallback
 */
export function getSectionStageCodeWithFallback(sectionKey: string): string {
  const stageCode = getSectionStageCode(sectionKey)
  
  if (!stageCode) {
    console.warn(`[section-stage-mapping] No stage mapping for section "${sectionKey}", using default DRAFT_ANNEXURE_DESCRIPTION`)
    return 'DRAFT_ANNEXURE_DESCRIPTION'
  }
  
  return stageCode
}

/**
 * Check if a section key has a stage mapping
 */
export function hasSectionStageMapping(sectionKey: string): boolean {
  return getSectionStageCode(sectionKey) !== undefined
}

/**
 * Get all supported section keys (canonical keys only, not aliases)
 */
export function getSupportedSectionKeys(): string[] {
  return [
    'title',
    'preamble',
    'fieldOfInvention',
    'background',
    'objectsOfInvention',
    'summary',
    'technicalProblem',
    'technicalSolution',
    'advantageousEffects',
    'briefDescriptionOfDrawings',
    'detailedDescription',
    'bestMethod',
    'industrialApplicability',
    'claims',
    'abstract',
    'listOfNumerals',
    'crossReference'
  ]
}

/**
 * Get the canonical section key from an alias
 * Returns the input if no alias mapping exists
 */
export function getCanonicalSectionKey(sectionKeyOrAlias: string): string {
  const stageCode = getSectionStageCode(sectionKeyOrAlias)
  
  if (!stageCode) {
    return sectionKeyOrAlias
  }
  
  // Reverse lookup to find canonical key
  const canonicalKeys = getSupportedSectionKeys()
  for (const key of canonicalKeys) {
    if (SECTION_TO_STAGE_MAP[key] === stageCode) {
      return key
    }
  }
  
  return sectionKeyOrAlias
}
