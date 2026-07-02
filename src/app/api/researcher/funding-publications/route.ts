import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRecommendationUser } from '@/lib/recommendations/request-auth';
import {
  fundingPublicationService,
  MAX_FUNDING_PUBLICATIONS,
} from '@/lib/researcherProfile/funding-publications';

export const runtime = 'nodejs';

const currentYear = new Date().getFullYear();

const requestSchema = z.object({
  title: z.string().min(1).max(300),
  abstract: z.string().min(1).max(5000),
  year: z.number().int().min(1800).max(currentYear + 1).nullable().optional(),
  venue: z.string().max(240).nullable().optional(),
  doi: z.string().max(240).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const publications = await fundingPublicationService.list(auth.userId);
    return NextResponse.json({
      publications,
      max: MAX_FUNDING_PUBLICATIONS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load funding publications',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRecommendationUser(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const parsed = requestSchema.parse(await request.json());
    const publication = await fundingPublicationService.create(auth.userId, parsed);
    return NextResponse.json({ publication }, { status: 201 });
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
        error: 'Failed to save funding publication',
        details: message,
      },
      { status: message.includes('at most') ? 409 : 500 }
    );
  }
}
