import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import {
  getFacultyResponsiveness,
  getUnitSummary,
  resolveActivityWindow,
} from '@/lib/fundingDept/accountabilityService'
import { getSchoolCoverage } from '@/lib/fundingDept/membershipService'
import { getFunnelForUnits } from '@/lib/fundingDept/schoolFunnelService'
import { listSubtreeUnitIds } from '@/lib/orgUnits/tree'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * A Dean's or Head of Department's own dashboard.
 *
 * The department's screens answer "is the office chasing". This one answers the
 * other half, which nobody could see before: what funding actually reached my
 * school, who in my school is sitting on it, and who do I call when nothing is
 * happening. Deans have had API-level report access for a while through their
 * manager grant, but no page and no menu entry, so in practice they had
 * nothing.
 *
 * Scoped strictly to granted units — no coverage rows involved, because a Dean
 * is not department staff. A tenant admin with no grants sees every school, so
 * they can check what a head would see.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)
  const window = await resolveActivityWindow(context.tenantId, searchParams.get('window'))

  const grants = await prisma.orgUnitManager.findMany({
    where: { tenant_id: context.tenantId, user_id: context.user.id, is_active: true },
    select: {
      org_unit_id: true,
      title: true,
      scope: true,
      can_view_reports: true,
      org_unit: { select: { id: true, name: true, code: true, depth: true, path: true } },
    },
  })

  let units = grants
    .filter((grant) => grant.org_unit && grant.can_view_reports)
    .map((grant) => ({
      id: grant.org_unit!.id,
      name: grant.org_unit!.name,
      code: grant.org_unit!.code,
      depth: grant.org_unit!.depth,
      path: grant.org_unit!.path,
      title: grant.title,
      scope: grant.scope as 'SUBTREE' | 'UNIT_ONLY',
    }))

  // An admin holds no grants, so without this the person who has to verify the
  // page sees an empty one.
  if (units.length === 0 && context.isAdmin) {
    const roots = await prisma.tenantOrgUnit.findMany({
      where: { tenant_id: context.tenantId, depth: 0, is_active: true },
      select: { id: true, name: true, code: true, depth: true, path: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      take: 25,
    })
    units = roots.map((unit) => ({ ...unit, title: null, scope: 'SUBTREE' as const }))
  }

  if (units.length === 0) {
    return NextResponse.json(
      { error: 'You do not head any school or department.' },
      { status: 403 }
    )
  }

  const funnels = await getFunnelForUnits(
    context.tenantId,
    units.map((unit) => unit.id)
  )
  const funnelByUnit = new Map(funnels.map((row) => [row.schoolId, row]))
  const coverage = await getSchoolCoverage(context.tenantId)
  const coverageByRoot = new Map(coverage.map((row) => [row.id, row]))

  const sections = await Promise.all(
    units.map(async (unit) => {
      // UNIT_ONLY authority stops at the unit itself; a Dean's reaches down.
      const subtree =
        unit.scope === 'UNIT_ONLY'
          ? [unit.id]
          : await listSubtreeUnitIds(context.tenantId, [unit.id])
      const unitIds = subtree.length > 0 ? subtree : [unit.id]

      const [summary, faculty] = await Promise.all([
        getUnitSummary(context.tenantId, unitIds),
        getFacultyResponsiveness(context.tenantId, unitIds, window),
      ])
      const funnel = funnelByUnit.get(unit.id)
      const root = coverageByRoot.get(unit.path?.[0] || unit.id) || null

      return {
        unit: {
          id: unit.id,
          name: unit.name,
          code: unit.code,
          depth: unit.depth,
          title: unit.title,
          scope: unit.scope,
        },
        schoolRootId: unit.path?.[0] || unit.id,
        funnel: funnel
          ? {
              relevantOpen: funnel.relevantOpen,
              pending: funnel.pending,
              untouchedPending: funnel.untouchedPending,
              shortlisted: funnel.shortlisted,
              assignedCalls: funnel.assignedCalls,
              isUnmapped: funnel.isUnmapped,
              lastContactAt: funnel.lastContactAt,
            }
          : null,
        summary,
        faculty,
        dsrContact: root
          ? {
              name: root.memberName,
              deputyName: root.deputyName,
              covered: root.covered,
              isAway: root.primaryAway,
              uncoveredRightNow: root.uncoveredRightNow,
            }
          : null,
      }
    })
  )

  return NextResponse.json({ window, sections })
}
