import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import {
  getMissedAssignments,
  getSummary,
  getUnassignedUpcomingCalls,
  getUpcomingDeadlines,
} from '@/lib/assignments/dashboardService'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { serializeMember } from '@/lib/fundingDept/shared'

export const dynamic = 'force-dynamic'

/**
 * One department member's worklist.
 *
 * Everything here is filtered to work THIS person delegated
 * (`assignedByUserIds`), not to their whole school scope — a member wants to
 * know what they are chasing, and mixing in a colleague's assignments in a
 * school they happen to share reach with would make the numbers unactionable.
 * The head's dept-wide view is /api/funding-dept/overview.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const membership = await getMembership(context.tenantId, context.user.id)
  const isActiveMember = Boolean(membership?.is_active)
  if (!isActiveMember && !context.isAdmin) {
    return NextResponse.json(
      { error: 'You are not a member of the funding department.' },
      { status: 403 }
    )
  }

  const filters = {
    tenantId: context.tenantId,
    assignedByUserIds: [context.user.id],
  }
  const schoolUnitIds = membership?.school_assignments.map((s) => s.org_unit_id) ?? []

  const [summary, upcoming, missed, dueReminders, openCalls] = await Promise.all([
    getSummary(filters),
    getUpcomingDeadlines(filters, 30, 25),
    getMissedAssignments(filters, 25),
    // Reminders this person set for themselves or for faculty that are now due.
    prisma.assignmentFollowUp.findMany({
      where: {
        tenant_id: context.tenantId,
        created_by_user_id: context.user.id,
        reminder_sent_at: null,
        remind_at: { not: null, lte: new Date() },
      },
      select: {
        id: true,
        note: true,
        kind: true,
        remind_at: true,
        remind_faculty: true,
        assignment: {
          select: {
            id: true,
            status: true,
            assignee: { select: { id: true, name: true, email: true } },
            funding_call: { select: { id: true, title: true, scheme_title: true } },
          },
        },
      },
      orderBy: { remind_at: 'asc' },
      take: 25,
    }),
    // Only meaningful for someone with schools; an admin without coverage would
    // otherwise get the whole tenant's backlog framed as their personal to-do.
    schoolUnitIds.length > 0
      ? getUnassignedUpcomingCalls(context.tenantId, {
          scopeUnitIds: context.scope.isTenantWide ? null : context.scope.managedUnitIds,
          withinDays: 45,
          limit: 15,
        })
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    member: membership ? serializeMember(membership) : null,
    summary,
    upcoming,
    missed,
    dueReminders: dueReminders.map((row) => ({
      id: row.id,
      note: row.note,
      kind: row.kind,
      remindAt: row.remind_at,
      remindFaculty: row.remind_faculty,
      assignmentId: row.assignment?.id ?? null,
      assignmentStatus: row.assignment?.status ?? null,
      facultyName: row.assignment?.assignee?.name || row.assignment?.assignee?.email || null,
      callTitle:
        row.assignment?.funding_call?.scheme_title || row.assignment?.funding_call?.title || null,
    })),
    openCalls,
  })
}
