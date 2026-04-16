import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: { code: string } }) {
  try {
    const code = context.params.code?.toUpperCase();
    if (!code) {
      return NextResponse.json({ error: 'Venue code is required' }, { status: 400 });
    }

    const venue = await prisma.publicationVenue.findUnique({
      where: { code },
      include: { citationStyle: true }
    });

    if (!venue || !venue.isActive) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    return NextResponse.json({
      venue: {
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
      }
    });
  } catch (error) {
    console.error('[PublicationVenues] GET by code error:', error);
    return NextResponse.json({ error: 'Failed to fetch venue' }, { status: 500 });
  }
}
