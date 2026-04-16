/**
 * Single Idea Frame API
 * 
 * PUT - Update idea frame (status, rating, notes)
 * DELETE - Delete an idea frame
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string; ideaId: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId, ideaId } = await params;
    const body = await request.json();
    const { status, rating, notes } = body;

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

    // Verify idea belongs to session
    const ideaFrame = await prisma.ideaFrame.findFirst({
      where: { id: ideaId, sessionId },
    });

    if (!ideaFrame) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    // Update status
    if (status) {
      const validStatuses = ['DRAFT', 'SHORTLISTED', 'REJECTED', 'ARCHIVED'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      await IdeationService.updateIdeaStatus(ideaId, status, notes);
    }

    // Update rating
    if (rating !== undefined) {
      await IdeationService.rateIdea(ideaId, rating);
    }

    // Get updated idea
    const updated = await prisma.ideaFrame.findUnique({
      where: { id: ideaId },
    });

    return NextResponse.json({
      success: true,
      idea: {
        id: updated?.id,
        status: updated?.status,
        userRating: updated?.userRating,
        userNotes: updated?.userNotes,
      },
    });
  } catch (error) {
    console.error('Failed to update idea:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update idea' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete an idea frame
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId, ideaId } = await params;

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

    // Verify idea belongs to session
    const ideaFrame = await prisma.ideaFrame.findFirst({
      where: { id: ideaId, sessionId },
    });

    if (!ideaFrame) {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }

    // Delete the idea
    await prisma.ideaFrame.delete({
      where: { id: ideaId },
    });

    return NextResponse.json({
      success: true,
      message: 'Idea deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete idea:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete idea' },
      { status: 500 }
    );
  }
}

