import { NextRequest, NextResponse } from 'next/server';

import { requireRecommendationUser } from '@/lib/recommendations/request-auth';
import { researchAreaTaxonomyService } from '@/lib/services/researchAreaTaxonomyService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const taxonomy = await researchAreaTaxonomyService.listActiveTaxonomy();
    return NextResponse.json(taxonomy);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load research area taxonomy',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
