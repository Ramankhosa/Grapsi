import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { redactProjectListPeople } from '@/lib/publicProjects/redaction'
import { publicProjectSearchService } from '@/lib/publicProjects/searchService'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit')) || 8
    const results = await publicProjectSearchService.findSimilar(params.id, requestedLimit)
    return NextResponse.json({ results: redactProjectListPeople(results) })
  } catch (error) {
    console.error('[ProjectIntelligence/Similar] Failed:', error)
    return NextResponse.json({ error: 'Failed to find similar projects' }, { status: 500 })
  }
}
