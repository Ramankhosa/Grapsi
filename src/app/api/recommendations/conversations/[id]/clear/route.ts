import { NextRequest, NextResponse } from 'next/server'

import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const conversation = await recommendationConversationService.clearConversation(auth.userId, params.id)
    return NextResponse.json({ conversation })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to clear recommendation conversation',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
