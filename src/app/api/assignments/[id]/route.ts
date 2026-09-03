import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantUser, withOrgScope } from '@/lib/auth/tenantAccess'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import {
  ASSIGNMENT_STATUSES,
  assignmentInclude,
  humanStatus,
  parseDate,
  serializeAssignment,
  validateStatusTransition,
  type AssignmentStatus,
} from '@/lib/assignments/shared'
import { notifyQuietly } from '@/lib/notifications/notificationService'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  declineReason: z.string().trim().max(2000).optional(),
  submissionReference: z.string().trim().max(200).nullable().optional(),
  submissionUrl: z.string().trim().max(2000).nullable().optional(),
  submissionNotes: z.string().trim().max(5000).nullable().optional(),
  submittedAt: z.string().trim().nullable().optional(),
  deadlineAt: z.string().trim().nullable().optional(),
  message: z.string().trim().max(5000).nullable().optional(),
  // Funding decision — admin only.
  outcome: z.enum(['PENDING', 'AWARDED', 'REJECTED', 'WITHDRAWN']).optional(),
  awardAmount: z.number().nonnegative().nullable().optional(),
  awardCurrency: z.string().trim().max(10).nullable().optional(),
  decisionAt: z.string().trim().nullable().optional(),
})

/** Accepts "example.com/apply" as well as a full URL. */
function normalizeUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    return new URL(candidate).toString()
  } catch {
    return null
  }
}

async function loadAssignment(tenantId: string, id: string) {
  return prisma.callAssignment.findFirst({
    where: { id, tenant_id: tenantId },
    include: assignmentInclude,
  })
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  if (!record) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const isAssignee = record.assignee_user_id === context.user.id
  const scoped = await withOrgScope(context)
  if (!isAssignee && !canManageAssignment(scoped.scope, record)) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  return NextResponse.json({ assignment: serializeAssignment(record) })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  if (!record) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const isAssignee = record.assignee_user_id === context.user.id
  // The assigner keeps oversight of what they delegated; anyone else needs the
  // assignment to sit inside the part of the org they manage.
  const scoped = await withOrgScope(context)
  const canManage = canManageAssignment(scoped.scope, record)
  if (!isAssignee && !canManage) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  let payload
  try {
    payload = updateSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  // The lifecycle table owns every status question: which moves exist at all,
  // and who may make each one. Checking it up front means the handlers below
  // only deal with the side effects of a move already known to be legitimate.
  if (payload.status) {
    const check = validateStatusTransition({
      from: record.status as AssignmentStatus,
      to: payload.status,
      isAssignee,
      canManage,
    })
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason }, { status: 403 })
    }
    if (payload.status === 'DECLINED' && !payload.declineReason) {
      return NextResponse.json(
        { error: 'Please add a short reason so the department knows why.' },
        { status: 400 }
      )
    }
  }

  const data: any = {}

  // --- Assignee: progress + submission proof --------------------------------
  const touchesSubmission =
    payload.submissionReference !== undefined ||
    payload.submissionUrl !== undefined ||
    payload.submissionNotes !== undefined ||
    payload.submittedAt !== undefined

  if (touchesSubmission || payload.status === 'IN_PROGRESS' || payload.status === 'COMPLETED') {
    if (!isAssignee && !canManage) {
      return NextResponse.json(
        { error: 'Only the assigned faculty member can record a submission.' },
        { status: 403 }
      )
    }

    if (payload.submissionReference !== undefined) {
      data.submission_reference = payload.submissionReference || null
    }
    if (payload.submissionNotes !== undefined) {
      data.submission_notes = payload.submissionNotes || null
    }
    if (payload.submissionUrl !== undefined) {
      if (payload.submissionUrl) {
        const normalized = normalizeUrl(payload.submissionUrl)
        if (!normalized) {
          return NextResponse.json({ error: 'Enter a valid submission link.' }, { status: 400 })
        }
        data.submission_url = normalized
      } else {
        data.submission_url = null
      }
    }
    if (payload.submittedAt !== undefined) {
      data.submitted_at = parseDate(payload.submittedAt)
    }
  }

  // --- Admin: deadline and message ------------------------------------------
  // (Cancelling and re-requesting are status moves, gated by the table above.)
  if (payload.deadlineAt !== undefined || payload.message !== undefined) {
    if (!canManage) {
      return NextResponse.json(
        { error: 'Only an administrator can change the deadline or message.' },
        { status: 403 }
      )
    }
    if (payload.deadlineAt !== undefined) {
      data.deadline_at = parseDate(payload.deadlineAt)
      const before = record.deadline_at ? new Date(record.deadline_at).getTime() : null
      const after = data.deadline_at ? new Date(data.deadline_at).getTime() : null
      if (before !== after) {
        // Moving the deadline restarts the countdown nudges. Without this, an
        // assignment extended by a month would skip its 7-day warning, having
        // already "sent" that stage against the old date. The no-reply chase
        // is kept — that clock is about the request, not the deadline.
        data.auto_nudge_stages = record.auto_nudge_stages.filter(
          (stage) => !stage.startsWith('D')
        )
      }
    }
    if (payload.message !== undefined) {
      data.message = payload.message || null
    }
  }

  // --- Admin: funding decision ----------------------------------------------
  const touchesOutcome =
    payload.outcome !== undefined ||
    payload.awardAmount !== undefined ||
    payload.awardCurrency !== undefined ||
    payload.decisionAt !== undefined

  if (touchesOutcome) {
    if (!canManage) {
      return NextResponse.json(
        { error: 'Only an administrator can record the funding decision.' },
        { status: 403 }
      )
    }
    if (payload.outcome !== undefined) {
      data.outcome = payload.outcome
      // Stamp the decision date automatically unless one was supplied.
      if (payload.outcome !== 'PENDING' && payload.decisionAt === undefined && !record.decision_at) {
        data.decision_at = new Date()
      }
      if (payload.outcome === 'PENDING') {
        data.decision_at = null
        data.award_amount = null
      }
    }
    if (payload.awardAmount !== undefined) {
      data.award_amount = payload.awardAmount
    }
    if (payload.awardCurrency !== undefined) {
      data.award_currency = payload.awardCurrency || null
    }
    if (payload.decisionAt !== undefined) {
      data.decision_at = parseDate(payload.decisionAt)
    }
  }

  if (payload.status) {
    if (payload.status === 'ACCEPTED' || payload.status === 'DECLINED') {
      data.responded_at = new Date()
      data.declined_reason = payload.status === 'DECLINED' ? payload.declineReason || null : null
    }
    if (payload.status === 'ASSIGNED' && record.status !== 'ASSIGNED') {
      // Back to unanswered. The previous answer is cleared from the live record
      // so the faculty member is being asked afresh rather than shown a stale
      // one; a decline is preserved in the follow-up log below so the
      // department does not lose why they said no.
      data.responded_at = null
      data.declined_reason = null
      // The automatic nudge ladder starts again too — otherwise a re-requested
      // call would never chase, having already "sent" every stage.
      data.auto_nudge_stages = []
    }
    if (payload.status === 'COMPLETED') {
      // "Mark complete by providing submission info" — require actual proof.
      const reference = data.submission_reference ?? record.submission_reference
      const url = data.submission_url ?? record.submission_url
      const notes = data.submission_notes ?? record.submission_notes
      if (!reference && !url && !notes) {
        return NextResponse.json(
          {
            error:
              'Add submission info (reference number, link or notes) before marking this complete.',
          },
          { status: 400 }
        )
      }
      data.completed_at = new Date()
      if (!data.submitted_at && !record.submitted_at) {
        data.submitted_at = new Date()
      }
    } else {
      // Re-opening or cancelling clears completion but keeps the recorded proof.
      data.completed_at = null
    }
    data.status = payload.status
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const updated = await prisma.callAssignment.update({
    where: { id: record.id },
    data,
    include: assignmentInclude,
  })

  // A re-request wipes the decline from the record, so keep the reason in the
  // contact log — otherwise the next person to chase this has no idea it was
  // already turned down once, or why.
  if (payload.status === 'ASSIGNED' && record.status === 'DECLINED') {
    try {
      await prisma.assignmentFollowUp.create({
        data: {
          tenant_id: context.tenantId,
          assignment_id: record.id,
          funding_call_id: record.funding_call_id,
          org_unit_id: record.assignee_org_unit_id,
          created_by_user_id: context.user.id,
          kind: 'NOTE',
          note: record.declined_reason
            ? `Re-requested after a decline. Original reason: ${record.declined_reason}`
            : 'Re-requested after a decline (no reason was recorded).',
        },
      })
    } catch (error) {
      console.warn('Assignment re-request: follow-up log failed', error)
    }
  }

  // Mirror the answer onto the shortlist, so an officer opening the worksheet
  // sees who said no without reading the assignment records one by one.
  if (data.status === 'DECLINED') {
    await prisma.callCandidate
      .updateMany({
        where: {
          tenant_id: context.tenantId,
          funding_call_id: record.funding_call_id,
          user_id: record.assignee_user_id,
        },
        data: { status: 'DECLINED' },
      })
      .catch(() => undefined)
  }

  const callTitle =
    updated.funding_call?.scheme_title || updated.funding_call?.title || 'a funding call'

  // Notify the other side of the change: the admin when faculty progress, the
  // faculty member when an admin changes the assignment or records a decision.
  if (data.status && data.status !== record.status) {
    const assigneeName = updated.assignee?.name || updated.assignee?.email || 'The assignee'
    if (isAssignee) {
      let title = `Assignment ${humanStatus(data.status)}: ${callTitle}`
      let body = `${assigneeName} updated this assignment.`
      if (data.status === 'COMPLETED') {
        title = `Submission recorded: ${callTitle}`
      } else if (data.status === 'ACCEPTED') {
        title = `Assignment accepted: ${callTitle}`
        body = `${assigneeName} accepted this call.`
      } else if (data.status === 'DECLINED') {
        title = `Assignment declined: ${callTitle}`
        // The reason is the whole point of the notification — a member who has
        // to open the record to find out why will not read it.
        body = `${assigneeName} declined: ${updated.declined_reason || 'no reason given'}`
      }
      await notifyQuietly({
        tenantId: context.tenantId,
        userIds: [updated.assigned_by_user_id],
        title,
        body,
        category: 'ASSIGNMENT',
        linkUrl: '/assignments',
        assignmentId: updated.id,
        createdByUserId: context.user.id,
      })
    } else {
      const reRequested = data.status === 'ASSIGNED' && record.status === 'DECLINED'
      await notifyQuietly({
        tenantId: context.tenantId,
        userIds: [updated.assignee_user_id],
        title: reRequested
          ? `Please reconsider: ${callTitle}`
          : `Assignment updated: ${callTitle}`,
        body: reRequested
          ? 'The funding department has asked you to look at this call again.'
          : `Status is now ${humanStatus(data.status)}.`,
        category: 'ASSIGNMENT',
        linkUrl: '/assignments',
        assignmentId: updated.id,
        createdByUserId: context.user.id,
        excludeUserIds: [context.user.id],
      })
    }
  }

  if (data.outcome && data.outcome !== record.outcome) {
    await notifyQuietly({
      tenantId: context.tenantId,
      userIds: [updated.assignee_user_id],
      title: `Funding decision: ${callTitle}`,
      body:
        data.outcome === 'AWARDED'
          ? `Awarded${updated.award_amount ? ` — ${updated.award_currency || ''}${updated.award_amount}`.trim() : ''}. Congratulations!`
          : `Outcome recorded as ${String(data.outcome).toLowerCase()}.`,
      category: 'OUTCOME',
      linkUrl: '/assignments',
      assignmentId: updated.id,
      createdByUserId: context.user.id,
      excludeUserIds: [context.user.id],
    })
  }

  return NextResponse.json({ assignment: serializeAssignment(updated) })
}
