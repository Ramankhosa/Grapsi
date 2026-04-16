import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService } from '@/lib/novelty-search-service';
import { verifyJWT } from '@/lib/auth';
import { NoveltySearchStage } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// Allow longer-running LLM gating without platform timeouts (defaults are often too low)
export const maxDuration = 300;

const noveltySearchService = new NoveltySearchService();

/**
 * POST /api/novelty-search/[searchId]/stage/[stageNumber]
 * Execute a specific stage of the novelty search
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { searchId: string; stageNumber: string } }
) {
  try {
    const { searchId, stageNumber } = params;

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    console.log('Authorization header received:', authHeader ? `${authHeader.substring(0, 20)}...` : 'null/undefined');

    if (!authHeader) {
      console.log('No authorization header found');
      return NextResponse.json(
        { error: 'Authorization header missing' },
        { status: 401 }
      );
    }

    if (!authHeader.startsWith('Bearer ')) {
      console.log('Authorization header does not start with Bearer:', authHeader.substring(0, 20));
      return NextResponse.json(
        { error: 'Authorization token must start with Bearer' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);
    console.log('Extracted JWT token length:', jwtToken ? jwtToken.length : 0);

    if (!jwtToken || jwtToken.trim() === '') {
      console.log('JWT token is empty after extraction');
      return NextResponse.json(
        { error: 'JWT token is empty' },
        { status: 401 }
      );
    }

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
      select: { id: true, email: true, name: true, tenantId: true }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = user.id;

    // Extract request headers for LLM gateway
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    let result;

    // Optional request body (used by stage 3.5a for selected publications)
    let body: any = null;
    try {
      if (request.headers.get('content-type')?.includes('application/json')) {
        body = await request.json();
      }
    } catch (e) {
      // ignore body parse errors; not required for all stages
    }

    // Execute the appropriate stage
  switch (stageNumber) {
    case '1':
      result = await noveltySearchService.executeStage1(searchId, userId, requestHeaders);
      break;
    case '1.5':
      result = await noveltySearchService.executeStage15(searchId, userId, requestHeaders);
      break;
    case '3.5':
      // Combined Stage 3.5 (3.5a + 3.5b)
      result = await noveltySearchService.executeStage35(searchId, userId, requestHeaders);
      break;
    case '3.5a':
      console.log('[Stage3.5a][API] Body keys:', body ? Object.keys(body) : 'no body');
      console.log('[Stage3.5a][API] selectedPublicationNumbers length:', Array.isArray(body?.selectedPublicationNumbers) ? body.selectedPublicationNumbers.length : 'n/a');
      result = await noveltySearchService.executeStage35a(
        searchId,
          userId,
          requestHeaders,
          Array.isArray(body?.selectedPublicationNumbers) ? body.selectedPublicationNumbers : undefined
        );
        break;
      case '3.5b':
        result = await noveltySearchService.executeStage35b(searchId, userId, requestHeaders);
        break;
      case '3.5c':
        // Stage 3.5c generates per-patent remarks - now enabled for enhanced reports
        result = await noveltySearchService.executeStage35c(searchId, userId, requestHeaders);
        break;
      case '4':
        result = await noveltySearchService.executeStage4(searchId, userId, requestHeaders);
        break;
      default:
        return NextResponse.json({
          error: 'Invalid stage number. Valid stages: 1, 1.5, 3.5, 3.5a, 3.5b, 3.5c, 4'
        }, { status: 400 });
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      searchId,
      status: result.status,
      currentStage: result.currentStage,
      results: result.results
    });

  } catch (error) {
    console.error('Stage execution API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
