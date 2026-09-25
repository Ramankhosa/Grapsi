import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { actorHasPlatformReadAccess, requireFundingActor } from '@/lib/funding/access';
import { mapCallToSchoolsQuietly } from '@/lib/fundingDept/callSchoolMapping';
import { fundingCallResearchAreaTaxonomyService } from '@/lib/services/fundingCallResearchAreaTaxonomyService';

export const runtime = 'nodejs';

const updateSchema = z.object({
  taxonomyAreaIds: z.array(z.string()).max(50).default([]),
});

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true });
  if ('response' in auth) {
    return auth.response;
  }

  if (!actorHasPlatformReadAccess(auth.actor)) {
    return NextResponse.json({ error: 'Platform funding access required' }, { status: 403 });
  }

  try {
    const mappings = await fundingCallResearchAreaTaxonomyService.listMappings(params.id);
    return NextResponse.json({ success: true, mappings });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load funding call research taxonomy mappings',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
    requiredPlatformPermission: 'funding.operations.write',
  });
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const parsed = updateSchema.parse(await request.json());
    const mappings = await fundingCallResearchAreaTaxonomyService.replaceMappings({
      fundingCallId: params.id,
      taxonomyAreaIds: parsed.taxonomyAreaIds,
    });
    // A corrected classification can make the call new schools' business.
    // Add-only: schools already mapped keep their responsibility.
    mapCallToSchoolsQuietly(params.id);

    return NextResponse.json({ success: true, mappings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid research taxonomy mapping request', details: error.flatten() },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to update funding call research taxonomy mappings',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
