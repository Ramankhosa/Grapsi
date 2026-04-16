/**
 * Library Tags API
 * GET /api/library/tags - Get all tags with counts
 */

import { NextRequest, NextResponse } from 'next/server';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { authenticateUser } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const tags = await referenceLibraryService.getAllTags(user.id);
    return NextResponse.json({ tags });
  } catch (err) {
    console.error('Library tags error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}

