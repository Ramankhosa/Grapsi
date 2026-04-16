import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { featureFlags } from '@/lib/feature-flags';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';
import { deepAnalysisService } from '@/lib/services/deep-analysis-service';
import { MAX_DEEP_ANALYSIS_CONCURRENCY } from '@/lib/services/deep-analysis-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startSchema = z.object({
  citationIds: z.array(z.string().min(1)).min(1).max(50),
  concurrency: z.number().int().min(1).max(MAX_DEEP_ANALYSIS_CONCURRENCY).optional().default(MAX_DEEP_ANALYSIS_CONCURRENCY),
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, tenantId: true },
    });
  }

  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true, tenantId: true },
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
    const input = startSchema.parse(body);
    const tenantContext = await resolveTenantContext(request, user.id);

    const result = await deepAnalysisService.startBatch(sessionId, input.citationIds, {
      concurrency: input.concurrency,
      tenantContext,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    if (error?.code === 'ACTIVE_RUN') {
      return NextResponse.json({
        error: 'Deep analysis already in progress',
        activeJobCount: Number(error.activeCount || 0),
      }, { status: 409 });
    }

    console.error('[DeepAnalysis] start error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to start deep analysis' }, { status: 500 });
  }
}
