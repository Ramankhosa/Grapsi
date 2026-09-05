import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getSummary, getUnassignedUpcomingCalls } from '@/lib/assignments/dashboardService'
import { getSchoolCoverage, listMembers } from '@/lib/fundingDept/membershipService'
import { canReviewDept, serializeMember } from '@/lib/fundingDept/shared'
import { getDepartmentTotals, getSchoolFunnel } from '@/lib/fundingDept/schoolFunnelService'

export const dynamic = 'force-dynamic'

/**
 * The head's view of the whole department: who is carrying what, which schools
 * nobody is covering, and how much chasing is actually being recorded.
 *
 * Per-member figures come from one getSummary call each rather than a grouped
 * report so every number uses the same bucket definitions as the member's own
 * dashboard — a head and a member looking at the same work must never see two
 * different counts. Departments are single-digit sized, so the round trips are
 * cheap and the consistency is worth more.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!canReviewDept(context, context.scope)) {
    return NextResponse.json(
      { error: 'Only the department head or an organization admin can view this.' },
      { status: 403 }
    )
  }

  const [members, coverage] = await Promise.all([
    listMembers(context.tenantId),
    getSchoolCoverage(context.tenantId),
  ])

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [summaries, followUpCounts, dueReminderCounts] = await Promise.all([
    Promise.all(
      members.map((member) =>
        getSummary({ tenantId: context.tenantId, assignedByUserIds: [member.user_id] })
      )
    ),
    prisma.assignmentFollowUp.groupBy({
      by: ['created_by_user_id'],
      where: { tenant_id: context.tenantId, happened_at: { gte: since } },
      _count: { _all: true },
    }),
    prisma.assignmentFollowUp.groupBy({
      by: ['created_by_user_id'],
      where: {
        tenant_id: context.tenantId,
        reminder_sent_at: null,
        remind_at: { not: null, lte: new Date() },
      },
      _count: { _all: true },
    }),
  ])

  const followUpsByUser = new Map(
    followUpCounts.map((row) => [row.created_by_user_id, row._count._all])
  )
  const dueByUser = new Map(
    dueReminderCounts.map((row) => [row.created_by_user_id, row._count._all])
  )

  const rows = members.map((member, index) => {
    const summary = summaries[index]
    return {
      ...serializeMember(member),
      schoolCount: member.school_assignments.length,
      active: summary.active,
      submitted: summary.submitted,
      missed: summary.missed,
      declined: summary.declined,
      cancelled: summary.cancelled,
      awarded: summary.awarded,
      total: summary.total,
      followUpsLast30Days: followUpsByUser.get(member.user_id) ?? 0,
      overdueReminders: dueByUser.get(member.user_id) ?? 0,
    }
  })

  // Per-school load, which the per-member table above cannot show: a member
  // covering four schools reads as one busy officer, and the head still cannot
  // see which of the four is actually carrying the work.
  //
  // Every school's subtree in one query, then bucketed in memory — a school
  // with no faculty must still appear with zeroes rather than vanish.
  const schoolIds = coverage.map((school) => school.id)
  const unitRows =
    schoolIds.length > 0
      ? await prisma.$queryRaw<Array<{ id: string; root: string }>>(Prisma.sql`
          SELECT id, unnest(path) AS root
          FROM tenant_org_units
          WHERE tenant_id = ${context.tenantId} AND is_active = true
        `)
      : []
  const rootByUnit = new Map<string, string[]>()
  for (const row of unitRows) {
    if (!schoolIds.includes(row.root)) continue
    const list = rootByUnit.get(row.id) || []
    list.push(row.root)
    rootByUnit.set(row.id, list)
  }

  const [assignmentRows, facultyRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        unitId: string
        active: number
        missed: number
        submitted: number
        declined: number
        awarded: number
      }>
    >(Prisma.sql`
      SELECT
        ca.assignee_org_unit_id AS "unitId",
        COUNT(*) FILTER (
          WHERE ca.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS')
            AND (ca.deadline_at IS NULL OR ca.deadline_at >= CURRENT_DATE)
        )::int AS active,
        COUNT(*) FILTER (
          WHERE ca.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS')
            AND ca.deadline_at IS NOT NULL AND ca.deadline_at < CURRENT_DATE
        )::int AS missed,
        COUNT(*) FILTER (WHERE ca.status = 'COMPLETED')::int AS submitted,
        COUNT(*) FILTER (WHERE ca.status = 'DECLINED')::int AS declined,
        COUNT(*) FILTER (WHERE ca.outcome = 'AWARDED')::int AS awarded
      FROM call_assignments ca
      WHERE ca.tenant_id = ${context.tenantId} AND ca.assignee_org_unit_id IS NOT NULL
      GROUP BY ca.assignee_org_unit_id
    `),
    prisma.$queryRaw<Array<{ unitId: string; faculty: number; busy: number }>>(Prisma.sql`
      SELECT
        rp.org_unit_id AS "unitId",
        COUNT(*)::int AS faculty,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM call_assignments ca
            WHERE ca.assignee_user_id = rp.user_id
              AND ca.tenant_id = ${context.tenantId}
              AND ca.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS')
          )
        )::int AS busy
      FROM researcher_profiles rp
      JOIN users u ON u.id = rp.user_id
      WHERE u."tenantId" = ${context.tenantId} AND rp.org_unit_id IS NOT NULL
      GROUP BY rp.org_unit_id
    `),
  ])

  const emptyBucket = () => ({
    active: 0,
    missed: 0,
    submitted: 0,
    declined: 0,
    awarded: 0,
    faculty: 0,
    busyFaculty: 0,
  })
  const bySchool = new Map(schoolIds.map((id) => [id, emptyBucket()]))
  for (const row of assignmentRows) {
    for (const root of rootByUnit.get(row.unitId) || []) {
      const bucket = bySchool.get(root)
      if (!bucket) continue
      bucket.active += row.active
      bucket.missed += row.missed
      bucket.submitted += row.submitted
      bucket.declined += row.declined
      bucket.awarded += row.awarded
    }
  }
  for (const row of facultyRows) {
    for (const root of rootByUnit.get(row.unitId) || []) {
      const bucket = bySchool.get(root)
      if (!bucket) continue
      bucket.faculty += row.faculty
      bucket.busyFaculty += row.busy
    }
  }

  const schoolRows = coverage.map((school) => ({
    ...school,
    ...(bySchool.get(school.id) || emptyBucket()),
  }))

  const uncovered = coverage.filter((school) => !school.covered)
  const openCalls = await getUnassignedUpcomingCalls(context.tenantId, {
    scopeUnitIds: context.scope.isTenantWide ? null : context.scope.managedUnitIds,
    withinDays: 45,
    limit: 25,
  })

  // The discipline funnel per school: what is relevant, and what nobody has
  // picked up. The assignment rollup below cannot see the second thing at all —
  // a school with a hundred untouched calls and one with nothing to do look
  // identical in it.
  const funnel = await getSchoolFunnel(context.tenantId)
  const funnelBySchool = new Map(funnel.map((row) => [row.schoolId, row]))
  const totals = await getDepartmentTotals(context.tenantId, funnel)

  const pendingByMember = new Map<string, number>()
  for (const member of members) {
    const covered = member.school_assignments.filter((row: any) => !row.is_deputy)
    pendingByMember.set(
      member.id,
      covered.reduce(
        (sum: number, row: any) => sum + (funnelBySchool.get(row.org_unit_id)?.pending ?? 0),
        0
      )
    )
  }

  return NextResponse.json({
    members: rows.map((row: any) => ({
      ...row,
      pendingInSchools: pendingByMember.get(row.id) ?? 0,
    })),
    schools: schoolRows.map((row: any) => {
      const extra = funnelBySchool.get(row.id)
      return {
        ...row,
        mappedAreas: extra?.mappedAreas ?? 0,
        isUnmapped: extra?.isUnmapped ?? true,
        relevantOpen: extra?.relevantOpen ?? 0,
        live: extra?.live ?? 0,
        pending: extra?.pending ?? 0,
        shortlisted: extra?.shortlisted ?? 0,
        awardAmount: extra?.awardAmount ?? 0,
        proposalsInReview: extra?.proposalsInReview ?? 0,
        proposalsCleared: extra?.proposalsCleared ?? 0,
        proposalsSubmitted: extra?.proposalsSubmitted ?? 0,
        proposalsSanctioned: extra?.proposalsSanctioned ?? 0,
        lastContactAt: extra?.lastContactAt ?? null,
      }
    }),
    departmentTotals: totals,
    uncovered,
    openCalls,
    totals: {
      members: rows.length,
      schools: coverage.length,
      uncovered: uncovered.length,
      active: rows.reduce((sum, row) => sum + row.active, 0),
      missed: rows.reduce((sum, row) => sum + row.missed, 0),
      declined: rows.reduce((sum, row) => sum + row.declined, 0),
      submitted: rows.reduce((sum, row) => sum + row.submitted, 0),
    },
  })
}
