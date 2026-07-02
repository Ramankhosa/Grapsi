import { NextRequest, NextResponse } from 'next/server';

import prisma from '@/lib/prisma';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { buildFundingCallAccessWhere, requireFundingImporterRequest } from '@/lib/fundingIntake/routeAuth';
import { fundingDocumentQaService } from '@/lib/fundingDocuments/qa';
import { toRecommendationAccessScope } from '@/lib/recommendations/request-auth';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } }
) {
  if (!isFeatureEnabled('ENABLE_FUNDING_DOC_INTELLIGENCE')) {
    return NextResponse.json({ message: 'Funding document intelligence is disabled' }, { status: 404 });
  }

  const auth = await requireFundingImporterRequest(request);
  if ('response' in auth) return auth.response;

  try {
    const accessibleCall = await prisma.fundingCall.findFirst({
      where: {
        AND: [{ id: params.callId }, buildFundingCallAccessWhere(auth.actor)],
      },
      select: { id: true },
    });
    if (!accessibleCall) {
      return NextResponse.json({ message: 'Funding call not found' }, { status: 404 });
    }

    const body = await request.json();
    const question = String(body?.question || '').trim();
    if (!question) {
      return NextResponse.json({ message: 'question is required' }, { status: 400 });
    }

    const answer = await fundingDocumentQaService.answerQuestion({
      callId: params.callId,
      question,
      access: toRecommendationAccessScope(auth.actor),
      llmContext: {
        tenantId: auth.actor.tenantId,
        userId: auth.actor.id,
      },
    });

    return NextResponse.json(answer);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to answer funding document question' },
      { status: 500 }
    );
  }
}
