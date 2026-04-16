/**
 * Contradiction Mapping API (Stage 2.5)
 * 
 * POST - Map technical contradictions to TRIZ principles and resolution strategies
 * This makes contradictions first-class citizens in the ideation process
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

    const contradictionMapping = await IdeationService.mapContradictions(
      sessionId, 
      requestHeaders
    );

    return NextResponse.json({
      success: true,
      contradictionMapping,
      contradictionCount: contradictionMapping.contradictions.length,
      principlesFound: contradictionMapping.inventivePrinciples.length,
      strategiesFound: contradictionMapping.resolutionStrategies.length,
    });
  } catch (error) {
    console.error('Failed to map contradictions:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to map contradictions' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
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
      select: { 
        userId: true, 
        normalizationJson: true,
      },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Extract contradiction mapping from normalization JSON
    const normalization = ideationSession.normalizationJson as any;
    const contradictionMapping = normalization?.contradictionMapping || null;

    return NextResponse.json({
      success: true,
      contradictionMapping,
      hasMapping: !!contradictionMapping,
    });
  } catch (error) {
    console.error('Failed to get contradiction mapping:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get mapping' },
      { status: 500 }
    );
  }
}

