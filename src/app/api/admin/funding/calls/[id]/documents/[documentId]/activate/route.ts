import { NextRequest, NextResponse } from 'next/server';

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth';
import { fundingDocumentService } from '@/lib/fundingDocuments/service';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
) {
  const auth = await requireFundingOperatorRequest(request);
  if ('response' in auth) return auth.response;

  try {
    const detail = await fundingDocumentService.activateDocument(params.id, params.documentId, auth.operator);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to activate funding document' },
      { status: 500 }
    );
  }
}
