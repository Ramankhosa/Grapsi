import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationUser } from '@/lib/recommendations/request-auth'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().max(120).optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireRecommendationUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const conversations = await recommendationConversationService.listConversations(auth.userId)
    return NextResponse.json({ conversations })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load recommendation conversations',
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
    const parsed = createSchema.parse(await request.json().catch(() => ({})))
    const conversation = await recommendationConversationService.createConversation(auth.userId, parsed.title)
    return NextResponse.json({ conversation }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to create recommendation conversation',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
