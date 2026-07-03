import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true })
  if ('response' in auth) return auth.response
  const run = await ideaIntelligenceService.getRun(params.runId, auth.actor.id)
  if (!run) return NextResponse.json({ error: 'Idea analysis not found' }, { status: 404 })
  return NextResponse.json({ run })
}
