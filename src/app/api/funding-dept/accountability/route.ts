import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import {
  getMemberSchoolMatrix,
  resolveActivityWindow,
} from '@/lib/fundingDept/accountabilityService'
import { isLensError, refuseSchoolHead, resolveReportLens } from '@/lib/fundingDept/reportAccess'

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
 *
 * The clamp itself lives in `resolveReportLens`, shared with the three report
 * endpoints beside this one. Four copies of it would have become four rules.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)
  const window = await resolveActivityWindow(context.tenantId, searchParams.get('window'))

  const lens = await resolveReportLens(context, {
    schoolId: searchParams.get('schoolId'),
    memberId: searchParams.get('memberId'),
  })
  if (isLensError(lens)) {
    return NextResponse.json({ error: lens.error }, { status: lens.status })
  }

  // Closed to a school head. This grid is officer by officer, with each one's
  // flags and attention score — the department's own performance management,
  // not a report about any one school. A Dean's two reports are on their own
  // page; see refuseSchoolHead for where that line comes from.
  const refusal = refuseSchoolHead(lens)
  if (refusal) return refusal

  const matrix = await getMemberSchoolMatrix(context.tenantId, {
    window,
    memberIds: lens.memberIds,
    // `undefined` is the matrix own "every school", and only a head or admin who
    // asked for no filter gets it. A member who named a school outside their
    // reach keeps the empty list and sees nothing, which is the point.
    schoolIds: lens.allSchools ? undefined : lens.schoolIds,
  })

  return NextResponse.json({ ...matrix, lens: lens.lens, viewer: lens.viewer })
}
