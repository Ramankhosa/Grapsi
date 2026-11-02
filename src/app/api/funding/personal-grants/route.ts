import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { accessibleCall, itemInclude, plannerContext, plannerFailure, PlannerError } from '@/lib/personalGrants/server'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const auth = await plannerContext(request)
  if ('response' in auth) return auth.response
  try {
    const params = request.nextUrl.searchParams
    const ids = params.get('callIds')?.split(',').filter(Boolean)
    if (ids && (ids.length > 100 || ids.some(id => id.length > 100))) throw new PlannerError('Select at most 100 grants.')
    const page = Number(params.get('page') || 1)
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new PlannerError('Invalid page.')
    const q = (params.get('q') || '').trim().slice(0, 200)
    const where = { ...auth.owner, funding_call: { AND: [accessibleCall(auth.owner), ...(q ? [{ OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { scheme_title: { contains: q, mode: 'insensitive' as const } }] }] : [])] },
      ...(ids ? { funding_call_id: { in: ids } } : params.get('view') === 'favourites' ? { is_favourite: true } : { OR: [{ is_favourite: true }, { notes: { not: '' } }, { events: { some: {} } }] }),
    }
    const [items, total] = await Promise.all([
      prisma.personalGrant.findMany({ where, include: itemInclude, orderBy: [{ updated_at: 'desc' }, { id: 'asc' }], skip: ids ? 0 : (page - 1) * 24, take: ids ? 100 : 24 }),
      prisma.personalGrant.count({ where }),
    ])
    return NextResponse.json({ items, total, page, pageSize: ids ? 100 : 24 }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return plannerFailure(error) }
}
