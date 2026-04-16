import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    const venues = await prisma.publicationVenue.findMany({
      where: {
        isActive: true,
        ...(type ? { venueType: type.toUpperCase() as any } : {})
      },
      include: {
        citationStyle: true
      },
      orderBy: { sortOrder: 'asc' }
    });

    const response = venues.map(venue => ({
      code: venue.code,
      name: venue.name,
      venueType: venue.venueType,
      acceptedPaperTypes: venue.acceptedPaperTypes,
      citationStyle: {
        code: venue.citationStyle.code,
        name: venue.citationStyle.name
      },
      sectionOverrides: venue.sectionOverrides,
      wordLimitOverrides: venue.wordLimitOverrides,
      formattingGuidelines: venue.formattingGuidelines,
      impactFactor: venue.impactFactor,
      ranking: venue.ranking,
      website: venue.website,
      submissionUrl: venue.submissionUrl
    }));

    return NextResponse.json({ venues: response });
  } catch (error) {
    console.error('[PublicationVenues] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch publication venues' }, { status: 500 });
  }
}
