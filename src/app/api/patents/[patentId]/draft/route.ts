import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DraftingService } from '@/lib/drafting-service';

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const payload = verifyJWT(token);
  if (!payload || !payload.email) {
    return null;
  }

  return payload.email;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request);
    if (!userEmail) {
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

    // Get drafting history
    const history = await DraftingService.getDraftingHistory(patentId, user.id);

    return NextResponse.json({ history });

  } catch (error) {
    console.error('GET /api/patents/[patentId]/draft error:', error);
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
      mode, // 'standalone' or 'with_novelty_assessment'
      assessmentId, // Required if mode is 'with_novelty_assessment'
      title,
      problem,
      solution,
      technicalFeatures,
      jurisdiction,
      filingType,
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
    if (!mode || !['standalone', 'with_novelty_assessment'].includes(mode)) {
      return NextResponse.json({
        error: 'Mode must be either "standalone" or "with_novelty_assessment"'
      }, { status: 400 });
    }

    if (mode === 'with_novelty_assessment' && !assessmentId) {
      return NextResponse.json({
        error: 'Assessment ID is required when mode is "with_novelty_assessment"'
      }, { status: 400 });
    }

    if (!title || !problem || !solution) {
      return NextResponse.json({
        error: 'Title, problem, and solution are required'
      }, { status: 400 });
    }

    // Validate word limits
    const totalWords = title.split(/\s+/).length +
                      problem.split(/\s+/).length +
                      solution.split(/\s+/).length;

    if (totalWords > 1000) { // Allow more words for detailed drafting
      return NextResponse.json({
        error: `Drafting input has ${totalWords} words, which exceeds the 1000 word limit`
      }, { status: 400 });
    }

    // If using novelty assessment, verify it exists and is completed
    if (mode === 'with_novelty_assessment') {
      const assessment = await prisma.noveltyAssessmentRun.findFirst({
        where: {
          id: assessmentId,
          patentId: patentId,
          userId: user.id,
        },
      });

      if (!assessment) {
        return NextResponse.json({
          error: 'Novelty assessment not found or access denied'
        }, { status: 404 });
      }

      if (!assessment.finalDetermination) {
        return NextResponse.json({
          error: 'Novelty assessment is not yet completed'
        }, { status: 400 });
      }
    }

    console.log(`✅ Starting ${mode} drafting for patent:`, patentId);

    // Execute drafting
    const authHeader = request.headers.get('authorization');
    const jwtToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';

    const result = await DraftingService.executeDrafting({
      patentId,
      jwtToken,
      mode,
      assessmentId: mode === 'with_novelty_assessment' ? assessmentId : undefined,
      title,
      problem,
      solution,
      technicalFeatures,
      jurisdiction,
      filingType,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    console.log('✅ Patent drafting completed:', result.draftId);

    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    console.error('POST /api/patents/[patentId]/draft error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
