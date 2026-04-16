/**
 * User Instruction Service
 * 
 * Manages user-provided custom instructions for patent sections.
 * These are the highest priority in the prompt hierarchy:
 * 
 * 1. SupersetSection (database) - Base universal prompts
 * 2. CountrySectionPrompt (database) - Country-specific top-up prompts
 * 3. UserInstruction (database) - User instructions (HIGHEST PRIORITY)
 * 
 * Instructions can be:
 * - Session-level (sessionId = specific ID) - applies only to that draft
 * - User-level persistent (sessionId = null) - applies to ALL user's drafts for that jurisdiction
 * 
 * Priority when fetching: Session-level > User-level persistent
 * 
 * Users can customize:
 * - Custom instruction text for any section
 * - What to emphasize/focus on
 * - What to avoid/exclude
 * - Writing style preferences
 * - Target word count overrides
 */

import { prisma } from './prisma'

// ============================================================================
// Types
// ============================================================================

export interface UserSectionInstruction {
  id: string
  sessionId: string | null  // null = user-level persistent
  userId: string
  jurisdiction: string // "*" = all jurisdictions, or specific like "IN", "US"
  sectionKey: string
  instruction: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
  isActive: boolean
  isPersistent: boolean // Computed: true if sessionId is null
  createdAt: Date
  updatedAt: Date
}

export interface CreateUserInstructionInput {
  sessionId?: string | null  // null = user-level persistent
  userId: string
  jurisdiction?: string // Default "*" (all jurisdictions)
  sectionKey: string
  instruction: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
  isPersistent?: boolean // If true, saves as user-level (sessionId = null)
}

export interface UpdateUserInstructionInput {
  instruction?: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
  isActive?: boolean
}

export interface UserInstructionContext {
  instruction: string
  emphasis?: string
  avoid?: string
  style?: string
  wordCount?: number
  isPersistent?: boolean // Indicates if this came from a persistent instruction
  instructionId?: string // ID of the instruction for reference
}

// ============================================================================
// Cache
// ============================================================================

// Cache key format: "session:{sessionId}" or "user:{userId}"
const instructionCache = new Map<string, Map<string, UserSectionInstruction>>()
const cacheTTL = 60 * 1000 // 1 minute
const cacheTimestamps = new Map<string, number>()

function getCachedInstructions(cacheKey: string): Map<string, UserSectionInstruction> | null {
  const timestamp = cacheTimestamps.get(cacheKey)
  if (timestamp && Date.now() - timestamp < cacheTTL) {
    return instructionCache.get(cacheKey) || null
  }
  return null
}

function setCachedInstructions(cacheKey: string, instructions: Map<string, UserSectionInstruction>): void {
  instructionCache.set(cacheKey, instructions)
  cacheTimestamps.set(cacheKey, Date.now())
}

export function invalidateSessionInstructionCache(sessionId: string): void {
  instructionCache.delete(`session:${sessionId}`)
  cacheTimestamps.delete(`session:${sessionId}`)
}

export function invalidateUserInstructionCache(userId: string): void {
  instructionCache.delete(`user:${userId}`)
  cacheTimestamps.delete(`user:${userId}`)
}

/**
 * Clone instructions from one session to another (e.g., when a session is reset/newly created).
 * Skips any sectionKey/jurisdiction pairs that already exist on the target session.
 * Returns number of instructions copied.
 */
export async function cloneInstructionsBetweenSessions(
  sourceSessionId: string,
  targetSessionId: string,
  userId: string
): Promise<number> {
  if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) return 0

  const [source, targetExisting] = await Promise.all([
    prisma.userSectionInstruction.findMany({ where: { sessionId: sourceSessionId } }),
    prisma.userSectionInstruction.findMany({ where: { sessionId: targetSessionId } })
  ])

  if (!source.length) return 0

  const existingKeys = new Set(targetExisting.map(i => `${i.sectionKey}:${i.jurisdiction}`))
  const payload = source
    .filter(i => !existingKeys.has(`${i.sectionKey}:${i.jurisdiction}`))
    .map(i => ({
      sessionId: targetSessionId,
      userId,
      jurisdiction: i.jurisdiction,
      sectionKey: i.sectionKey,
      instruction: i.instruction,
      emphasis: i.emphasis,
      avoid: i.avoid,
      style: i.style,
      wordCount: i.wordCount,
      isActive: i.isActive
    }))

  if (payload.length === 0) return 0

  await prisma.userSectionInstruction.createMany({ data: payload })
  invalidateSessionInstructionCache(targetSessionId)
  return payload.length
}

// ============================================================================
// Core CRUD Operations
// ============================================================================

/**
 * Get user instruction for a specific section
 * Priority: Session-level > User-level persistent
 * 
 * @param sessionId - The drafting session ID (optional for user-level only lookup)
 * @param userId - The user ID (required for user-level lookup)
 * @param sectionKey - The section key (canonical)
 * @param jurisdiction - Optional jurisdiction code (e.g., "IN", "US")
 */
export async function getUserInstruction(
  sessionId: string | null,
  sectionKey: string,
  jurisdiction?: string,
  userId?: string
): Promise<UserInstructionContext | null> {
  const jurisdictionCode = jurisdiction?.toUpperCase() || '*'
  
  try {
    // 1. Check session-level first (if sessionId provided)
    if (sessionId) {
      const sessionInstruction = await prisma.userSectionInstruction.findFirst({
        where: {
          sessionId,
          sectionKey,
          jurisdiction: jurisdictionCode,
          isActive: true
        }
      })

      if (sessionInstruction) {
        return {
          instruction: sessionInstruction.instruction,
          emphasis: sessionInstruction.emphasis || undefined,
          avoid: sessionInstruction.avoid || undefined,
          style: sessionInstruction.style || undefined,
          wordCount: sessionInstruction.wordCount || undefined,
          isPersistent: false,
          instructionId: sessionInstruction.id
        }
      }

      // Fall back to wildcard jurisdiction at session level
      if (jurisdictionCode !== '*') {
        const wildcardSessionInstruction = await prisma.userSectionInstruction.findFirst({
          where: {
            sessionId,
            sectionKey,
            jurisdiction: '*',
            isActive: true
          }
        })

        if (wildcardSessionInstruction) {
          return {
            instruction: wildcardSessionInstruction.instruction,
            emphasis: wildcardSessionInstruction.emphasis || undefined,
            avoid: wildcardSessionInstruction.avoid || undefined,
            style: wildcardSessionInstruction.style || undefined,
            wordCount: wildcardSessionInstruction.wordCount || undefined,
            isPersistent: false,
            instructionId: wildcardSessionInstruction.id
          }
        }
      }
    }

    // 2. Check user-level persistent (if userId provided)
    if (userId) {
      const userInstruction = await prisma.userSectionInstruction.findFirst({
        where: {
          userId,
          sessionId: null, // User-level = no session
          sectionKey,
          jurisdiction: jurisdictionCode,
          isActive: true
        }
      })

      if (userInstruction) {
        return {
          instruction: userInstruction.instruction,
          emphasis: userInstruction.emphasis || undefined,
          avoid: userInstruction.avoid || undefined,
          style: userInstruction.style || undefined,
          wordCount: userInstruction.wordCount || undefined,
          isPersistent: true,
          instructionId: userInstruction.id
        }
      }

      // Fall back to wildcard jurisdiction at user level
      if (jurisdictionCode !== '*') {
        const wildcardUserInstruction = await prisma.userSectionInstruction.findFirst({
          where: {
            userId,
            sessionId: null,
            sectionKey,
            jurisdiction: '*',
            isActive: true
          }
        })

        if (wildcardUserInstruction) {
          return {
            instruction: wildcardUserInstruction.instruction,
            emphasis: wildcardUserInstruction.emphasis || undefined,
            avoid: wildcardUserInstruction.avoid || undefined,
            style: wildcardUserInstruction.style || undefined,
            wordCount: wildcardUserInstruction.wordCount || undefined,
            isPersistent: true,
            instructionId: wildcardUserInstruction.id
          }
        }
      }
    }
  } catch (error) {
    console.warn(`[UserInstructionService] Failed to get instruction for ${sessionId}/${jurisdictionCode}/${sectionKey}:`, error)
  }

  return null
}

/**
 * Get all user instructions (session-level + user-level merged)
 * Session-level instructions override user-level for the same section/jurisdiction
 * 
 * @param sessionId - The drafting session ID (optional)
 * @param userId - The user ID (required for user-level)
 * @param jurisdiction - Optional jurisdiction filter
 * @param includeInactive - Include deactivated instructions
 */
export async function getAllUserInstructions(
  sessionId: string | null,
  userId?: string,
  jurisdiction?: string,
  includeInactive: boolean = false
): Promise<UserSectionInstruction[]> {
  try {
    const jurisdictionFilter = jurisdiction 
      ? { jurisdiction: { in: [jurisdiction.toUpperCase(), '*'] } }
      : {}
    
    const activeFilter = includeInactive ? {} : { isActive: true }

    // Fetch both session-level and user-level instructions
    const conditions: any[] = []
    
    if (sessionId) {
      conditions.push({ sessionId })
    }
    
    if (userId) {
      conditions.push({ userId, sessionId: null }) // User-level persistent
    }

    if (conditions.length === 0) {
      return []
    }

    const instructions = await prisma.userSectionInstruction.findMany({
      where: {
        OR: conditions,
        ...jurisdictionFilter,
        ...activeFilter
      },
      orderBy: [{ jurisdiction: 'asc' }, { sectionKey: 'asc' }]
    })

    // Merge: session-level takes precedence over user-level
    const merged = new Map<string, UserSectionInstruction>()
    
    for (const i of instructions) {
      const key = `${i.sectionKey}:${i.jurisdiction}`
      const existing = merged.get(key)
      
      const mapped: UserSectionInstruction = {
        id: i.id,
        sessionId: i.sessionId,
        userId: i.userId,
        jurisdiction: i.jurisdiction,
        sectionKey: i.sectionKey,
        instruction: i.instruction,
        emphasis: i.emphasis || undefined,
        avoid: i.avoid || undefined,
        style: i.style || undefined,
        wordCount: i.wordCount || undefined,
        isActive: i.isActive,
        isPersistent: i.sessionId === null,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt
      }

      // Session-level (sessionId not null) takes precedence
      if (!existing || (i.sessionId !== null && existing.sessionId === null)) {
        merged.set(key, mapped)
      }
    }

    return Array.from(merged.values())
  } catch (error) {
    console.error(`[UserInstructionService] Failed to get all instructions:`, error)
    return []
  }
}

/**
 * Get only user-level persistent instructions (no session context)
 */
export async function getUserPersistentInstructions(
  userId: string,
  jurisdiction?: string,
  includeInactive: boolean = false
): Promise<UserSectionInstruction[]> {
  try {
    const jurisdictionFilter = jurisdiction 
      ? { jurisdiction: { in: [jurisdiction.toUpperCase(), '*'] } }
      : {}
    
    const instructions = await prisma.userSectionInstruction.findMany({
      where: {
        userId,
        sessionId: null, // Only persistent (user-level)
        ...jurisdictionFilter,
        ...(includeInactive ? {} : { isActive: true })
      },
      orderBy: [{ jurisdiction: 'asc' }, { sectionKey: 'asc' }]
    })

    return instructions.map(i => ({
      id: i.id,
      sessionId: null,
      userId: i.userId,
      jurisdiction: i.jurisdiction,
      sectionKey: i.sectionKey,
      instruction: i.instruction,
      emphasis: i.emphasis || undefined,
      avoid: i.avoid || undefined,
      style: i.style || undefined,
      wordCount: i.wordCount || undefined,
      isActive: i.isActive,
      isPersistent: true,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt
    }))
  } catch (error) {
    console.error(`[UserInstructionService] Failed to get persistent instructions for ${userId}:`, error)
    return []
  }
}

/**
 * Create or update user instruction for a section
 * Supports both session-level and user-level persistent instructions
 */
export async function upsertUserInstruction(
  input: CreateUserInstructionInput
): Promise<UserSectionInstruction> {
  const jurisdiction = input.jurisdiction?.toUpperCase() || '*'
  const sessionId = input.isPersistent ? null : (input.sessionId || null)
  
  try {
    // Find existing instruction
    const existing = await prisma.userSectionInstruction.findFirst({
      where: {
        userId: input.userId,
        sessionId,
        jurisdiction,
        sectionKey: input.sectionKey
      }
    })

    let result
    if (existing) {
      result = await prisma.userSectionInstruction.update({
        where: { id: existing.id },
        data: {
          instruction: input.instruction,
          emphasis: input.emphasis,
          avoid: input.avoid,
          style: input.style,
          wordCount: input.wordCount,
          isActive: true
        }
      })
    } else {
      result = await prisma.userSectionInstruction.create({
        data: {
          sessionId,
          userId: input.userId,
          jurisdiction,
          sectionKey: input.sectionKey,
          instruction: input.instruction,
          emphasis: input.emphasis,
          avoid: input.avoid,
          style: input.style,
          wordCount: input.wordCount,
          isActive: true
        }
      })
    }

    // Invalidate appropriate cache
    if (sessionId) {
      invalidateSessionInstructionCache(sessionId)
    }
    invalidateUserInstructionCache(input.userId)

    return {
      id: result.id,
      sessionId: result.sessionId,
      userId: result.userId,
      jurisdiction: result.jurisdiction,
      sectionKey: result.sectionKey,
      instruction: result.instruction,
      emphasis: result.emphasis || undefined,
      avoid: result.avoid || undefined,
      style: result.style || undefined,
      wordCount: result.wordCount || undefined,
      isActive: result.isActive,
      isPersistent: result.sessionId === null,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    }
  } catch (error) {
    console.error(`[UserInstructionService] Failed to upsert instruction:`, error)
    throw error
  }
}

/**
 * Update an existing user instruction
 */
export async function updateUserInstruction(
  id: string,
  input: UpdateUserInstructionInput
): Promise<UserSectionInstruction> {
  try {
    const result = await prisma.userSectionInstruction.update({
      where: { id },
      data: {
        instruction: input.instruction,
        emphasis: input.emphasis,
        avoid: input.avoid,
        style: input.style,
        wordCount: input.wordCount,
        isActive: input.isActive
      }
    })

    // Invalidate caches
    if (result.sessionId) {
      invalidateSessionInstructionCache(result.sessionId)
    }
    invalidateUserInstructionCache(result.userId)

    return {
      id: result.id,
      sessionId: result.sessionId,
      userId: result.userId,
      jurisdiction: result.jurisdiction,
      sectionKey: result.sectionKey,
      instruction: result.instruction,
      emphasis: result.emphasis || undefined,
      avoid: result.avoid || undefined,
      style: result.style || undefined,
      wordCount: result.wordCount || undefined,
      isActive: result.isActive,
      isPersistent: result.sessionId === null,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    }
  } catch (error) {
    console.error(`[UserInstructionService] Failed to update instruction:`, error)
    throw error
  }
}

/**
 * Delete user instruction
 */
export async function deleteUserInstruction(id: string): Promise<void> {
  try {
    const instruction = await prisma.userSectionInstruction.findUnique({
      where: { id }
    })

    if (instruction) {
      await prisma.userSectionInstruction.delete({
        where: { id }
      })
      if (instruction.sessionId) {
        invalidateSessionInstructionCache(instruction.sessionId)
      }
      invalidateUserInstructionCache(instruction.userId)
    }
  } catch (error) {
    console.error(`[UserInstructionService] Failed to delete instruction:`, error)
    throw error
  }
}

/**
 * Deactivate user instructions for a section (soft delete)
 * Can target session-level, user-level, or both
 */
export async function deactivateUserInstruction(
  userId: string,
  sectionKey: string,
  sessionId?: string | null,
  deactivatePersistent: boolean = false
): Promise<void> {
  try {
    const conditions: any[] = []
    
    if (sessionId) {
      conditions.push({ sessionId, sectionKey })
    }
    
    if (deactivatePersistent) {
      conditions.push({ userId, sessionId: null, sectionKey })
    }

    if (conditions.length === 0) return

    await prisma.userSectionInstruction.updateMany({
      where: { OR: conditions },
      data: { isActive: false }
    })

    if (sessionId) {
      invalidateSessionInstructionCache(sessionId)
    }
    invalidateUserInstructionCache(userId)
  } catch (error) {
    console.error(`[UserInstructionService] Failed to deactivate instruction:`, error)
    throw error
  }
}

/**
 * Bulk save user instructions for multiple sections
 */
export async function bulkSaveUserInstructions(
  userId: string,
  sessionId: string | null,
  instructions: Record<string, {
    instruction: string
    emphasis?: string
    avoid?: string
    style?: string
    wordCount?: number
  }>,
  isPersistent: boolean = false
): Promise<UserSectionInstruction[]> {
  const results: UserSectionInstruction[] = []

  for (const [sectionKey, data] of Object.entries(instructions)) {
    if (data.instruction && data.instruction.trim()) {
      const result = await upsertUserInstruction({
        sessionId: isPersistent ? null : sessionId,
        userId,
        sectionKey,
        instruction: data.instruction,
        emphasis: data.emphasis,
        avoid: data.avoid,
        style: data.style,
        wordCount: data.wordCount,
        isPersistent
      })
      results.push(result)
    }
  }

  return results
}

// ============================================================================
// Prompt Building Helpers
// ============================================================================

/**
 * Build user instruction block for inclusion in LLM prompt
 * 
 * CRITICAL: User instructions have ABSOLUTE HIGHEST PRIORITY.
 * They MUST override any conflicting base prompts or top-up prompts.
 */
export function buildUserInstructionBlock(
  userInstruction: UserInstructionContext | null
): string {
  if (!userInstruction) return ''

  const lines: string[] = []
  
  // Strong emphasis on priority
  lines.push('\n\n╔════════════════════════════════════════════════════════════╗')
  lines.push('║  USER CUSTOM INSTRUCTIONS - HIGHEST PRIORITY                ║')
  lines.push('║  These instructions OVERRIDE all other guidance.            ║')
  lines.push('║  If any conflict exists with base or jurisdiction prompts,  ║')
  lines.push('║  ALWAYS follow the user instructions below.                 ║')
  lines.push('╚════════════════════════════════════════════════════════════╝')
  lines.push('')
  lines.push(`**Primary Instruction:** ${userInstruction.instruction}`)

  if (userInstruction.emphasis) {
    lines.push(`\n**MUST Focus On:** ${userInstruction.emphasis}`)
  }

  if (userInstruction.avoid) {
    lines.push(`\n**MUST Avoid:** ${userInstruction.avoid}`)
  }

  if (userInstruction.style) {
    lines.push(`\n**Required Style:** ${userInstruction.style}`)
  }

  if (userInstruction.wordCount) {
    lines.push(`\n**Target Word Count:** ~${userInstruction.wordCount} words`)
  }

  lines.push('\n⚠️ REMINDER: The above user instructions take precedence over ALL other prompts.')
  
  return lines.join('\n')
}

/**
 * Get all user instructions for a session as a map (for prompt building)
 * Includes both session-level and user-level persistent instructions
 */
export async function getUserInstructionsMap(
  sessionId: string,
  userId?: string
): Promise<Record<string, UserInstructionContext>> {
  const instructions = await getAllUserInstructions(sessionId, userId)
  const result: Record<string, UserInstructionContext> = {}

  for (const instruction of instructions) {
    if (instruction.isActive) {
      result[instruction.sectionKey] = {
        instruction: instruction.instruction,
        emphasis: instruction.emphasis,
        avoid: instruction.avoid,
        style: instruction.style,
        wordCount: instruction.wordCount,
        isPersistent: instruction.isPersistent,
        instructionId: instruction.id
      }
    }
  }

  return result
}
