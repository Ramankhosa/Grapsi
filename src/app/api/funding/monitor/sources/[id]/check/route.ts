import { NextRequest, NextResponse } from 'next/server'

import { requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { runCheck } from '@/lib/monitor/checker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * "Check now" — deliberately outside the daily sweep, so a reviewer who has
 * just fixed a selector can see the result immediately instead of waiting
 * until tomorrow morning.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response

  const result = await runCheck(params.id)
  return NextResponse.json(result, { status: result.status === 'error' ? 502 : 200 })
}
