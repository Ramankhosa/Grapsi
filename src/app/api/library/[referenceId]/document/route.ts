/**
 * Reference Document API
 * POST /api/library/[referenceId]/document - Upload PDF and attach to reference
 * GET /api/library/[referenceId]/document - Get document status/metadata
 * DELETE /api/library/[referenceId]/document - Detach document from reference
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { referenceDocumentService } from '@/lib/services/reference-document-service';
import { PDF_ERROR_MESSAGES } from '@/lib/services/pdf-parser-service';

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_REFERENCE_PDF_SIZE_MB || '50', 10);

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

        // Parse multipart form data
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // Validate content type
        if (file.type !== 'application/pdf') {
            return NextResponse.json(
                { error: 'Only PDF files are accepted' },
                { status: 400 }
            );
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            return NextResponse.json(
                { error: `File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB` },
                { status: 400 }
            );
        }

        // Convert to buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const result = await referenceDocumentService.uploadDocument(
            user.id,
            params.referenceId,
            buffer,
            file.name
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
                pdfTitle: result.document.pdfTitle,
                pdfAuthors: result.document.pdfAuthors,
                pdfDoi: result.document.pdfDoi,
                createdAt: result.document.createdAt,
            },
            isDuplicate: result.isDuplicate,
        }, { status: 201 });
    } catch (err) {
        console.error('Document upload error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to upload document' },
            { status: 500 }
        );
    }
}

export async function GET(
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

        const link = await referenceDocumentService.getDocumentByReference(
            user.id,
            params.referenceId
        );

        if (!link) {
            return NextResponse.json({ document: null });
        }

        const doc = link.document;
        return NextResponse.json({
            document: {
                id: doc.id,
                status: doc.status,
                errorCode: doc.errorCode,
                errorMessage: doc.errorCode
                    ? (PDF_ERROR_MESSAGES as any)[doc.errorCode] || 'Unknown error'
                    : undefined,
                originalFilename: doc.originalFilename,
                fileSizeBytes: doc.fileSizeBytes,
                pageCount: doc.pageCount,
                pdfTitle: doc.pdfTitle,
                pdfAuthors: doc.pdfAuthors,
                pdfDoi: doc.pdfDoi,
                pdfSubject: doc.pdfSubject,
                pdfCreationDate: doc.pdfCreationDate,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
            },
            linkId: link.id,
            isPrimary: link.isPrimary,
        });
    } catch (err) {
        console.error('Document GET error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to retrieve document info' },
            { status: 500 }
        );
    }
}

export async function DELETE(
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

        const result = await referenceDocumentService.detachDocument(
            user.id,
            params.referenceId
        );

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('Document DELETE error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to detach document' },
            { status: 500 }
        );
    }
}
