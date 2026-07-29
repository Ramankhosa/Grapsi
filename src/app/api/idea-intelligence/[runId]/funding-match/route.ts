import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingActor, type FundingActor } from '@/lib/funding/access'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'

const matchSchema = z.object({
  agencyName: z.string().min(1, 'Pick a funder first.').max(160),
})

function actorContext(actor: FundingActor) {
  return {
    userId: actor.id,
    tenantId: actor.tenantId,
    access: { tenantId: actor.tenantId, isSuperAdmin: actor.isSuperAdmin },
  }
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Idea analysis not found') return 404
  if (message.startsWith('Finding funding opportunities is available')) return 409
  return 500
}

// Step 1 of the funding match: which funders have already sanctioned comparable
// work. Read-only and free — no LLM call, no write.
export async function GET(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const result = await ideaIntelligenceService.listFundingAgencies(params.runId, actorContext(auth.actor))
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load funder recommendations' },
      { status: errorStatus(error) }
    )
  }
}

// Step 2: the chosen funder's open calls, ranked against this idea.
export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const input = matchSchema.parse(await request.json())
    const fundingMatch = await ideaIntelligenceService.matchCallsForAgency(params.runId, input.agencyName, actorContext(auth.actor))
    return NextResponse.json({ fundingMatch })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid funder' }, { status: 400 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to find calls for this funder' },
      { status: errorStatus(error) }
    )
  }
}
