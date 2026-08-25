import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import {
  enforcePatentRateLimit,
  isPatentSearchEnabled,
  patentErrorResponse,
  patentIntelligenceService,
} from '@/lib/patentIntelligence/service'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest, { params }: { params: { publicationNumber: string } }) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  if (!isPatentSearchEnabled()) {
    return NextResponse.json(
      { error: 'Patent search is not enabled for this deployment.', code: 'PATENT_SEARCH_NOT_CONFIGURED' },
      { status: 503 },
    )
  }

  const limited = enforcePatentRateLimit(auth.actor.id, 'detail')
  if (limited) return limited

  let publicationNumber = ''
  try {
    publicationNumber = decodeURIComponent(params.publicationNumber || '').trim()
  } catch {
    publicationNumber = String(params.publicationNumber || '').trim()
  }
  if (!publicationNumber || publicationNumber.length > 200) {
    return NextResponse.json({ error: 'A valid publication number is required.', code: 'INVALID_REQUEST' }, { status: 400 })
  }

  try {
    const result = await patentIntelligenceService.getPatent(publicationNumber)
    return NextResponse.json(result)
  } catch (error) {
    return patentErrorResponse(error)
  }
}
