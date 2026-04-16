/**
 * Classify Invention API
 * 
 * POST - Run classification on the normalized input
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
      select: { userId: true, status: true, normalizationJson: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!ideationSession.normalizationJson) {
      return NextResponse.json(
        { error: 'Session must be normalized first' },
        { status: 400 }
      );
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    const classification = await IdeationService.classifyInvention(sessionId, requestHeaders);

    return NextResponse.json({
      success: true,
      classification,
      shouldFork: classification.forkMode === 'FORK',
    });
  } catch (error) {
    console.error('Failed to classify invention:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to classify' },
      { status: 500 }
    );
  }
}

