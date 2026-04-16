/**
 * Node Operations API
 * 
 * PUT - Update node state or position
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
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

    const { sessionId } = await params;
    const body = await request.json();
    const { nodeId, action, state, position } = body;

    if (!nodeId) {
      return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });
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

    // Update state
    if (action === 'state' && state) {
      const validStates = ['EXPANDED', 'COLLAPSED', 'HIDDEN', 'REMOVED', 'SELECTED'];
      if (!validStates.includes(state)) {
        return NextResponse.json({ error: 'Invalid state' }, { status: 400 });
      }

      const updated = await IdeationService.updateNodeState(sessionId, nodeId, state);
      return NextResponse.json({ success: true, node: updated });
    }

    // Update position
    if (action === 'position' && position) {
      const { x, y } = position;
      if (typeof x !== 'number' || typeof y !== 'number') {
        return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
      }

      const updated = await IdeationService.updateNodePosition(sessionId, nodeId, x, y);
      return NextResponse.json({ success: true, node: updated });
    }

    // Undo
    if (action === 'undo') {
      const count = await IdeationService.undoNodeChanges(sessionId);
      return NextResponse.json({ success: true, restoredCount: count });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "state", "position", or "undo"' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Failed to update node:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update node' },
      { status: 500 }
    );
  }
}

