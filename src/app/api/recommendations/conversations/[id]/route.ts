import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationTenantUser } from '@/lib/recommendations/request-auth'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const updateSchema = z.object({
  title: z.string().max(120).optional(),
  filterMode: z.enum(['manual', 'auto']).optional(),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const conversation = await recommendationConversationService.getConversation(auth.userId, auth.tenantId, params.id)
    return NextResponse.json({ conversation })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load recommendation conversation',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to update recommendation conversation',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    await recommendationConversationService.deleteConversation(auth.userId, auth.tenantId, params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to delete recommendation conversation',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
