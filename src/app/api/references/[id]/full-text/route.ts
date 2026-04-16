import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { paperAcquisitionService } from '@/lib/services/paper-acquisition-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user, error } = await authenticateUser(request);
    if (error || !user) {
      return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status: error?.status || 401 });
    }

    const referenceId = (context.params.id || '').trim();
    if (!referenceId) {
      return NextResponse.json({ error: 'Invalid reference ID' }, { status: 400 });
    }

    const result = await paperAcquisitionService.getReferenceFullText(user.id, referenceId);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || 'Full text not available' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      status: result.status,
      sourceType: result.sourceType,
      text: result.text || '',
      pageCount: result.pageCount,
    });
  } catch (error) {
    console.error('[ReferenceFullText] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch full text' }, { status: 500 });
  }
}

