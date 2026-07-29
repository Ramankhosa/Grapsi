import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingActor } from '@/lib/funding/access'
import { completeIdeaIntelligenceUsage, releaseIdeaIntelligenceUsage, reserveIdeaIntelligenceUsage } from '@/lib/ideaIntelligence/quota'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'
export const maxDuration = 300

const callFitSchema = z.object({
  fundingCallId: z.string().min(1, 'Pick a funding call first.').max(80),
})

// Step 3 of the funding match: read the idea against the one call the user
// picked. The only step here that costs an LLM call, so it is metered.
export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  let input: z.infer<typeof callFitSchema>
  try {
    input = callFitSchema.parse(await request.json())
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message : 'Invalid funding call'
    return NextResponse.json({ error: message || 'Invalid funding call' }, { status: 400 })
  }

  const reservation = await reserveIdeaIntelligenceUsage(
    auth.actor,
    `${params.runId}:call-fit:${input.fundingCallId}`,
    'idea_intelligence_call_fit'
  )
  if ('response' in reservation) return reservation.response

  try {
    const run = await ideaIntelligenceService.evaluateAgainstCall(params.runId, input.fundingCallId, {
      userId: auth.actor.id,
      tenantId: auth.actor.tenantId,
      access: { tenantId: auth.actor.tenantId, isSuperAdmin: auth.actor.isSuperAdmin },
    })
    await completeIdeaIntelligenceUsage(reservation, auth.actor, 'idea_intelligence_call_fit', {
      runId: params.runId,
      fundingCallId: input.fundingCallId,
    })
    return NextResponse.json({ run })
  } catch (error) {
    await releaseIdeaIntelligenceUsage(reservation)
    console.error('[IdeaIntelligence/CallFit] Failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to check this idea against the call'
    const status = message === 'Idea analysis not found'
      ? 404
      : message.startsWith('Finding funding opportunities is available')
        ? 409
        : message.startsWith('The selected funding call')
          ? 404
          : 500
    return NextResponse.json({ error: message }, { status })
  }
}
