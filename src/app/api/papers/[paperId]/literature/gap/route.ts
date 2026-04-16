import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { llmGateway } from '@/lib/metering/gateway';
import { citationService } from '@/lib/services/citation-service';
import { featureFlags } from '@/lib/feature-flags';
import { buildLiteratureGapPrompt } from '@/lib/prompts/paper-literature-prompts';

export const runtime = 'nodejs';

const gapSchema = z.object({
  citationKeys: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(50).optional()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({
      where: { id: sessionId },
      include: { paperType: true }
    });
  }

  return prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id
    },
    include: { paperType: true }
  });
}

function parseJsonOutput(output: string): any | null {
  let jsonText = (output || '').trim();
  if (!jsonText) return null;

  const fenceStart = jsonText.indexOf('```');
  if (fenceStart !== -1) {
    jsonText = jsonText.slice(fenceStart + 3);
    jsonText = jsonText.replace(/^json\s*/i, '');
    const fenceEnd = jsonText.indexOf('```');
    if (fenceEnd !== -1) {
      jsonText = jsonText.slice(0, fenceEnd);
    }
  }

  const startBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (startBrace !== -1 && lastBrace !== -1 && lastBrace > startBrace) {
    jsonText = jsonText.slice(startBrace, lastBrace + 1);
  }

  jsonText = jsonText
    .replace(/`+/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([\x00-\x08\x0B\x0C\x0E-\x1F])/g, '');

  try {
    return JSON.parse(jsonText);
  } catch {
    try {
      const quotedKeys = jsonText.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
      return JSON.parse(quotedKeys);
    } catch {
      return null;
    }
  }
}

export async function POST(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    if (!featureFlags.isEnabled('ENABLE_LITERATURE_SEARCH')) {
      return NextResponse.json({ error: 'Literature search is not enabled' }, { status: 403 });
    }

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
    const payload = gapSchema.parse(body);

    const citations = await citationService.getCitationsForSession(sessionId);
    const filtered = payload.citationKeys
      ? citations.filter(citation => payload.citationKeys!.includes(citation.citationKey))
      : citations;

    if (filtered.length === 0) {
      return NextResponse.json({ error: 'No citations available for analysis' }, { status: 400 });
    }

    const limit = payload.limit ?? 25;
    const trimmed = filtered.slice(0, limit);

    const topic = await prisma.researchTopic.findUnique({
      where: { sessionId }
    });

    const prompt = buildLiteratureGapPrompt(
      trimmed.map(citation => ({
        citationKey: citation.citationKey,
        title: citation.title,
        authors: citation.authors,
        year: citation.year,
        venue: citation.venue,
        abstract: citation.notes || null
      })),
      {
        researchQuestion: topic?.researchQuestion || null,
        title: topic?.title || null,
        methodology: topic?.methodology || null,
        contributionType: topic?.contributionType || null
      }
    );

    const headers = Object.fromEntries(request.headers.entries());
    const llmRequest = {
      taskCode: 'LLM2_DRAFT' as const,
      stageCode: 'PAPER_LITERATURE_GAP',
      prompt,
      parameters: { temperature: 0.3 },
      idempotencyKey: crypto.randomUUID(),
      metadata: {
        sessionId,
        paperId: sessionId, // Paper ID for cost tracking
        citationCount: trimmed.length,
        action: 'analyze_literature_gap',
        module: 'publication_ideation' // Module identifier for cost reports
      }
    };

    const result = await llmGateway.executeLLMOperation({ headers }, llmRequest);
    if (!result.success || !result.response) {
      return NextResponse.json({ error: result.error?.message || 'Gap analysis failed' }, { status: 500 });
    }

    const parsed = parseJsonOutput(result.response.output || '');
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    return NextResponse.json({
      analysis: parsed,
      citationCount: filtered.length,
      usedCitations: trimmed.length,
      truncated: filtered.length > trimmed.length
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[LiteratureGap] error:', error);
    return NextResponse.json({ error: 'Failed to analyze literature' }, { status: 500 });
  }
}
