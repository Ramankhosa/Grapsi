export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server';

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth';
import { fundingDocumentService } from '@/lib/fundingDocuments/service';

export const runtime = 'nodejs';

async function cataloguePOST(
  request: NextRequest,
  { params }: { params: { id: string; documentId: string } }
) {
  const auth = await requireFundingOperatorRequest(request);
  if ('response' in auth) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const active = body?.active === false ? false : true;
    const detail = await fundingDocumentService.activateDocument(params.id, params.documentId, auth.operator, active);
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to activate funding document' },
      { status: 500 }
    );
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'detail', 'FUNDING_DISCOVERY')
