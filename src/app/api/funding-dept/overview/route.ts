import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getSummary, getUnassignedUpcomingCalls } from '@/lib/assignments/dashboardService'
import { getSchoolCoverage, listMembers } from '@/lib/fundingDept/membershipService'
import { canReviewDept, serializeMember } from '@/lib/fundingDept/shared'

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

  const uncovered = coverage.filter((school) => !school.covered)
  const openCalls = await getUnassignedUpcomingCalls(context.tenantId, {
    scopeUnitIds: context.scope.isTenantWide ? null : context.scope.managedUnitIds,
    withinDays: 45,
    limit: 25,
  })

  return NextResponse.json({
    members: rows,
    schools: coverage,
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
