import { NextRequest, NextResponse } from 'next/server';

import { requireFundingOperatorRequest, requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth';
import { fundingDocumentService, isFundingDocumentKind } from '@/lib/fundingDocuments/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingReadOperatorRequest(request);
  if ('response' in auth) return auth.response;

  try {
    const bundle = await fundingDocumentService.listDocuments(params.id);
    return NextResponse.json(bundle);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load funding documents' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request);
  if ('response' in auth) return auth.response;

  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      if (body?.sourceMode === 'intake' || body?.syncFromIntake === true) {
        const result = await fundingDocumentService.syncFromIntake(params.id, auth.operator);
        return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
      }
      return NextResponse.json({ message: 'Unsupported document request' }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ message: 'No document file received' }, { status: 400 });
    }

    const rawKind = form.get('documentKind');
    let documentKind: 'call_document' | 'guideline_document' | 'template_document' | undefined;
    if (typeof rawKind === 'string' && rawKind.trim()) {
      if (!isFundingDocumentKind(rawKind.trim())) {
        return NextResponse.json({ message: `Invalid document kind: ${rawKind}` }, { status: 400 });
      }
      documentKind = rawKind.trim() as typeof documentKind;
    }

    const result = await fundingDocumentService.uploadDocument({
      fundingCallId: params.id,
      file,
      sourceUrl: typeof form.get('sourceUrl') === 'string' ? String(form.get('sourceUrl')) : null,
      documentKind,
      operator: auth.operator,
    });

    return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to upload funding document' },
      { status: 500 }
    );
  }
}
