import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { resolveActivityWindow } from '@/lib/fundingDept/accountabilityService'
import { efficiencyToCsv, getOfficerEfficiency } from '@/lib/fundingDept/efficiencyService'
import {
  isLensError,
  lensIsEmpty,
  refuseSchoolHead,
  resolveReportLens,
} from '@/lib/fundingDept/reportAccess'
import { getDeptSettings } from '@/lib/fundingDept/settings'

export const dynamic = 'force-dynamic'

/**
 * How quickly each officer reacts, as opposed to how much is outstanding.
 *
 * The only endpoint that can answer "is this person slow" rather than "is this
 * person behind" — and the only one where a cleared queue and an empty one look
 * different.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const params = request.nextUrl.searchParams
  const lens = await resolveReportLens(context, {
    schoolId: params.get('schoolId'),
    memberId: params.get('memberId'),
  })
  if (isLensError(lens)) {
    return NextResponse.json({ error: lens.error }, { status: lens.status })
  }

  // Closed to a school head, unlike the backlog and the faculty roster: this
  // measures how fast the department's own officers work.
  const refusal = refuseSchoolHead(lens)
  if (refusal) return refusal

  const window = await resolveActivityWindow(context.tenantId, params.get('window'))
  const settings = await getDeptSettings(context.tenantId)

  const weeksParam = Number(params.get('weeks'))
  const result = lensIsEmpty(lens)
    ? {
        window,
        firstTouchTargetDays: settings.firstTouchTargetDays,
        dismissalRateWarnPct: settings.dismissalRateWarnPct,
        trendWeeks: [],
        members: [],
      }
    : await getOfficerEfficiency(context.tenantId, {
        window,
        settings,
        memberIds: lens.memberIds,
        // undefined is "every school", and only a head or admin who asked for no
        // filter reaches it.
        schoolIds: lens.allSchools ? undefined : lens.schoolIds,
        weeks: Number.isFinite(weeksParam) ? Math.min(Math.max(weeksParam, 0), 26) : undefined,
      })

  if (params.get('format') === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(efficiencyToCsv(result.members), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="officer-efficiency-${stamp}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  return NextResponse.json({ ...result, lens: lens.lens, viewer: lens.viewer })
}
