import { NextRequest, NextResponse } from 'next/server'
import { isAccessError, requireTenantRoles, TENANT_ASSIGNER_ROLES } from '@/lib/auth/tenantAccess'
import {
  DASHBOARD_GROUP_BY,
  DashboardFilters,
  DashboardGroupBy,
  getReport,
  reportToCsv,
} from '@/lib/assignments/dashboardService'
import { parseDate } from '@/lib/assignments/shared'

export const dynamic = 'force-dynamic'

/**
 * Grouped statistics over the tenant's assignments — by agency, call, school,
 * department, faculty, year or month — for any date range. `format=csv`
 * returns the same rows as a download.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_ASSIGNER_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)

  const requestedGroupBy = (searchParams.get('groupBy') || 'agency') as DashboardGroupBy
  if (!DASHBOARD_GROUP_BY.includes(requestedGroupBy)) {
    return NextResponse.json(
      { error: `groupBy must be one of: ${DASHBOARD_GROUP_BY.join(', ')}` },
      { status: 400 }
    )
  }

  const filters: DashboardFilters = {
    tenantId: context.tenantId,
    orgUnitIds: searchParams
      .getAll('orgUnitIds')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 200),
    // Accept both from/to and dateFrom/dateTo so the dashboard and report
    // panels can share one filter object on the client.
    dateFrom: parseDate(searchParams.get('from') || searchParams.get('dateFrom')),
    dateTo: parseDate(searchParams.get('to') || searchParams.get('dateTo')),
    agency: (searchParams.get('agency') || '').trim() || null,
  }

  try {
    const rows = await getReport(filters, requestedGroupBy)

    if ((searchParams.get('format') || '').toLowerCase() === 'csv') {
      const stamp = new Date().toISOString().slice(0, 10)
      return new NextResponse(reportToCsv(rows, requestedGroupBy), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="grant-report-${requestedGroupBy}-${stamp}.csv"`,
        },
      })
    }

    return NextResponse.json({ groupBy: requestedGroupBy, rows })
  } catch (error) {
    console.error('Grant report query failed:', error)
    return NextResponse.json({ error: 'Could not build the report.' }, { status: 500 })
  }
}
