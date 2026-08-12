import { NextRequest, NextResponse } from 'next/server'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { intersectRequestedUnits } from '@/lib/orgUnits/scope'
import {
  DashboardFilters,
  getAllocation,
  getMissedAssignments,
  getSummary,
  getUnassignedExpiredCalls,
  getUpcomingDeadlines,
} from '@/lib/assignments/dashboardService'
import { parseDate } from '@/lib/assignments/shared'

export const dynamic = 'force-dynamic'

/**
 * Grant portfolio dashboard for tenant admins: headline buckets, allocation by
 * school/department/faculty, and the panels that need attention.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!context.scope.canViewReports) {
    return NextResponse.json(
      { error: 'You do not have permission to view the grant dashboard.' },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(request.url)
  const requestedUnitIds = searchParams
    .getAll('orgUnitIds')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 200)

  // Both tenant scope and org reach come from the session, never the query
  // string; the client may only narrow within what it already has.
  const filters: DashboardFilters = {
    tenantId: context.tenantId,
    scopeUnitIds: context.scope.isTenantWide ? null : context.scope.managedUnitIds,
    orgUnitIds: context.scope.isTenantWide
      ? requestedUnitIds
      : intersectRequestedUnits(context.scope, requestedUnitIds),
    dateFrom: parseDate(searchParams.get('dateFrom')),
    dateTo: parseDate(searchParams.get('dateTo')),
    agency: (searchParams.get('agency') || '').trim() || null,
  }

  try {
    const [summary, allocation, upcoming, missed, unassignedExpired] = await Promise.all([
      getSummary(filters),
      getAllocation(filters),
      getUpcomingDeadlines(filters),
      getMissedAssignments(filters),
      // "Nobody in the whole organization took this call" is an org-level miss
      // by definition, so it stays tenant-wide — but it is meaningless to a
      // scoped head, who should not be shown a number they cannot act on.
      context.scope.isTenantWide ? getUnassignedExpiredCalls(context.tenantId) : Promise.resolve([]),
    ])

    return NextResponse.json({
      summary,
      allocation,
      upcoming,
      missed,
      unassignedExpired,
      scope: {
        isTenantWide: context.scope.isTenantWide,
        isHead: context.scope.isHead,
        managedUnitIds: context.scope.managedUnitIds,
      },
    })
  } catch (error) {
    console.error('Grant dashboard query failed:', error)
    return NextResponse.json({ error: 'Could not load the dashboard.' }, { status: 500 })
  }
}
