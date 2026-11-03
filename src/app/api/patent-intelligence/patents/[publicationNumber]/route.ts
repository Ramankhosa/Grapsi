import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { patentNestFieldsSchema } from '@/lib/patentnest/searchContract'
import { PATENT_PRIVATE_HEADERS } from '@/lib/patentIntelligence/http'
import {
  enforcePatentRateLimit,
  isPatentSearchEnabled,
  patentErrorResponse,
  patentIntelligenceService,
} from '@/lib/patentIntelligence/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
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
    const rawFields = request.nextUrl.searchParams.getAll('fields')
    const fields = rawFields.length ? patentNestFieldsSchema.parse(rawFields.flatMap(value => value.split(',').map(field => field.trim()))) : undefined
    const result = fields ? await patentIntelligenceService.getPatent(publicationNumber, { fields }) : await patentIntelligenceService.getPatent(publicationNumber)
    return NextResponse.json(result, { headers: PATENT_PRIVATE_HEADERS })
  } catch (error) {
    return patentErrorResponse(error)
  }
}
