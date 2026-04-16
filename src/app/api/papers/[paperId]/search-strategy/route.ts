import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Schema for generating strategy
const generateSchema = z.object({
  regenerate: z.boolean().optional().default(false)
});

const searchQueryCategorySchema = z.enum([
  'CORE_CONCEPTS', 'DOMAIN_APPLICATION', 'METHODOLOGY',
  'THEORETICAL_FOUNDATION', 'SURVEYS_REVIEWS', 'COMPETING_APPROACHES',
  'RECENT_ADVANCES', 'GAP_IDENTIFICATION', 'CUSTOM'
]);

// Schema for updating query status
const updateQuerySchema = z.object({
  queryId: z.string().min(1),
  status: z.enum(['PENDING', 'SEARCHING', 'SEARCHED', 'COMPLETED', 'SKIPPED']).optional(),
  resultsCount: z.number().int().nonnegative().optional(),
  importedCount: z.number().int().nonnegative().optional(),
  userNotes: z.string().optional(),
  queryText: z.string().min(2).max(300).optional(),
  description: z.string().max(500).optional(),
  category: searchQueryCategorySchema.optional(),
  priority: z.number().int().positive().optional(),
  suggestedSources: z.array(z.string().min(1).max(50)).optional(),
  suggestedYearFrom: z.union([z.number().int().min(1900).max(2100), z.null()]).optional(),
  suggestedYearTo: z.union([z.number().int().min(1900).max(2100), z.null()]).optional()
});

// Schema for adding custom query
const addQuerySchema = z.object({
  queryText: z.string().min(2),
  description: z.string().max(500).optional(),
  category: searchQueryCategorySchema.optional().default('CUSTOM')
});

interface GeneratedQuery {
  queryText: string;
  category: string;
  description: string;
  priority: number;
  suggestedSources: string[];
  suggestedYearFrom?: number;
  suggestedYearTo?: number;
}

interface LLMStrategyResponse {
  summary: string;
  estimatedPapers: number;
  queries: GeneratedQuery[];
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ 
      where: { id: sessionId },
      include: { 
        researchTopic: true, 
        ideaRecord: true,
        citationSearchStrategy: {
          include: { queries: { orderBy: { priority: 'asc' } } }
        }
      }
    });
  }

  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { 
      researchTopic: true, 
      ideaRecord: true,
      citationSearchStrategy: {
        include: { queries: { orderBy: { priority: 'asc' } } }
      }
    }
  });
}

function buildStrategyPrompt(
  paperTitle: string,
  paperAbstract: string,
  keywords: string[],
  researchFocus: string
): string {
  return `You are an expert research librarian helping generate a systematic literature search strategy for academic paper writing.

PAPER INFORMATION:
Title: ${paperTitle}
Abstract/Description: ${paperAbstract}
Keywords: ${keywords.join(', ')}
Research Focus: ${researchFocus}

TASK:
Generate a comprehensive set of 6-10 search queries that will help find ALL relevant papers needed to write a complete academic manuscript. The queries should cover:

1. CORE_CONCEPTS - Main topic keywords and concepts
2. DOMAIN_APPLICATION - Field-specific and application papers
3. METHODOLOGY - Methods, techniques, algorithms relevant to the research
4. THEORETICAL_FOUNDATION - Foundational and seminal works (can be older)
5. SURVEYS_REVIEWS - Existing review papers and surveys
6. COMPETING_APPROACHES - Alternative methods, baselines, comparisons
7. RECENT_ADVANCES - Latest papers (2023-2024)
8. GAP_IDENTIFICATION - Papers that highlight limitations and gaps

For each query:
- Create SHORT, keyword-focused queries (3-7 words) optimized for academic search
- Do NOT use question format - use keyword combinations
- Suggest which search sources work best (semantic_scholar, openalex, pubmed, arxiv, crossref, core)
- Suggest year ranges where appropriate

Respond in JSON format ONLY:
{
  "summary": "<1-2 sentence overview of the search strategy>",
  "estimatedPapers": <estimated total papers to find across all queries>,
  "queries": [
    {
      "queryText": "<search query keywords>",
      "category": "<CORE_CONCEPTS|DOMAIN_APPLICATION|METHODOLOGY|THEORETICAL_FOUNDATION|SURVEYS_REVIEWS|COMPETING_APPROACHES|RECENT_ADVANCES|GAP_IDENTIFICATION>",
      "description": "<why this query is important, what papers it will find>",
      "priority": <1-10, execution order>,
      "suggestedSources": ["semantic_scholar", "openalex", ...],
      "suggestedYearFrom": <optional, e.g., 2020>,
      "suggestedYearTo": <optional, e.g., 2024>
    }
  ]
}

Generate queries that together provide COMPLETE coverage for writing Introduction, Literature Review, and Methodology sections.`;
}

function parseStrategyResponse(output: string): LLMStrategyResponse {
  let cleaned = output.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const parsed = JSON.parse(cleaned);
  
  if (!parsed.queries || !Array.isArray(parsed.queries)) {
    throw new Error('Invalid response: missing queries array');
  }

  const validCategories = [
    'CORE_CONCEPTS', 'DOMAIN_APPLICATION', 'METHODOLOGY', 
    'THEORETICAL_FOUNDATION', 'SURVEYS_REVIEWS', 'COMPETING_APPROACHES',
    'RECENT_ADVANCES', 'GAP_IDENTIFICATION', 'CUSTOM'
  ];

  const queries: GeneratedQuery[] = parsed.queries.map((q: any, idx: number) => ({
    queryText: String(q.queryText || '').slice(0, 200),
    category: validCategories.includes(q.category) ? q.category : 'CUSTOM',
    description: String(q.description || 'Search query').slice(0, 500),
    priority: Number(q.priority) || idx + 1,
    suggestedSources: Array.isArray(q.suggestedSources) ? q.suggestedSources : ['semantic_scholar', 'openalex'],
    suggestedYearFrom: q.suggestedYearFrom ? Number(q.suggestedYearFrom) : undefined,
    suggestedYearTo: q.suggestedYearTo ? Number(q.suggestedYearTo) : undefined
  }));

  return {
    summary: String(parsed.summary || 'Search strategy generated'),
    estimatedPapers: Number(parsed.estimatedPapers) || 50,
    queries
  };
}

// GET - Retrieve existing search strategy
export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    if (!session.citationSearchStrategy) {
      return NextResponse.json({ 
        strategy: null,
        message: 'No search strategy generated yet'
      });
    }

    // Calculate progress
    const queries = session.citationSearchStrategy.queries;
    const completedQueries = queries.filter(q => 
      q.status === 'COMPLETED' || q.status === 'SKIPPED'
    ).length;
    const totalQueries = queries.length;
    const progress = totalQueries > 0 ? Math.round((completedQueries / totalQueries) * 100) : 0;

    return NextResponse.json({
      strategy: {
        ...session.citationSearchStrategy,
        progress,
        completedQueries,
        totalQueries
      }
    });

  } catch (error) {
    console.error('[SearchStrategy] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch search strategy' }, { status: 500 });
  }
}

// Helper to check if user has Pro plan
async function userHasProPlan(userId: string): Promise<boolean> {
  const credits = await prisma.userCredit.findUnique({
    where: { userId },
    select: { planTier: true }
  });
  return credits?.planTier === 'pro' || credits?.planTier === 'enterprise';
}

// POST - Generate new search strategy or add custom query
export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Check if user has Pro plan for strategy generation
    const hasPro = await userHasProPlan(user.id);
    if (!hasPro) {
      return NextResponse.json({ 
        error: 'Search Strategy generation requires a Pro plan. Upgrade to access AI-powered systematic search queries.',
        code: 'PRO_REQUIRED'
      }, { status: 403 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    
    // Check if this is adding a custom query
    if (body.queryText) {
      const data = addQuerySchema.parse(body);
      
      if (!session.citationSearchStrategy) {
        return NextResponse.json({ error: 'Generate a search strategy first' }, { status: 400 });
      }

      const maxPriority = Math.max(
        ...session.citationSearchStrategy.queries.map(q => q.priority),
        0
      );

      const newQuery = await prisma.citationSearchQuery.create({
        data: {
          strategyId: session.citationSearchStrategy.id,
          queryText: data.queryText,
          category: data.category as any,
          description: data.description || 'Custom search query',
          priority: maxPriority + 1,
          suggestedSources: ['semantic_scholar', 'openalex', 'crossref'],
          status: 'PENDING'
        }
      });

      return NextResponse.json({ query: newQuery }, { status: 201 });
    }

    // Generate new strategy
    const data = generateSchema.parse(body);

    // Check if strategy already exists and regenerate is not requested
    if (session.citationSearchStrategy && !data.regenerate) {
      return NextResponse.json({ 
        error: 'Search strategy already exists. Set regenerate: true to create a new one.',
        strategy: session.citationSearchStrategy
      }, { status: 409 });
    }

    // Get paper information for strategy generation
    const paperTitle = session.researchTopic?.title 
      || session.ideaRecord?.title 
      || 'Untitled Research';
    
    const paperAbstract = session.researchTopic?.abstractDraft
      || session.researchTopic?.researchQuestion
      || session.researchTopic?.problemStatement
      || session.ideaRecord?.problem
      || '';
    
    const keywords = session.researchTopic?.keywords || [];
    
    const researchFocus = session.researchTopic?.topicDescription
      || session.researchTopic?.researchGaps
      || session.researchTopic?.methodologyApproach
      || session.ideaRecord?.objectives
      || session.ideaRecord?.logic
      || '';

    if (!paperAbstract && !researchFocus) {
      return NextResponse.json({ 
        error: 'Please complete the Research Topic stage first to generate search strategy' 
      }, { status: 400 });
    }

    // Build prompt and call LLM
    const prompt = buildStrategyPrompt(paperTitle, paperAbstract, keywords, researchFocus);
    const authHeader = request.headers.get('authorization') || '';

    const llmResult = await llmGateway.executeLLMOperation(
      { headers: { authorization: authHeader } },
      {
        taskCode: 'SEARCH_STRATEGY_GEN',
        stageCode: 'LITERATURE_SEARCH',
        prompt,
        parameters: { temperature: 0.4 },
        idempotencyKey: `search-strategy-${sessionId}-${Date.now()}`,
        metadata: { sessionId }
      }
    );

    if (!llmResult.success || !llmResult.response) {
      console.error('[SearchStrategy] LLM call failed:', llmResult.error);
      return NextResponse.json({ 
        error: llmResult.error?.message || 'Failed to generate search strategy' 
      }, { status: 500 });
    }

    // Parse response
    let strategyData: LLMStrategyResponse;
    try {
      strategyData = parseStrategyResponse(llmResult.response.output);
    } catch (parseError) {
      console.error('[SearchStrategy] Parse error:', parseError);
      console.error('Raw output:', llmResult.response.output);
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // Delete existing strategy if regenerating
    if (session.citationSearchStrategy) {
      await prisma.citationSearchStrategy.delete({
        where: { id: session.citationSearchStrategy.id }
      });
    }

    // Create new strategy with queries
    const strategy = await prisma.citationSearchStrategy.create({
      data: {
        sessionId,
        paperTitle,
        paperAbstract,
        keywords,
        researchFocus,
        summary: strategyData.summary,
        estimatedPapers: strategyData.estimatedPapers,
        aiModelUsed: llmResult.response.modelClass || 'unknown',
        status: 'READY',
        queries: {
          create: strategyData.queries.map(q => ({
            queryText: q.queryText,
            category: q.category as any,
            description: q.description,
            priority: q.priority,
            suggestedSources: q.suggestedSources,
            suggestedYearFrom: q.suggestedYearFrom,
            suggestedYearTo: q.suggestedYearTo,
            status: 'PENDING'
          }))
        }
      },
      include: {
        queries: { orderBy: { priority: 'asc' } }
      }
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'SEARCH_STRATEGY_GENERATED',
        resource: `drafting_session:${sessionId}`,
        meta: {
          strategyId: strategy.id,
          queryCount: strategy.queries.length,
          estimatedPapers: strategy.estimatedPapers
        }
      }
    });

    return NextResponse.json({
      strategy: {
        ...strategy,
        progress: 0,
        completedQueries: 0,
        totalQueries: strategy.queries.length
      }
    }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }
    console.error('[SearchStrategy] POST error:', error);
    return NextResponse.json({ error: 'Failed to generate search strategy' }, { status: 500 });
  }
}

// PATCH - Update query status
export async function PATCH(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    if (!session.citationSearchStrategy) {
      return NextResponse.json({ error: 'No search strategy found' }, { status: 404 });
    }

    const body = await request.json();
    const data = updateQuerySchema.parse(body);

    if (
      data.suggestedYearFrom !== undefined &&
      data.suggestedYearTo !== undefined &&
      data.suggestedYearFrom !== null &&
      data.suggestedYearTo !== null &&
      data.suggestedYearFrom > data.suggestedYearTo
    ) {
      return NextResponse.json(
        { error: 'suggestedYearFrom must be less than or equal to suggestedYearTo' },
        { status: 400 }
      );
    }

    // Verify query belongs to this strategy
    const query = await prisma.citationSearchQuery.findFirst({
      where: {
        id: data.queryId,
        strategyId: session.citationSearchStrategy.id
      }
    });

    if (!query) {
      return NextResponse.json({ error: 'Query not found' }, { status: 404 });
    }

    // Update query
    const updateData: any = {};
    if (data.status) {
      updateData.status = data.status;
      if (data.status === 'SEARCHED' || data.status === 'COMPLETED') {
        updateData.searchedAt = new Date();
      }
    }
    if (data.resultsCount !== undefined) updateData.resultsCount = data.resultsCount;
    if (data.importedCount !== undefined) updateData.importedCount = data.importedCount;
    if (data.userNotes !== undefined) updateData.userNotes = data.userNotes;
    if (data.queryText !== undefined) updateData.queryText = data.queryText.trim();
    if (data.description !== undefined) updateData.description = data.description.trim();
    if (data.category !== undefined) updateData.category = data.category;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.suggestedSources !== undefined) updateData.suggestedSources = data.suggestedSources;
    if (data.suggestedYearFrom !== undefined) updateData.suggestedYearFrom = data.suggestedYearFrom;
    if (data.suggestedYearTo !== undefined) updateData.suggestedYearTo = data.suggestedYearTo;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No query fields provided to update' }, { status: 400 });
    }

    const updatedQuery = await prisma.citationSearchQuery.update({
      where: { id: data.queryId },
      data: updateData
    });

    // Check if all queries are completed to update strategy status
    const allQueries = await prisma.citationSearchQuery.findMany({
      where: { strategyId: session.citationSearchStrategy.id }
    });

    const allCompleted = allQueries.every(q => 
      q.status === 'COMPLETED' || q.status === 'SKIPPED'
    );
    const anyInProgress = allQueries.some(q => 
      q.status === 'SEARCHING' || q.status === 'SEARCHED'
    );

    let newStrategyStatus = session.citationSearchStrategy.status;
    if (allCompleted) {
      newStrategyStatus = 'COMPLETED';
    } else if (anyInProgress || allQueries.some(q => q.status === 'COMPLETED')) {
      newStrategyStatus = 'IN_PROGRESS';
    }

    if (newStrategyStatus !== session.citationSearchStrategy.status) {
      await prisma.citationSearchStrategy.update({
        where: { id: session.citationSearchStrategy.id },
        data: { 
          status: newStrategyStatus as any,
          completedAt: allCompleted ? new Date() : null
        }
      });
    }

    return NextResponse.json({ 
      query: updatedQuery,
      strategyStatus: newStrategyStatus
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }
    console.error('[SearchStrategy] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update query' }, { status: 500 });
  }
}

// DELETE - Delete a custom query
export async function DELETE(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    if (!session.citationSearchStrategy) {
      return NextResponse.json({ error: 'No search strategy found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('queryId');

    if (!queryId) {
      return NextResponse.json({ error: 'queryId is required' }, { status: 400 });
    }

    // Verify query belongs to this strategy and is custom
    const query = await prisma.citationSearchQuery.findFirst({
      where: {
        id: queryId,
        strategyId: session.citationSearchStrategy.id
      }
    });

    if (!query) {
      return NextResponse.json({ error: 'Query not found' }, { status: 404 });
    }

    await prisma.citationSearchQuery.delete({
      where: { id: queryId }
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[SearchStrategy] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete query' }, { status: 500 });
  }
}

