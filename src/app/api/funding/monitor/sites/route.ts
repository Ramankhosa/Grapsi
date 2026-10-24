import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/funding/monitor/sites — every site with its watch points and evidence counts. */
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const status = request.nextUrl.searchParams.get('status')
  const sites = await prisma.monitorSite.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: 'asc' }, { host: 'asc' }],
    take: 500,
    include: {
      sources: {
        select: {
          id: true,
          name: true,
          url: true,
          kind: true,
          status: true,
          fetch_mode: true,
          next_check_at: true,
          last_checked_at: true,
          last_complete_check_at: true,
          last_error: true,
          check_generation: true,
        },
      },
      _count: { select: { resources: true } },
    },
  })
  return NextResponse.json({ sites }, { headers: { 'Cache-Control': 'private, no-store' } })
}
