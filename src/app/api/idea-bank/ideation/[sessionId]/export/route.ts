/**
 * Export to Idea Bank API
 * 
 * POST - Export selected idea frames to the Idea Bank
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    const body = await request.json();
    const { ideaFrameIds } = body;

    if (!Array.isArray(ideaFrameIds) || ideaFrameIds.length === 0) {
      return NextResponse.json(
        { error: 'ideaFrameIds array is required' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      select: { id: true, tenantId: true },
    });

    if (!user?.tenantId) {
      return NextResponse.json(
        { error: 'User not associated with tenant' },
        { status: 403 }
      );
    }

    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const exportedIds = await IdeationService.exportToIdeaBank({
      sessionId,
      ideaFrameIds,
      userId: user.id,
      tenantId: user.tenantId,
    });

    return NextResponse.json({
      success: true,
      exportedCount: exportedIds.length,
      ideaBankIds: exportedIds,
      message: `Successfully exported ${exportedIds.length} idea(s) to Idea Bank`,
    });
  } catch (error) {
    console.error('Failed to export to Idea Bank:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export' },
      { status: 500 }
    );
  }
}

