import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';
import type { CitationData } from '@/lib/services/citation-style-service';
import { exportCitationsToBibtex } from '@/lib/export/bibtex-export';

export const runtime = 'nodejs';

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: { citationStyle: true }
  });
}

function toCitationData(citation: any): CitationData {
  return {
    id: citation.id,
    title: citation.title,
    authors: citation.authors,
    year: citation.year || undefined,
    venue: citation.venue || undefined,
    volume: citation.volume || undefined,
    issue: citation.issue || undefined,
    pages: citation.pages || undefined,
    doi: citation.doi || undefined,
    url: citation.url || undefined,
    isbn: citation.isbn || undefined,
    publisher: citation.publisher || undefined,
    edition: citation.edition || undefined,
    sourceType: citation.sourceType || undefined,
    editors: Array.isArray(citation.editors) ? citation.editors : undefined,
    publicationPlace: citation.publicationPlace || undefined,
    publicationDate: citation.publicationDate || undefined,
    accessedDate: citation.accessedDate || undefined,
    articleNumber: citation.articleNumber || undefined,
    issn: citation.issn || undefined,
    journalAbbreviation: citation.journalAbbreviation || undefined,
    pmid: citation.pmid || undefined,
    pmcid: citation.pmcid || undefined,
    arxivId: citation.arxivId || undefined,
    citationKey: citation.citationKey
  };
}

function getDefaultStyleCode(session: any): string {
  return session?.citationStyle?.code
    || process.env.DEFAULT_CITATION_STYLE
    || 'APA7';
}

export async function GET(request: NextRequest, context: { params: { paperId: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get('ids');

    const sessionId = context.params.paperId;
    const session = await getSessionForUser(sessionId, user);
    if (!session) {
      return NextResponse.json({ error: 'Paper session not found' }, { status: 404 });
    }

    const citations = await citationService.getCitationsForSession(sessionId);
    const selectedIds = idsParam
      ? idsParam.split(',').map(id => id.trim()).filter(Boolean)
      : [];
    const exportCitations = selectedIds.length > 0
      ? citations.filter(citation => selectedIds.includes(citation.id))
      : citations;
    const styleCode = getDefaultStyleCode(session);
    const bibtex = exportCitationsToBibtex(
      exportCitations.map(citation => ({
        ...toCitationData(citation),
        sourceType: citation.sourceType
      }))
    );

    return NextResponse.json({
      bibtex,
      citationStyle: styleCode,
      count: exportCitations.length
    });
  } catch (error) {
    console.error('[Citations] export error:', error);
    return NextResponse.json({ error: 'Failed to export citations' }, { status: 500 });
  }
}
