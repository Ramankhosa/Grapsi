import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { REVIEW_RESOLUTIONS } from '@/lib/fundingCatalogImport/constants'
import { resolveReviewItems } from '@/lib/fundingCatalogImport/review'
import { requireFundingOperatorRequest, requireFundingPublisherRequest } from '@/lib/fundingIntake/routeAuth'

export const runtime = 'nodejs'

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).max(2000).optional(),
  filter: z
    .object({
      reason: z.string().nullish(),
      tier: z.string().nullish(),
      state: z.enum(['open', 'resolved', 'all']).optional(),
      variant: z.enum(['only', 'exclude']).nullish(),
      runId: z.string().nullish(),
      q: z.string().max(200).nullish(),
    })
    .optional(),
  resolution: z.enum(REVIEW_RESOLUTIONS),
  keep: z.enum(['subject', 'candidate']).optional(),
  note: z.string().max(1000).nullish(),
})

/**
 * Resolves review items. Allowed for funding operators and publishers. Only
 * imported calls are ever changed; existing calls are never written.
 */
export async function POST(request: NextRequest) {
  let auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) auth = await requireFundingPublisherRequest(request)
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Invalid request', issues: parsed.error.issues }, { status: 400 })
  const { ids, filter, resolution, keep, note } = parsed.data
  if ((!ids || ids.length === 0) && !filter) return NextResponse.json({ message: 'Pass ids or a filter' }, { status: 400 })
  try {
    const result = await resolveReviewItems(prisma as any, {
      ids,
      filter: filter ? { ...filter, state: filter.state || 'open' } : undefined,
      resolution,
      keep,
      note: note || null,
      actorUserId: auth.actor.id,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Failed to resolve' }, { status: 500 })
  }
}
