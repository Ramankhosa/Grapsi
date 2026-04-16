/**
 * Bulk Delete References API
 * POST /api/library/bulk-delete - Delete multiple references at once
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { authenticateUser } from '@/lib/auth-middleware';

const bulkDeleteSchema = z.object({
  referenceIds: z.array(z.string()).min(1, 'At least one reference ID required'),
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
    const data = bulkDeleteSchema.parse(body);

    let deleted = 0;
    const errors: string[] = [];

    // Delete references one by one to ensure proper ownership checks
    for (const referenceId of data.referenceIds) {
      try {
        await referenceLibraryService.deleteReference(user.id, referenceId);
        deleted++;
      } catch (err) {
        errors.push(`Failed to delete ${referenceId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return NextResponse.json({
      success: deleted > 0,
      deleted,
      total: data.referenceIds.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: err.errors }, { status: 400 });
    }
    console.error('Bulk delete error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete references' },
      { status: 500 }
    );
  }
}

