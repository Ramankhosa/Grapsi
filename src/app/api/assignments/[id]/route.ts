import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantUser } from '@/lib/auth/tenantAccess'
import { assignmentInclude, parseDate, serializeAssignment } from '@/lib/assignments/shared'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  submissionReference: z.string().trim().max(200).nullable().optional(),
  submissionUrl: z.string().trim().max(2000).nullable().optional(),
  submissionNotes: z.string().trim().max(5000).nullable().optional(),
  submittedAt: z.string().trim().nullable().optional(),
  deadlineAt: z.string().trim().nullable().optional(),
  message: z.string().trim().max(5000).nullable().optional(),
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

  return NextResponse.json({ assignment: serializeAssignment(updated) })
}
