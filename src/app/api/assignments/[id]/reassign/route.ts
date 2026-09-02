import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { assignmentInclude, parseDate, serializeAssignment } from '@/lib/assignments/shared'
import { notifyNewAssignment } from '@/lib/assignments/notifyAssignment'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canAssignToUser, canManageAssignment, resolveAssignerUnitId } from '@/lib/orgUnits/scope'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Pass a call on to the next candidate.
 *
 * Cancelling and re-creating was already possible; what it could not do is say
 * that the two records are the same piece of work. The chain matters: "asked A,
 * declined for lack of time, asked B, accepted" is the story a head needs when
 * a call fails, and it is exactly what a fresh unrelated assignment loses.
 *
 * The original is closed rather than deleted — its decline reason and its
 * contact log are the reason there is a second attempt at all.
 */

const reassignSchema = z.object({
  assigneeUserId: z.string().trim().min(1, 'Choose who to pass this to'),
  deadlineAt: z.string().trim().nullable().optional(),
  message: z.string().trim().max(5000).nullable().optional(),
  /** Recorded on the original when it is still open and has to be closed. */
  closeReason: z.string().trim().max(2000).nullable().optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  if (!context.scope.canAssign) {
    return NextResponse.json(
      { error: 'You do not have permission to assign funding calls.' },
      { status: 403 }
    )
  }

  let payload
  try {
    payload = reassignSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const original = await prisma.callAssignment.findFirst({
    where: { id: params.id, tenant_id: context.tenantId },
    include: assignmentInclude,
  })
  if (!original) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }
  if (!canManageAssignment(context.scope, original)) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  // One successor per record, enforced by the unique index. Checking here turns
  // the race into a clear message rather than a Prisma unique-violation dump.
  const alreadySuperseded = await prisma.callAssignment.findFirst({
    where: { previous_assignment_id: original.id },
    select: { id: true, assignee: { select: { name: true, email: true } } },
  })
  if (alreadySuperseded) {
    return NextResponse.json(
      {
        error: `This was already passed to ${
          alreadySuperseded.assignee?.name || alreadySuperseded.assignee?.email || 'someone else'
        }.`,
        assignmentId: alreadySuperseded.id,
      },
      { status: 409 }
    )
  }

  if (original.assignee_user_id === payload.assigneeUserId) {
    return NextResponse.json(
      { error: 'That is the same person. Re-request the call instead of passing it on.' },
      { status: 400 }
    )
  }

  const assignee = await prisma.user.findFirst({
    where: { id: payload.assigneeUserId, tenantId: context.tenantId },
    select: { id: true, name: true, email: true },
  })
  if (!assignee) {
    return NextResponse.json(
      { error: 'That faculty member is not part of your organization.' },
      { status: 404 }
    )
  }

  const permission = await canAssignToUser(context.scope, assignee.id)
  if (!permission.allowed) {
    return NextResponse.json(
      { error: permission.reason || 'That person is not in a department you manage.' },
      { status: 403 }
    )
  }

  const duplicate = await prisma.callAssignment.findUnique({
    where: {
      funding_call_id_assignee_user_id: {
        funding_call_id: original.funding_call_id,
        assignee_user_id: assignee.id,
      },
    },
    select: { id: true },
  })
  if (duplicate) {
    return NextResponse.json(
      {
        error: `${assignee.name || assignee.email} already has this call.`,
        assignmentId: duplicate.id,
      },
      { status: 409 }
    )
  }

  const assignerUnitId = await resolveAssignerUnitId(context.scope)
  const stillOpen = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(original.status)

  // One transaction: a successor that exists while its predecessor is still
  // shown as live would double-count the same work on every dashboard.
  const created = await prisma.$transaction(async (tx) => {
    if (stillOpen) {
      await tx.callAssignment.update({
        where: { id: original.id },
        data: {
          status: 'CANCELLED',
          declined_reason: payload.closeReason || original.declined_reason,
        },
      })
    }

    return tx.callAssignment.create({
      data: {
        tenant_id: context.tenantId,
        funding_call_id: original.funding_call_id,
        assignee_user_id: assignee.id,
        assigned_by_user_id: context.user.id,
        // The brief carries over unless the officer rewrites it — passing a
        // call on rarely changes what is being asked for.
        message: payload.message !== undefined ? payload.message : original.message,
        deadline_at:
          payload.deadlineAt !== undefined ? parseDate(payload.deadlineAt) : original.deadline_at,
        assignee_org_unit_id: permission.assigneeUnitId,
        assigner_org_unit_id: assignerUnitId,
        previous_assignment_id: original.id,
      },
      include: assignmentInclude,
    })
  })

  const previousName =
    original.assignee?.name || original.assignee?.email || 'a colleague'

  await notifyNewAssignment({
    tenantId: context.tenantId,
    record: created,
    assigner: context.user,
    lead: `Passed on after ${previousName} could not take it.`,
  })

  // The shortlist, if one is being kept, should show the answer without the
  // officer having to restate it.
  await prisma.callCandidate
    .updateMany({
      where: {
        tenant_id: context.tenantId,
        funding_call_id: original.funding_call_id,
        user_id: assignee.id,
      },
      data: { status: 'ASSIGNED' },
    })
    .catch(() => undefined)

  return NextResponse.json(
    {
      assignment: serializeAssignment(created),
      closedPrevious: stillOpen,
    },
    { status: 201 }
  )
}
