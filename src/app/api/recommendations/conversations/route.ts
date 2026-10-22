export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationTenantUser } from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const createSchema = z.object({
  title: z.string().max(120).optional(),
})

async function catalogueGET(request: NextRequest) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const conversations = await recommendationConversationService.listConversations(auth.userId, auth.tenantId)
    return NextResponse.json({ conversations })
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to load recommendation conversations')
  }
}

async function cataloguePOST(request: NextRequest) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  // Creation has its own bucket: the chat bucket is keyed per user (not per
  // conversation), so minting conversations no longer buys extra chat capacity,
  // but unbounded creation is still cheap abuse of the DB and usage ledger.

  try {
    const parsed = createSchema.parse(await request.json().catch(() => ({})))
    const conversation = await recommendationConversationService.createConversation(
      auth.userId,
      auth.tenantId,
      parsed.title
    )
    return NextResponse.json({ conversation }, { status: 201 })
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to create recommendation conversation')
  }
}

export const GET = withCatalogueProtection(catalogueGET, 'summary', 'FUNDING_CHAT')

export const POST = withCatalogueProtection(cataloguePOST, 'summary', 'FUNDING_CHAT')
