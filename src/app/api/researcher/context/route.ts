import { NextRequest, NextResponse } from 'next/server'

import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import { researcherProfileService } from '@/lib/services/researcherProfileService'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const context = await researcherProfileService.getFinderContext(auth.userId)
    return NextResponse.json(context)
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load researcher finder context',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
