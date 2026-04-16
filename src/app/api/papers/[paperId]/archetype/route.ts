import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperArchetypeService } from '@/lib/services/paper-archetype-service';

export const runtime = 'nodejs';

const topicOverrideSchema = z.object({
  title: z.string().optional().nullable(),
  field: z.string().optional().nullable(),
  subfield: z.string().optional().nullable(),
  topicDescription: z.string().optional().nullable(),
  researchQuestion: z.string().optional().nullable(),
  subQuestions: z.array(z.string()).optional(),
  problemStatement: z.string().optional().nullable(),
  researchGaps: z.string().optional().nullable(),
  methodology: z.string().optional().nullable(),
  methodologyApproach: z.string().optional().nullable(),
  techniques: z.array(z.string()).optional(),
  datasetDescription: z.string().optional().nullable(),
  dataCollection: z.string().optional().nullable(),
  sampleSize: z.string().optional().nullable(),
  tools: z.array(z.string()).optional(),
  experiments: z.string().optional().nullable(),
  hypothesis: z.string().optional().nullable(),
  expectedResults: z.string().optional().nullable(),
  contributionType: z.string().optional().nullable(),
  novelty: z.string().optional().nullable(),
  limitations: z.string().optional().nullable(),
  keywords: z.array(z.string()).optional(),
  abstractDraft: z.string().optional().nullable()
});

const postSchema = z.object({
  force: z.boolean().optional().default(true),
  topic: topicOverrideSchema.optional(),
  helperNotes: z.record(z.any()).optional().nullable()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    select: { id: true }
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

    const archetype = await paperArchetypeService.getSessionArchetype(sessionId);
    return NextResponse.json({
      success: true,
      archetypeDetection: archetype
    });
  } catch (err) {
    console.error('[PaperArchetype] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch archetype status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
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

    const body = await request.json().catch(() => ({}));
    const payload = postSchema.parse(body);
    const headers = Object.fromEntries(request.headers.entries());

    const result = await paperArchetypeService.detectAndPersist({
      sessionId,
      headers,
      userId: user.id,
      source: 'MANUAL',
      force: payload.force,
      topicOverride: payload.topic,
      helperNotes: payload.helperNotes
    });

    return NextResponse.json({
      success: true,
      archetypeDetection: result
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[PaperArchetype] POST error:', err);
    return NextResponse.json({ error: 'Failed to detect archetype' }, { status: 500 });
  }
}
