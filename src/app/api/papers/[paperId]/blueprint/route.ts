/**
 * Paper Blueprint API Route
 * 
 * Manages the Paper Blueprint - a frozen plan that governs section generation
 * for coherence-by-construction.
 * 
 * Endpoints:
 * - GET: Fetch existing blueprint
 * - POST: Generate new blueprint from research topic
 * - PUT: Update blueprint (only when not frozen)
 * - PATCH: Freeze/unfreeze blueprint
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';
import {
  blueprintService,
  type RhetoricalBlueprintBySection,
  type SectionPlanItem
} from '@/lib/services/blueprint-service';
import { deepAnalysisService } from '@/lib/services/deep-analysis-service';

export const runtime = 'nodejs';

// ============================================================================
// Schemas
// ============================================================================

const generateBlueprintSchema = z.object({
  action: z.literal('generate'),
  targetWordCount: z.number().min(500).max(50000).optional()
});

const dimensionTypeEnum = z.enum(['foundational', 'methodological', 'empirical', 'comparative', 'gap']);
const rhetoricalCitationModeEnum = z.enum(['optional', 'none', 'required']);

const rhetoricalCitationPolicySchema = z.object({
  mode: rhetoricalCitationModeEnum,
  maxCitations: z.number().int().min(0).max(2)
});

const rhetoricalSlotSchema = z.object({
  key: z.string().min(1).max(100),
  required: z.boolean(),
  placement: z.string().min(1).max(80),
  intent: z.string().min(1).max(600),
  constraints: z.array(z.string().min(1).max(300)).default([]),
  citationPolicy: rhetoricalCitationPolicySchema
});

const rhetoricalBlueprintSchema = z.object({
  enabled: z.boolean(),
  slots: z.array(rhetoricalSlotSchema).max(12)
});

const thematicBlueprintSchema = z.object({
  mustCover: z.array(z.string().min(10).max(200)),
  mustAvoid: z.array(z.string()),
  mustCoverTyping: z.record(z.string(), dimensionTypeEnum).optional(),
  suggestedCitationCount: z.number().min(1).max(50).optional()
});

const updateBlueprintSchema = z.object({
  action: z.literal('update'),
  thesisStatement: z.string().min(20).max(500).optional(),
  centralObjective: z.string().min(20).max(1000).optional(),
  keyContributions: z.array(z.string().min(5).max(500)).min(2).max(7).optional(),
  sectionPlan: z.array(z.object({
    sectionKey: z.string(),
    purpose: z.string(),
    mustCover: z.array(z.string().min(10).max(200)), // Citation-mappable dimensions
    mustCoverTyping: z.record(z.string(), dimensionTypeEnum).optional(),
    mustAvoid: z.array(z.string()),
    wordBudget: z.number().optional(),
    dependencies: z.array(z.string()),
    outputsPromised: z.array(z.string()),
    suggestedCitationCount: z.number().min(1).max(50).optional(),
    thematicBlueprint: thematicBlueprintSchema.optional(),
    rhetoricalBlueprint: rhetoricalBlueprintSchema.optional()
  })).optional(),
  preferredTerms: z.record(z.string(), z.string()).optional(),
  rhetoricalBlueprints: z.record(z.string(), rhetoricalBlueprintSchema).optional()
});

const freezeSchema = z.object({
  action: z.enum(['freeze', 'unfreeze'])
});

// ============================================================================
// Helper Functions
// ============================================================================

async function getSessionWithTopic(sessionId: string, user: { id: string; roles?: string[] }) {
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

async function resolveTenantContext(request: NextRequest, userId: string) {
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const tenantContext = await extractTenantContextFromRequest({ headers: { authorization } });
  if (!tenantContext) return null;
  return {
    ...tenantContext,
    userId: tenantContext.userId || userId,
  };
}

// ============================================================================
// GET - Fetch Blueprint
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
    const session = await getSessionWithTopic(sessionId, user);

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }

    const blueprint = await blueprintService.getBlueprint(sessionId);

    return NextResponse.json({
      success: true,
      blueprint,
      hasBlueprint: !!blueprint,
      isFrozen: blueprint?.status === 'FROZEN'
    });
  } catch (error) {
    console.error('[Blueprint] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blueprint' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Generate Blueprint or Freeze/Unfreeze
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
    const session = await getSessionWithTopic(sessionId, user);

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Handle freeze/unfreeze actions
    if (body.action === 'freeze' || body.action === 'unfreeze') {
      const data = freezeSchema.parse(body);

      if (data.action === 'freeze') {
        const blueprint = await blueprintService.freezeBlueprint(sessionId);
        
        await prisma.draftingHistory.create({
          data: {
            sessionId,
            action: 'BLUEPRINT_FROZEN',
            userId: user.id,
            stage: session.status,
            newData: { blueprintVersion: blueprint.version }
          }
        });

        // If deep-analysis cards already exist, remap them to the latest frozen blueprint.
        // This keeps dimension mappings current without forcing re-extraction.
        const hasExtractedCards = await prisma.evidenceCard.count({
          where: { sessionId },
        });
        if (hasExtractedCards > 0) {
          const tenantContext = await resolveTenantContext(request, user.id);
          await deepAnalysisService.remapAll(sessionId, tenantContext).catch(err => {
            console.warn('[Blueprint] Auto-remap after freeze failed:', err);
          });
        }

        return NextResponse.json({
          success: true,
          blueprint,
          message: 'Blueprint frozen successfully'
        });
      } else {
        const blueprint = await blueprintService.unfreezeBlueprint(sessionId);
        
        await prisma.draftingHistory.create({
          data: {
            sessionId,
            action: 'BLUEPRINT_UNFROZEN',
            userId: user.id,
            stage: session.status,
            newData: { blueprintVersion: blueprint.version }
          }
        });

        return NextResponse.json({
          success: true,
          blueprint,
          message: 'Blueprint unfrozen. Existing sections marked as stale.'
        });
      }
    }

    // Handle generate action
    const data = generateBlueprintSchema.parse(body);

    if (!session.researchTopic) {
      return NextResponse.json(
        { error: 'Research topic required before generating blueprint' },
        { status: 400 }
      );
    }

    const paperTypeCode = session.paperType?.code || 'JOURNAL_ARTICLE';

    // Fetch tenant's active plan for LLM metering
    const tenant = session.tenantId ? await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      include: {
        tenantPlans: {
          where: {
            status: 'ACTIVE',
            effectiveFrom: { lte: new Date() },
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } }
            ]
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        }
      }
    }) : null;

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 400 }
      );
    }

    const activePlan = tenant.tenantPlans[0];
    if (!activePlan) {
      return NextResponse.json(
        { error: 'No active subscription plan found for your organization' },
        { status: 403 }
      );
    }

    // Build tenant context for LLM metering
    const tenantContext = {
      tenantId: session.tenantId!,
      planId: activePlan.planId,
      userId: user.id
    };

    const blueprint = await blueprintService.generateBlueprint({
      sessionId,
      researchTopic: session.researchTopic,
      paperTypeCode,
      targetWordCount: data.targetWordCount,
      tenantContext
    });

    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'BLUEPRINT_GENERATED',
        userId: user.id,
        stage: session.status,
        newData: {
          thesisStatement: blueprint.thesisStatement,
          sectionCount: blueprint.sectionPlan.length
        }
      }
    });

    return NextResponse.json({
      success: true,
      blueprint,
      message: 'Blueprint generated successfully. Review and freeze to begin section generation.'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[Blueprint] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process blueprint request' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PUT - Update Blueprint
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
    const session = await getSessionWithTopic(sessionId, user);

    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }

    if (!session.paperBlueprint) {
      return NextResponse.json(
        { error: 'No blueprint exists. Generate one first.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const data = updateBlueprintSchema.parse(body);

    const updates: Parameters<typeof blueprintService.updateBlueprint>[1] = {};

    if (data.thesisStatement) updates.thesisStatement = data.thesisStatement;
    if (data.centralObjective) updates.centralObjective = data.centralObjective;
    if (data.keyContributions) updates.keyContributions = data.keyContributions;
    if (data.sectionPlan) updates.sectionPlan = data.sectionPlan as SectionPlanItem[];
    if (data.preferredTerms) updates.preferredTerms = data.preferredTerms;
    if (data.rhetoricalBlueprints) {
      updates.rhetoricalBlueprints = data.rhetoricalBlueprints as RhetoricalBlueprintBySection;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const blueprint = await blueprintService.updateBlueprint(sessionId, updates);

    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'BLUEPRINT_UPDATED',
        userId: user.id,
        stage: session.status,
        newData: { updatedFields: Object.keys(updates), version: blueprint.version }
      }
    });

    return NextResponse.json({
      success: true,
      blueprint,
      message: 'Blueprint updated successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid payload' },
        { status: 400 }
      );
    }

    console.error('[Blueprint] PUT error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update blueprint' },
      { status: 500 }
    );
  }
}

