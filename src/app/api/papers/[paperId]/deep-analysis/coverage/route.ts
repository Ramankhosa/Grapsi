import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { featureFlags } from '@/lib/feature-flags';
import { deepAnalysisService } from '@/lib/services/deep-analysis-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ where: { id: sessionId }, select: { id: true } });
  }

  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true },
  });
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

    const result = await deepAnalysisService.getCoverage(sessionId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[DeepAnalysis] coverage error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to fetch deep analysis coverage' }, { status: 500 });
  }
}
