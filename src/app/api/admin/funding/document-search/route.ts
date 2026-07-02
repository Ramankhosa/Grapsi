import { NextRequest, NextResponse } from 'next/server';

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth';
import { isFundingDocumentSectionType } from '@/lib/fundingDocuments/constants';
import { fundingDocumentRetrievalService } from '@/lib/fundingDocuments/retrieval';
import { toRecommendationAccessScope } from '@/lib/recommendations/request-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request);
  if ('response' in auth) return auth.response;

  try {
    const body = await request.json();
    const query = String(body?.query || '').trim();
    if (!query) {
      return NextResponse.json({ message: 'query is required' }, { status: 400 });
    }

    const sectionTypes = Array.isArray(body?.sectionTypes)
      ? body.sectionTypes.filter((value: unknown) => isFundingDocumentSectionType(String(value)))
      : undefined;

    const results = await fundingDocumentRetrievalService.searchChunks({
      query,
      fundingCallId: body?.fundingCallId ? String(body.fundingCallId) : undefined,
      sectionTypes,
      callStatus: body?.callStatus || 'any',
      topK: body?.topK,
      minSimilarity: body?.minSimilarity,
      access: toRecommendationAccessScope(auth.actor),
      llmContext: {
        tenantId: auth.actor.tenantId,
        userId: auth.actor.id,
      },
    });

    return NextResponse.json({
      results,
      embeddingHealth: fundingDocumentRetrievalService.getEmbeddingHealth(),
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to search funding documents' },
      { status: 500 }
    );
  }
}
