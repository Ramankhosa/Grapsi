/**
 * Paper Sections API Route
 * 
 * Manages paper section generation with inline memory for coherence.
 * Each section returns both content and a structured memory summary
 * that is passed to subsequent sections.
 * 
 * Endpoints:
 * - GET: Fetch all sections or specific section
 * - POST: Generate a section
 * - PUT: Update section content (manual edit)
 * - PATCH: Approve section or re-extract memory
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperSectionService } from '@/lib/services/paper-section-service';
import { blueprintService } from '@/lib/services/blueprint-service';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';

const HIDE_CONTENT_STATUSES = new Set(['PREPARING', 'BASE_READY', 'POLISHING', 'REGENERATING']);

/**
 * Strip internal-only fields from section payloads before returning to clients.
 * Pass 1 content is never exposed — only polished (Pass 2) content is public.
 */
function sanitizeSection(section: any) {
  if (!section) return section;
  const {
    baseContentInternal: _b,
    baseMemory: _bm,
    pass1PromptUsed: _p1p,
    pass1LlmResponse: _p1r,
    pass1TokensUsed: _p1t,
    pass2PromptUsed: _p2p,
    promptUsed: _pu,
    llmResponse: _lr,
    ...publicFields
  } = section;

  if (HIDE_CONTENT_STATUSES.has(String(publicFields.status || ''))) {
    return {
      ...publicFields,
      content: '',
      wordCount: 0
    };
  }

  return publicFields;
}

function sanitizeSections(sections: any[]) {
  return sections.map(sanitizeSection);
}

export const runtime = 'nodejs';

// ============================================================================
// Schemas
// ============================================================================

const generateSectionSchema = z.object({
  action: z.literal('generate'),
  sectionKey: z.string().min(1),
  userInstructions: z.string().max(2000).optional(),
  regenerate: z.boolean().optional()
});

const updateSectionSchema = z.object({
  action: z.literal('update'),
  sectionKey: z.string().min(1),
  content: z.string().min(1)
});

const approveSectionSchema = z.object({
  action: z.literal('approve'),
  sectionKey: z.string().min(1)
});

const reExtractMemorySchema = z.object({
  action: z.literal('reExtractMemory'),
  sectionKey: z.string().min(1)
});

const generateAllSchema = z.object({
  action: z.literal('generateAll'),
  userInstructions: z.record(z.string(), z.string()).optional(),
  regenerateStale: z.boolean().optional()
});

// ============================================================================
// Helper Functions
// ============================================================================

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      researchTopic: true,
      paperType: true,
      paperBlueprint: true
    }
  });
}

async function resolveTenantContext(
  request: NextRequest,
  userId: string,
  tenantId?: string | null
) {
  const authorization = request.headers.get('authorization');
  if (authorization) {
    const tenantContext = await extractTenantContextFromRequest({ headers: { authorization } });
    if (tenantContext) {
      return {
        ...tenantContext,
        userId: tenantContext.userId || userId,
      };
    }
  }

  if (!tenantId) return null;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      tenantPlans: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  });

  if (tenant && tenant.status === 'ACTIVE' && tenant.tenantPlans[0]) {
    return {
      tenantId: tenant.id,
      planId: tenant.tenantPlans[0].planId,
      tenantStatus: tenant.status,
      userId,
    };
  }

  return null;
}

// ============================================================================
// GET - Fetch Sections
// ============================================================================

export async function GET(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      );
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }

    // Check for specific section query parameter
    const { searchParams } = new URL(request.url);
    const sectionKey = searchParams.get('sectionKey');

    if (sectionKey) {
      const section = await paperSectionService.getSection(sessionId, sectionKey);
      return NextResponse.json({
        success: true,
        section: sanitizeSection(section)
      });
    }

    // Return all sections
    const sections = await paperSectionService.getAllSections(sessionId);
    
    // Get generation order from blueprint
    const generationOrder = await paperSectionService.getSectionGenerationOrder(sessionId);

    // Get blueprint status
    const blueprint = await blueprintService.getBlueprint(sessionId);
    const plannedSections = blueprint?.sectionPlan.map(s => s.sectionKey) || [];

    // Include background generation status
    const bgStatus = await paperSectionService.getBackgroundGenStatus(sessionId);

    return NextResponse.json({
      success: true,
      sections: sanitizeSections(sections),
      generationOrder,
      plannedSections,
      generatedSections: sections.map(s => s.sectionKey),
      staleSections: sections.filter(s => s.isStale).map(s => s.sectionKey),
      blueprintStatus: blueprint?.status || null,
      backgroundGeneration: bgStatus,
    });
  } catch (error) {
    console.error('[Sections] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sections' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Generate Section(s)
// ============================================================================

export async function POST(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      );
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }
    const tenantContext = await resolveTenantContext(request, user.id, session.tenantId);
    const body = await request.json();

    // Handle generateAll action
    if (body.action === 'generateAll') {
      const data = generateAllSchema.parse(body);
      
      // Check blueprint is frozen
      const blueprintReady = await blueprintService.isBlueprintReady(sessionId);
      if (!blueprintReady.ready) {
        return NextResponse.json(
          { error: blueprintReady.reason || 'Blueprint not ready' },
          { status: 400 }
        );
      }

      // Get generation order
      const generationOrder = await paperSectionService.getSectionGenerationOrder(sessionId);
      
      // Get existing sections
      const existingSections = await paperSectionService.getAllSections(sessionId);
      const existingKeys = new Set(existingSections.map(s => s.sectionKey));
      const staleKeys = new Set(existingSections.filter(s => s.isStale).map(s => s.sectionKey));

      // Sections that still need Pass 2 (BASE_READY = Pass 1 done, polish pending)
      const baseReadyKeys = new Set(
        existingSections.filter(s => s.status === 'BASE_READY').map(s => s.sectionKey)
      );

      // Determine which sections to generate (missing, stale, or needing Pass 2)
      const sectionsToGenerate = generationOrder.filter(key => {
        if (!existingKeys.has(key)) return true;
        if (data.regenerateStale && staleKeys.has(key)) return true;
        if (baseReadyKeys.has(key)) return true;
        return false;
      });

      if (sectionsToGenerate.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'All sections already generated',
          sections: sanitizeSections(existingSections)
        });
      }

      // Generate sections in order
      const results: Array<{ sectionKey: string; success: boolean; error?: string }> = [];
      const generatedSections = [];

      for (const sectionKey of sectionsToGenerate) {
        const result = await paperSectionService.generateSection({
          sessionId,
          sectionKey,
          userInstructions: data.userInstructions?.[sectionKey],
          regenerate: staleKeys.has(sectionKey),
          tenantContext,
        });

        results.push({
          sectionKey,
          success: result.success,
          error: result.error
        });

        if (result.success && result.section) {
          generatedSections.push(result.section);
        }

        // Stop on failure (sections depend on each other)
        if (!result.success) {
          break;
        }
      }

      await prisma.draftingHistory.create({
        data: {
          sessionId,
          action: 'SECTIONS_BATCH_GENERATED',
          userId: user.id,
          stage: session.status,
          newData: {
            requested: sectionsToGenerate.length,
            generated: generatedSections.length,
            results
          }
        }
      });

      return NextResponse.json({
        success: results.every(r => r.success),
        message: `Generated ${generatedSections.length} of ${sectionsToGenerate.length} sections`,
        results,
        sections: sanitizeSections(generatedSections)
      });
    }

    // Handle single section generation
    const data = generateSectionSchema.parse(body);

    const result = await paperSectionService.generateSection({
      sessionId,
      sectionKey: data.sectionKey,
      userInstructions: data.userInstructions,
      regenerate: data.regenerate,
      tenantContext,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Section generation failed' },
        { status: 400 }
      );
    }

    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'SECTION_GENERATED',
        userId: user.id,
        stage: session.status,
        newData: {
          sectionKey: data.sectionKey,
          wordCount: result.section?.wordCount,
          version: result.section?.version
        }
      }
    });

    return NextResponse.json({
      success: true,
      section: sanitizeSection(result.section),
      message: `Section "${data.sectionKey}" generated successfully`
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[Sections] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate section' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PUT - Update Section Content
// ============================================================================

export async function PUT(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      );
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const data = updateSectionSchema.parse(body);

    const section = await paperSectionService.updateSectionContent(
      sessionId,
      data.sectionKey,
      data.content
    );

    if (!section) {
      return NextResponse.json(
        { error: 'Section not found' },
        { status: 404 }
      );
    }

    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'SECTION_EDITED',
        userId: user.id,
        stage: session.status,
        newData: {
          sectionKey: data.sectionKey,
          wordCount: section.wordCount,
          version: section.version
        }
      }
    });

    return NextResponse.json({
      success: true,
      section: sanitizeSection(section),
      message: 'Section updated. Consider re-extracting memory if content changed significantly.'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[Sections] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update section' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - Approve Section or Re-extract Memory
// ============================================================================

export async function PATCH(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      );
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }
    const tenantContext = await resolveTenantContext(request, user.id, session.tenantId);

    const body = await request.json();

    if (body.action === 'approve') {
      const data = approveSectionSchema.parse(body);
      
      const section = await paperSectionService.approveSection(sessionId, data.sectionKey);
      
      if (!section) {
        return NextResponse.json(
          { error: 'Section not found' },
          { status: 404 }
        );
      }

      await prisma.draftingHistory.create({
        data: {
          sessionId,
          action: 'SECTION_APPROVED',
          userId: user.id,
          stage: session.status,
          newData: { sectionKey: data.sectionKey }
        }
      });

      return NextResponse.json({
        success: true,
        section: sanitizeSection(section),
        message: `Section "${data.sectionKey}" approved`
      });
    }

    if (body.action === 'reExtractMemory') {
      const data = reExtractMemorySchema.parse(body);
      
      const section = await paperSectionService.reExtractMemory(sessionId, data.sectionKey, tenantContext);
      
      if (!section) {
        return NextResponse.json(
          { error: 'Section not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        section: sanitizeSection(section),
        message: 'Memory re-extracted successfully'
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "approve" or "reExtractMemory"' },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[Sections] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

