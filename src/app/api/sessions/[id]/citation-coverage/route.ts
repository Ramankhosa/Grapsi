import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { citationCoverageValidator } from '@/lib/services/citation-coverage-validator';

export const runtime = 'nodejs';

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true }
    });
  }

  return prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id
    },
    select: { id: true, userId: true }
  });
}

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.id;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const coverage = await citationCoverageValidator.validateCoverage(sessionId);
    return NextResponse.json({
      sessionId,
      ...coverage
    });
  } catch (error) {
    console.error('[CitationCoverage] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load citation coverage' },
      { status: 500 }
    );
  }
}
