import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';
import { paperLibraryService } from '@/lib/services/paper-library-service';

export const runtime = 'nodejs';

const schema = z.object({
  bibtex: z.string().min(1)
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({ where });
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

    const body = await request.json();
    const data = schema.parse(body);

    const citations = await citationService.importFromBibTeX(sessionId, data.bibtex);

    if (citations.length > 0) {
      try {
        await paperLibraryService.syncCitationsToLibraryAndCollection(user.id, sessionId, citations);
      } catch (syncError) {
        console.warn('[Citations][BibTeX] Failed to sync citations to paper library collection:', syncError);
      }
    }

    return NextResponse.json({ citations }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to import BibTeX';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
