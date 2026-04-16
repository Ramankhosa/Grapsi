import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';

export const runtime = 'nodejs';

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({ where });
}

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

    const unused = await citationService.findUnusedCitations(sessionId);
    return NextResponse.json({ citations: unused });
  } catch (error) {
    console.error('[Citations] unused error:', error);
    return NextResponse.json({ error: 'Failed to fetch unused citations' }, { status: 500 });
  }
}
