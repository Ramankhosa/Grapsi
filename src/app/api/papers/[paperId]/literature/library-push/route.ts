import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authenticateUser } from '@/lib/auth-middleware';
import { featureFlags } from '@/lib/feature-flags';
import { paperLibraryService } from '@/lib/services/paper-library-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  referenceIds: z.array(z.string().min(1)).min(1).max(500)
});

type PdfStatus = 'UPLOADED' | 'PARSING' | 'READY' | 'FAILED' | 'NONE';

function toPdfStatus(value: unknown): PdfStatus {
  if (value === 'UPLOADED' || value === 'PARSING' || value === 'READY' || value === 'FAILED') {
    return value;
  }
  return 'NONE';
}

function mapSourceTypeToPublicationType(sourceType: string | null | undefined): string | undefined {
  switch (sourceType) {
    case 'JOURNAL_ARTICLE':
      return 'journal-article';
    case 'CONFERENCE_PAPER':
      return 'conference-paper';
    case 'BOOK_CHAPTER':
      return 'book-chapter';
    case 'BOOK':
      return 'book';
    case 'THESIS':
      return 'thesis';
    default:
      return undefined;
  }
}

function sanitizeForPostgres(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.replace(/\u0000/g, '');
  if (Array.isArray(obj)) return obj.map(sanitizeForPostgres);
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeForPostgres(value);
    }
    return sanitized;
  }
  return obj;
}

async function getSessionForUser(sessionId: string, user: { id: string; roles?: string[] }) {
  if (user.roles?.includes('SUPER_ADMIN')) {
    return prisma.draftingSession.findUnique({ where: { id: sessionId } });
  }
  return prisma.draftingSession.findFirst({
    where: { id: sessionId, userId: user.id }
  });
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
    const { referenceIds } = requestSchema.parse(body);
    const uniqueReferenceIds = Array.from(new Set(referenceIds.map(id => id.trim()).filter(Boolean)));

    if (uniqueReferenceIds.length === 0) {
      return NextResponse.json({ error: 'No valid reference IDs provided' }, { status: 400 });
    }

    const references = await prisma.referenceLibrary.findMany({
      where: {
        id: { in: uniqueReferenceIds },
        userId: user.id,
        isActive: true
      },
      include: {
        documents: {
          where: { isPrimary: true },
          include: {
            document: {
              select: {
                id: true,
                status: true,
                sourceType: true
              }
            }
          }
        }
      }
    });

    if (references.length === 0) {
      return NextResponse.json({
        searchRunId: null,
        results: [],
        totalFound: 0,
        sources: ['library'],
        importedFromLibrary: 0,
        skipped: uniqueReferenceIds.length
      });
    }

    try {
      await paperLibraryService.addReferencesToPaperCollection(
        user.id,
        sessionId,
        references.map(reference => reference.id)
      );
    } catch (collectionError) {
      console.warn('[LiteratureLibraryPush] Failed to add references to paper library collection:', collectionError);
    }

    const results = references.map((ref) => {
      const primaryDocument = ref.documents[0]?.document;
      const pdfStatus = toPdfStatus(primaryDocument?.status);
      const isOpenAccess = Boolean(ref.pdfUrl) || primaryDocument?.sourceType === 'DOI_FETCH'
        ? true
        : undefined;

      return {
        id: `lib_${ref.id}`,
        title: ref.title,
        authors: Array.isArray(ref.authors) ? ref.authors : [],
        year: ref.year ?? undefined,
        venue: ref.venue ?? undefined,
        volume: ref.volume ?? undefined,
        issue: ref.issue ?? undefined,
        pages: ref.pages ?? undefined,
        publisher: ref.publisher ?? undefined,
        isbn: ref.isbn ?? undefined,
        edition: ref.edition ?? undefined,
        editors: Array.isArray(ref.editors) ? ref.editors : undefined,
        publicationPlace: ref.publicationPlace ?? undefined,
        publicationDate: ref.publicationDate ?? undefined,
        accessedDate: ref.accessedDate ?? undefined,
        articleNumber: ref.articleNumber ?? undefined,
        issn: ref.issn ?? undefined,
        journalAbbreviation: ref.journalAbbreviation ?? undefined,
        pmid: ref.pmid ?? undefined,
        pmcid: ref.pmcid ?? undefined,
        arxivId: ref.arxivId ?? undefined,
        abstract: ref.abstract ?? undefined,
        doi: ref.doi ?? undefined,
        url: ref.url ?? undefined,
        pdfUrl: ref.pdfUrl ?? undefined,
        source: 'library',
        publicationType: mapSourceTypeToPublicationType(ref.sourceType),
        isOpenAccess,
        pdfStatus,
        libraryReferenceId: ref.id,
        libraryDocumentId: primaryDocument?.id || null
      };
    });

    const sanitizedResults = sanitizeForPostgres(results);
    const searchRun = await prisma.literatureSearchRun.create({
      data: {
        sessionId,
        query: `My Library import (${results.length})`,
        sources: ['library'],
        results: sanitizedResults
      }
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        tenantId: user.tenantId || null,
        action: 'LITERATURE_LIBRARY_PUSH',
        resource: `drafting_session:${sessionId}`,
        meta: {
          searchRunId: searchRun.id,
          referencesRequested: uniqueReferenceIds.length,
          referencesImported: results.length,
          referencesSkipped: uniqueReferenceIds.length - results.length
        }
      }
    });

    return NextResponse.json({
      searchRunId: searchRun.id,
      results,
      totalFound: results.length,
      sources: ['library'],
      importedFromLibrary: results.length,
      skipped: uniqueReferenceIds.length - results.length
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }

    console.error('[LiteratureLibraryPush] POST error:', error);
    return NextResponse.json({ error: 'Failed to push library references to literature workspace' }, { status: 500 });
  }
}
