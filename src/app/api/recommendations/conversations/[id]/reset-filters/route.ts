export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { conversationContextFlagsSchema } from '@/lib/recommendations/messageSchema'
import {
  requireRecommendationTenantUser,
  toRecommendationAccessScope,
} from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const requestSchema = conversationContextFlagsSchema

/**
 * "Clear all filters". Re-runs the search with default filters; no user message,
 * no LLM narrative. Shares the per-user chat rate bucket, not metered.
 */
async function cataloguePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }


  try {
    const parsed = requestSchema.parse(await request.json().catch(() => ({})))
    const response = await recommendationConversationService.resetFilters(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    // The service already returns `{ conversation, stale, clientTurnId }` — do not
    // wrap it again (the client reads `payload.conversation`).
    return NextResponse.json(response)
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to reset conversation filters')
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'ai', 'FUNDING_CHAT')
