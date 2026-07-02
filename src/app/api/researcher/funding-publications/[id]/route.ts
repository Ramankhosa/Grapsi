import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRecommendationUser } from '@/lib/recommendations/request-auth';
import { fundingPublicationService } from '@/lib/researcherProfile/funding-publications';

export const runtime = 'nodejs';

const currentYear = new Date().getFullYear();

const requestSchema = z.object({
  title: z.string().min(1).max(300),
  abstract: z.string().min(1).max(5000),
  year: z.number().int().min(1800).max(currentYear + 1).nullable().optional(),
  venue: z.string().max(240).nullable().optional(),
  doi: z.string().max(240).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationUser(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const parsed = requestSchema.parse(await request.json());
    const publication = await fundingPublicationService.update(auth.userId, params.id, parsed);
    return NextResponse.json({ publication });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid funding publication payload', details: error.flatten() },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Failed to update funding publication',
        details: message,
      },
      { status: message.includes('not found') ? 404 : message.includes('at most') ? 409 : 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationUser(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    await fundingPublicationService.remove(auth.userId, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Failed to remove funding publication',
        details: message,
      },
      { status: message.includes('not found') ? 404 : 500 }
    );
  }
}
