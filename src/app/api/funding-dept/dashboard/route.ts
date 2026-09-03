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

  const { searchParams } = new URL(request.url)
  const membership = await getMembership(context.tenantId, context.user.id)
  const isActiveMember = Boolean(membership?.is_active)
  if (!isActiveMember && !context.isAdmin) {
    return NextResponse.json(
      { error: 'You are not a member of the funding department.' },
      { status: 403 }
    )
  }

  // `mine` (default) is the personal chase list this endpoint was built for.
  // `schools` widens to everything landing in the schools the caller covers,
  // whoever delegated it — otherwise a call the head or a colleague assigns
  // into your school never appears in the numbers you are answerable for.
  const view = searchParams.get('view') === 'schools' ? 'schools' : 'mine'
  const reach = context.scope.isTenantWide ? null : context.scope.managedUnitIds

  const filters =
    view === 'schools'
      ? { tenantId: context.tenantId, scopeUnitIds: reach }
      : { tenantId: context.tenantId, assignedByUserIds: [context.user.id] }

  const schoolUnitIds = membership?.school_assignments.map((s) => s.org_unit_id) ?? []

  // In the personal view a due reminder is the caller's own tickler. In the
  // schools view it is anything now due on work inside their reach, so cover
  // does not depend on who happened to set the reminder.
  const reminderWhere =
    view === 'schools'
      ? {
          tenant_id: context.tenantId,
          reminder_sent_at: null,
          remind_at: { not: null, lte: new Date() },
          // Either an assignment inside reach, or a call-level tickler logged
          // against one of these schools before anyone was assigned. A to-one
          // relation filter alone would silently exclude the latter.
          ...(reach
            ? {
                OR: [
                  {
                    assignment: {
                      assignee_org_unit_id: { in: reach.length > 0 ? reach : ['__none__'] },
                    },
                  },
                  { org_unit_id: { in: reach.length > 0 ? reach : ['__none__'] } },
                ],
              }
            : {}),
        }
      : {
          tenant_id: context.tenantId,
          created_by_user_id: context.user.id,
          reminder_sent_at: null,
          remind_at: { not: null, lte: new Date() },
        }

  const [summary, upcoming, missed, dueReminders, openCalls] = await Promise.all([
    getSummary(filters),
    getUpcomingDeadlines(filters, 30, 25),
    getMissedAssignments(filters, 25),
    prisma.assignmentFollowUp.findMany({
      where: reminderWhere,
      select: {
        id: true,
        note: true,
        kind: true,
        remind_at: true,
        remind_faculty: true,
        created_by: { select: { id: true, name: true, email: true } },
        funding_call: { select: { id: true, title: true, scheme_title: true } },
        org_unit: { select: { id: true, name: true } },
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
          // Narrowed to the disciplines of the schools this person actually
          // covers. Without this the "needs somebody" list was the whole
          // tenant's open catalog framed as one officer's to-do.
          relevanceUnitIds: schoolUnitIds,
          withinDays: 45,
          limit: 15,
        })
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    view,
    member: membership ? serializeMember(membership) : null,
    schools: (membership?.school_assignments ?? []).map((row) => ({
      id: row.org_unit_id,
      name: row.org_unit?.name ?? null,
    })),
    summary,
    upcoming,
    missed,
    dueReminders: dueReminders.map((row) => ({
      id: row.id,
      note: row.note,
      kind: row.kind,
      remindAt: row.remind_at,
      remindFaculty: row.remind_faculty,
      authorName: row.created_by?.name || row.created_by?.email || null,
      authorIsMe: row.created_by?.id === context.user.id,
      assignmentId: row.assignment?.id ?? null,
      assignmentStatus: row.assignment?.status ?? null,
      facultyName: row.assignment?.assignee?.name || row.assignment?.assignee?.email || null,
      // A call-level tickler has no assignee; it has a school instead.
      schoolName: row.org_unit?.name ?? null,
      callId: row.assignment?.funding_call?.id ?? row.funding_call?.id ?? null,
      orgUnitId: row.org_unit?.id ?? null,
      callTitle:
        row.assignment?.funding_call?.scheme_title ||
        row.assignment?.funding_call?.title ||
        row.funding_call?.scheme_title ||
        row.funding_call?.title ||
        null,
    })),
    openCalls,
  })
}
