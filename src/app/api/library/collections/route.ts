/**
 * Collections API
 * GET /api/library/collections - Get all collections
 * POST /api/library/collections - Create new collection
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { paperLibraryService } from '@/lib/services/paper-library-service';
import { authenticateUser } from '@/lib/auth-middleware';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const url = new URL(request.url);
    const paperId = (url.searchParams.get('paperId') || '').trim();
    if (paperId) {
      try {
        await paperLibraryService.backfillPaperCollectionFromSessionCitations(user.id, paperId);
      } catch (syncError) {
        // Fail-open for collection listing; don't block UI if repair fails.
        console.warn('[LibraryCollections] Paper collection backfill failed:', syncError);
      }
    }

    const result = await referenceLibraryService.getCollections(user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Collections GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch collections' },
      { status: 500 }
    );
  }
}

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
    
    const data = createSchema.parse(body);

    const collection = await referenceLibraryService.createCollection(
      user.id,
      data.name,
      data.description,
      data.color
    );

    return NextResponse.json({ collection }, { status: 201 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: err.errors }, { status: 400 });
    }
    // Handle unique constraint violation (duplicate collection name)
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A collection with this name already exists' },
        { status: 409 }
      );
    }
    console.error('Collections POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create collection' },
      { status: 500 }
    );
  }
}

