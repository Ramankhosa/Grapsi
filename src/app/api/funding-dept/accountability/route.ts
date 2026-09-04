import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import {
  getMemberSchoolMatrix,
  resolveActivityWindow,
} from '@/lib/fundingDept/accountabilityService'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { canReviewDept, memberReachSchoolIds, serializeMember } from '@/lib/fundingDept/shared'

export const dynamic = 'force-dynamic'

/**
 * Member -> school -> call, with the countable facts behind "who is not doing
 * the job".
 *
 * Three lenses, one endpoint, because they are the same grid seen from
 * different heights:
 *
 *   admin / department head   every member, every school, plus the schools
 *                             nobody covers
 *   an active member          their own row only — their rota AND anything
 *                             they deputise on, because during someone's leave
 *                             the deputy is the one doing the work
 *   anyone else               403
 *
 * A member is clamped rather than refused on purpose: an officer should be able
 * to see what the head sees about them. Nothing here is meant to be a secret
 * scorecard, and a number somebody cannot check is a number they cannot fix.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)
  const window = await resolveActivityWindow(context.tenantId, searchParams.get('window'))

  const reviewsDept = canReviewDept(context, context.scope)
  const membership = await getMembership(context.tenantId, context.user.id)
  const isActiveMember = Boolean(membership?.is_active)

  if (!reviewsDept && !isActiveMember) {
    return NextResponse.json(
      { error: 'Only the funding department can see this.' },
      { status: 403 }
    )
  }

  const requestedSchool = (searchParams.get('schoolId') || '').trim() || null
  const requestedMember = (searchParams.get('memberId') || '').trim() || null

  let memberIds: string[] | undefined
  let schoolIds: string[] | undefined

  if (reviewsDept) {
    if (requestedMember) memberIds = [requestedMember]
    if (requestedSchool) schoolIds = [requestedSchool]
  } else {
    // Clamped to this member's own reach. A requested school outside it
    // narrows to nothing rather than widening — the same shape the roster and
    // matching routes use.
    const serialized = serializeMember(membership)
    const reach = memberReachSchoolIds(serialized)
    memberIds = [serialized.id]
    schoolIds = requestedSchool
      ? reach.filter((id) => id === requestedSchool)
      : reach.length > 0
        ? reach
        : ['__none__']
  }

  const matrix = await getMemberSchoolMatrix(context.tenantId, { window, memberIds, schoolIds })

  return NextResponse.json({
    ...matrix,
    lens: reviewsDept ? 'department' : 'member',
    viewer: {
      memberId: membership?.id ?? null,
      isHead: Boolean(membership?.is_head),
      canReviewDept: reviewsDept,
    },
  })
}
