export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationTenantUser } from '@/lib/recommendations/request-auth'
import { recommendationErrorResponse } from '@/lib/recommendations/routeErrors'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const updateSchema = z.object({
  title: z.string().max(120).optional(),
  filterMode: z.enum(['manual', 'auto']).optional(),
})

async function catalogueGET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const cursor = request.nextUrl.searchParams.get('beforeTurn')
    if (cursor !== null && (!/^\d+$/.test(cursor) || Number(cursor) < 1)) return NextResponse.json({ error: 'Invalid history page.' }, { status: 400 })
    const conversation = await recommendationConversationService.getConversation(auth.userId, auth.tenantId, params.id, cursor === null ? undefined : Number(cursor))
    return NextResponse.json({ conversation })
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to load recommendation conversation')
  }
}

async function cataloguePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = updateSchema.parse(await request.json())
    const conversation = await recommendationConversationService.updateConversation(
      auth.userId,
      auth.tenantId,
      params.id,
      { title: parsed.title, filterMode: parsed.filterMode }
    )
    return NextResponse.json({ conversation })
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to update recommendation conversation')
  }
}

async function catalogueDELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    await recommendationConversationService.deleteConversation(auth.userId, auth.tenantId, params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return recommendationErrorResponse(error, 'Failed to delete recommendation conversation')
  }
}

export const GET = withCatalogueProtection(catalogueGET, 'summary', 'FUNDING_CHAT')

export const PATCH = withCatalogueProtection(cataloguePATCH, 'summary', 'FUNDING_CHAT')

export const DELETE = withCatalogueProtection(catalogueDELETE, 'summary', 'FUNDING_CHAT')
