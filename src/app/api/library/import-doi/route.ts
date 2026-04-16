/**
 * DOI Import API
 * POST /api/library/import-doi - Import reference by DOI
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { referenceLibraryService } from '@/lib/services/reference-library-service';
import { referenceDocumentService } from '@/lib/services/reference-document-service';
import { authenticateUser } from '@/lib/auth-middleware';

const importSchema = z.object({
  doi: z.string().min(1),
  collectionId: z.string().optional(), // Auto-add imported reference to this collection
  autoFetchPdf: z.boolean().optional(),
});

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
    const data = importSchema.parse(body);

    const reference = await referenceLibraryService.importFromDOI(user.id, data.doi);
    
    // If a collectionId is provided, add the reference to that collection
    if (data.collectionId && reference) {
      try {
        await referenceLibraryService.addToCollection(user.id, data.collectionId, [reference.id]);
      } catch (collectionErr) {
        console.error('Failed to add imported reference to collection:', collectionErr);
        // Don't fail the import, just log the error
      }
    }

    // Best-effort OA PDF fetch after DOI import.
    // This should not fail the citation import when OA PDF is unavailable.
    const oaPdf = {
      attempted: false,
      success: false,
      error: undefined as string | undefined,
      documentId: undefined as string | undefined,
      status: undefined as string | undefined,
      sourceType: undefined as string | undefined,
    };

    if (data.autoFetchPdf !== false) {
      oaPdf.attempted = true;
      try {
        const doiForPdf = reference.doi || data.doi;
        if (!doiForPdf) {
          oaPdf.error = 'No DOI available to fetch OA PDF.';
        } else {
          const result = await referenceDocumentService.fetchOAPdfByDOI(
            user.id,
            reference.id,
            doiForPdf
          );
          if (result.success && result.document) {
            oaPdf.success = true;
            oaPdf.documentId = result.document.id;
            oaPdf.status = result.document.status;
            oaPdf.sourceType = result.document.sourceType;
          } else {
            oaPdf.error = result.error || 'OA PDF not available.';
          }
        }
      } catch (pdfErr) {
        console.error('DOI import OA fetch error:', pdfErr);
        oaPdf.error = pdfErr instanceof Error ? pdfErr.message : 'Failed to fetch OA PDF.';
      }
    }
    
    return NextResponse.json({ reference, oaPdf }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid DOI format' }, { status: 400 });
    }
    console.error('DOI import error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to import from DOI' },
      { status: 500 }
    );
  }
}

