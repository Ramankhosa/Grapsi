import { NextRequest, NextResponse } from 'next/server'

import { requireFundingReadOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/funding/monitor/sites/:id — the evidence for one site: recent check
 * runs (complete or not), and the resources its watch points have seen, newest
 * first, with each watch point's observation of them.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response

  const take = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get('take')) || 50))
  const site = await prisma.monitorSite.findUnique({
    where: { id: params.id },
    include: { sources: { select: { id: true, name: true, url: true, kind: true, status: true, fetch_mode: true } } },
  })
  if (!site) return NextResponse.json({ message: 'Not found' }, { status: 404 })

  const [checkRuns, resources, counts] = await Promise.all([
    prisma.monitorCheckRun.findMany({
      where: { source_id: { in: site.sources.map((s) => s.id) } },
      orderBy: { started_at: 'desc' },
      take: 30,
    }),
    prisma.monitorResource.findMany({
      where: { site_id: site.id, role: { not: 'LISTING' } },
      orderBy: { first_seen_at: 'desc' },
      take,
      select: {
        id: true,
        kind: true,
        role: true,
        canonical_url: true,
        title: true,
        first_seen_at: true,
        last_observed_at: true,
        last_validated_at: true,
        last_validation_status: true,
        observations: {
          select: {
            source_id: true,
            anchor_text: true,
            context_text: true,
            date_hints: true,
            first_seen_at: true,
            last_seen_at: true,
            missing_since: true,
          },
        },
      },
    }),
    prisma.monitorResource.groupBy({ by: ['role'], where: { site_id: site.id }, _count: { _all: true } }),
  ])

  return NextResponse.json(
    { site, checkRuns, resources, resourceCounts: Object.fromEntries(counts.map((c) => [c.role, c._count._all])) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
