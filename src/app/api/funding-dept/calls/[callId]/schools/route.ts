import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getIncomingCalls } from '@/lib/fundingDept/incomingCalls'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/funding-dept/calls/[callId]/schools
 *
 * The call window's "All schools" panel: every school in the viewer's reach
 * that this call concerns, with how it got there, matched faculty, shortlist,
 * allocations, submissions and the coordinator's action status. The same rows
 * and definitions as Incoming Calls, for one call, so the two cannot disagree.
 *
 * Reach is the dossier's: a member sees the schools they cover (primary or
 * deputy); the head, an administrator, or a member with no coverage yet sees
 * every school.
 */
export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return NextResponse.json({ error: context.error }, { status: context.status })
  const membership = await getMembership(context.tenantId, context.user.id)
  if (!membership?.is_active && !context.isAdmin)
    return NextResponse.json({ error: 'You are not a member of the funding department.' }, { status: 403 })

  // Only a call this tenant can see: another tenant's private call must not be
  // confirmed, marked or reported on from here.
  const call = await prisma.fundingCall.findFirst({
    where: { AND: [{ id: params.callId }, visibleFundingCallWhere(context.tenantId, { includeTenantDrafts: true })] }, select: { id: true },
  })
  if (!call) return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })

  const covered = (membership?.school_assignments ?? []).map(row => row.org_unit_id)
  const wide = covered.length === 0 || context.scope.fundingDept.isHead || context.scope.isTenantWide
  const schools = await prisma.tenantOrgUnit.findMany({
    where: { tenant_id: context.tenantId, is_active: true, depth: 0, ...(wide ? {} : { id: { in: covered } }) },
    select: { id: true, name: true }, orderBy: { name: 'asc' },
  })

  try {
    const result = await getIncomingCalls(context.tenantId, {
      schoolIds: schools.map(s => s.id), includeExpired: true, callId: call.id, asOf: new Date(), page: 1, pageSize: 1,
    })
    const row = result.rows[0] || null
    const listed = new Set(row?.schools.map(s => s.schoolId) || [])
    return NextResponse.json({
      callId: call.id,
      row,
      /** Schools in reach this call has not reached — what the head can add. */
      otherSchools: schools.filter(s => !listed.has(s.id)),
      canAddSchool: Boolean(context.scope.fundingDept.isHead || context.isAdmin),
      matchesRefreshedAt: result.matchesRefreshedAt,
    })
  } catch (error) {
    console.error('Call schools panel failed', error)
    return NextResponse.json({ error: 'Could not load the schools for this call.' }, { status: 500 })
  }
}
