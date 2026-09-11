import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { resolveActivityWindow } from '@/lib/fundingDept/accountabilityService'
import {
  engagementToCsv,
  getFacultyEngagement,
  type EngagementCode,
} from '@/lib/fundingDept/facultyEngagementService'
import { isLensError, lensIsEmpty, resolveReportLens } from '@/lib/fundingDept/reportAccess'
import { getDeptSettings } from '@/lib/fundingDept/settings'

export const dynamic = 'force-dynamic'

/**
 * Who in these schools has been sent nothing.
 *
 * The one population no existing report could show, because every other faculty
 * figure in the department is a GROUP BY over allocations and a person with no
 * allocations produces no row.
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

  const window = await resolveActivityWindow(context.tenantId, params.get('window'))
  const settings = await getDeptSettings(context.tenantId)

  const result = lensIsEmpty(lens)
    ? {
        window,
        dormantDays: settings.facultyDormantDays,
        rows: [],
        totals: {
          faculty: 0,
          engaged: 0,
          dormant: 0,
          neverAssigned: 0,
          unreachable: 0,
          actionable: 0,
        },
        bySchool: [],
      }
    : await getFacultyEngagement(context.tenantId, {
        window,
        schoolIds: lens.schoolIds,
        settings,
      })

  // Filtered after classification, never inside the query: the totals strip has
  // to keep describing the whole roster, or "2 never approached" silently becomes
  // "2 never approached, of the 2 I am looking at".
  const standing = (params.get('standing') || '').trim().toUpperCase()
  const rows = standing
    ? result.rows.filter((row) => row.code === (standing as EngagementCode))
    : result.rows

  if (params.get('format') === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(engagementToCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="faculty-engagement-${stamp}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  return NextResponse.json({ ...result, rows, lens: lens.lens, viewer: lens.viewer })
}
