import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService } from '@/lib/novelty-search-service';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const noveltySearchService = new NoveltySearchService();

// Force dynamic rendering since we access request headers and url
export const dynamic = 'force-dynamic';

/**
 * GET /api/novelty-search/history
 * Get novelty search history for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);

    // Validate user from JWT token
    const payload = verifyJWT(jwtToken);
    if (!payload || !payload.sub) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, tenantId: true, noveltySearchesCompleted: true }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get search history
    const history = await noveltySearchService.getNoveltySearchHistory(user.id, projectId || undefined);

    return NextResponse.json({
      success: true,
      history,
      userStats: {
        totalSearches: user.noveltySearchesCompleted,
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error('Novelty search history API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
