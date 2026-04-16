import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NoveltyAssessmentService } from '@/lib/novelty-assessment';

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
  { params }: { params: { patentId: string; assessmentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request);
    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patentId, assessmentId } = params;

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

    // Verify assessment belongs to this patent and user
    const assessment = await prisma.noveltyAssessmentRun.findFirst({
      where: {
        id: assessmentId,
        patentId: patentId,
        userId: user.id,
      },
    });

    if (!assessment) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
    }

    // Get detailed assessment results
    const result = await NoveltyAssessmentService.getAssessment(assessmentId, user.id);

    return NextResponse.json(result);

  } catch (error) {
    console.error('GET /api/patents/[patentId]/novelty-assessment/[assessmentId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
