export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { conversationMessageRequestSchema } from '@/lib/recommendations/messageSchema'
import {
  requireRecommendationTenantUser,
  toRecommendationAccessScope,
} from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

async function cataloguePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  // Same per-user bucket as the SSE route and the filter routes.

  try {
    const parsed = conversationMessageRequestSchema.parse(await request.json())
    const response = await recommendationConversationService.processMessage(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed,
      toRecommendationAccessScope(auth.actor)
    )
    return NextResponse.json(response)
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to process recommendation message')
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'ai', 'FUNDING_CHAT')
