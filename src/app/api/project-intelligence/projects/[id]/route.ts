import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { publicProjectSearchService } from '@/lib/publicProjects/searchService'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  try {
    const project = await publicProjectSearchService.getProject(params.id)
    if (!project) {
      return NextResponse.json({ error: 'Funded project not found' }, { status: 404 })
    }
    return NextResponse.json({ project })
  } catch (error) {
    console.error('[ProjectIntelligence/Project] Failed:', error)
    return NextResponse.json({ error: 'Failed to load the funded project' }, { status: 500 })
  }
}
