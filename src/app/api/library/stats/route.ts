/**
 * Library Stats API
 * GET /api/library/stats - Get library statistics
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

    const stats = await referenceLibraryService.getStats(user.id);
    return NextResponse.json(stats);
  } catch (err) {
    console.error('Library stats error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

