import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { accessibleCall, eventSelect, itemInclude, plannerContext, plannerFailure, PlannerError } from '@/lib/personalGrants/server'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const auth = await plannerContext(request)
  if ('response' in auth) return auth.response
  try {
    const from = new Date(request.nextUrl.searchParams.get('from') || '')
    const to = new Date(request.nextUrl.searchParams.get('to') || '')
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 43 * 86400000) throw new PlannerError('Choose a calendar range of up to six weeks.')
    const page = Number(request.nextUrl.searchParams.get('page') || 1)
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new PlannerError('Invalid page.')
    const where = { event_at: { gte: from, lt: to }, personal_grant: { ...auth.owner, funding_call: accessibleCall(auth.owner) } }
    const [events, total] = await Promise.all([
      prisma.personalGrantEvent.findMany({ where, select: { ...eventSelect, personal_grant: { include: itemInclude } }, orderBy: [{ event_at: 'asc' }, { id: 'asc' }], skip: (page - 1) * 200, take: 200 }),
      prisma.personalGrantEvent.count({ where }),
    ])
    return NextResponse.json({ events, total, page, pageSize: 200 }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return plannerFailure(error) }
}
