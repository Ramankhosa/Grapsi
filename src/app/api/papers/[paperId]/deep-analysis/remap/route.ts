import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { featureFlags } from '@/lib/feature-flags';
import { extractTenantContextFromRequest } from '@/lib/metering/auth-bridge';
import { deepAnalysisService } from '@/lib/services/deep-analysis-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    const tenantContext = await resolveTenantContext(request, user.id);
    const result = await deepAnalysisService.remapAll(sessionId, tenantContext);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[DeepAnalysis] remap error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to remap evidence cards' }, { status: 500 });
  }
}
