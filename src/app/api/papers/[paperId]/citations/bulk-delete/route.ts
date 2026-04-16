/**
 * Bulk Delete Citations API
 * POST /api/papers/:paperId/citations/bulk-delete - Delete multiple citations at once
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

const bulkDeleteSchema = z.object({
  citationIds: z.array(z.string()).min(1, 'At least one citation ID required'),
});

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;

    // Verify session ownership
    const session = await prisma.draftingSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });

    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const data = bulkDeleteSchema.parse(body);

    // Delete all citations in one query
    const result = await prisma.citation.deleteMany({
      where: {
        id: { in: data.citationIds },
        sessionId: sessionId,
      },
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
      message: `Deleted ${result.count} citation(s)`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: err.errors }, { status: 400 });
    }
    console.error('Bulk delete citations error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete citations' },
      { status: 500 }
    );
  }
}













