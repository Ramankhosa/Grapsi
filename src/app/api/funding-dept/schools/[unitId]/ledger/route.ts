import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import {
  getSchoolCallLedger,
  redactLedgerForSchoolHead,
  resolveActivityWindow,
} from '@/lib/fundingDept/accountabilityService'
import { getSchoolCoverage } from '@/lib/fundingDept/membershipService'
import { canOpenSchoolWork } from '@/lib/fundingDept/shared'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Every call this school could apply for, and what happened about each.
 *
 * Two audiences, one page: the officer who works the school, and the Dean or
 * HoD who answers for it. `canOpenSchoolWork` already admits both — a manager
 * grant on the school puts the unit in `managedUnitIds` — so the only
 * difference is the lens. A head sees who is assigned, where it stands, and
 * when the department last made contact. They do not see the note text: the
 * contact log is written for internal coordination, and notes written for that
 * purpose stop being honest once the subject's own head can read them.
 */
export async function GET(request: NextRequest, { params }: { params: { unitId: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unitId = (params.unitId || '').trim()
  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: unitId, tenant_id: context.tenantId },
    select: { id: true, name: true, path: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'School not found.' }, { status: 404 })
  }
  if (!canOpenSchoolWork(context.scope, unit.id)) {
    return NextResponse.json(
      { error: 'That school is outside the ones you cover.' },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(request.url)
  const window = await resolveActivityWindow(context.tenantId, searchParams.get('window'))

  const ledger = await getSchoolCallLedger(context.tenantId, unit.id, { window })

  // The officer lens is for the department itself and for tenant admins. A
  // Dean reaches this through a manager grant and gets the redacted copy.
  const isOfficer = context.isAdmin || context.scope.fundingDept.isMember
  const payload = isOfficer ? ledger : redactLedgerForSchoolHead(ledger)

  // Who to talk to about this school. Resolved from the school ROOT, since
  // coverage rows are keyed there and this unit may be a department.
  const rootId = unit.path?.[0] || unit.id
  const coverage = await getSchoolCoverage(context.tenantId)
  const school = coverage.find((row) => row.id === rootId) || null

  return NextResponse.json({
    ...payload,
    lens: isOfficer ? 'officer' : 'head',
    coveredBy: school?.covered
      ? {
          name: school.memberName ?? null,
          isMe: school.memberUserId === context.user.id,
          deputyName: school.deputyName ?? null,
          // A Dean whose officer is away with no stand-in should be told, not
          // left wondering why nothing is moving.
          isAway: school.primaryAway,
          uncoveredRightNow: school.uncoveredRightNow,
        }
      : null,
  })
}
