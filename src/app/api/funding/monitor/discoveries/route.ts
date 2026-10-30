import { NextRequest, NextResponse } from 'next/server'
import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { LANE_LABELS } from '@/lib/monitor/discoveryExport'
import { laneCounts, reviewLane } from '@/lib/monitor/reviewList'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * GET /api/funding/monitor/discoveries?lane=PENDING[&q=text][&lanes=PENDING,SNOOZED]
 * Every discovery in a lane as a summary row with the live duplicate check,
 * plus the counts of the lanes the screen shows. Details: /discoveries/[id].
 */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const params = request.nextUrl.searchParams
  const lane = params.get('lane') ?? 'PENDING'
  if (!LANE_LABELS[lane]) return NextResponse.json({ message: 'Unknown lane' }, { status: 400 })
  const lanes = (params.get('lanes') ?? lane).split(',').filter(l => LANE_LABELS[l]).slice(0, 12)
  const [list, counts] = await Promise.all([reviewLane(lane, { q: params.get('q')?.slice(0, 200) }), laneCounts(lanes)])
  return NextResponse.json({ ...list, counts }, { headers: { 'Cache-Control': 'private, no-store' } })
}
