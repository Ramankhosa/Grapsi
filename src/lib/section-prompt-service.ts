/**
 * Section Prompt Service
 * 
 * Manages country-specific top-up prompts stored in the database.
 * Provides CRUD operations, versioning, and audit trail.
 * 
 * Hierarchy:
 * 1. CountrySectionPrompt (database) - Country-specific top-up prompts
 * 2. SupersetSection (database) - Base universal prompts
 */

import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { getCountryProfile } from './country-profile-service'

// ============================================================================
// Types
// ============================================================================

export interface SectionPromptTopUp {
  instruction: string
  constraints: string[]
  additions?: string[]
  importFiguresDirectly?: boolean // When true, bypass LLM and import figure titles directly
}

export interface SectionPrompt {
  id: string
  countryCode: string
  sectionKey: string
  instruction: string
  constraints: string[]
  additions: string[]
  importFiguresDirectly: boolean // When true, bypass LLM and import figure titles directly
  version: number
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  createdBy?: string
  updatedBy?: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateSectionPromptInput {
  countryCode: string
  sectionKey: string
  instruction: string
  constraints?: string[]
  additions?: string[]
  createdBy?: string
}

export interface UpdateSectionPromptInput {
  instruction?: string
  constraints?: string[]
  additions?: string[]
  importFiguresDirectly?: boolean
  changeReason?: string
  updatedBy?: string
}

// ============================================================================
// Cache
// ============================================================================

// In-memory cache for active prompts (refreshed on updates)
let promptCache: Map<string, SectionPrompt> | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 2 * 60 * 1000 // 2 minutes (shorter than country profile cache)

function getCacheKey(countryCode: string, sectionKey: string): string {
  return `${countryCode.toUpperCase()}:${sectionKey}`
}

export function invalidateSectionPromptCache(): void {
  promptCache = null
  cacheTimestamp = 0
}

// ============================================================================
// Core CRUD Operations
// ============================================================================

/**
 * Get a specific section prompt from database
 * Falls back to JSON file if not in database
 */
export async function getSectionPrompt(
  countryCode: string,
  sectionKey: string
): Promise<SectionPromptTopUp | null> {
  const jurisdiction = countryCode.toUpperCase()
  const cacheKey = getCacheKey(jurisdiction, sectionKey)
  const now = Date.now()

  // Check cache first
  if (promptCache && (now - cacheTimestamp) < CACHE_DURATION) {
    const cached = promptCache.get(cacheKey)
    if (cached) {
      return {
        instruction: cached.instruction,
        constraints: cached.constraints,
        additions: cached.additions
      }
    }
  }

  // Try database first
  try {
    const dbPrompt = await prisma.countrySectionPrompt.findFirst({
      where: {
        countryCode: { equals: jurisdiction, mode: 'insensitive' },
        sectionKey: { equals: sectionKey, mode: 'insensitive' },
        status: 'ACTIVE'
      }
    })

    if (dbPrompt) {
      // Update cache
      if (!promptCache) {
        promptCache = new Map()
        cacheTimestamp = now
      }
      promptCache.set(cacheKey, {
        id: dbPrompt.id,
        countryCode: dbPrompt.countryCode,
        sectionKey: dbPrompt.sectionKey,
        instruction: dbPrompt.instruction,
        constraints: Array.isArray(dbPrompt.constraints) ? dbPrompt.constraints as string[] : [],
        additions: Array.isArray(dbPrompt.additions) ? dbPrompt.additions as string[] : [],
        importFiguresDirectly: dbPrompt.importFiguresDirectly || false,
        version: dbPrompt.version,
        status: dbPrompt.status as 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
        createdBy: dbPrompt.createdBy || undefined,
        updatedBy: dbPrompt.updatedBy || undefined,
        createdAt: dbPrompt.createdAt,
        updatedAt: dbPrompt.updatedAt
      })

      // CRITICAL: Include importFiguresDirectly flag for Brief Description of Drawings
      return {
        instruction: dbPrompt.instruction,
        constraints: Array.isArray(dbPrompt.constraints) ? dbPrompt.constraints as string[] : [],
        additions: Array.isArray(dbPrompt.additions) ? dbPrompt.additions as string[] : [],
        importFiguresDirectly: dbPrompt.importFiguresDirectly || false
      }
    }
  } catch (error) {
    console.warn(`[SectionPromptService] DB lookup failed for ${jurisdiction}/${sectionKey}:`, error)
  }

  return null
}

/**
 * Get all section prompts for a country
 */
export async function getAllSectionPrompts(
  countryCode: string,
  includeArchived: boolean = false
): Promise<SectionPrompt[]> {
  const jurisdiction = countryCode.toUpperCase()

  try {
    const prompts = await prisma.countrySectionPrompt.findMany({
      where: {
        countryCode: jurisdiction,
        ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } })
      },
      orderBy: { sectionKey: 'asc' }
    })

    return prompts.map(p => ({
      id: p.id,
      countryCode: p.countryCode,
      sectionKey: p.sectionKey,
      instruction: p.instruction,
      constraints: Array.isArray(p.constraints) ? p.constraints as string[] : [],
      additions: Array.isArray(p.additions) ? p.additions as string[] : [],
      importFiguresDirectly: p.importFiguresDirectly || false,
      version: p.version,
      status: p.status as 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
      createdBy: p.createdBy || undefined,
      updatedBy: p.updatedBy || undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }))
  } catch (error) {
    console.error(`[SectionPromptService] Failed to get all prompts for ${jurisdiction}:`, error)
    return []
  }
}

/**
 * Create a new section prompt
 */
export async function createSectionPrompt(
  input: CreateSectionPromptInput
): Promise<SectionPrompt> {
  const jurisdiction = input.countryCode.toUpperCase()

  // Check if prompt already exists
  const existing = await prisma.countrySectionPrompt.findFirst({
    where: {
      countryCode: jurisdiction,
      sectionKey: input.sectionKey,
      status: 'ACTIVE'
    }
  })

  if (existing) {
    throw new Error(`Active prompt already exists for ${jurisdiction}/${input.sectionKey}. Use update instead.`)
  }

  const prompt = await prisma.countrySectionPrompt.create({
    data: {
      countryCode: jurisdiction,
      sectionKey: input.sectionKey,
      instruction: input.instruction,
      constraints: input.constraints || [],
      additions: input.additions || [],
      version: 1,
      status: 'ACTIVE',
      createdBy: input.createdBy
    }
  })

  // Create history entry
  await prisma.countrySectionPromptHistory.create({
    data: {
      promptId: prompt.id,
      countryCode: jurisdiction,
      sectionKey: input.sectionKey,
      instruction: prompt.instruction,
      constraints: prompt.constraints as Prisma.InputJsonValue,
      additions: (prompt.additions ?? []) as Prisma.InputJsonValue,
      version: 1,
      changeType: 'CREATE',
      changedBy: input.createdBy
    }
  })

  // Invalidate cache
  invalidateSectionPromptCache()

  return {
    id: prompt.id,
    countryCode: prompt.countryCode,
    sectionKey: prompt.sectionKey,
    instruction: prompt.instruction,
    constraints: Array.isArray(prompt.constraints) ? prompt.constraints as string[] : [],
    additions: Array.isArray(prompt.additions) ? prompt.additions as string[] : [],
    importFiguresDirectly: prompt.importFiguresDirectly || false,
    version: prompt.version,
    status: prompt.status as 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
    createdBy: prompt.createdBy || undefined,
    updatedBy: prompt.updatedBy || undefined,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt
  }
}

/**
 * Update an existing section prompt (creates new version)
 */
export async function updateSectionPrompt(
  id: string,
  input: UpdateSectionPromptInput
): Promise<SectionPrompt> {
  const existing = await prisma.countrySectionPrompt.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new Error(`Prompt not found: ${id}`)
  }

  const newVersion = existing.version + 1

  const updated = await prisma.countrySectionPrompt.update({
    where: { id },
    data: {
      instruction: input.instruction ?? existing.instruction,
      constraints: (input.constraints ?? existing.constraints ?? []) as Prisma.InputJsonValue,
      additions: (input.additions ?? existing.additions ?? []) as Prisma.InputJsonValue,
      importFiguresDirectly: input.importFiguresDirectly ?? existing.importFiguresDirectly,
      version: newVersion,
      updatedBy: input.updatedBy
    }
  })

  // Create history entry
  await prisma.countrySectionPromptHistory.create({
    data: {
      promptId: updated.id,
      countryCode: updated.countryCode,
      sectionKey: updated.sectionKey,
      instruction: updated.instruction,
      constraints: updated.constraints as Prisma.InputJsonValue,
      additions: (updated.additions ?? []) as Prisma.InputJsonValue,
      version: newVersion,
      changeType: 'UPDATE',
      changeReason: input.changeReason,
      changedBy: input.updatedBy
    }
  })

  // Invalidate cache
  invalidateSectionPromptCache()

  return {
    id: updated.id,
    countryCode: updated.countryCode,
    sectionKey: updated.sectionKey,
    instruction: updated.instruction,
    constraints: Array.isArray(updated.constraints) ? updated.constraints as string[] : [],
    additions: Array.isArray(updated.additions) ? updated.additions as string[] : [],
    importFiguresDirectly: updated.importFiguresDirectly || false,
    version: updated.version,
    status: updated.status as 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
    createdBy: updated.createdBy || undefined,
    updatedBy: updated.updatedBy || undefined,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  }
}

/**
 * Archive a section prompt (soft delete)
 */
export async function archiveSectionPrompt(
  id: string,
  archivedBy?: string,
  reason?: string
): Promise<void> {
  const existing = await prisma.countrySectionPrompt.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new Error(`Prompt not found: ${id}`)
  }

  await prisma.countrySectionPrompt.update({
    where: { id },
    data: {
      status: 'ARCHIVED',
      updatedBy: archivedBy
    }
  })

  // Create history entry
  await prisma.countrySectionPromptHistory.create({
    data: {
      promptId: existing.id,
      countryCode: existing.countryCode,
      sectionKey: existing.sectionKey,
      instruction: existing.instruction,
      constraints: existing.constraints as Prisma.InputJsonValue,
      additions: (existing.additions ?? []) as Prisma.InputJsonValue,
      version: existing.version,
      changeType: 'ARCHIVE',
      changeReason: reason,
      changedBy: archivedBy
    }
  })

  // Invalidate cache
  invalidateSectionPromptCache()
}

/**
 * Restore an archived prompt
 */
export async function restoreSectionPrompt(
  id: string,
  restoredBy?: string
): Promise<SectionPrompt> {
  const existing = await prisma.countrySectionPrompt.findUnique({
    where: { id }
  })

  if (!existing) {
    throw new Error(`Prompt not found: ${id}`)
  }

  if (existing.status !== 'ARCHIVED') {
    throw new Error(`Prompt is not archived: ${id}`)
  }

  // Check if there's already an active prompt for this country/section
  const activeExists = await prisma.countrySectionPrompt.findFirst({
    where: {
      countryCode: existing.countryCode,
      sectionKey: existing.sectionKey,
      status: 'ACTIVE',
      id: { not: id }
    }
  })

  if (activeExists) {
    throw new Error(`An active prompt already exists for ${existing.countryCode}/${existing.sectionKey}. Archive it first.`)
  }

  const restored = await prisma.countrySectionPrompt.update({
    where: { id },
    data: {
      status: 'ACTIVE',
      updatedBy: restoredBy
    }
  })

  // Create history entry
  await prisma.countrySectionPromptHistory.create({
    data: {
      promptId: restored.id,
      countryCode: restored.countryCode,
      sectionKey: restored.sectionKey,
      instruction: restored.instruction,
      constraints: restored.constraints as Prisma.InputJsonValue,
      additions: (restored.additions ?? []) as Prisma.InputJsonValue,
      version: restored.version,
      changeType: 'RESTORE',
      changedBy: restoredBy
    }
  })

  // Invalidate cache
  invalidateSectionPromptCache()

  return {
    id: restored.id,
    countryCode: restored.countryCode,
    sectionKey: restored.sectionKey,
    instruction: restored.instruction,
    constraints: Array.isArray(restored.constraints) ? restored.constraints as string[] : [],
    additions: Array.isArray(restored.additions) ? restored.additions as string[] : [],
    importFiguresDirectly: restored.importFiguresDirectly || false,
    version: restored.version,
    status: restored.status as 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
    createdBy: restored.createdBy || undefined,
    updatedBy: restored.updatedBy || undefined,
    createdAt: restored.createdAt,
    updatedAt: restored.updatedAt
  }
}

/**
 * Get version history for a prompt
 */
export async function getSectionPromptHistory(
  countryCode: string,
  sectionKey: string
): Promise<Array<{
  version: number
  instruction: string
  constraints: string[]
  additions: string[]
  changeType: string
  changeReason?: string
  changedBy?: string
  changedAt: Date
}>> {
  const jurisdiction = countryCode.toUpperCase()

  const history = await prisma.countrySectionPromptHistory.findMany({
    where: {
      countryCode: jurisdiction,
      sectionKey: sectionKey
    },
    orderBy: { changedAt: 'desc' }
  })

  return history.map(h => ({
    version: h.version,
    instruction: h.instruction,
    constraints: Array.isArray(h.constraints) ? h.constraints as string[] : [],
    additions: Array.isArray(h.additions) ? h.additions as string[] : [],
    changeType: h.changeType,
    changeReason: h.changeReason || undefined,
    changedBy: h.changedBy || undefined,
    changedAt: h.changedAt
  }))
}

// ============================================================================
// Seed/Import Functions
// ============================================================================

/**
 * Seed prompts from JSON file to database
 */
export async function seedPromptsFromJson(
  countryCode: string,
  seededBy?: string
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const jurisdiction = countryCode.toUpperCase()
  const result = { created: 0, skipped: 0, errors: [] as string[] }

  try {
    const profile = await getCountryProfile(jurisdiction)
    if (!profile) {
      result.errors.push(`Country profile not found for ${jurisdiction}`)
      return result
    }

    const sections = profile.profileData?.prompts?.sections || {}

    for (const [sectionKey, config] of Object.entries(sections)) {
      try {
        // Check if prompt already exists in DB
        const existing = await prisma.countrySectionPrompt.findFirst({
          where: {
            countryCode: jurisdiction,
            sectionKey: sectionKey
          }
        })

        if (existing) {
          result.skipped++
          continue
        }

        // Extract topUp or legacy format
        const topUp = (config as any)?.topUp || config
        if (!topUp?.instruction) {
          result.skipped++
          continue
        }

        await createSectionPrompt({
          countryCode: jurisdiction,
          sectionKey: sectionKey,
          instruction: topUp.instruction,
          constraints: topUp.constraints || [],
          additions: topUp.additions || [],
          createdBy: seededBy || 'system:seed'
        })

        result.created++
      } catch (error) {
        result.errors.push(`Failed to seed ${sectionKey}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    result.errors.push(`Failed to load profile: ${error instanceof Error ? error.message : String(error)}`)
  }

  return result
}

/**
 * Export prompts to JSON format (for backup or migration)
 */
export async function exportPromptsToJson(
  countryCode: string
): Promise<Record<string, SectionPromptTopUp>> {
  const prompts = await getAllSectionPrompts(countryCode)
  const result: Record<string, SectionPromptTopUp> = {}

  for (const prompt of prompts) {
    if (prompt.status === 'ACTIVE') {
      result[prompt.sectionKey] = {
        instruction: prompt.instruction,
        constraints: prompt.constraints,
        additions: prompt.additions
      }
    }
  }

  return result
}
