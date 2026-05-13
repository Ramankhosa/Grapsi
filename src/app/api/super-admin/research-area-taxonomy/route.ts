import { NextRequest, NextResponse } from 'next/server';

import { actorHasPlatformReadAccess, requireFundingActor } from '@/lib/funding/access';
import { researchAreaTaxonomyService } from '@/lib/services/researchAreaTaxonomyService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true });
  if ('response' in auth) {
    return auth.response;
  }

  if (!actorHasPlatformReadAccess(auth.actor)) {
    return NextResponse.json({ error: 'Platform funding access required' }, { status: 403 });
  }

  try {
    const taxonomy = await researchAreaTaxonomyService.listActiveTaxonomy({ includeInactive: true });
    return NextResponse.json({ success: true, ...taxonomy });
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
