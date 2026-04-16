import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import {
  getUserInstruction,
  getAllUserInstructions,
  getUserPersistentInstructions,
  deleteUserInstruction,
  deactivateUserInstruction,
  invalidateSessionInstructionCache,
  invalidateUserInstructionCache,
  upsertUserInstruction
} from '@/lib/user-instruction-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/patents/[patentId]/drafting/user-instructions
 * Get user instructions for a session (merged with user-level persistent)
 * 
 * Query params:
 * - sessionId: optional (if not provided, returns only user-level persistent)
 * - jurisdiction: optional (filter by jurisdiction)
 * - sectionKey: optional (get specific section)
 * - persistentOnly: optional (if "true", return only user-level persistent instructions)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    const jurisdiction = url.searchParams.get('jurisdiction')
    const sectionKey = url.searchParams.get('sectionKey')
    const persistentOnly = url.searchParams.get('persistentOnly') === 'true'

    const userId = authResult.user.id

    // If persistentOnly, return only user-level instructions
    if (persistentOnly) {
      const persistent = await getUserPersistentInstructions(userId, jurisdiction || undefined)
      
      const grouped: Record<string, Record<string, any>> = {}
      for (const instr of persistent) {
        if (!grouped[instr.jurisdiction]) {
          grouped[instr.jurisdiction] = {}
        }
        grouped[instr.jurisdiction][instr.sectionKey] = {
          id: instr.id,
          instruction: instr.instruction,
          emphasis: instr.emphasis,
          avoid: instr.avoid,
          style: instr.style,
          wordCount: instr.wordCount,
          isActive: instr.isActive,
          isPersistent: true,
          updatedAt: instr.updatedAt
        }
      }

      return NextResponse.json({ 
        instructions: persistent,
        grouped,
        userId,
        jurisdiction: jurisdiction || 'all',
        persistentOnly: true
      })
    }

    // Verify session belongs to user (if sessionId provided)
    if (sessionId) {
      const session = await prisma.draftingSession.findFirst({
        where: {
          id: sessionId,
          patentId: params.patentId,
          userId
        }
      })

      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
      }
    }

    // Get specific section instruction
    if (sectionKey) {
      const instruction = await getUserInstruction(sessionId, sectionKey, jurisdiction || undefined, userId)
      return NextResponse.json({ instruction })
    }

    // Get all instructions (merged session + user-level)
    const instructions = await getAllUserInstructions(sessionId, userId, jurisdiction || undefined)
    
    // Group by jurisdiction for easier frontend use
    const grouped: Record<string, Record<string, any>> = {}
    for (const instr of instructions) {
      if (!grouped[instr.jurisdiction]) {
        grouped[instr.jurisdiction] = {}
      }
      grouped[instr.jurisdiction][instr.sectionKey] = {
        id: instr.id,
        instruction: instr.instruction,
        emphasis: instr.emphasis,
        avoid: instr.avoid,
        style: instr.style,
        wordCount: instr.wordCount,
        isActive: instr.isActive,
        isPersistent: instr.isPersistent,
        updatedAt: instr.updatedAt
      }
    }

    return NextResponse.json({ 
      instructions,
      grouped,
      sessionId,
      userId,
      jurisdiction: jurisdiction || 'all'
    })
  } catch (error) {
    console.error('[UserInstructions:GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/patents/[patentId]/drafting/user-instructions
 * Create or update user instruction
 * 
 * Body:
 * - sessionId: optional (null/omitted = user-level persistent)
 * - jurisdiction: optional (default "*")
 * - sectionKey: required
 * - instruction: required
 * - emphasis: optional
 * - avoid: optional
 * - style: optional
 * - wordCount: optional
 * - isActive: optional
 * - isPersistent: optional (if true, saves as user-level regardless of sessionId)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      sessionId, 
      jurisdiction, 
      sectionKey, 
      instruction, 
      emphasis, 
      avoid, 
      style, 
      wordCount, 
      isActive,
      isPersistent 
    } = body

    if (!sectionKey) {
      return NextResponse.json({ error: 'sectionKey required' }, { status: 400 })
    }

    const userId = authResult.user.id

    // Word limit validation (50 words max)
    const MAX_WORDS = 50
    const wordCount_instructions = (instruction || '').trim().split(/\s+/).filter((w: string) => w.length > 0).length
    if (wordCount_instructions > MAX_WORDS) {
      return NextResponse.json({ 
        error: `Instruction exceeds ${MAX_WORDS} word limit (${wordCount_instructions} words)` 
      }, { status: 400 })
    }

    // Verify session belongs to user (if sessionId provided and not persistent)
    if (sessionId && !isPersistent) {
      const session = await prisma.draftingSession.findFirst({
        where: {
          id: sessionId,
          patentId: params.patentId,
          userId
        }
      })

      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
      }
    }

    // Determine the effective sessionId
    const effectiveSessionId = isPersistent ? null : (sessionId || null)
    const jurisdictionCode = (jurisdiction || '*').toUpperCase()

    // Check if updating an existing record's isActive status
    const existing = await prisma.userSectionInstruction.findFirst({
      where: {
        userId,
        sessionId: effectiveSessionId,
        jurisdiction: jurisdictionCode,
        sectionKey
      }
    })

    let result
    if (existing) {
      // Update existing
      result = await prisma.userSectionInstruction.update({
        where: { id: existing.id },
        data: {
          instruction: instruction || existing.instruction,
          emphasis: emphasis !== undefined ? emphasis : existing.emphasis,
          avoid: avoid !== undefined ? avoid : existing.avoid,
          style: style !== undefined ? style : existing.style,
          wordCount: wordCount !== undefined ? wordCount : existing.wordCount,
          isActive: isActive !== undefined ? isActive : existing.isActive
        }
      })
    } else {
      // Create new
      result = await prisma.userSectionInstruction.create({
        data: {
          sessionId: effectiveSessionId,
          userId,
          jurisdiction: jurisdictionCode,
          sectionKey,
          instruction: instruction || '',
          emphasis: emphasis || null,
          avoid: avoid || null,
          style: style || null,
          wordCount: wordCount || null,
          isActive: isActive !== undefined ? isActive : true
        }
      })
    }

    // Invalidate caches
    if (effectiveSessionId) {
      invalidateSessionInstructionCache(effectiveSessionId)
    }
    invalidateUserInstructionCache(userId)

    const savedAsPersistent = result.sessionId === null
    const scopeDescription = savedAsPersistent 
      ? `all future ${jurisdictionCode === '*' ? '' : jurisdictionCode + ' '}drafts`
      : 'this draft only'

    return NextResponse.json({ 
      success: true, 
      instruction: {
        ...result,
        isPersistent: savedAsPersistent
      },
      message: `Instruction saved for ${sectionKey} (${scopeDescription})`
    })
  } catch (error) {
    console.error('[UserInstructions:POST] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/patents/[patentId]/drafting/user-instructions
 * Delete or deactivate user instruction
 * 
 * Query params:
 * - id: optional (delete by ID)
 * - sessionId: optional (for session-level deactivation)
 * - sectionKey: optional (deactivate by section)
 * - isPersistent: optional (if "true", delete user-level persistent instruction)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const instructionId = url.searchParams.get('id')
    const sessionId = url.searchParams.get('sessionId')
    const sectionKey = url.searchParams.get('sectionKey')
    const isPersistent = url.searchParams.get('isPersistent') === 'true'

    const userId = authResult.user.id

    // Delete by ID
    if (instructionId) {
      // Verify the instruction belongs to the user
      const instruction = await prisma.userSectionInstruction.findFirst({
        where: { id: instructionId, userId }
      })

      if (!instruction) {
        return NextResponse.json({ error: 'Instruction not found' }, { status: 404 })
      }

      await deleteUserInstruction(instructionId)
      return NextResponse.json({ 
        success: true, 
        message: instruction.sessionId === null 
          ? 'Persistent instruction deleted' 
          : 'Instruction deleted' 
      })
    }

    // Deactivate by section key
    if (sectionKey) {
      // Verify session belongs to user (if sessionId provided)
      if (sessionId) {
        const session = await prisma.draftingSession.findFirst({
          where: {
            id: sessionId,
            patentId: params.patentId,
            userId
          }
        })

        if (!session) {
          return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }
      }

      await deactivateUserInstruction(userId, sectionKey, sessionId || undefined, isPersistent)
      
      const scopeMsg = isPersistent ? 'persistent' : (sessionId ? 'session' : 'all')
      return NextResponse.json({ 
        success: true, 
        message: `Instruction deactivated for ${sectionKey} (${scopeMsg})` 
      })
    }

    return NextResponse.json({ error: 'id or sectionKey required' }, { status: 400 })
  } catch (error) {
    console.error('[UserInstructions:DELETE] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
