export const dynamic = 'force-dynamic'
import { withCatalogueProtection } from '@/lib/catalogueProtection/guard'
import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { ideaIntelligenceService } from '@/lib/ideaIntelligence/service'

export const runtime = 'nodejs'

async function catalogueGET(request: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response
  const run = await ideaIntelligenceService.getRun(params.runId, auth.actor.id)
  if (!run) return NextResponse.json({ error: 'Idea analysis not found' }, { status: 404 })
  return NextResponse.json({ run })
}

export const GET=withCatalogueProtection(catalogueGET,'detail','FUNDING_INTELLIGENCE')
