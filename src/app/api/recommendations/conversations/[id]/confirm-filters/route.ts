import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRecommendationTenantUser } from '@/lib/recommendations/request-auth'
import { recommendationConversationService } from '@/lib/services/recommendationConversationService'

export const runtime = 'nodejs'

const requestSchema = z.object({
  confirm: z.boolean(),
  editedQueryPatch: z.record(z.any()).optional(),
  editedFilterPatch: z.record(z.any()).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRecommendationTenantUser(request)
  if ('response' in auth) {
    return auth.response
  }

  try {
    const parsed = requestSchema.parse(await request.json().catch(() => ({})))
    const response = await recommendationConversationService.confirmPendingPatch(
      auth.userId,
      auth.tenantId,
      params.id,
      parsed
    )
    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid confirmation payload', details: error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to confirm pending filter patch',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
