/**
 * Obviousness Filter API (Stage 3.5)
 * 
 * POST - Score selected dimensions for novelty BEFORE idea generation
 * Prevents wasting LLM calls on obvious combinations
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
    const { selectedDimensions } = body;

    if (!selectedDimensions || !Array.isArray(selectedDimensions) || selectedDimensions.length === 0) {
      return NextResponse.json(
        { error: 'selectedDimensions array is required' },
        { status: 400 }
      );
    }

    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { 
        userId: true, 
        status: true, 
        normalizationJson: true,
        classificationJson: true,
      },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!ideationSession.normalizationJson || !ideationSession.classificationJson) {
      return NextResponse.json(
        { error: 'Session must be normalized and classified first' },
        { status: 400 }
      );
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    const obviousnessResult = await IdeationService.checkObviousness(
      sessionId,
      selectedDimensions,
      requestHeaders
    );

    // Determine if we should proceed or suggest changes
    const shouldProceed = obviousnessResult.combinationNovelty >= 40;
    const needsWildcard = obviousnessResult.combinationNovelty < 40;

    return NextResponse.json({
      success: true,
      obviousnessResult,
      shouldProceed,
      needsWildcard,
      // Convenience fields for frontend
      noveltyScore: obviousnessResult.combinationNovelty,
      flags: obviousnessResult.obviousnessFlags,
      wildCard: obviousnessResult.wildCardSuggestion,
      analogySuggestions: obviousnessResult.suggestedAnalogySources,
      dimensionScores: obviousnessResult.dimensionQualityScores,
    });
  } catch (error) {
    console.error('Failed to check obviousness:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check obviousness' },
      { status: 500 }
    );
  }
}

