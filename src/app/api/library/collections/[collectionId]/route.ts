/**
 * Individual Collection API
 * GET /api/library/collections/[collectionId] - Get collection with references
 * PUT /api/library/collections/[collectionId] - Update collection
 * DELETE /api/library/collections/[collectionId] - Delete collection
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { authenticateUser } from '@/lib/auth-middleware';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const addReferencesSchema = z.object({
  action: z.literal('addReferences'),
  referenceIds: z.array(z.string()).min(1),
});

const removeReferencesSchema = z.object({
  action: z.literal('removeReferences'),
  referenceIds: z.array(z.string()).min(1),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { collectionId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Get collection references using the filter
    const { references, total } = await referenceLibraryService.getReferences(
      user.id,
      { collectionId: params.collectionId },
      100,
      0
    );

    return NextResponse.json({ references, total });
  } catch (err) {
    console.error('Collection GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch collection' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { collectionId: string } }
) {
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

    // Handle add/remove references
    if (body.action === 'addReferences') {
      const data = addReferencesSchema.parse(body);
      const result = await referenceLibraryService.addToCollection(
        user.id,
        params.collectionId,
        data.referenceIds
      );
      return NextResponse.json(result);
    }

    if (body.action === 'removeReferences') {
      const data = removeReferencesSchema.parse(body);
      const result = await referenceLibraryService.removeFromCollection(
        user.id,
        params.collectionId,
        data.referenceIds
      );
      return NextResponse.json(result);
    }

    // Regular update
    const data = updateSchema.parse(body);
    const collection = await referenceLibraryService.updateCollection(
      user.id,
      params.collectionId,
      data
    );

    return NextResponse.json({ collection });
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
    // Handle not found error from Prisma
    if (err?.code === 'P2025') {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      );
    }
    console.error('Collection PUT error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update collection' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { collectionId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    await referenceLibraryService.deleteCollection(user.id, params.collectionId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    // Handle not found error from Prisma
    if (err?.code === 'P2025') {
      return NextResponse.json(
        { error: 'Collection not found' },
        { status: 404 }
      );
    }
    console.error('Collection DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete collection' },
      { status: 500 }
    );
  }
}

