import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';

const INTERNAL_SECTION_FIELDS = [
  'baseContentInternal', 'baseMemory',
  'pass1PromptUsed', 'pass1LlmResponse', 'pass1TokensUsed',
  'pass2PromptUsed', 'promptUsed', 'llmResponse',
] as const;

const HIDE_CONTENT_STATUSES = new Set(['PREPARING', 'BASE_READY', 'POLISHING', 'REGENERATING']);

function sanitizePaperSections(session: any) {
  if (!session?.paperSections || !Array.isArray(session.paperSections)) return session;
  return {
    ...session,
    paperSections: session.paperSections.map((s: any) => {
      const clean = { ...s };
      for (const key of INTERNAL_SECTION_FIELDS) delete clean[key];
      if (HIDE_CONTENT_STATUSES.has(String(clean.status || ''))) {
        clean.content = '';
        clean.wordCount = 0;
      }
      return clean;
    }),
  };
}

export const runtime = 'nodejs';

const updateSchema = z.object({
  paperTypeCode: z.string().max(64).optional(),
  citationStyleCode: z.string().max(64).optional(),
  publicationVenueCode: z.string().max(64).optional(),
  targetWordCount: z.number().int().positive().optional(),
  literatureReviewStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']).optional()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      paperType: true,
      citationStyle: true,
      publicationVenue: true,
      researchTopic: true,
      citations: true,
      deepAnalysisJobs: {
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { cards: true }
          }
        }
      },
      annexureDrafts: true,
      figurePlans: true,
      paperBlueprint: true,
      aiReviews: {
        where: {
          jurisdiction: 'PAPER'
        },
        orderBy: {
          reviewedAt: 'desc'
        },
        take: 10
      },
      paperSections: {
        orderBy: { updatedAt: 'desc' }
      },
      paperSectionHumanizations: {
        select: {
          sectionKey: true,
          status: true,
          humanizedContent: true,
          sourceDraftFingerprint: true,
          updatedAt: true
        }
      }
    }
  });
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    return NextResponse.json({ session: sanitizePaperSections(session) });
  } catch (error) {
    console.error('[PaperSession] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch paper session' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const body = await request.json();
    const data = updateSchema.parse(body);

    const paperType = data.paperTypeCode
      ? await prisma.paperTypeDefinition.findUnique({ where: { code: data.paperTypeCode.toUpperCase() } })
      : null;

    const citationStyle = data.citationStyleCode
      ? await prisma.citationStyleDefinition.findUnique({ where: { code: data.citationStyleCode.toUpperCase() } })
      : null;

    const venue = data.publicationVenueCode
      ? await prisma.publicationVenue.findUnique({ where: { code: data.publicationVenueCode.toUpperCase() } })
      : null;

    if (data.paperTypeCode && !paperType) {
      return NextResponse.json({ error: 'Paper type not found' }, { status: 404 });
    }

    if (data.citationStyleCode && !citationStyle) {
      return NextResponse.json({ error: 'Citation style not found' }, { status: 404 });
    }

    if (data.publicationVenueCode && !venue) {
      return NextResponse.json({ error: 'Publication venue not found' }, { status: 404 });
    }

    const citationStyleId = citationStyle
      ? citationStyle.id
      : venue
        ? venue.citationStyleId
        : session.citationStyleId;

    const updated = await prisma.draftingSession.update({
      where: { id: sessionId },
      data: {
        paperTypeId: paperType ? paperType.id : session.paperTypeId,
        citationStyleId,
        publicationVenueId: venue ? venue.id : session.publicationVenueId,
        targetWordCount: data.targetWordCount ?? session.targetWordCount,
        literatureReviewStatus: data.literatureReviewStatus ?? session.literatureReviewStatus
      },
      include: {
        paperType: true,
        citationStyle: true,
        publicationVenue: true,
        researchTopic: true,
        citations: true,
        deepAnalysisJobs: {
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: { cards: true }
            }
          }
        },
        figurePlans: true,
        aiReviews: {
          where: {
            jurisdiction: 'PAPER'
          },
          orderBy: {
            reviewedAt: 'desc'
          },
          take: 10
        },
        paperSections: {
          orderBy: { updatedAt: 'desc' }
        },
        paperSectionHumanizations: {
          select: {
            sectionKey: true,
            status: true,
            humanizedContent: true,
            sourceDraftFingerprint: true,
            updatedAt: true
          }
        }
      }
    });

    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'PAPER_SETTINGS_UPDATED',
        userId: user.id,
        stage: session.status,
        newData: {
          paperTypeId: updated.paperTypeId,
          citationStyleId: updated.citationStyleId,
          publicationVenueId: updated.publicationVenueId,
          targetWordCount: updated.targetWordCount,
          literatureReviewStatus: updated.literatureReviewStatus
        }
      }
    });

    return NextResponse.json({ session: sanitizePaperSections(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[PaperSession] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update paper session' }, { status: 500 });
  }
}
