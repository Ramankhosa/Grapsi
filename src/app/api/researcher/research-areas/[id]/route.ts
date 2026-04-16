import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

const requestSchema = z.object({
  label: z.string().max(120),
  researchArea: z.string().max(300),
  keywords: z.array(z.string().max(120)).max(40).default([]),
  disciplines: z.array(z.string().max(120)).max(40).default([]),
  isDefault: z.boolean().default(false),
  useForAlerts: z.boolean().default(true),
})

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json())
    const researchArea = await researcherProfileService.saveResearchArea(auth.userId, {
      id: params.id,
      ...parsed,
    })
    return NextResponse.json({ researchArea })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid research area payload', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to update research area',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    await researcherProfileService.deleteResearchArea(auth.userId, params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to delete research area',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
