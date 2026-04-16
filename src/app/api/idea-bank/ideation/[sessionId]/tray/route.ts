/**
 * Combine Tray API
 * 
 * GET  - Get current tray contents
 * POST - Update tray selections
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
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
      include: { combineTray: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      tray: ideationSession.combineTray || {
        selectedComponents: [],
        selectedDimensions: [],
        selectedOperators: [],
        recipeIntent: 'divergent',
        requestedCount: 5,
      },
    });
  } catch (error) {
    console.error('Failed to get tray:', error);
    return NextResponse.json(
      { error: 'Failed to get tray' },
      { status: 500 }
    );
  }
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
    const {
      components = [],
      dimensions = [],
      operators = [],
      intent = 'DIVERGENT',
      count = 5,
    } = body;

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

    const tray = await IdeationService.updateCombineTray(
      sessionId,
      components,
      dimensions,
      operators,
      intent,
      count
    );

    return NextResponse.json({
      success: true,
      tray,
    });
  } catch (error) {
    console.error('Failed to update tray:', error);
    return NextResponse.json(
      { error: 'Failed to update tray' },
      { status: 500 }
    );
  }
}

