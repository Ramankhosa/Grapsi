import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

const venueSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  venueType: z.enum(['JOURNAL', 'CONFERENCE', 'BOOK_PUBLISHER']),
  citationStyleCode: z.string().min(1),
  acceptedPaperTypes: z.array(z.string()).default([]),
  sectionOverrides: z.record(z.unknown()).optional(),
  wordLimitOverrides: z.record(z.number()).optional(),
  formattingGuidelines: z.record(z.unknown()).optional(),
  impactFactor: z.number().min(0).optional(),
  ranking: z.number().int().min(1).optional(),
  website: z.string().url().optional(),
  submissionUrl: z.string().url().optional(),
  sortOrder: z.number().int().optional()
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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const type = searchParams.get('type')?.toUpperCase();

    const where: Record<string, unknown> = {};
    if (!includeInactive) {
      where.isActive = true;
    }
    if (type && ['JOURNAL', 'CONFERENCE', 'BOOK_PUBLISHER'].includes(type)) {
      where.venueType = type;
    }

    const venues = await prisma.publicationVenue.findMany({
      where,
      include: {
        citationStyle: {
          select: { code: true, name: true }
        }
      },
      orderBy: { sortOrder: 'asc' }
    });

    return NextResponse.json({ venues });
  } catch (error) {
    console.error('[Admin PublicationVenues] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch publication venues' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSuperAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const data = venueSchema.parse(body);

    // Check if code already exists
    const existing = await prisma.publicationVenue.findUnique({
      where: { code: data.code.toUpperCase() }
    });

    if (existing) {
      return NextResponse.json({ error: 'Publication venue with this code already exists' }, { status: 400 });
    }

    // Find citation style by code
    const citationStyle = await prisma.citationStyleDefinition.findUnique({
      where: { code: data.citationStyleCode.toUpperCase() }
    });

    if (!citationStyle) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }

    const venue = await prisma.publicationVenue.create({
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        venueType: data.venueType,
        citationStyleId: citationStyle.id,
        acceptedPaperTypes: data.acceptedPaperTypes,
        sectionOverrides: data.sectionOverrides as Prisma.InputJsonValue,
        wordLimitOverrides: data.wordLimitOverrides as Prisma.InputJsonValue,
        formattingGuidelines: data.formattingGuidelines as Prisma.InputJsonValue,
        impactFactor: data.impactFactor,
        ranking: data.ranking,
        website: data.website,
        submissionUrl: data.submissionUrl,
        sortOrder: data.sortOrder ?? 0
      },
      include: {
        citationStyle: {
          select: { code: true, name: true }
        }
      }
    });

    return NextResponse.json({ venue }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[Admin PublicationVenues] POST error:', error);
    return NextResponse.json({ error: 'Failed to create publication venue' }, { status: 500 });
  }
}

