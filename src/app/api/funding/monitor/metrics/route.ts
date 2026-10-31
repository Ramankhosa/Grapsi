import { NextRequest, NextResponse } from 'next/server'
import { requireFundingReadOperatorRequest, requireFundingOperatorRequest } from '@/lib/fundingIntake/routeAuth'
import { qualityMetrics } from '@/lib/monitor/metrics'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const auth = await requireFundingReadOperatorRequest(request)
  if ('response' in auth) return auth.response
  return NextResponse.json(await qualityMetrics(request.nextUrl.searchParams.get('siteId') ?? undefined))
}
const verification = z.object({ siteId: z.string(), cohort: z.string().min(1).max(100), title: z.string().min(3).max(500), url: z.string().url(), announcedOn: z.string().date().optional(), matchedOpportunityId: z.string().optional() })
export async function POST(request: NextRequest) {
  const auth = await requireFundingOperatorRequest(request)
  if ('response' in auth) return auth.response
  const input = verification.safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ message: 'Invalid independently verified announcement' }, { status: 400 })
  const data = input.data
  if (data.matchedOpportunityId && !await prisma.monitorOpportunity.findFirst({ where: { id: data.matchedOpportunityId, site_id: data.siteId } })) return NextResponse.json({ message: 'The matching discovery must belong to this site' }, { status: 400 })
  const record = await prisma.monitorVerifiedAnnouncement.create({ data: { site_id: data.siteId, cohort: data.cohort, title: data.title, url: data.url, announced_on: data.announcedOn ? new Date(data.announcedOn) : null, matched_opportunity_id: data.matchedOpportunityId, verified_by_user_id: auth.actor.id } })
  return NextResponse.json({ id: record.id })
}
