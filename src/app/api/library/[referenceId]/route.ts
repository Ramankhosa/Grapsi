/**
 * Individual Reference API
 * GET /api/library/[referenceId] - Get single reference
 * PUT /api/library/[referenceId] - Update reference
 * DELETE /api/library/[referenceId] - Delete reference
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { authenticateUser } from '@/lib/auth-middleware';

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  authors: z.array(z.string()).optional(),
  year: z.number().optional(),
  venue: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  editors: z.array(z.string()).optional(),
  publicationPlace: z.string().optional(),
  publicationDate: z.string().optional(),
  accessedDate: z.string().optional(),
  articleNumber: z.string().optional(),
  issn: z.string().optional(),
  journalAbbreviation: z.string().optional(),
  pmid: z.string().optional(),
  pmcid: z.string().optional(),
  arxivId: z.string().optional(),
  abstract: z.string().optional(),
  sourceType: z.enum(['JOURNAL_ARTICLE', 'CONFERENCE_PAPER', 'BOOK', 'BOOK_CHAPTER', 'THESIS', 'REPORT', 'WEBSITE', 'PATENT', 'WORKING_PAPER', 'OTHER']).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pdfUrl: z.string().optional(),
  isRead: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { referenceId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Validate referenceId
    if (!params.referenceId || typeof params.referenceId !== 'string' || params.referenceId.trim() === '') {
      return NextResponse.json({ error: 'Invalid reference ID' }, { status: 400 });
    }

    const reference = await referenceLibraryService.getReference(user.id, params.referenceId);
    if (!reference) {
      return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
    }

    return NextResponse.json({ reference });
  } catch (err) {
    console.error('Library GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch reference' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { referenceId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Validate referenceId
    if (!params.referenceId || typeof params.referenceId !== 'string' || params.referenceId.trim() === '') {
      return NextResponse.json({ error: 'Invalid reference ID' }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    // Handle special actions
    if (body.action === 'toggleFavorite') {
      const reference = await referenceLibraryService.toggleFavorite(user.id, params.referenceId);
      return NextResponse.json({ reference });
    }

    if (body.action === 'toggleRead') {
      const reference = await referenceLibraryService.toggleRead(user.id, params.referenceId);
      return NextResponse.json({ reference });
    }

    const data = updateSchema.parse(body);
    const reference = await referenceLibraryService.updateReference(user.id, params.referenceId, data);

    return NextResponse.json({ reference });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: err.errors }, { status: 400 });
    }
    console.error('Library PUT error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update reference' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { referenceId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Validate referenceId
    if (!params.referenceId || typeof params.referenceId !== 'string' || params.referenceId.trim() === '') {
      return NextResponse.json({ error: 'Invalid reference ID' }, { status: 400 });
    }

    await referenceLibraryService.deleteReference(user.id, params.referenceId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Library DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete reference' },
      { status: 500 }
    );
  }
}

