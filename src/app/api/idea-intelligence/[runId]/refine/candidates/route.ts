import { randomUUID } from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingActor } from '@/lib/funding/access'
import { completeIdeaIntelligenceUsage, releaseIdeaIntelligenceUsage, reserveIdeaIntelligenceUsage } from '@/lib/ideaIntelligence/quota'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'
export const maxDuration = 120

const candidateSchema = z.object({
  objective: z.enum(['maximize_white_space', 'target_funder', 'reduce_risk']).optional(),
  instructions: z.string().max(1500).optional(),
  targetGapId: z.string().max(40).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  let reservation: Awaited<ReturnType<typeof reserveIdeaIntelligenceUsage>> | null = null
  try {
    const input = candidateSchema.parse(await request.json().catch(() => ({})))
    reservation = await reserveIdeaIntelligenceUsage(
      auth.actor,
      `refine-candidates:${params.runId}:${randomUUID()}`,
      'idea_intelligence_refine'
    )
    if ('response' in reservation) return reservation.response

    const candidates = await ideaIntelligenceService.generateRefinementCandidates(params.runId, input, {
      userId: auth.actor.id,
      tenantId: auth.actor.tenantId,
      access: { tenantId: auth.actor.tenantId, isSuperAdmin: auth.actor.isSuperAdmin },
    })
    await completeIdeaIntelligenceUsage(reservation, auth.actor, 'idea_intelligence_refine', {
      sourceRunId: params.runId,
      candidateCount: candidates.length,
    })
    return NextResponse.json({ candidates }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid refinement request' }, { status: 400 })
    }
    if (reservation) await releaseIdeaIntelligenceUsage(reservation)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate refinement candidates' }, { status: 500 })
  }
}
