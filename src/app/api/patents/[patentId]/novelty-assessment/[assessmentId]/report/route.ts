import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NoveltyAssessmentStatus } from '@prisma/client';

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

    // Check if assessment is completed
    if (assessment.status !== NoveltyAssessmentStatus.NOVEL &&
        assessment.status !== NoveltyAssessmentStatus.NOT_NOVEL &&
        assessment.status !== NoveltyAssessmentStatus.DOUBT_RESOLVED) {
      return NextResponse.json({
        error: 'Report is not available. Assessment is still in progress.'
      }, { status: 400 });
    }

    // PDF generation has been replaced with browser print functionality
    // Users should now use the "Download Official Report" button in the consolidated report
    // which will open the browser's print dialog for saving as PDF
    return NextResponse.json({
      error: 'PDF generation is no longer available via this endpoint. Please use the "Download Official Report" button in the consolidated report view, which will open your browser\'s print dialog to save the report as PDF.',
      message: 'Use browser print functionality instead'
    }, { status: 410 }); // 410 Gone - resource no longer available

  } catch (error) {
    console.error('GET /api/patents/[patentId]/novelty-assessment/[assessmentId]/report error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
