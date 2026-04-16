/**
 * Copy to Session API
 * POST /api/library/copy-to-session - Copy library references to a paper session
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperLibraryService } from '@/lib/services/paper-library-service';

const copySchema = z.object({
  sessionId: z.string().min(1),
  referenceIds: z.array(z.string()).min(1),
});

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    const data = copySchema.parse(body);

    const result = await referenceLibraryService.copyToSession(
      user.id,
      data.sessionId,
      data.referenceIds
    );

    if (data.referenceIds.length > 0) {
      try {
        await paperLibraryService.addReferencesToPaperCollection(
          user.id,
          data.sessionId,
          data.referenceIds
        );
      } catch (collectionError) {
        console.warn('[LibraryCopyToSession] Failed to add references to paper library collection:', collectionError);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: err.errors }, { status: 400 });
    }
    console.error('Copy to session error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to copy references' },
      { status: 500 }
    );
  }
}

