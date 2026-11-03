import { NextRequest, NextResponse } from 'next/server'

import { requireFundingActor } from '@/lib/funding/access'
import { searchRequestSchema } from '@/lib/patentIntelligence/schemas'
import { PATENT_PRIVATE_HEADERS, readPatentJson } from '@/lib/patentIntelligence/http'
import {
  enforcePatentRateLimit,
  isPatentSearchEnabled,
  patentErrorResponse,
  patentIntelligenceService,
} from '@/lib/patentIntelligence/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Hybrid and structured patent search over the PatentNest corpus. Deliberately unmetered
// (no usage-ledger write): it is a lookup, not an LLM run. Per-user and global
// rate limits plus a short cache protect the shared PatentNest key instead.
export async function POST(request: NextRequest) {
  const auth = await requireFundingActor(request, { allowPlatform: true, requiredServiceType: 'FUNDING_INTELLIGENCE' })
  if ('response' in auth) return auth.response

  if (!isPatentSearchEnabled()) {
    return NextResponse.json(
      { error: 'Patent search is not enabled for this deployment.', code: 'PATENT_SEARCH_NOT_CONFIGURED' },
      { status: 503 },
    )
  }

  const limited = enforcePatentRateLimit(auth.actor.id, 'search')
  if (limited) return limited

  try {
    const body = await readPatentJson(request)
    const input = searchRequestSchema.parse(body)
    const result = await patentIntelligenceService.searchPatents(input)
    const headers = new Headers(PATENT_PRIVATE_HEADERS)
    if (result.diagnostics.requestId) headers.set('X-Request-ID', result.diagnostics.requestId)
    return NextResponse.json(result, { headers })
  } catch (error) {
    return patentErrorResponse(error)
  }
}
