import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRecommendationUser } from '@/lib/recommendations/request-auth';
import { researcherSearchService } from '@/lib/services/researcherSearchService';

export const runtime = 'nodejs';

const requestSchema = z.object({
  query: z.string().max(5000).nullable().optional(),
  fundingCallId: z.string().max(120).nullable().optional(),
  limit: z.number().int().min(1).max(50).nullable().optional(),
  filters: z.object({
    countries: z.array(z.string().max(120)).max(20).optional(),
    institutionTypes: z.array(z.string().max(120)).max(20).optional(),
    careerStages: z.array(z.string().max(120)).max(20).optional(),
    applicationLanguages: z.array(z.string().max(120)).max(20).optional(),
    tenantOnly: z.boolean().optional(),
    includeSelf: z.boolean().optional(),
  }).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireRecommendationUser(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const parsed = requestSchema.parse(await request.json());
    const response = await researcherSearchService.search({
      query: parsed.query,
      fundingCallId: parsed.fundingCallId,
      limit: parsed.limit,
      filters: parsed.filters,
      requesterUserId: auth.userId,
      requesterTenantId: auth.tenantId,
    });
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid researcher search payload', details: error.flatten() },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Failed to search researchers',
        details: message,
      },
      { status: message.includes('required') || message.includes('not found') ? 400 : 500 }
    );
  }
}
