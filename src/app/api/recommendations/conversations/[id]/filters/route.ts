import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { MAX_SELECTED_RESEARCH_AREAS } from '@/lib/recommendations/constants'
import { conversationMessageFilterSchema } from '@/lib/recommendations/messageSchema'
import { requireRecommendationTenantUser, toRecommendationAccessScope } from '@/lib/recommendations/request-auth'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const requestSchema = z.object({
  filters: conversationMessageFilterSchema,
  useProfileContext: z.boolean().optional(),
  useEligibilityProfile: z.boolean().optional(),
  usePublicationContext: z.boolean().optional(),
  selectedResearchAreaIds: z.array(z.string().max(120)).max(MAX_SELECTED_RESEARCH_AREAS).optional(),
})

/**
 * Direct filter manipulation from the UI. Deliberately separate from the chat
 * message endpoint: applying or removing a filter must not post a user message
 * or trigger any narrative LLM call.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json())
    const conversation = await recommendationConversationService.applyFilters(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    return NextResponse.json(conversation)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid filter payload', details: error.flatten() }, { status: 400 })
    }
    return NextResponse.json(
      {
        error: 'Failed to update conversation filters',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
