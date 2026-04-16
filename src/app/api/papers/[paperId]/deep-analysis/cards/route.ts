import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { featureFlags } from '@/lib/feature-flags';
import { deepAnalysisService } from '@/lib/services/deep-analysis-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  view: z.enum(['paper', 'dimension', 'section']).optional(),
  citationId: z.string().min(1).optional(),
  sectionKey: z.string().min(1).optional(),
  dimension: z.string().min(1).optional(),
  claimType: z.string().min(1).optional(),
  confidence: z.string().min(1).optional(),
  verified: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ where: { id: sessionId }, select: { id: true } });
  }

  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true },
  });
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
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

    const searchParams = request.nextUrl.searchParams;
    const parsed = querySchema.parse({
      view: searchParams.get('view') || undefined,
      citationId: searchParams.get('citationId') || undefined,
      sectionKey: searchParams.get('sectionKey') || undefined,
      dimension: searchParams.get('dimension') || undefined,
      claimType: searchParams.get('claimType') || undefined,
      confidence: searchParams.get('confidence') || undefined,
      verified: parseBoolean(searchParams.get('verified')),
      page: parseNumber(searchParams.get('page')),
      limit: parseNumber(searchParams.get('limit')),
    });

    const result = await deepAnalysisService.getCards(sessionId, parsed);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid query parameters' }, { status: 400 });
    }

    console.error('[DeepAnalysis] cards error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to fetch evidence cards' }, { status: 500 });
  }
}
