/**
 * Annexure Draft Schema Constants
 * 
 * Centralizes the schema definition for AnnexureDraft to avoid
 * hardcoding legacy field lists in multiple places.
 * 
 * DATABASE IS THE ONLY SOURCE OF TRUTH for section definitions.
 * This file only defines the database schema structure.
 */

/**
 * Legacy columns in AnnexureDraft table that have dedicated database columns.
 * These are the original section fields before extraSections JSON was added.
 * 
 * New sections should be stored in the extraSections JSON column.
 * Do not add new entries here - update via database migrations instead.
 */
export const ANNEXURE_LEGACY_COLUMNS = [
  'title',
  'fieldOfInvention',
  'background',
  'summary',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',
  'claims',
  'abstract',
  'industrialApplicability',
  'listOfNumerals'
] as const

export type AnnexureLegacyColumn = typeof ANNEXURE_LEGACY_COLUMNS[number]

/**
 * Check if a section key is a legacy column in AnnexureDraft
 */
export function isLegacyColumn(sectionKey: string): boolean {
  return ANNEXURE_LEGACY_COLUMNS.includes(sectionKey as AnnexureLegacyColumn)
}

/**
 * Separate section data into legacy columns and extraSections
 * @param sections - Object with section keys and content
 * @returns Object with legacyData and extraSections
 */
export function separateSectionData<T>(
  sections: Record<string, T>
): { legacyData: Partial<Record<AnnexureLegacyColumn, T>>; extraSections: Record<string, T> } {
  const legacyData: Partial<Record<AnnexureLegacyColumn, T>> = {}
  const extraSections: Record<string, T> = {}
  
  for (const [key, value] of Object.entries(sections)) {
    if (isLegacyColumn(key)) {
      legacyData[key as AnnexureLegacyColumn] = value
    } else {
      extraSections[key] = value
    }
  }
  
  return { legacyData, extraSections }
}

