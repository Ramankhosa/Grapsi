import { NextRequest, NextResponse } from 'next/server'
import { isAccessError, requireTenantRoles, TENANT_ASSIGNER_ROLES } from '@/lib/auth/tenantAccess'
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
  const context = await requireTenantRoles(request, TENANT_ASSIGNER_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)

  // Tenant scope comes from the session, never from the query string.
  const filters: DashboardFilters = {
    tenantId: context.tenantId,
    orgUnitIds: searchParams
      .getAll('orgUnitIds')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 200),
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
      getUnassignedExpiredCalls(context.tenantId),
    ])

    return NextResponse.json({ summary, allocation, upcoming, missed, unassignedExpired })
  } catch (error) {
    console.error('Grant dashboard query failed:', error)
    return NextResponse.json({ error: 'Could not load the dashboard.' }, { status: 500 })
  }
}
