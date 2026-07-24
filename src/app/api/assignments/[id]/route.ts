import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantUser } from '@/lib/auth/tenantAccess'
import { assignmentInclude, parseDate, serializeAssignment } from '@/lib/assignments/shared'
import { notifyQuietly } from '@/lib/notifications/notificationService'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
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
  const isOwner = record.assigned_by_user_id === context.user.id
  if (!isAssignee && !isOwner && !context.isAssigner) {
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
  // The assigning admin, or any admin in the tenant, can manage the assignment.
  const canManage = record.assigned_by_user_id === context.user.id || context.isAssigner
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

  // --- Admin: deadline, message, cancel -------------------------------------
  if (payload.deadlineAt !== undefined || payload.message !== undefined || payload.status === 'CANCELLED' || payload.status === 'ASSIGNED') {
    if (!canManage) {
      return NextResponse.json(
        { error: 'Only an administrator can change the deadline, message or cancel this assignment.' },
        { status: 403 }
      )
    }
    if (payload.deadlineAt !== undefined) {
      data.deadline_at = parseDate(payload.deadlineAt)
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

  const callTitle =
    updated.funding_call?.scheme_title || updated.funding_call?.title || 'a funding call'

  // Notify the other side of the change: the admin when faculty progress, the
  // faculty member when an admin changes the assignment or records a decision.
  if (data.status && data.status !== record.status) {
    if (isAssignee) {
      await notifyQuietly({
        tenantId: context.tenantId,
        userIds: [updated.assigned_by_user_id],
        title:
          data.status === 'COMPLETED'
            ? `Submission recorded: ${callTitle}`
            : `Assignment ${String(data.status).toLowerCase().replace('_', ' ')}: ${callTitle}`,
        body: `${updated.assignee?.name || updated.assignee?.email || 'The assignee'} updated this assignment.`,
        category: 'ASSIGNMENT',
        linkUrl: '/assignments',
        assignmentId: updated.id,
        createdByUserId: context.user.id,
      })
    } else {
      await notifyQuietly({
        tenantId: context.tenantId,
        userIds: [updated.assignee_user_id],
        title: `Assignment updated: ${callTitle}`,
        body: `Status is now ${String(data.status).toLowerCase().replace('_', ' ')}.`,
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
