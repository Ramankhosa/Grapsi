import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { resolveActivityWindow } from '@/lib/fundingDept/accountabilityService'
import { backlogToCsv, getUnallocatedBacklog } from '@/lib/fundingDept/pendencyService'
import { isLensError, lensIsEmpty, resolveReportLens } from '@/lib/fundingDept/reportAccess'
import { getDeptSettings } from '@/lib/fundingDept/settings'

export const dynamic = 'force-dynamic'

/**
 * The calls nobody has taken up, named one by one.
 *
 * The grid already counts these. This is the list behind the count, which is the
 * difference between a head knowing somebody is behind and being able to do
 * something about it.
 *
 * `?format=csv` returns the spreadsheet a governing-body meeting asks for. Fetch
 * it with `authFetch` and save the blob: auth here is Bearer-only.
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

  // A member whose reach is empty gets an empty report, never the whole tenant.
  const minDaysParam = Number(params.get('minDays'))
  const result = lensIsEmpty(lens)
    ? {
        window,
        untouchedDays: settings.untouchedDays,
        calls: [],
        totals: { calls: 0, schools: 0, closingSoon: 0, uncovered: 0, oldestDays: 0 },
      }
    : await getUnallocatedBacklog(context.tenantId, {
        window,
        schoolIds: lens.schoolIds,
        settings,
        // Below the tenant threshold the list would include calls that arrived
        // this morning, which is not a pendency and would bury the real ones.
        minDays: Number.isFinite(minDaysParam)
          ? Math.max(minDaysParam, settings.untouchedDays)
          : undefined,
        includeClosed: params.get('includeClosed') === 'true',
      })

  if (params.get('format') === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(backlogToCsv(result.calls), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="unallocated-calls-${stamp}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  return NextResponse.json({ ...result, lens: lens.lens, viewer: lens.viewer })
}
