import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { pipelineSummary } from '@/lib/monitor/pipelineSummary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/pipeline — live counts for the five stage cards. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  return NextResponse.json(await pipelineSummary(), { headers: { 'Cache-Control': 'private, no-store' } })
}
