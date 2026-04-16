import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService, NoveltySearchRequest } from '../../../lib/novelty-search-service';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { enforceServiceAccess } from '@/lib/service-access-middleware';

const noveltySearchService = new NoveltySearchService();

/**
 * POST /api/novelty-search
 * Start a new novelty search
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      patentId,
      projectId,
      inventionDescription,
      title,
      jurisdiction = 'IN',
      config
    } = body;

    if (!inventionDescription || !title) {
      return NextResponse.json(
        { error: 'inventionDescription and title are required' },
        { status: 400 }
      );
    }

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);

    // Check organizational service access (Tenant Admin controlled)
    const payload = verifyJWT(jwtToken);
    if (payload?.sub) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, tenantId: true }
      });
      if (user?.tenantId) {
        const serviceCheck = await enforceServiceAccess(user.id, user.tenantId, 'NOVELTY_SEARCH');
        if (!serviceCheck.allowed) {
          return serviceCheck.response;
        }
      }
    }

    const searchRequest: NoveltySearchRequest = {
      patentId,
      projectId,
      jwtToken,
      inventionDescription,
      title,
      jurisdiction,
      config
    };

    const result = await noveltySearchService.startNoveltySearch(searchRequest);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      searchId: result.searchId,
      status: result.status,
      currentStage: result.currentStage,
      results: result.results
    });

  } catch (error) {
    console.error('Novelty search API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
