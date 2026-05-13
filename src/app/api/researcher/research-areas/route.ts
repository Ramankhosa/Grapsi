import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

const requestSchema = z.object({
  taxonomyAreaId: z.string().nullable().optional(),
  label: z.string().max(120),
  researchArea: z.string().max(300),
  keywords: z.array(z.string().max(120)).max(40).default([]),
  disciplines: z.array(z.string().max(120)).max(40).default([]),
  isDefault: z.boolean().default(false),
  useForAlerts: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const researchAreas = await researcherProfileService.listResearchAreas(auth.userId)
    return NextResponse.json({ researchAreas })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load saved research areas',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json())
    const researchArea = await researcherProfileService.saveResearchArea(auth.userId, parsed)
    return NextResponse.json({ researchArea }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid research area payload', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to save research area',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
