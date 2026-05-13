import { NextRequest, NextResponse } from 'next/server';

import { requireFundingActor } from '@/lib/funding/access';
import { researchAreaTaxonomyService } from '@/lib/services/researchAreaTaxonomyService';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireFundingActor(request, {
    allowPlatform: true,
    requireWriteSuperAdmin: true,
    requiredPlatformPermission: 'funding.operations.write',
  });
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const sourceName = typeof formData.get('sourceName') === 'string' ? String(formData.get('sourceName')) : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'CSV file must be 2 MB or smaller' }, { status: 400 });
    }

    const csvText = await file.text();
    const result = await researchAreaTaxonomyService.uploadTaxonomyCsv({
      csvText,
      originalFilename: file.name,
      sourceName,
      uploadedBy: auth.actor.id,
    });

    return NextResponse.json({
      success: true,
      message: 'Research area taxonomy uploaded successfully',
      ...result,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to upload research area taxonomy',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}
