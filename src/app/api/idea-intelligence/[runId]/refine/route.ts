import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { requireFundingActor } from '@/lib/funding/access'
import { completeIdeaIntelligenceUsage, releaseIdeaIntelligenceUsage, reserveIdeaIntelligenceUsage } from '@/lib/ideaIntelligence/quota'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'
export const maxDuration = 120

const refineSchema = z.object({
  objective: z.enum(['maximize_white_space', 'target_funder', 'reduce_risk']).optional().default('maximize_white_space'),
  instructions: z.string().max(1500).optional(),
  candidateId: z.string().min(8).optional(),
  editedIdeaText: z.string().min(50).max(12000).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) return auth.response

  let reservation: Awaited<ReturnType<typeof reserveIdeaIntelligenceUsage>> | null = null
  try {
    const input = refineSchema.parse(await request.json())
    reservation = await reserveIdeaIntelligenceUsage(
      auth.actor,
      `refine:${params.runId}:${randomUUID()}`,
      'idea_intelligence_refine'
    )
    if ('response' in reservation) return reservation.response

    const run = await ideaIntelligenceService.refineRun(params.runId, input, {
      userId: auth.actor.id,
      tenantId: auth.actor.tenantId,
      access: { tenantId: auth.actor.tenantId, isSuperAdmin: auth.actor.isSuperAdmin },
    })
    await completeIdeaIntelligenceUsage(reservation, auth.actor, 'idea_intelligence_refine', { sourceRunId: params.runId, runId: run.id })
    return NextResponse.json({ run }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid refinement request' }, { status: 400 })
    }
    if (reservation) await releaseIdeaIntelligenceUsage(reservation)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to refine idea' }, { status: 500 })
  }
}
