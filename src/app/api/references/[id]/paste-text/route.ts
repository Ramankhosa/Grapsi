import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperAcquisitionService } from '@/lib/services/paper-acquisition-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  text: z.string().min(1),
  format: z.enum(['plain', 'html']).optional().default('plain'),
});

function statusFromErrorCode(errorCode?: string): number {
  switch (errorCode) {
    case 'REFERENCE_NOT_FOUND':
      return 404;
    case 'ALREADY_ATTACHED':
      return 409;
    case 'INVALID_TEXT':
      return 400;
    default:
      return 500;
  }
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const referenceId = (context.params.id || '').trim();
    if (!referenceId) {
      return NextResponse.json({ error: 'Invalid reference ID' }, { status: 400 });
    }

    const body = await request.json();
    const { text, format } = requestSchema.parse(body);

    const result = await paperAcquisitionService.storeFullTextPaste(user.id, referenceId, text, format);
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          errorCode: result.errorCode,
          error: result.error || 'Failed to store pasted text',
        },
        { status: statusFromErrorCode(result.errorCode) }
      );
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      characterCount: result.characterCount,
      sourceType: result.documentSourceType,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid request' }, { status: 400 });
    }
    console.error('[ReferencePasteText] POST error:', error);
    return NextResponse.json({ error: 'Failed to store pasted text' }, { status: 500 });
  }
}

