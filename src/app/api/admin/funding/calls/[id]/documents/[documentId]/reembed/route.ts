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
    const detail = await fundingDocumentService.reembedDocument(params.id, params.documentId, auth.operator);
    return NextResponse.json(detail, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to re-embed funding document' },
      { status: 500 }
    );
  }
}
