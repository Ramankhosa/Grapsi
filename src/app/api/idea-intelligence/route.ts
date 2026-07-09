import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireFundingActor, type FundingActor } from '@/lib/funding/access'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'

const createSchema = z.object({
  ideaText: z.string().min(50, 'Describe the idea in at least 50 characters.').max(12000),
  title: z.string().max(140).optional(),
  anchorPublicProjectId: z.string().max(80).optional(),
})

function actorContext(actor: FundingActor) {
  return {
    userId: actor.id,
    tenantId: actor.tenantId,
    access: { tenantId: actor.tenantId, isSuperAdmin: actor.isSuperAdmin },
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response
  const runs = await ideaIntelligenceService.listRuns(auth.actor.id)
  return NextResponse.json({ runs })
}

export async function POST(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const input = createSchema.parse(await request.json())
    const run = await ideaIntelligenceService.createRun(input, actorContext(auth.actor))
    return NextResponse.json({ run }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message || 'Invalid idea' }, { status: 400 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create analysis' }, { status: 500 })
  }
}
