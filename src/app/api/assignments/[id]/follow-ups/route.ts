import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import { parseDate, validateStatusTransition, type AssignmentStatus } from '@/lib/assignments/shared'
import { buildSubmissionUpdate } from '@/lib/assignments/submission'
import {
  FOLLOW_UP_KINDS,
  FOLLOW_UP_STAGES,
  serializeFollowUp,
  submissionWatchers,
} from '@/lib/fundingDept/shared'
import { notifyQuietly } from '@/lib/notifications/notificationService'

export const dynamic = 'force-dynamic'

/**
 * The department's contact log against one assignment.
 *
 * Deliberately NOT visible to the assignee: this is where a member records
 * "called twice, no answer" and "says he is waiting on a co-PI". Notes written
 * for internal coordination change character entirely once the subject can read
 * them, and the honest ones stop being written. Anything meant for the faculty
 * member goes through Notification instead.
 */

const createSchema = z.object({
  kind: z.enum(FOLLOW_UP_KINDS).default('NOTE'),
  /**
   * Where the application stands. Optional, and inert except for SUBMITTED,
   * which also closes the assignment out through the shared submission path —
   * an officer told over the phone that it went in should not have to record
   * the same fact twice on two screens for the hierarchy to see it.
   */
  stage: z.enum(FOLLOW_UP_STAGES).nullable().optional(),
  note: z.string().trim().min(1, 'Add a note').max(5000),
  happenedAt: z.string().trim().nullable().optional(),
  remindAt: z.string().trim().nullable().optional(),
  remindFaculty: z.boolean().default(false),
})

const followUpInclude = {
  created_by: { select: { id: true, name: true, email: true } },
} as const

async function loadAssignment(tenantId: string, id: string) {
  return prisma.callAssignment.findFirst({
    where: { id, tenant_id: tenantId },
    select: {
      id: true,
      status: true,
      funding_call_id: true,
      assigned_by_user_id: true,
      assignee_org_unit_id: true,
      assignee_user_id: true,
      submission_reference: true,
      submission_url: true,
      submission_notes: true,
      submitted_at: true,
      assignee: { select: { id: true, name: true, email: true } },
      funding_call: { select: { id: true, title: true, scheme_title: true } },
    },
  })
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  // 404 rather than 403 for an assignment outside the caller's reach: the same
  // answer the assignment routes give, so probing cannot map the org tree.
  if (!record || !canManageAssignment(context.scope, record)) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const followUps = await prisma.assignmentFollowUp.findMany({
    where: { assignment_id: record.id },
    include: followUpInclude,
    orderBy: [{ happened_at: 'desc' }, { created_at: 'desc' }],
    take: 200,
  })

  return NextResponse.json({ followUps: followUps.map(serializeFollowUp) })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  if (!record || !canManageAssignment(context.scope, record)) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  let payload
  try {
    payload = createSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const remindAt = parseDate(payload.remindAt)
  if (payload.remindAt && !remindAt) {
    return NextResponse.json({ error: 'That reminder date is not valid.' }, { status: 400 })
  }
  if (remindAt && remindAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Pick a reminder time in the future.' }, { status: 400 })
  }
  if (payload.remindFaculty && !remindAt) {
    return NextResponse.json(
      { error: 'Choose when to remind them before turning the reminder on.' },
      { status: 400 }
    )
  }

  const happenedAt = parseDate(payload.happenedAt) || new Date()

  const followUpData = {
    tenant_id: context.tenantId,
    assignment_id: record.id,
    // Stamped on assignment-level rows too, so a call's whole history in a
    // school is one indexed scan rather than a union through assignments.
    funding_call_id: record.funding_call_id,
    org_unit_id: record.assignee_org_unit_id,
    created_by_user_id: context.user.id,
    kind: payload.kind,
    stage: payload.stage ?? null,
    note: payload.note,
    happened_at: happenedAt,
    remind_at: remindAt,
    remind_faculty: payload.remindFaculty,
  }

  // Stage SUBMITTED closes the assignment out as well as logging the note. The
  // transition table still decides whether this caller may make that move, and
  // the shared builder still demands proof — the note is the proof here, which
  // is why it is required on every follow-up anyway.
  const marksSubmitted = payload.stage === 'SUBMITTED' && record.status !== 'COMPLETED'
  let submissionApplied = false

  if (marksSubmitted) {
    const transition = validateStatusTransition({
      from: record.status as AssignmentStatus,
      to: 'COMPLETED',
      isAssignee: record.assignee_user_id === context.user.id,
      canManage: true,
    })
    if (!transition.allowed) {
      return NextResponse.json({ error: transition.reason }, { status: 400 })
    }
  }

  const followUp = await prisma.$transaction(async (tx) => {
    const created = await tx.assignmentFollowUp.create({
      data: followUpData,
      include: followUpInclude,
    })

    if (marksSubmitted) {
      const submission = buildSubmissionUpdate({
        record,
        notes: record.submission_notes || payload.note,
        submittedAt: happenedAt,
      })
      if (submission.ok) {
        await tx.callAssignment.update({ where: { id: record.id }, data: submission.data })
        submissionApplied = true
      }
    }

    return created
  })

  if (submissionApplied) {
    const callTitle =
      record.funding_call?.scheme_title || record.funding_call?.title || 'a funding call'
    const assigneeName = record.assignee?.name || record.assignee?.email || 'The assignee'
    try {
      const watchers = await submissionWatchers({
        tenantId: context.tenantId,
        assigneeOrgUnitId: record.assignee_org_unit_id,
        excludeUserIds: [context.user.id],
      })
      // The assignee is told too: their record just changed, and they did not
      // make the change.
      const recipients = Array.from(new Set([...watchers, record.assignee_user_id])).filter(
        (userId) => userId !== context.user.id
      )
      if (recipients.length > 0) {
        await notifyQuietly({
          tenantId: context.tenantId,
          userIds: recipients,
          title: `Submitted: ${callTitle}`,
          body: `${assigneeName}'s application was recorded as submitted by the funding department.`,
          category: 'ASSIGNMENT',
          linkUrl: '/assignments',
          assignmentId: record.id,
          createdByUserId: context.user.id,
        })
      }
    } catch (error) {
      console.warn('Follow-up submission notification failed', error)
    }
  }

  return NextResponse.json(
    { followUp: serializeFollowUp(followUp), markedSubmitted: submissionApplied },
    { status: 201 }
  )
}
