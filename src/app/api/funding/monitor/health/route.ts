import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { monitorHealthSnapshot } from '@/lib/monitor/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/health — the Health strip: worker, queue, failures, budget. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const snapshot = await monitorHealthSnapshot()
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
}
