/**
 * Replace Document API
 * POST /api/library/[referenceId]/document/replace - Replace existing PDF
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { referenceDocumentService } from '@/lib/services/reference-document-service';

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

        if (file.type !== 'application/pdf') {
            return NextResponse.json(
                { error: 'Only PDF files are accepted' },
                { status: 400 }
            );
        }

        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            return NextResponse.json(
                { error: `File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB` },
                { status: 400 }
            );
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const result = await referenceDocumentService.replaceDocument(
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
                createdAt: result.document.createdAt,
            },
            isDuplicate: result.isDuplicate,
        });
    } catch (err) {
        console.error('Document replace error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to replace document' },
            { status: 500 }
        );
    }
}
