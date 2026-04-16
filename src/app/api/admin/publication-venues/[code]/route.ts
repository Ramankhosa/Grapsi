import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  venueType: z.enum(['JOURNAL', 'CONFERENCE', 'BOOK_PUBLISHER']).optional(),
  citationStyleCode: z.string().min(1).optional(),
  acceptedPaperTypes: z.array(z.string()).optional(),
  sectionOverrides: z.record(z.unknown()).optional().nullable(),
  wordLimitOverrides: z.record(z.number()).optional().nullable(),
  formattingGuidelines: z.record(z.unknown()).optional().nullable(),
  impactFactor: z.number().min(0).optional().nullable(),
  ranking: z.number().int().min(1).optional().nullable(),
  website: z.string().url().optional().nullable(),
  submissionUrl: z.string().url().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional()
});

async function requireSuperAdmin(request: NextRequest) {
  const { user, error } = await authenticateUser(request);
  if (error || !user) {
    return { user: null, error: NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 }) };
  }

  if (!user.roles?.includes('SUPER_ADMIN')) {
    return { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user, error: null };
}

export async function GET(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Venue code is required' }, { status: 400 });
    }

    const venue = await prisma.publicationVenue.findUnique({
      where: { code },
      include: {
        citationStyle: {
          select: { code: true, name: true }
        }
      }
    });

    if (!venue) {
      return NextResponse.json({ error: 'Publication venue not found' }, { status: 404 });
    }

    return NextResponse.json({ venue });
  } catch (error) {
    console.error('[Admin PublicationVenues] GET by code error:', error);
    return NextResponse.json({ error: 'Failed to fetch publication venue' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Venue code is required' }, { status: 400 });
    }

    const existing = await prisma.publicationVenue.findUnique({
      where: { code }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Publication venue not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = updateSchema.parse(body);

    // If citation style code is provided, look it up
    let citationStyleId = existing.citationStyleId;
    if (data.citationStyleCode) {
      const citationStyle = await prisma.citationStyleDefinition.findUnique({
        where: { code: data.citationStyleCode.toUpperCase() }
      });

      if (!citationStyle) {
        return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
      }
      citationStyleId = citationStyle.id;
    }

    const venue = await prisma.publicationVenue.update({
      where: { code },
      data: {
        name: data.name,
        venueType: data.venueType,
        citationStyleId,
        acceptedPaperTypes: data.acceptedPaperTypes,
        sectionOverrides: data.sectionOverrides as Prisma.InputJsonValue,
        wordLimitOverrides: data.wordLimitOverrides as Prisma.InputJsonValue,
        formattingGuidelines: data.formattingGuidelines as Prisma.InputJsonValue,
        impactFactor: data.impactFactor,
        ranking: data.ranking,
        website: data.website,
        submissionUrl: data.submissionUrl,
        sortOrder: data.sortOrder,
        isActive: data.isActive
      },
      include: {
        citationStyle: {
          select: { code: true, name: true }
        }
      }
    });

    return NextResponse.json({ venue });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[Admin PublicationVenues] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update publication venue' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: { code: string } }) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Venue code is required' }, { status: 400 });
    }

    const existing = await prisma.publicationVenue.findUnique({
      where: { code }
    });

    if (!existing) {
      return NextResponse.json({ error: 'Publication venue not found' }, { status: 404 });
    }

    // Check if venue is being used by any sessions
    const usageCount = await prisma.draftingSession.count({
      where: { publicationVenueId: existing.id }
    });

    if (usageCount > 0) {
      return NextResponse.json({ 
        error: `Cannot delete venue: ${code} is being used by ${usageCount} sessions. Deactivate it instead.` 
      }, { status: 400 });
    }

    // Soft delete by setting inactive
    await prisma.publicationVenue.update({
      where: { code },
      data: { isActive: false }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin PublicationVenues] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete publication venue' }, { status: 500 });
  }
}

