import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor, type FundingActor } from '@/lib/funding/access'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'

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

// The open calls in the catalogue that match this idea. A POST rather than a GET
// because it runs the catalogue search and records what was shown on the run.
export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const result = await ideaIntelligenceService.matchCallsForIdea(params.runId, actorContext(auth.actor))
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to find matching funding calls' },
      { status: errorStatus(error) }
    )
  }
}
