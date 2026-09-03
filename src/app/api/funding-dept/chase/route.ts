import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Everything that needs chasing, worst first.
 *
 * The nudge ladder handles the automatic half well. This is the human half: the
 * officer working a backlog on a Tuesday morning, who until now had to expand
 * assignment rows one at a time to find out which ones had gone quiet.
 *
 * A row can need attention for more than one reason, so reasons accumulate and
 * the ranking is their combined weight — an unanswered request whose deadline
 * is also next week outranks either problem on its own.
 */

const NO_CONTACT_DAYS = 14
const UNANSWERED_DAYS = 3
const DEADLINE_WINDOW_DAYS = 14

type Reason = {
  code: 'OVERDUE' | 'UNANSWERED' | 'REMINDER_DUE' | 'DEADLINE_NEAR' | 'GONE_QUIET'
  label: string
  weight: number
}

export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const membership = await getMembership(context.tenantId, context.user.id)
  if (!membership?.is_active && !context.isAdmin) {
    return NextResponse.json(
      { error: 'You are not a member of the funding department.' },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(request.url)
  // 'schools' is the default here, unlike the dashboard: chasing is a duty of
  // the school, and a call a colleague handed out still goes quiet on your watch.
  const view = searchParams.get('view') === 'mine' ? 'mine' : 'schools'
  const orgUnitId = (searchParams.get('orgUnitId') || '').trim()
  const reach = context.scope.isTenantWide ? null : context.scope.managedUnitIds

  const where: any = {
    tenant_id: context.tenantId,
    status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
  }
  if (view === 'mine') {
    where.assigned_by_user_id = context.user.id
  } else if (reach) {
    where.assignee_org_unit_id = { in: reach.length > 0 ? reach : ['__none__'] }
  }
  if (orgUnitId) {
    // Already clamped by the reach predicate above for a scoped caller.
    where.assignee_org_unit_id =
      reach && !reach.includes(orgUnitId) ? { in: ['__none__'] } : orgUnitId
  }

  const records = await prisma.callAssignment.findMany({
    where,
    select: {
      id: true,
      status: true,
      deadline_at: true,
      created_at: true,
      responded_at: true,
      message: true,
      assignee: { select: { id: true, name: true, email: true } },
      assigned_by: { select: { id: true, name: true, email: true } },
      assignee_org_unit: { select: { id: true, name: true } },
      funding_call: {
        select: { id: true, title: true, scheme_title: true, agencyName: true, close_date: true },
      },
      follow_ups: {
        select: {
          id: true,
          note: true,
          kind: true,
          happened_at: true,
          remind_at: true,
          reminder_sent_at: true,
          created_by: { select: { id: true, name: true, email: true } },
        },
        orderBy: { happened_at: 'desc' },
        take: 1,
      },
    },
    take: 500,
  })

  // Pending reminders separately: the latest follow-up is not necessarily the
  // one carrying an unfired reminder.
  const pendingReminders = await prisma.assignmentFollowUp.findMany({
    where: {
      tenant_id: context.tenantId,
      assignment_id: { in: records.map((row) => row.id) },
      reminder_sent_at: null,
      remind_at: { not: null },
    },
    select: {
      id: true,
      assignment_id: true,
      note: true,
      remind_at: true,
      remind_faculty: true,
      created_by: { select: { id: true, name: true, email: true } },
    },
    orderBy: { remind_at: 'asc' },
  })
  const reminderByAssignment = new Map<string, (typeof pendingReminders)[number]>()
  for (const reminder of pendingReminders) {
    // The query filters on assignment_id, so it is always set here; the column
    // is nullable now that call-level follow-ups exist, and the type must know.
    if (!reminder.assignment_id) continue
    if (!reminderByAssignment.has(reminder.assignment_id)) {
      reminderByAssignment.set(reminder.assignment_id, reminder)
    }
  }

  const now = Date.now()
  const days = (from: Date | null | undefined) =>
    from ? Math.floor((now - new Date(from).getTime()) / 86400000) : null
  const daysUntil = (to: Date | null | undefined) =>
    to ? Math.ceil((new Date(to).getTime() - now) / 86400000) : null

  const rows = records.map((record) => {
    const reasons: Reason[] = []
    const lastContact = record.follow_ups[0] ?? null
    const reminder = reminderByAssignment.get(record.id) ?? null
    const deadlineIn = daysUntil(record.deadline_at)
    const sinceAsked = days(record.created_at)
    const sinceContact = days(lastContact?.happened_at ?? null)

    if (deadlineIn !== null && deadlineIn < 0) {
      reasons.push({
        code: 'OVERDUE',
        label: `${Math.abs(deadlineIn)} days past the internal deadline`,
        weight: 100 + Math.min(Math.abs(deadlineIn), 60),
      })
    }
    if (record.status === 'ASSIGNED' && !record.responded_at) {
      const waiting = sinceAsked ?? 0
      if (waiting >= UNANSWERED_DAYS) {
        reasons.push({
          code: 'UNANSWERED',
          label: `No answer in ${waiting} days`,
          weight: 80 + Math.min(waiting, 30),
        })
      }
    }
    if (reminder?.remind_at && new Date(reminder.remind_at).getTime() <= now) {
      reasons.push({
        code: 'REMINDER_DUE',
        label: `Reminder due ${new Date(reminder.remind_at).toLocaleDateString('en-IN')}`,
        weight: 70,
      })
    }
    if (deadlineIn !== null && deadlineIn >= 0 && deadlineIn <= DEADLINE_WINDOW_DAYS) {
      reasons.push({
        code: 'DEADLINE_NEAR',
        label: deadlineIn === 0 ? 'Due today' : `Due in ${deadlineIn} days`,
        weight: 60 - deadlineIn,
      })
    }
    // Only counts as quiet if nobody has a reminder pending — an officer who
    // already scheduled the next chase is not neglecting it.
    if (!reminder && (sinceContact === null ? (sinceAsked ?? 0) : sinceContact) >= NO_CONTACT_DAYS) {
      const quiet = sinceContact === null ? sinceAsked : sinceContact
      reasons.push({
        code: 'GONE_QUIET',
        label: lastContact
          ? `Nothing logged for ${quiet} days`
          : `Never contacted, assigned ${quiet} days ago`,
        weight: 40,
      })
    }

    return {
      id: record.id,
      status: record.status,
      deadlineAt: record.deadline_at,
      deadlineIn,
      respondedAt: record.responded_at,
      assignee: record.assignee
        ? { id: record.assignee.id, name: record.assignee.name || record.assignee.email }
        : null,
      assignedBy: record.assigned_by
        ? {
            id: record.assigned_by.id,
            name: record.assigned_by.name || record.assigned_by.email,
            isMe: record.assigned_by.id === context.user.id,
          }
        : null,
      school: record.assignee_org_unit?.name ?? null,
      schoolId: record.assignee_org_unit?.id ?? null,
      call: record.funding_call
        ? {
            id: record.funding_call.id,
            title: record.funding_call.scheme_title || record.funding_call.title,
            agency: record.funding_call.agencyName,
            closeDate: record.funding_call.close_date,
          }
        : null,
      lastContact: lastContact
        ? {
            note: lastContact.note,
            kind: lastContact.kind,
            happenedAt: lastContact.happened_at,
            author: lastContact.created_by?.name || lastContact.created_by?.email || null,
          }
        : null,
      pendingReminder: reminder
        ? {
            id: reminder.id,
            note: reminder.note,
            remindAt: reminder.remind_at,
            remindFaculty: reminder.remind_faculty,
            author: reminder.created_by?.name || reminder.created_by?.email || null,
          }
        : null,
      reasons,
      priority: reasons.reduce((sum, reason) => sum + reason.weight, 0),
    }
  })

  const queue = rows
    .filter((row) => row.reasons.length > 0)
    .sort((left, right) => right.priority - left.priority)

  const tally: Record<string, number> = {}
  for (const row of queue) {
    for (const reason of row.reasons) tally[reason.code] = (tally[reason.code] || 0) + 1
  }

  return NextResponse.json({
    view,
    queue,
    counts: {
      needsAttention: queue.length,
      liveTotal: rows.length,
      overdue: tally.OVERDUE || 0,
      unanswered: tally.UNANSWERED || 0,
      remindersDue: tally.REMINDER_DUE || 0,
      deadlineNear: tally.DEADLINE_NEAR || 0,
      goneQuiet: tally.GONE_QUIET || 0,
    },
  })
}
