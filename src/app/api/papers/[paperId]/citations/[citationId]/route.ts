import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { citationService } from '@/lib/services/citation-service';
import { citationStyleService, type CitationData } from '@/lib/services/citation-style-service';

export const runtime = 'nodejs';

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  authors: z.array(z.string().min(1)).optional(),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  editors: z.array(z.string().min(1)).optional(),
  publicationPlace: z.string().optional(),
  publicationDate: z.string().optional(),
  accessedDate: z.string().optional(),
  articleNumber: z.string().optional(),
  issn: z.string().optional(),
  journalAbbreviation: z.string().optional(),
  pmid: z.string().optional(),
  pmcid: z.string().optional(),
  arxivId: z.string().optional(),
  abstract: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  const where = user.roles?.includes('SUPER_ADMIN')
    ? { id: sessionId }
    : { id: sessionId, userId: user.id };

  return prisma.draftingSession.findFirst({
    where,
    include: {
      citationStyle: true
    }
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

function normalizeAiReview(raw: unknown): {
  relevanceScore: number | null;
  relevanceToResearch: string | null;
  keyContribution: string | null;
  keyFindings: string | null;
  methodologicalApproach: string | null;
  limitationsOrGaps: string | null;
  analyzedAt: string | null;
} {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const relevanceScoreRaw = Number(value.relevanceScore);
  const relevanceScore = Number.isFinite(relevanceScoreRaw)
    ? Math.max(0, Math.min(100, Math.round(relevanceScoreRaw)))
    : null;

  const readString = (key: string, limit = 500): string | null => {
    const candidate = value[key];
    if (typeof candidate !== 'string') return null;
    const trimmed = candidate.trim();
    return trimmed ? trimmed.slice(0, limit) : null;
  };

  return {
    relevanceScore,
    relevanceToResearch: readString('relevanceToResearch'),
    keyContribution: readString('keyContribution', 400),
    keyFindings: readString('keyFindings', 400),
    methodologicalApproach: readString('methodologicalApproach', 400),
    limitationsOrGaps: readString('limitationsOrGaps', 500),
    analyzedAt: readString('analyzedAt', 80)
  };
}

export async function GET(request: NextRequest, context: { params: { paperId: string; citationId: string } }) {
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

    const citationId = context.params.citationId;
    if (!citationId) {
      return NextResponse.json({ error: 'Citation ID is required' }, { status: 400 });
    }

    const citation = await prisma.citation.findFirst({
      where: {
        id: citationId,
        sessionId,
        isActive: true
      },
      select: {
        id: true,
        citationKey: true,
        aiMeta: true,
        usages: {
          where: {
            usageKind: 'DIMENSION_MAPPING',
            inclusionStatus: 'INCLUDED'
          },
          select: {
            sectionKey: true,
            dimension: true,
            remark: true,
            confidence: true,
            mappingSource: true,
            updatedAt: true
          },
          orderBy: { updatedAt: 'desc' },
          take: 12
        }
      }
    });

    if (!citation) {
      return NextResponse.json({ error: 'Citation not found' }, { status: 404 });
    }

    const aiReview = normalizeAiReview(citation.aiMeta);
    const mappings = citation.usages
      .map((usage) => ({
        sectionKey: usage.sectionKey,
        dimension: usage.dimension || null,
        remark: usage.remark ? usage.remark.trim().slice(0, 500) : null,
        confidence: usage.confidence || null,
        mappingSource: usage.mappingSource || null,
        updatedAt: usage.updatedAt
      }))
      .filter((mapping) => Boolean(mapping.dimension || mapping.remark));

    const hasReview = Boolean(
      aiReview.relevanceScore !== null
      || aiReview.relevanceToResearch
      || aiReview.keyContribution
      || aiReview.keyFindings
      || aiReview.methodologicalApproach
      || aiReview.limitationsOrGaps
      || mappings.length > 0
    );

    return NextResponse.json({
      citationId: citation.id,
      citationKey: citation.citationKey,
      hasReview,
      aiReview,
      mappings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load citation AI review';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: { paperId: string; citationId: string } }) {
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

    const citationId = context.params.citationId;
    if (!citationId) {
      return NextResponse.json({ error: 'Citation ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const updates = updateSchema.parse(body);

    const citation = await citationService.updateCitation(citationId, updates);
    const styleCode = getDefaultStyleCode(session);
    const citationData = toCitationData(citation);

    let inText = '';
    let bibliography = '';
    try {
      inText = await citationStyleService.formatInTextCitation(citationData, styleCode);
      bibliography = await citationStyleService.formatBibliographyEntry(citationData, styleCode);
    } catch (formatError) {
      console.warn('[Citations] Format preview failed:', formatError);
    }

    return NextResponse.json({
      citation: {
        ...citation,
        preview: {
          inText,
          bibliography
        }
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid payload' }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : 'Failed to update citation';
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: { params: { paperId: string; citationId: string } }) {
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

    const citationId = context.params.citationId;
    if (!citationId) {
      return NextResponse.json({ error: 'Citation ID is required' }, { status: 400 });
    }

    const result = await citationService.deleteCitation(citationId);
    if (!result.deleted) {
      return NextResponse.json({
        deleted: false,
        warning: result.warning
      }, { status: 409 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete citation';
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
