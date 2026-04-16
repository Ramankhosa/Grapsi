/**
 * Library Export API
 * GET /api/library/export - Export references to BibTeX
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

    const searchParams = request.nextUrl.searchParams;
    const idsParam = searchParams.get('ids');
    const referenceIds = idsParam ? idsParam.split(',').filter(Boolean) : undefined;

    const bibtex = await referenceLibraryService.exportToBibTeX(user.id, referenceIds);

    return new NextResponse(bibtex, {
      headers: {
        'Content-Type': 'application/x-bibtex',
        'Content-Disposition': 'attachment; filename="references.bib"',
      },
    });
  } catch (err) {
    console.error('Library export error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export references' },
      { status: 500 }
    );
  }
}

