/**
 * Citation Abstract Management API
 * GET - Search for abstract from external sources
 * PUT - Update/add abstract manually
 * POST - Extract abstract from pasted text
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { abstractEnrichmentService } from '@/lib/services/abstract-enrichment-service';

const updateAbstractSchema = z.object({
  abstract: z.string().min(10).max(10000),
  source: z.string().optional(), // Where the abstract came from
});

const extractAbstractSchema = z.object({
  text: z.string().min(50), // Pasted text from PDF or webpage
});

// GET: Search for abstract from external sources
export async function GET(
  request: NextRequest,
  { params }: { params: { paperId: string; citationId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Verify citation ownership
    const citation = await prisma.citation.findFirst({
      where: {
        id: params.citationId,
        session: { id: params.paperId, userId: user.id },
      },
    });

    if (!citation) {
      return NextResponse.json({ error: 'Citation not found' }, { status: 404 });
    }

    // Search for abstract
    const result = await abstractEnrichmentService.enrichCitation({
      doi: citation.doi || undefined,
      title: citation.title,
      authors: citation.authors,
    });

    return NextResponse.json({
      found: result.found,
      abstracts: result.abstracts,
      currentAbstract: citation.abstract,
      errors: result.errors,
    });
  } catch (err) {
    console.error('Abstract search error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to search for abstract' },
      { status: 500 }
    );
  }
}

// PUT: Update abstract manually
export async function PUT(
  request: NextRequest,
  { params }: { params: { paperId: string; citationId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Verify citation ownership
    const citation = await prisma.citation.findFirst({
      where: {
        id: params.citationId,
        session: { id: params.paperId, userId: user.id },
      },
    });

    if (!citation) {
      return NextResponse.json({ error: 'Citation not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = updateAbstractSchema.parse(body);

    // Update the citation with the abstract
    const updated = await prisma.citation.update({
      where: { id: params.citationId },
      data: {
        abstract: data.abstract,
        notes: data.source
          ? `${citation.notes || ''}\n[Abstract source: ${data.source}]`.trim()
          : citation.notes,
      },
    });

    return NextResponse.json({
      citation: updated,
      message: 'Abstract updated successfully',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid abstract data', details: err.errors }, { status: 400 });
    }
    console.error('Abstract update error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update abstract' },
      { status: 500 }
    );
  }
}

// POST: Extract abstract from pasted text
export async function POST(
  request: NextRequest,
  { params }: { params: { paperId: string; citationId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    // Verify citation ownership
    const citation = await prisma.citation.findFirst({
      where: {
        id: params.citationId,
        session: { id: params.paperId, userId: user.id },
      },
    });

    if (!citation) {
      return NextResponse.json({ error: 'Citation not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = extractAbstractSchema.parse(body);

    // Try to extract abstract from the text
    const extracted = abstractEnrichmentService.extractAbstractFromText(data.text);

    if (!extracted) {
      // If pattern matching fails, return the cleaned text as-is
      // (user may have copied just the abstract)
      const cleaned = abstractEnrichmentService.cleanAbstractText(data.text);
      
      return NextResponse.json({
        extracted: false,
        suggestedAbstract: cleaned.length > 50 && cleaned.length < 5000 ? cleaned : null,
        message: 'Could not auto-detect abstract boundaries. Please review the text.',
      });
    }

    return NextResponse.json({
      extracted: true,
      suggestedAbstract: extracted,
      message: 'Abstract extracted successfully. Please review before saving.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid text data', details: err.errors }, { status: 400 });
    }
    console.error('Abstract extraction error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to extract abstract' },
      { status: 500 }
    );
  }
}

