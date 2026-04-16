/**
 * Section Alias Resolution Service
 * 
 * Resolves alternative section keys (aliases) to their canonical sectionKey.
 * Uses database-driven aliasing stored in SupersetSection.aliases.
 * 
 * IMPORTANT: Database is the ONLY source of truth. No hardcoded fallbacks.
 * If database is unavailable, operations will fail with clear error messages.
 * 
 * Example:
 *   - "objects" → "objectsOfInvention" (canonical)
 *   - "objects_of_invention" → "objectsOfInvention" (canonical)
 *   - "detailed_description" → "detailedDescription" (canonical)
 */

import { prisma } from './prisma'

// Cache for alias → canonical key mapping
let aliasCache: Map<string, string> | null = null
let aliasCacheTimestamp = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Get the alias-to-canonical key mapping from database
 * Uses caching to minimize DB queries
 * 
 * DATABASE IS THE ONLY SOURCE OF TRUTH - No hardcoded fallbacks
 */
async function getAliasMap(): Promise<Map<string, string>> {
  const now = Date.now()
  
  if (aliasCache && (now - aliasCacheTimestamp) < CACHE_DURATION) {
    return aliasCache
  }
  
  // Database is the ONLY source of truth - no fallbacks
  const sections = await prisma.supersetSection.findMany({
    where: { isActive: true },
    select: { sectionKey: true, aliases: true }
  })
  
  if (sections.length === 0) {
    throw new Error(
      '[SectionAliasService] CRITICAL: No SupersetSection entries found in database. ' +
      'Please seed the superset_sections table via /super-admin/superset-sections.'
    )
  }
  
  aliasCache = new Map()
  
  for (const section of sections) {
    // The canonical key maps to itself
    aliasCache.set(section.sectionKey, section.sectionKey)
    
    // Each alias maps to the canonical key
    for (const alias of section.aliases) {
      aliasCache.set(alias, section.sectionKey)
    }
  }
  
  aliasCacheTimestamp = now
  return aliasCache
}

/**
 * Resolve a section key (which may be an alias) to its canonical key
 * 
 * @param key - The section key to resolve (may be alias or canonical)
 * @returns The canonical section key, or the original key if not found
 */
export async function resolveCanonicalKey(key: string): Promise<string> {
  const aliasMap = await getAliasMap()
  return aliasMap.get(key) || key
}

/**
 * Resolve multiple keys at once (more efficient for batch operations)
 * 
 * @param keys - Array of section keys to resolve
 * @returns Map of original key → canonical key
 */
export async function resolveCanonicalKeys(keys: string[]): Promise<Map<string, string>> {
  const aliasMap = await getAliasMap()
  const result = new Map<string, string>()
  
  for (const key of keys) {
    result.set(key, aliasMap.get(key) || key)
  }
  
  return result
}

/**
 * Check if a key is a known alias (not canonical)
 */
export async function isAlias(key: string): Promise<boolean> {
  const aliasMap = await getAliasMap()
  const canonical = aliasMap.get(key)
  return canonical !== undefined && canonical !== key
}

/**
 * Get all aliases for a canonical key
 */
export async function getAliasesForKey(canonicalKey: string): Promise<string[]> {
  try {
    const section = await prisma.supersetSection.findUnique({
      where: { sectionKey: canonicalKey },
      select: { aliases: true }
    })
    return section?.aliases || []
  } catch (error) {
    console.error(`Failed to get aliases for ${canonicalKey}:`, error)
    return []
  }
}

/**
 * Add an alias to a section (for admin use)
 */
export async function addAlias(canonicalKey: string, alias: string): Promise<boolean> {
  try {
    const section = await prisma.supersetSection.findUnique({
      where: { sectionKey: canonicalKey },
      select: { aliases: true }
    })
    
    if (!section) {
      console.error(`Section ${canonicalKey} not found`)
      return false
    }
    
    // Don't add duplicate
    if (section.aliases.includes(alias)) {
      return true
    }
    
    await prisma.supersetSection.update({
      where: { sectionKey: canonicalKey },
      data: { aliases: [...section.aliases, alias] }
    })
    
    // Invalidate cache
    aliasCache = null
    return true
  } catch (error) {
    console.error(`Failed to add alias ${alias} to ${canonicalKey}:`, error)
    return false
  }
}

/**
 * Remove an alias from a section (for admin use)
 */
export async function removeAlias(canonicalKey: string, alias: string): Promise<boolean> {
  try {
    const section = await prisma.supersetSection.findUnique({
      where: { sectionKey: canonicalKey },
      select: { aliases: true }
    })
    
    if (!section) return false
    
    await prisma.supersetSection.update({
      where: { sectionKey: canonicalKey },
      data: { aliases: section.aliases.filter(a => a !== alias) }
    })
    
    // Invalidate cache
    aliasCache = null
    return true
  } catch (error) {
    console.error(`Failed to remove alias ${alias} from ${canonicalKey}:`, error)
    return false
  }
}

/**
 * Invalidate the alias cache (call after DB updates)
 */
export function invalidateAliasCache(): void {
  aliasCache = null
  aliasCacheTimestamp = 0
}

/**
 * Get all canonical section keys from database
 * 
 * DATABASE IS THE ONLY SOURCE OF TRUTH - No hardcoded fallbacks
 */
export async function getCanonicalKeys(): Promise<string[]> {
  const sections = await prisma.supersetSection.findMany({
    where: { isActive: true },
    select: { sectionKey: true },
    orderBy: { displayOrder: 'asc' }
  })
  
  if (sections.length === 0) {
    throw new Error(
      '[SectionAliasService] CRITICAL: No SupersetSection entries found in database. ' +
      'Please seed the superset_sections table via /super-admin/superset-sections.'
    )
  }
  
  return sections.map(s => s.sectionKey)
}

/**
 * Normalize a section data object by converting all alias keys to canonical keys
 * 
 * @param data - Object with section keys (may include aliases)
 * @returns Object with all keys converted to canonical form
 */
export async function normalizeSectionKeys<T>(data: Record<string, T>): Promise<Record<string, T>> {
  const aliasMap = await getAliasMap()
  const normalized: Record<string, T> = {}
  
  for (const [key, value] of Object.entries(data)) {
    const canonicalKey = aliasMap.get(key) || key
    normalized[canonicalKey] = value
  }
  
  return normalized
}
