import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cache invalidation helpers (in-memory for simplicity)
const sessionInstructionCache = new Map<string, { data: any; timestamp: number }>();
const userInstructionCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

function invalidateSessionInstructionCache(sessionId: string) {
  sessionInstructionCache.delete(sessionId);
}

function invalidateUserInstructionCache(userId: string) {
  userInstructionCache.delete(userId);
}

// Get user-level persistent instructions (for papers, uses jurisdiction='PAPER')
async function getUserPersistentInstructions(userId: string, paperTypeCode?: string) {
  // For papers, we use 'PAPER' as jurisdiction and optionally filter by paper type in style field
  const where: any = {
    userId,
    sessionId: null, // User-level persistent
    jurisdiction: { in: ['PAPER', '*'] } // Paper-specific or global
  };

  if (paperTypeCode) {
    where.OR = [
      { style: paperTypeCode },
      { style: null },
      { style: '' }
    ];
  }

  return prisma.userSectionInstruction.findMany({
    where,
    orderBy: { updatedAt: 'desc' }
  });
}

// Get instruction for a specific section (merges session + user-level)
async function getUserInstruction(
  sessionId: string | null,
  sectionKey: string,
  paperTypeCode: string | null,
  userId: string
) {
  // First check session-level
  if (sessionId) {
    const sessionLevel = await prisma.userSectionInstruction.findFirst({
      where: {
        sessionId,
        sectionKey,
        jurisdiction: 'PAPER'
      }
    });
    if (sessionLevel) return { ...sessionLevel, isPersistent: false };
  }

  // Then check user-level for this paper type
  const userLevelSpecific = await prisma.userSectionInstruction.findFirst({
    where: {
      userId,
      sessionId: null,
      sectionKey,
      jurisdiction: 'PAPER',
      style: paperTypeCode || undefined
    }
  });
  if (userLevelSpecific) return { ...userLevelSpecific, isPersistent: true };

  // Finally check global user-level (jurisdiction = '*')
  const userLevelGlobal = await prisma.userSectionInstruction.findFirst({
    where: {
      userId,
      sessionId: null,
      sectionKey,
      jurisdiction: '*'
    }
  });
  if (userLevelGlobal) return { ...userLevelGlobal, isPersistent: true };

  return null;
}

// Get all instructions for a session (merged with user-level)
async function getAllUserInstructions(
  sessionId: string | null,
  userId: string,
  paperTypeCode?: string
) {
  const instructions: any[] = [];
  const seenKeys = new Set<string>();

  // First, session-level instructions
  if (sessionId) {
    const sessionInstructions = await prisma.userSectionInstruction.findMany({
      where: {
        sessionId,
        jurisdiction: 'PAPER'
      }
    });

    for (const instr of sessionInstructions) {
      instructions.push({ ...instr, isPersistent: false });
      seenKeys.add(instr.sectionKey);
    }
  }

  // Then, user-level persistent instructions (paper-type specific)
  const userPersistent = await getUserPersistentInstructions(userId, paperTypeCode);

  for (const instr of userPersistent) {
    if (!seenKeys.has(instr.sectionKey)) {
      instructions.push({ ...instr, isPersistent: true });
      seenKeys.add(instr.sectionKey);
    }
  }

  return instructions;
}

/**
 * GET /api/papers/[paperId]/drafting/user-instructions
 * Get user instructions for a paper drafting session
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { paperId: string } }
) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId') || params.paperId;
    const sectionKey = url.searchParams.get('sectionKey');
    const persistentOnly = url.searchParams.get('persistentOnly') === 'true';

    const userId = authResult.user.id;

    // Get session to find paper type
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId },
      include: { paperType: true }
    });

    const paperTypeCode = session?.paperType?.code || null;

    // If persistentOnly, return only user-level instructions
    if (persistentOnly) {
      const persistent = await getUserPersistentInstructions(userId, paperTypeCode || undefined);
      
      const grouped: Record<string, any> = {};
      for (const instr of persistent) {
        grouped[instr.sectionKey] = {
          id: instr.id,
          instruction: instr.instruction,
          emphasis: instr.emphasis,
          avoid: instr.avoid,
          style: instr.style,
          wordCount: instr.wordCount,
          isActive: instr.isActive,
          isPersistent: true,
          updatedAt: instr.updatedAt
        };
      }

      return NextResponse.json({
        instructions: persistent,
        grouped,
        userId,
        persistentOnly: true
      });
    }

    // Get specific section instruction
    if (sectionKey) {
      const instruction = await getUserInstruction(sessionId, sectionKey, paperTypeCode, userId);
      return NextResponse.json({ instruction });
    }

    // Get all instructions (merged session + user-level)
    const instructions = await getAllUserInstructions(sessionId, userId, paperTypeCode || undefined);
    
    // Group by sectionKey for easier frontend use
    const grouped: Record<string, any> = {};
    for (const instr of instructions) {
      grouped[instr.sectionKey] = {
        id: instr.id,
        instruction: instr.instruction,
        emphasis: instr.emphasis,
        avoid: instr.avoid,
        style: instr.style,
        wordCount: instr.wordCount,
        isActive: instr.isActive,
        isPersistent: instr.isPersistent,
        updatedAt: instr.updatedAt
      };
    }

    return NextResponse.json({ 
      instructions,
      grouped,
      sessionId,
      userId,
      paperTypeCode
    });
  } catch (error) {
    console.error('[PaperUserInstructions:GET] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/papers/[paperId]/drafting/user-instructions
 * Create or update user instruction for paper drafting
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { paperId: string } }
) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      sessionId, 
      sectionKey, 
      instruction, 
      emphasis, 
      avoid, 
      style, 
      wordCount, 
      isActive,
      isPersistent,
      paperTypeCode // Optional: to categorize persistent instructions by paper type
    } = body;

    if (!sectionKey) {
      return NextResponse.json({ error: 'sectionKey required' }, { status: 400 });
    }

    const userId = authResult.user.id;

    // Word limit validation (50 words max)
    const MAX_WORDS = 50;
    const wordCountInstructions = (instruction || '').trim().split(/\s+/).filter((w: string) => w.length > 0).length;
    if (wordCountInstructions > MAX_WORDS) {
      return NextResponse.json({ 
        error: `Instruction exceeds ${MAX_WORDS} word limit (${wordCountInstructions} words)` 
      }, { status: 400 });
    }

    // Determine the effective sessionId
    const effectiveSessionId = isPersistent ? null : (sessionId || params.paperId);
    
    // For papers, use 'PAPER' as jurisdiction
    const jurisdiction = 'PAPER';

    // Check if updating an existing record
    const existing = await prisma.userSectionInstruction.findFirst({
      where: {
        userId,
        sessionId: effectiveSessionId,
        jurisdiction,
        sectionKey
      }
    });

    let result;
    if (existing) {
      // Update existing
      result = await prisma.userSectionInstruction.update({
        where: { id: existing.id },
        data: {
          instruction: instruction || existing.instruction,
          emphasis: emphasis !== undefined ? emphasis : existing.emphasis,
          avoid: avoid !== undefined ? avoid : existing.avoid,
          style: paperTypeCode || style || existing.style, // Store paper type code in style field for persistent
          wordCount: wordCount !== undefined ? wordCount : existing.wordCount,
          isActive: isActive !== undefined ? isActive : existing.isActive
        }
      });
    } else {
      // Create new
      result = await prisma.userSectionInstruction.create({
        data: {
          sessionId: effectiveSessionId,
          userId,
          jurisdiction,
          sectionKey,
          instruction: instruction || '',
          emphasis: emphasis || null,
          avoid: avoid || null,
          style: paperTypeCode || style || null,
          wordCount: wordCount || null,
          isActive: isActive !== undefined ? isActive : true
        }
      });
    }

    // Invalidate caches
    if (effectiveSessionId) {
      invalidateSessionInstructionCache(effectiveSessionId);
    }
    invalidateUserInstructionCache(userId);

    const savedAsPersistent = result.sessionId === null;
    const scopeDescription = savedAsPersistent 
      ? 'all future paper drafts'
      : 'this paper only';

    return NextResponse.json({
      success: true, 
      instruction: {
        ...result,
        isPersistent: savedAsPersistent
      },
      message: `Instruction saved for ${sectionKey} (${scopeDescription})`
    });
  } catch (error) {
    console.error('[PaperUserInstructions:POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/papers/[paperId]/drafting/user-instructions
 * Delete user instruction
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { paperId: string } }
) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const sessionId = url.searchParams.get('sessionId');
    const sectionKey = url.searchParams.get('sectionKey');
    const isPersistent = url.searchParams.get('isPersistent') === 'true';

    const userId = authResult.user.id;

    // Delete by ID
    if (id) {
      const instruction = await prisma.userSectionInstruction.findFirst({
        where: { id, userId }
      });

      if (!instruction) {
        return NextResponse.json({ error: 'Instruction not found' }, { status: 404 });
      }

      await prisma.userSectionInstruction.delete({ where: { id } });

      // Invalidate caches
      if (instruction.sessionId) {
        invalidateSessionInstructionCache(instruction.sessionId);
      }
      invalidateUserInstructionCache(userId);

      return NextResponse.json({ success: true, deleted: id });
    }

    // Delete by sectionKey
    if (sectionKey) {
      const where: any = {
        userId,
        sectionKey,
        jurisdiction: 'PAPER'
      };

      if (isPersistent) {
        where.sessionId = null;
      } else if (sessionId) {
        where.sessionId = sessionId;
      }

      const deleted = await prisma.userSectionInstruction.deleteMany({ where });

      // Invalidate caches
      if (sessionId) {
        invalidateSessionInstructionCache(sessionId);
      }
      invalidateUserInstructionCache(userId);

      return NextResponse.json({ success: true, deletedCount: deleted.count });
    }

    return NextResponse.json({ error: 'id or sectionKey required' }, { status: 400 });
  } catch (error) {
    console.error('[PaperUserInstructions:DELETE] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

