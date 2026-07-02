import { NextRequest, NextResponse } from 'next/server';

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth';
import { fundingDocumentService } from '@/lib/fundingDocuments/service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
) {
  const auth = await requireFundingReadOperatorRequest(request);
  if ('response' in auth) return auth.response;

  try {
    const detail = await fundingDocumentService.getDocumentDetail(params.id, params.documentId);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funding document' },
      { status: 500 }
    );
  }
}
