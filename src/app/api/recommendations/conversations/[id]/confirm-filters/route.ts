import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  conversationContextFlagsSchema,
  conversationMessageFilterSchema,
  conversationQueryPatchSchema,
} from '@/lib/recommendations/messageSchema'
import {
  enforceChatRateLimit,
  requireRecommendationTenantUser,
  toRecommendationAccessScope,
} from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const requestSchema = conversationContextFlagsSchema.extend({
  confirm: z.boolean(),
  editedQueryPatch: conversationQueryPatchSchema.optional(),
  editedFilterPatch: conversationMessageFilterSchema.optional(),
})

/**
 * Confirm or reject a pending (AI-suggested) filter patch. Confirming re-runs the
 * search and generates an LLM narrative, so it shares the chat rate bucket and
 * — unlike the other filter routes — reserves a FUNDING_CHAT message slot.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  const limited = enforceChatRateLimit(auth.userId)
  if (limited) return limited

  try {
    const parsed = requestSchema.parse(await request.json().catch(() => ({})))
    const response = await recommendationConversationService.confirmPendingPatch(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    return NextResponse.json(response)
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to confirm pending filter patch')
  }
}
