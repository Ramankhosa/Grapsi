/**
 * Search Strategy API
 * Generates and manages blueprint-aware literature search strategies
 * 
 * Part A of the SRS: Search Strategy Planning & Query Generation
 * 
 * Endpoints:
 * - GET: Retrieve existing strategy for session
 * - POST: Generate new search strategy
 * - PATCH: Update query status after execution
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { CitationSearchQuery } from '@prisma/client';
import { authenticateUser } from '@/lib/auth-middleware';
import { featureFlags } from '@/lib/feature-flags';
import { searchStrategyService } from '@/lib/services/search-strategy-service';
import { blueprintService } from '@/lib/services/blueprint-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ============================================================================
// Validation Schemas
// ============================================================================

const generateStrategySchema = z.object({
  action: z.literal('generate'),
  force: z.boolean().optional() // Force regeneration even if strategy exists
});

const updateQueryStatusSchema = z.object({
  action: z.literal('update_query'),
  queryId: z.string(),
  status: z.enum(['SEARCHING', 'SEARCHED', 'COMPLETED', 'SKIPPED']),
  resultsCount: z.number().int().nonnegative().optional(),
  importedCount: z.number().int().nonnegative().optional()
});

const postSchema = z.discriminatedUnion('action', [
  generateStrategySchema,
  updateQueryStatusSchema
]);

// ============================================================================
// Helper Functions
// ============================================================================

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[]; tenantId?: string }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({
      where: { id: sessionId },
      include: { researchTopic: true }
    });
  }

  return prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id
    },
    include: { researchTopic: true }
  });
}

function buildTenantContext(user: { id: string; tenantId?: string }) {
  return {
    tenantId: user.tenantId || 'system',
    planId: 'default', // Will be resolved by metering middleware
    userId: user.id
  };
}

// ============================================================================
// GET - Retrieve existing strategy
// ============================================================================

export async function GET(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    // Check feature flag
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json(
        { error: 'Literature search is not enabled' },
        { status: 403 }
      );
    }

    // Authenticate user
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      );
    }

    const sessionId = context.params.paperId;

    // Verify session access
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }

    // Get existing strategy
    const strategy = await searchStrategyService.getStrategy(sessionId);

    if (!strategy) {
      return NextResponse.json({
        exists: false,
        message: 'No search strategy generated yet'
      });
    }

    // Calculate coverage
    const byCategory: Record<string, number> = {};
    const intents = new Set<string>();
    for (const q of strategy.queries as CitationSearchQuery[]) {
      byCategory[q.category] = (byCategory[q.category] || 0) + 1;
      const filters = q.suggestedFilters as { searchIntent?: string } | null;
      if (filters?.searchIntent) {
        intents.add(filters.searchIntent);
      }
    }

    return NextResponse.json({
      exists: true,
      strategy: {
        id: strategy.id,
        sessionId: strategy.sessionId,
        status: strategy.status,
        summary: strategy.summary,
        estimatedPapers: strategy.estimatedPapers,
        createdAt: strategy.createdAt,
        completedAt: strategy.completedAt
      },
      queries: strategy.queries.map((q: CitationSearchQuery) => ({
        id: q.id,
        queryText: q.queryText,
        category: q.category,
        description: q.description,
        priority: q.priority,
        suggestedSources: q.suggestedSources,
        suggestedYearFrom: q.suggestedYearFrom,
        suggestedYearTo: q.suggestedYearTo,
        searchIntent: (q.suggestedFilters as { searchIntent?: string } | null)?.searchIntent,
        status: q.status,
        searchedAt: q.searchedAt,
        resultsCount: q.resultsCount,
        importedCount: q.importedCount
      })),
      coverage: {
        totalQueries: strategy.queries.length,
        byCategory,
        completedQueries: strategy.queries.filter((q: CitationSearchQuery) =>
          q.status === 'COMPLETED' || q.status === 'SKIPPED'
        ).length,
        pendingQueries: strategy.queries.filter((q: CitationSearchQuery) =>
          q.status === 'PENDING'
        ).length
      }
    });

  } catch (error) {
    console.error('[SearchStrategy] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve search strategy' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Generate strategy or update query status
// ============================================================================

export async function POST(
  request: NextRequest,
  context: { params: { paperId: string } }
) {
  try {
    // Check feature flag
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json(
        { error: 'Literature search is not enabled' },
        { status: 403 }
      );
    }

    // Authenticate user
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json(
        { error: error?.message || 'Unauthorized' },
        { status: error?.status || 401 }
      );
    }

    const sessionId = context.params.paperId;

    // Verify session access
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json(
        { error: 'Paper session not found' },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = postSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Route to appropriate handler
    switch (data.action) {
      case 'generate':
        return await handleGenerateStrategy(session, user, data.force);
      
      case 'update_query':
        return await handleUpdateQueryStatus(data.queryId, data.status, data.resultsCount, data.importedCount);
      
      default:
        return NextResponse.json(
          { error: 'Unknown action' },
          { status: 400 }
        );
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }

    console.error('[SearchStrategy] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleGenerateStrategy(
  session: any,
  user: { id: string; tenantId?: string },
  force?: boolean
) {
  // Check if research topic exists
  if (!session.researchTopic) {
    return NextResponse.json(
      { error: 'Research topic not found. Complete the topic entry stage first.' },
      { status: 400 }
    );
  }

  // Check if strategy already exists and force is not set
  if (!force) {
    const existing = await searchStrategyService.getStrategy(session.id);
    if (existing && existing.status !== 'DRAFT') {
      return NextResponse.json(
        { 
          error: 'Strategy already exists. Use force=true to regenerate.',
          existingStrategyId: existing.id
        },
        { status: 409 }
      );
    }
  }

  // Get paper type code
  const paperTypeCode = session.paperType?.code || 
    (session.paperTypeId ? await getPaperTypeCode(session.paperTypeId) : 'JOURNAL_ARTICLE');

  // Get blueprint if available
  let blueprint;
  try {
    blueprint = await blueprintService.getBlueprint(session.id);
  } catch (e) {
    // Blueprint not available, continue without it
  }

  // Build tenant context
  const tenantContext = buildTenantContext(user);

  // Generate strategy
  const result = await searchStrategyService.generateStrategy({
    sessionId: session.id,
    researchTopic: session.researchTopic,
    paperTypeCode,
    blueprint: blueprint || undefined,
    tenantContext
  });

  // Log audit (serialize coverage for JSON storage)
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      tenantId: user.tenantId || null,
      action: 'SEARCH_STRATEGY_GENERATED',
      resource: `drafting_session:${session.id}`,
      meta: {
        strategyId: result.strategy.id,
        queryCount: result.queries.length,
        totalQueries: result.coverage.totalQueries,
        byCategory: result.coverage.byCategory,
        missingIntents: result.coverage.missingIntents
      }
    }
  });

  return NextResponse.json({
    success: true,
    strategy: {
      id: result.strategy.id,
      status: result.strategy.status,
      summary: result.strategy.summary,
      estimatedPapers: result.strategy.estimatedPapers
    },
    queries: result.queries.map((q: CitationSearchQuery) => ({
      id: q.id,
      queryText: q.queryText,
      category: q.category,
      description: q.description,
      priority: q.priority,
      suggestedSources: q.suggestedSources,
      suggestedYearFrom: q.suggestedYearFrom,
      suggestedYearTo: q.suggestedYearTo,
      searchIntent: (q.suggestedFilters as { searchIntent?: string } | null)?.searchIntent,
      status: q.status
    })),
    searchPlan: result.searchPlan,
    coverage: result.coverage
  }, { status: 201 });
}

async function handleUpdateQueryStatus(
  queryId: string,
  status: 'SEARCHING' | 'SEARCHED' | 'COMPLETED' | 'SKIPPED',
  resultsCount?: number,
  importedCount?: number
) {
  try {
    const updatedQuery = await searchStrategyService.updateQueryStatus(
      queryId,
      status,
      resultsCount,
      importedCount
    );

    // Check and update strategy status
    await searchStrategyService.checkAndUpdateStrategyStatus(updatedQuery.strategyId);

    return NextResponse.json({
      success: true,
      query: {
        id: updatedQuery.id,
        status: updatedQuery.status,
        searchedAt: updatedQuery.searchedAt,
        resultsCount: updatedQuery.resultsCount,
        importedCount: updatedQuery.importedCount
      }
    });

  } catch (error) {
    console.error('Failed to update query status:', error);
    return NextResponse.json(
      { error: 'Failed to update query status' },
      { status: 500 }
    );
  }
}

// Helper to get paper type code from ID
async function getPaperTypeCode(paperTypeId: string): Promise<string> {
  const pt = await prisma.paperTypeDefinition.findUnique({
    where: { id: paperTypeId },
    select: { code: true }
  });
  return pt?.code || 'JOURNAL_ARTICLE';
}


