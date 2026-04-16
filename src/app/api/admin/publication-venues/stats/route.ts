import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    if (!user.roles?.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Count venues by type
    const [total, journals, conferences, bookPublishers] = await Promise.all([
      prisma.publicationVenue.count({ where: { isActive: true } }),
      prisma.publicationVenue.count({ where: { isActive: true, venueType: 'JOURNAL' } }),
      prisma.publicationVenue.count({ where: { isActive: true, venueType: 'CONFERENCE' } }),
      prisma.publicationVenue.count({ where: { isActive: true, venueType: 'BOOK_PUBLISHER' } })
    ]);

    return NextResponse.json({
      stats: {
        total,
        journals,
        conferences,
        bookPublishers
      }
    });
  } catch (error) {
    console.error('[PublicationVenues Stats] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch venue stats' }, { status: 500 });
  }
}

