import { NextRequest, NextResponse } from 'next/server'

import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { getReportingPeriod, resolvePeriod } from '@/lib/tenant/reportingPeriod'

export const dynamic = 'force-dynamic'

/**
 * The tenant's period of consideration.
 *
 * GET  - the window in force right now (rolled forward), plus the raw dates as
 *        stored so the form shows what was actually entered.
 * PUT  - set or clear it. Tenant admins only: it changes the denominator of
 *        every workload number the funding department sees.
 */

function toIsoDate(value: Date): string {
  // Date-only, in the server's local terms, because the window is expressed in
  // whole days and an ISO timestamp would shift it across a timezone boundary.
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

/** Parse a `YYYY-MM-DD` from the form into a local-midnight Date. */
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request)
  if (auth.error) return auth.error
  const user = auth.user!
  if (!user.tenant_id) {
    return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenant_id },
    select: {
      reporting_period_start: true,
      reporting_period_end: true,
      reporting_period_label: true,
    },
  })
  const period = await getReportingPeriod(user.tenant_id)

  return NextResponse.json({
    configured: Boolean(tenant?.reporting_period_start && tenant?.reporting_period_end),
    stored: {
      start: tenant?.reporting_period_start ? toIsoDate(tenant.reporting_period_start) : null,
      end: tenant?.reporting_period_end ? toIsoDate(tenant.reporting_period_end) : null,
      label: tenant?.reporting_period_label ?? null,
    },
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      startDate: toIsoDate(period.start),
      endDate: toIsoDate(period.end),
      label: period.label,
      isDefault: period.isDefault,
    },
  })
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateRequest(request)
  if (auth.error) return auth.error
  const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
  if (roleCheck) return roleCheck

  const user = auth.user!
  if (!user.tenant_id) {
    return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Clearing is a legitimate choice: it returns the tenant to the calendar year.
  if (body.clear === true) {
    await prisma.tenant.update({
      where: { id: user.tenant_id },
      data: {
        reporting_period_start: null,
        reporting_period_end: null,
        reporting_period_label: null,
      },
    })
    return GET(request)
  }

  const start = parseDateOnly(body.start)
  const end = parseDateOnly(body.end)
  if (!start || !end) {
    return NextResponse.json(
      { error: 'Give both a start and an end date, as YYYY-MM-DD.' },
      { status: 400 }
    )
  }
  if (end <= start) {
    return NextResponse.json({ error: 'The end date must fall after the start date.' }, { status: 400 })
  }
  // A window longer than two years is almost certainly a typo, and it would
  // make "already carrying" meaningless.
  const spanDays = (end.getTime() - start.getTime()) / 86_400_000
  if (spanDays > 731) {
    return NextResponse.json(
      { error: 'A period of consideration cannot be longer than two years.' },
      { status: 400 }
    )
  }

  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : ''

  await prisma.tenant.update({
    where: { id: user.tenant_id },
    data: {
      reporting_period_start: start,
      reporting_period_end: end,
      reporting_period_label: label || null,
    },
  })

  const period = resolvePeriod(start, end, label || null)
  return NextResponse.json({
    configured: true,
    stored: { start: toIsoDate(start), end: toIsoDate(end), label: label || null },
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      startDate: toIsoDate(period.start),
      endDate: toIsoDate(period.end),
      label: period.label,
      isDefault: false,
    },
  })
}
