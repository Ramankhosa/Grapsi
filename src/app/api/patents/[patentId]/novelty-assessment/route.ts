import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NoveltyAssessmentService } from '@/lib/novelty-assessment';

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No auth header or not Bearer token');
    return null;
  }

  const token = authHeader.substring(7);
  console.log('Token received:', token.substring(0, 20) + '...');
  const payload = verifyJWT(token);
  console.log('JWT payload:', payload);
  if (!payload || !payload.email) {
    console.log('Invalid payload or missing email');
    return null;
  }

  return payload.email;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    console.log('GET /api/patents/[patentId]/novelty-assessment called');
    const userEmail = await getUserFromRequest(request);
    console.log('User email from token:', userEmail);
    if (!userEmail) {
      console.log('No user email, returning 401');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patentId } = params;

    // Get user details
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: user.id },
          {
            project: {
              OR: [
                { userId: user.id },
                { collaborators: { some: { userId: user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 });
    }

    // Get all novelty assessments for this patent
    const assessments = await NoveltyAssessmentService.getPatentAssessments(patentId, user.id);

    return NextResponse.json({ assessments });

  } catch (error) {
    console.error('GET /api/patents/[patentId]/novelty-assessment error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request);
    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patentId } = params;
    const body = await request.json();
    const {
      runId, // Optional link to prior art run
      inventionSummary,
      intersectingPatents
    } = body;

    // Get user details
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: user.id },
          {
            project: {
              OR: [
                { userId: user.id },
                { collaborators: { some: { userId: user.id } } }
              ]
            }
          }
        ]
      }
    });

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 });
    }

    // Validate input
    if (!inventionSummary || typeof inventionSummary !== 'object') {
      return NextResponse.json({ error: 'Invention summary is required' }, { status: 400 });
    }

    if (!inventionSummary.title || !inventionSummary.problem || !inventionSummary.solution) {
      return NextResponse.json({
        error: 'Invention summary must include title, problem, and solution'
      }, { status: 400 });
    }

    if (!Array.isArray(intersectingPatents) || intersectingPatents.length === 0) {
      return NextResponse.json({ error: 'Intersecting patents array is required' }, { status: 400 });
    }

    // Validate intersecting patents format
    for (const patent of intersectingPatents) {
      if (!patent.publicationNumber || !patent.title || !patent.abstract) {
        return NextResponse.json({
          error: 'Each intersecting patent must have publicationNumber, title, and abstract'
        }, { status: 400 });
      }
    }

    // Validate word limits
    const totalWords = inventionSummary.title.split(/\s+/).length +
                      inventionSummary.problem.split(/\s+/).length +
                      inventionSummary.solution.split(/\s+/).length;

    if (totalWords > 500) { // Allow more words for complete summary
      return NextResponse.json({
        error: `Invention summary has ${totalWords} words, which exceeds the 500 word limit`
      }, { status: 400 });
    }

    // If runId provided, verify it exists and belongs to this patent
    if (runId) {
      const run = await prisma.priorArtRun.findFirst({
        where: {
          id: runId,
          bundle: {
            patentId: patentId
          }
        }
      });

      if (!run) {
        return NextResponse.json({
          error: 'Prior art run not found or does not belong to this patent'
        }, { status: 404 });
      }
    }

    console.log('✅ Starting novelty assessment for patent:', patentId);

    // Start the novelty assessment
    const authHeader = request.headers.get('authorization');
    const jwtToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';

    const result = await NoveltyAssessmentService.startAssessment({
      patentId,
      runId,
      jwtToken,
      inventionSummary,
      intersectingPatents,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    console.log('✅ Novelty assessment completed:', result.assessmentId);

    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    console.error('POST /api/patents/[patentId]/novelty-assessment error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
