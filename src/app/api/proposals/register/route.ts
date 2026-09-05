import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { proposalReachUnitIds } from '@/lib/proposals/access'
import { buildRegisterRows, registerToCsv } from '@/lib/proposals/register'
import { PROPOSAL_STATUSES } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * The register as a spreadsheet — the artefact the office is asked for at an
 * audit or a governing-body meeting.
 *
 * Clamped to the caller's schools like every other department read. Fetch it
 * with `authFetch` and save the blob: auth here is Bearer-only.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const isOfficer =
    context.isAdmin || context.scope.isTenantWide || context.scope.fundingDept.isMember
  if (!isOfficer) {
    return NextResponse.json({ error: 'This is the funding department’s register.' }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  const statuses = params
    .getAll('status')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toUpperCase())
    .filter((value) => (PROPOSAL_STATUSES as readonly string[]).includes(value))

  const rows = await buildRegisterRows({
    tenantId: context.tenantId,
    reachUnitIds: proposalReachUnitIds(context),
    status: statuses.length ? statuses : null,
    orgUnitId: params.get('orgUnitId'),
    window: params.get('window'),
  })

  if (params.get('format') === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(registerToCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="proposal-register-${stamp}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  return NextResponse.json({ rows, total: rows.length })
}
