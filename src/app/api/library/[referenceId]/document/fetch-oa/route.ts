/**
 * Fetch Open Access PDF via Unpaywall
 * POST /api/library/[referenceId]/document/fetch-oa - Fetch OA PDF by DOI
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { referenceDocumentService } from '@/lib/services/reference-document-service';
import { referenceLibraryService } from '@/lib/services/reference-library-service';

export async function POST(
    request: NextRequest,
    { params }: { params: { referenceId: string } }
) {
    try {
        const { user, error } = await authenticateUser(request);
        if (error || !user) {
            return NextResponse.json(
                { error: error?.message || 'Unauthorized' },
                { status: error?.status || 401 }
            );
        }

        if (!params.referenceId || params.referenceId.trim() === '') {
            return NextResponse.json({ error: 'Invalid reference ID' }, { status: 400 });
        }

        // Get the reference to find the DOI
        const reference = await referenceLibraryService.getReference(user.id, params.referenceId);
        if (!reference) {
            return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
        }

        // Allow DOI override from request body
        let body: any = {};
        try {
            body = await request.json();
        } catch {
            // No body is fine, we'll use the reference DOI
        }

        const doi = body?.doi || reference.doi;
        if (!doi) {
            return NextResponse.json(
                { error: 'No DOI available for this reference. Cannot fetch OA PDF without a DOI.' },
                { status: 400 }
            );
        }

        const result = await referenceDocumentService.fetchOAPdfByDOI(
            user.id,
            params.referenceId,
            doi
        );

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            document: {
                id: result.document.id,
                status: result.document.status,
                originalFilename: result.document.originalFilename,
                fileSizeBytes: result.document.fileSizeBytes,
                sourceType: result.document.sourceType,
                sourceIdentifier: result.document.sourceIdentifier,
                createdAt: result.document.createdAt,
            },
            oaUrl: result.oaUrl,
        }, { status: 201 });
    } catch (err) {
        console.error('Fetch OA PDF error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to fetch OA PDF' },
            { status: 500 }
        );
    }
}
