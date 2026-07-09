import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { completeIdeaIntelligenceUsage, releaseIdeaIntelligenceUsage, reserveIdeaIntelligenceUsage } from '@/lib/ideaIntelligence/quota'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response
  const reservation = await reserveIdeaIntelligenceUsage(auth.actor, params.runId, 'idea_intelligence_execute')
  if ('response' in reservation) return reservation.response

  try {
    const run = await ideaIntelligenceService.execute(params.runId, {
      userId: auth.actor.id,
      tenantId: auth.actor.tenantId,
      access: { tenantId: auth.actor.tenantId, isSuperAdmin: auth.actor.isSuperAdmin },
    })
    if (run.status === 'COMPLETED') {
      await completeIdeaIntelligenceUsage(reservation, auth.actor, 'idea_intelligence_execute', { runId: run.id })
    }
    return NextResponse.json({ run })
  } catch (error) {
    await releaseIdeaIntelligenceUsage(reservation)
    console.error('[IdeaIntelligence/Execute] Failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Idea analysis failed' }, { status: 500 })
  }
}
