export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { requireRecommendationTenantUser } from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

async function cataloguePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const conversation = await recommendationConversationService.clearConversation(auth.userId, auth.tenantId, params.id)
    return NextResponse.json({ conversation })
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to clear recommendation conversation')
  }
}

export const POST = withCatalogueProtection(cataloguePOST, 'summary', 'FUNDING_CHAT')
