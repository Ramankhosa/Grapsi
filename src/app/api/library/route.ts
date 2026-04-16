/**
 * Reference Library API
 * GET /api/library - Get user's reference library
 * POST /api/library - Create new reference or bulk import
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { referenceReconciliationService } from '@/lib/services/reference-reconciliation-service';
import { libraryConnectionService } from '@/lib/services/library-connection-service';
import { authenticateUser } from '@/lib/auth-middleware';

const createSchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  year: z.number().optional(),
  venue: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  isbn: z.string().optional(),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  editors: z.array(z.string()).optional(),
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
  sourceType: z.enum(['JOURNAL_ARTICLE', 'CONFERENCE_PAPER', 'BOOK', 'BOOK_CHAPTER', 'THESIS', 'REPORT', 'WEBSITE', 'PATENT', 'WORKING_PAPER', 'OTHER']).default('OTHER'),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  pdfUrl: z.string().optional(),
});

const importSchema = z.object({
  content: z.string().min(1),
  format: z.enum(['auto', 'bibtex', 'ris', 'mendeley', 'zotero']).default('auto'),
  collectionId: z.string().optional(), // Auto-add imported references to this collection
  autoReconcile: z.boolean().optional().default(false),
  dryRunReconcile: z.boolean().optional().default(false),
});

const filterSchema = z.object({
  search: z.string().optional(),
  sourceType: z.enum(['JOURNAL_ARTICLE', 'CONFERENCE_PAPER', 'BOOK', 'BOOK_CHAPTER', 'THESIS', 'REPORT', 'WEBSITE', 'PATENT', 'WORKING_PAPER', 'OTHER']).optional(),
  tags: z.array(z.string()).optional(),
  collectionId: z.string().optional(),
  isFavorite: z.boolean().optional(),
  isRead: z.boolean().optional(),
  hasAttachment: z.boolean().optional(),
  yearFrom: z.number().optional(),
  yearTo: z.number().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    
    // Safely parse URL parameters with proper type handling
    const rawParams: Record<string, any> = {};
    
    // String parameters
    const search = searchParams.get('search');
    if (search) rawParams.search = search;
    
    const sourceType = searchParams.get('sourceType');
    if (sourceType) rawParams.sourceType = sourceType;
    
    const collectionId = searchParams.get('collectionId');
    if (collectionId) rawParams.collectionId = collectionId;
    
    // Boolean parameters
    const isFavorite = searchParams.get('isFavorite');
    if (isFavorite !== null) rawParams.isFavorite = isFavorite === 'true';
    
    const isRead = searchParams.get('isRead');
    if (isRead !== null) rawParams.isRead = isRead === 'true';

    const hasAttachment = searchParams.get('hasAttachment');
    if (hasAttachment !== null) rawParams.hasAttachment = hasAttachment === 'true';
    
    // Array parameters
    const tags = searchParams.get('tags');
    if (tags) rawParams.tags = tags.split(',').filter(Boolean);
    
    // Number parameters - validate before parsing
    const limit = searchParams.get('limit');
    if (limit) {
      const parsed = parseInt(limit, 10);
      if (!isNaN(parsed) && parsed > 0) rawParams.limit = parsed;
    }
    
    const offset = searchParams.get('offset');
    if (offset) {
      const parsed = parseInt(offset, 10);
      if (!isNaN(parsed) && parsed >= 0) rawParams.offset = parsed;
    }
    
    const yearFrom = searchParams.get('yearFrom');
    if (yearFrom) {
      const parsed = parseInt(yearFrom, 10);
      if (!isNaN(parsed) && parsed > 1000 && parsed < 3000) rawParams.yearFrom = parsed;
    }
    
    const yearTo = searchParams.get('yearTo');
    if (yearTo) {
      const parsed = parseInt(yearTo, 10);
      if (!isNaN(parsed) && parsed > 1000 && parsed < 3000) rawParams.yearTo = parsed;
    }

    const filter = filterSchema.parse(rawParams);
    const { references, total } = await referenceLibraryService.getReferences(
      user.id,
      filter,
      filter.limit,
      filter.offset
    );

    return NextResponse.json({ references, total, limit: filter.limit, offset: filter.offset });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid filter parameters', details: err.errors }, { status: 400 });
    }
    console.error('Library GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch references' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    // Check if this is a bulk import or single create
    if (body.content) {
      // Bulk import
      const data = importSchema.parse(body);
      const result = await referenceLibraryService.importReferences(user.id, data.content);
      
      // If a collectionId is provided and we have imported references, add them to the collection
      if (data.collectionId && result.references && result.references.length > 0) {
        try {
          const referenceIds = result.references.map((ref: any) => ref.id);
          await referenceLibraryService.addToCollection(user.id, data.collectionId, referenceIds);
        } catch (collectionErr) {
          console.error('Failed to add imported references to collection:', collectionErr);
          // Don't fail the whole import, just log the error
        }
      }

      let reconciliation: any = null;
      if (data.autoReconcile && result.references && result.references.length > 0) {
        const importedReferenceIds = result.references.map((ref: any) => ref.id);

        // Build providers from stored connections (tokens never touch the client)
        const providers: Record<string, string | undefined> = {};
        try {
          const { accessToken: mToken } = await libraryConnectionService.ensureValidToken(user.id, 'mendeley');
          providers.mendeleyAccessToken = mToken;
        } catch { /* no Mendeley connection */ }
        try {
          const { accessToken: zKey, providerUserId: zUid } = await libraryConnectionService.ensureValidToken(user.id, 'zotero');
          providers.zoteroApiKey = zKey;
          providers.zoteroUserId = zUid ?? undefined;
        } catch { /* no Zotero connection */ }

        reconciliation = await referenceReconciliationService.runReconciliation({
          userId: user.id,
          actorUserId: user.id,
          tenantId: (user as any).tenantId || null,
          referenceIds: importedReferenceIds,
          applyAutoLinks: true,
          dryRun: data.dryRunReconcile,
          includeAlreadyLinkedDocuments: true,
          providers,
          referenceAttachmentHints: result.attachmentHintsByReferenceId,
        }).catch((reconcileErr: unknown) => ({
          error: reconcileErr instanceof Error ? reconcileErr.message : 'Reconciliation failed',
        }));
      }
      
      return NextResponse.json({
        success: result.success,
        imported: result.imported,
        skipped: result.skipped,
        format: result.format,
        errors: result.errors,
        warnings: result.warnings,
        referenceIds: result.references?.map((ref: any) => ref.id) || [],
        reconciliation,
      });
    } else {
      // Single reference create
      const data = createSchema.parse(body);
      const reference = await referenceLibraryService.createReference({
        userId: user.id,
        ...data,
      });

      return NextResponse.json({ reference }, { status: 201 });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: err.errors }, { status: 400 });
    }
    console.error('Library POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create reference' },
      { status: 500 }
    );
  }
}

