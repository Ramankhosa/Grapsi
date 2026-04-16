import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperArchetypeService } from '@/lib/services/paper-archetype-service';

export const runtime = 'nodejs';

// ============================================================================
// Validation Schema - All Research Topic Fields
// ============================================================================

const topicSchema = z.object({
  // Basic Info
  title: z.string().min(1).max(500),
  field: z.string().max(200).optional().nullable(),
  subfield: z.string().max(200).optional().nullable(),
  topicDescription: z.string().max(5000).optional().nullable(),

  // Research Question
  researchQuestion: z.string().min(10).max(5000),
  subQuestions: z.array(z.string()).default([]),
  problemStatement: z.string().max(5000).optional().nullable(),
  researchGaps: z.string().max(5000).optional().nullable(),

  // Methodology
  methodology: z.enum([
    'QUALITATIVE',
    'QUANTITATIVE',
    'MIXED_METHODS',
    'THEORETICAL',
    'CASE_STUDY',
    'ACTION_RESEARCH',
    'EXPERIMENTAL',
    'SURVEY',
    'OTHER'
  ]).default('QUALITATIVE'),
  methodologyApproach: z.string().max(5000).optional().nullable(),
  techniques: z.array(z.string()).default([]),
  methodologyJustification: z.string().max(5000).optional().nullable(),

  // Data & Experimentation
  datasetDescription: z.string().max(5000).optional().nullable(),
  dataCollection: z.string().max(5000).optional().nullable(),
  sampleSize: z.string().max(200).optional().nullable(),
  tools: z.array(z.string()).default([]),
  experiments: z.string().max(5000).optional().nullable(),

  // Expected Outcomes
  hypothesis: z.string().max(5000).optional().nullable(),
  expectedResults: z.string().max(5000).optional().nullable(),
  contributionType: z.enum([
    'THEORETICAL',
    'EMPIRICAL',
    'METHODOLOGICAL',
    'APPLIED',
    'REVIEW',
    'CONCEPTUAL'
  ]).default('EMPIRICAL'),
  novelty: z.string().max(5000).optional().nullable(),
  limitations: z.string().max(5000).optional().nullable(),

  // Keywords & Abstract
  keywords: z.array(z.string()).default([]),
  abstractDraft: z.string().max(10000).optional().nullable()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: { researchTopic: true }
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

    // Debug: Log what we're returning
    const topic = session.researchTopic;
    if (topic) {
      console.log('[ResearchTopic] GET returning:', {
        id: topic.id,
        field: topic.field,
        subfield: topic.subfield,
        topicDescription: topic.topicDescription?.substring(0, 30),
        problemStatement: topic.problemStatement?.substring(0, 30),
        researchGaps: topic.researchGaps?.substring(0, 30),
      });
    }

    return NextResponse.json({ topic: session.researchTopic });
  } catch (error) {
    console.error('[ResearchTopic] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch research topic' }, { status: 500 });
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
    
    // Debug: Log what we received
    console.log('[ResearchTopic] PUT received fields:', {
      title: body.title?.substring(0, 30),
      field: body.field,
      subfield: body.subfield,
      topicDescription: body.topicDescription?.substring(0, 30),
      researchQuestion: body.researchQuestion?.substring(0, 30),
      problemStatement: body.problemStatement?.substring(0, 30),
      researchGaps: body.researchGaps?.substring(0, 30),
      methodology: body.methodology,
    });
    
    const data = topicSchema.parse(body);

    // Helper to convert empty strings to null
    const emptyToNull = (val: string | null | undefined): string | null => {
      if (val === null || val === undefined) return null;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    // Build the data object for all fields
    const topicData = {
      // Basic Info
      title: data.title.trim(),
      field: emptyToNull(data.field),
      subfield: emptyToNull(data.subfield),
      topicDescription: emptyToNull(data.topicDescription),

      // Research Question
      researchQuestion: data.researchQuestion.trim(),
      subQuestions: (data.subQuestions || []).filter(q => q.trim().length > 0),
      problemStatement: emptyToNull(data.problemStatement),
      researchGaps: emptyToNull(data.researchGaps),

      // Methodology
      methodology: data.methodology,
      methodologyApproach: emptyToNull(data.methodologyApproach),
      techniques: (data.techniques || []).filter(t => t.trim().length > 0),
      methodologyJustification: emptyToNull(data.methodologyJustification),

      // Data & Experimentation
      datasetDescription: emptyToNull(data.datasetDescription),
      dataCollection: emptyToNull(data.dataCollection),
      sampleSize: emptyToNull(data.sampleSize),
      tools: (data.tools || []).filter(t => t.trim().length > 0),
      experiments: emptyToNull(data.experiments),

      // Expected Outcomes
      hypothesis: emptyToNull(data.hypothesis),
      expectedResults: emptyToNull(data.expectedResults),
      contributionType: data.contributionType,
      novelty: emptyToNull(data.novelty),
      limitations: emptyToNull(data.limitations),

      // Keywords & Abstract
      keywords: (data.keywords || []).filter(k => k.trim().length > 0),
      abstractDraft: emptyToNull(data.abstractDraft)
    };

    const topic = await prisma.researchTopic.upsert({
      where: { sessionId },
      update: topicData,
      create: {
        sessionId,
        ...topicData
      }
    });

    // Debug: Log what was saved
    console.log('[ResearchTopic] Saved to DB:', {
      id: topic.id,
      field: topic.field,
      subfield: topic.subfield,
      topicDescription: topic.topicDescription?.substring(0, 30),
      problemStatement: topic.problemStatement?.substring(0, 30),
      researchGaps: topic.researchGaps?.substring(0, 30),
    });

    await prisma.draftingHistory.create({
      data: {
        sessionId,
        action: 'RESEARCH_TOPIC_UPDATED',
        userId: user.id,
        stage: session.status,
        newData: {
          title: topic.title,
          field: topic.field,
          researchQuestion: topic.researchQuestion,
          methodology: topic.methodology,
          contributionType: topic.contributionType,
          keywordsCount: topic.keywords.length
        }
      }
    });

    let archetypeDetection: Awaited<ReturnType<typeof paperArchetypeService.detectAndPersist>> | null = null;
    try {
      const headers = Object.fromEntries(request.headers.entries());
      archetypeDetection = await paperArchetypeService.detectAndPersist({
        sessionId,
        headers,
        userId: user.id,
        source: 'TOPIC_SAVE'
      });
    } catch (detectError) {
      console.error('[ResearchTopic] Archetype detection failed:', detectError);
    }

    return NextResponse.json({ topic, archetypeDetection });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    console.error('[ResearchTopic] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update research topic' }, { status: 500 });
  }
}
