import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || !query.trim()) {
      return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
    }

    const venues = await prisma.publicationVenue.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { code: { contains: query, mode: 'insensitive' } }
        ]
      },
      include: { citationStyle: true },
      orderBy: { sortOrder: 'asc' }
    });

    const response = venues.map(venue => ({
      code: venue.code,
      name: venue.name,
      venueType: venue.venueType,
      citationStyle: {
        code: venue.citationStyle.code,
        name: venue.citationStyle.name
      },
      acceptedPaperTypes: venue.acceptedPaperTypes,
      impactFactor: venue.impactFactor,
      ranking: venue.ranking
    }));

    return NextResponse.json({ venues: response });
  } catch (error) {
    console.error('[PublicationVenues] search error:', error);
    return NextResponse.json({ error: 'Failed to search venues' }, { status: 500 });
  }
}
