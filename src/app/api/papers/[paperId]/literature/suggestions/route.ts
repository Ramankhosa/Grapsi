import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { featureFlags } from '@/lib/feature-flags';

export const runtime = 'nodejs';

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ where: { id: sessionId } });
  }

  return prisma.draftingSession.findFirst({
    where: {
      id: sessionId,
      userId: user.id
    }
  });
}

function buildSuggestions(topic: any): string[] {
  const suggestions: string[] = [];

  if (topic?.researchQuestion) {
    suggestions.push(topic.researchQuestion);
  }

  if (topic?.title) {
    suggestions.push(topic.title);
  }

  const keywords = Array.isArray(topic?.keywords) ? topic.keywords.filter(Boolean) : [];
  if (keywords.length > 0) {
    suggestions.push(keywords.join(' '));
    if (keywords.length >= 3) {
      suggestions.push(keywords.slice(0, 3).join(' '));
    }
  }

  if (topic?.datasetDescription) {
    suggestions.push(`${topic.datasetDescription} methodology`);
  }

  if (topic?.abstractDraft) {
    suggestions.push(topic.abstractDraft.split('.').slice(0, 1).join('.').trim());
  }

  return Array.from(new Set(suggestions.filter(s => s && s.trim().length > 0)));
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
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

    const topic = await prisma.researchTopic.findUnique({
      where: { sessionId }
    });

    if (!topic) {
      return NextResponse.json({ suggestions: [] });
    }

    const suggestions = buildSuggestions(topic);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[LiteratureSuggestions] GET error:', error);
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 });
  }
}
