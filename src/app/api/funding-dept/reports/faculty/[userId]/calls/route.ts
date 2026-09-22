import { NextRequest, NextResponse } from 'next/server'
import { findCallsInMyAreas } from '@/lib/funding/myAreasService'
import { managementAccess, schoolIsAccessible } from '@/lib/fundingDept/managementAccess'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { userId: string } }) {
  const access = await managementAccess(request)
  if ('response' in access) return access.response

  const person = await prisma.user.findFirst({
    where: { id: params.userId, tenantId: access.context.tenantId, status: 'ACTIVE' },
    select: { id: true, name: true, email: true, researcher_profile: { select: { org_unit: { select: { path: true } } } } },
  })
  const schoolId = person?.researcher_profile?.org_unit?.path[0]
  if (!person || !schoolId || !(await schoolIsAccessible(access, schoolId))) {
    return NextResponse.json({ error: 'Researcher not found in your accessible schools.' }, { status: 404 })
  }

  const status = new URL(request.url).searchParams.get('includeExpired') === 'true' ? 'all' : 'active'
  const result = await findCallsInMyAreas(person.id, access.context.tenantId, { status, limit: 200 })
  const callIds = result.calls.map(call => call.id)
  const [assignments, candidates] = await Promise.all([
    prisma.callAssignment.findMany({
      where: { tenant_id: access.context.tenantId, assignee_user_id: person.id, funding_call_id: { in: callIds } },
      select: { id: true, funding_call_id: true, status: true, outcome: true, deadline_at: true, created_at: true },
    }),
    prisma.callCandidate.findMany({
      where: { tenant_id: access.context.tenantId, user_id: person.id, funding_call_id: { in: callIds } },
      select: { funding_call_id: true, status: true, note: true, updated_at: true },
    }),
  ])

  return NextResponse.json({
    person: { id: person.id, name: person.name || person.email, schoolId },
    readiness: result.readiness,
    counts: result.counts,
    calls: result.calls.map(call => ({
      ...call,
      assignment: assignments.find(row => row.funding_call_id === call.id) || null,
      candidate: candidates.find(row => row.funding_call_id === call.id) || null,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
