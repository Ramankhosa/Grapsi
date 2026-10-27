import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { LANE_LABELS, discoveryWorkbook } from '@/lib/monitor/discoveryExport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/discoveries/export?lane=PENDING — an Excel workbook of one Review lane, for manual review. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  const lane = request.nextUrl.searchParams.get('lane') ?? 'PENDING'
  if (!(lane in LANE_LABELS)) return NextResponse.json({ message: 'Unknown lane' }, { status: 400 })
  const now = new Date()
  const bytes = await discoveryWorkbook(lane, auth.actor.email, now)
  const name = `source-watch-${lane.toLowerCase().replace(/_/g, '-')}-${now.toISOString().slice(0, 10)}.xlsx`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
