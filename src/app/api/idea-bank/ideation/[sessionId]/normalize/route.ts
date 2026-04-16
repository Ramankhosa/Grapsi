/**
 * Normalize Seed API
 * 
 * POST - Run normalization on the seed input
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
    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, status: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    const normalization = await IdeationService.normalizeSeed(sessionId, requestHeaders);

    return NextResponse.json({
      success: true,
      normalization,
      hasUnknowns: normalization.unknownsToAsk.length > 0,
    });
  } catch (error) {
    console.error('Failed to normalize seed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to normalize' },
      { status: 500 }
    );
  }
}

