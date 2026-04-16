import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { literatureSearchService } from '@/lib/services/literature-search-service';
import { featureFlags } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const searchSchema = z.object({
  query: z.string().min(2),
  sources: z.array(z.string().min(1)).optional(),
  yearFrom: z.number().int().optional(),
  yearTo: z.number().int().optional(),
  limit: z.number().int().positive().max(50).optional(),
  // Enhanced filters
  publicationTypes: z.array(z.enum([
    'journal-article', 'conference-paper', 'book-chapter', 'book', 
    'preprint', 'review', 'thesis', 'dataset', 'other'
  ])).optional(),
  openAccessOnly: z.boolean().optional(),
  minCitations: z.number().int().nonnegative().optional(),
  fieldsOfStudy: z.array(z.enum([
    'computer-science', 'medicine', 'biology', 'physics', 'chemistry',
    'mathematics', 'engineering', 'economics', 'psychology', 'sociology',
    'environmental-science', 'materials-science', 'other'
  ])).optional(),
  hasAbstract: z.boolean().optional()
});

const recentRequests = new Map<string, { timestamp: number; response: any }>();
const DEDUP_WINDOW_MS = 5000;

// Sanitize string to remove null characters that PostgreSQL can't handle
function sanitizeForPostgres(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Remove null characters (\u0000)
    return obj.replace(/\u0000/g, '');
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForPostgres);
  }
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeForPostgres(value);
    }
    return sanitized;
  }
  return obj;
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ where: { id: sessionId } });
  }

  return prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id
    }
  });
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = searchSchema.parse(body);

    const cacheKey = JSON.stringify({
      query: data.query,
      sources: data.sources?.slice().sort() || [],
      yearFrom: data.yearFrom,
      yearTo: data.yearTo,
      limit: data.limit,
      publicationTypes: data.publicationTypes?.slice().sort() || [],
      openAccessOnly: data.openAccessOnly,
      minCitations: data.minCitations,
      fieldsOfStudy: data.fieldsOfStudy?.slice().sort() || [],
      hasAbstract: data.hasAbstract
    });

    const now = Date.now();
    const cached = recentRequests.get(cacheKey);
    if (cached && (now - cached.timestamp) < DEDUP_WINDOW_MS) {
      return NextResponse.json({ ...cached.response, deduped: true });
    }

    const result = await literatureSearchService.search(data.query, {
      sources: data.sources,
      yearFrom: data.yearFrom,
      yearTo: data.yearTo,
      limit: data.limit,
      // Enhanced filters
      publicationTypes: data.publicationTypes,
      openAccessOnly: data.openAccessOnly,
      minCitations: data.minCitations,
      fieldsOfStudy: data.fieldsOfStudy,
      hasAbstract: data.hasAbstract
    });

    // Persist search run for AI analysis feature
    // Sanitize results to remove null characters that PostgreSQL can't handle
    const sanitizedResults = sanitizeForPostgres(result.results);
    
    const searchRun = await prisma.literatureSearchRun.create({
      data: {
        sessionId,
        query: data.query,
        sources: data.sources || result.sources,
        yearFrom: data.yearFrom,
        yearTo: data.yearTo,
        results: sanitizedResults,
      }
    });

    const response = {
      searchRunId: searchRun.id, // Include for AI analysis feature
      results: result.results,
      totalFound: result.totalFound,
      sources: result.sources
    };

    recentRequests.set(cacheKey, { timestamp: now, response });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'LITERATURE_SEARCH',
        resource: `drafting_session:${sessionId}`,
        meta: {
          query: data.query,
          sources: data.sources || result.sources,
          yearFrom: data.yearFrom,
          yearTo: data.yearTo,
          limit: data.limit,
          publicationTypes: data.publicationTypes,
          openAccessOnly: data.openAccessOnly,
          minCitations: data.minCitations,
          fieldsOfStudy: data.fieldsOfStudy,
          results: result.totalFound
        }
      }
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[LiteratureSearch] POST error:', error);
    return NextResponse.json({ error: 'Failed to search literature' }, { status: 500 });
  }
}
