import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import { parseDate } from '@/lib/assignments/shared'
import { FOLLOW_UP_KINDS, serializeFollowUp } from '@/lib/fundingDept/shared'

export const dynamic = 'force-dynamic'

const updateSchema = z
  .object({
    kind: z.enum(FOLLOW_UP_KINDS).optional(),
    note: z.string().trim().min(1).max(5000).optional(),
    happenedAt: z.string().trim().nullable().optional(),
    remindAt: z.string().trim().nullable().optional(),
    remindFaculty: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })

const followUpInclude = {
  created_by: { select: { id: true, name: true, email: true } },
} as const

async function load(tenantId: string, assignmentId: string, followUpId: string) {
  return prisma.assignmentFollowUp.findFirst({
    where: { id: followUpId, assignment_id: assignmentId, tenant_id: tenantId },
    include: {
      ...followUpInclude,
      assignment: {
        select: { id: true, assigned_by_user_id: true, assignee_org_unit_id: true },
      },
    },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; followUpId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await load(context.tenantId, params.id, params.followUpId)
  // `assignment` is nullable now that call-level rows exist; this route is
  // addressed by assignment id so it is always set here, but the type must know.
  if (!record || !record.assignment || !canManageAssignment(context.scope, record.assignment)) {
    return NextResponse.json({ error: 'Follow-up not found.' }, { status: 404 })
  }
  // A colleague can read the log and act on it; only the person who wrote a
  // note may change what it says. The head can still delete it.
  if (record.created_by_user_id !== context.user.id && !context.scope.fundingDept.isHead && !context.isAdmin) {
    return NextResponse.json(
      { error: 'Only the person who recorded this follow-up can edit it.' },
      { status: 403 }
    )
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

  const touchesReminder = payload.remindAt !== undefined || payload.remindFaculty !== undefined
  if (touchesReminder && record.reminder_sent_at) {
    return NextResponse.json(
      { error: 'That reminder has already gone out. Add a new follow-up instead.' },
      { status: 409 }
    )
  }

  const data: any = {}
  if (payload.kind !== undefined) data.kind = payload.kind
  if (payload.note !== undefined) data.note = payload.note
  if (payload.happenedAt !== undefined) {
    data.happened_at = parseDate(payload.happenedAt) || new Date()
  }
  if (payload.remindAt !== undefined) {
    const remindAt = parseDate(payload.remindAt)
    if (payload.remindAt && !remindAt) {
      return NextResponse.json({ error: 'That reminder date is not valid.' }, { status: 400 })
    }
    if (remindAt && remindAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Pick a reminder time in the future.' }, { status: 400 })
    }
    data.remind_at = remindAt
    if (!remindAt) data.remind_faculty = false
  }
  if (payload.remindFaculty !== undefined) {
    const effectiveRemindAt = data.remind_at !== undefined ? data.remind_at : record.remind_at
    if (payload.remindFaculty && !effectiveRemindAt) {
      return NextResponse.json(
        { error: 'Choose when to remind them before turning the reminder on.' },
        { status: 400 }
      )
    }
    data.remind_faculty = payload.remindFaculty
  }

  const updated = await prisma.assignmentFollowUp.update({
    where: { id: record.id },
    data,
    include: followUpInclude,
  })

  return NextResponse.json({ followUp: serializeFollowUp(updated) })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; followUpId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await load(context.tenantId, params.id, params.followUpId)
  // `assignment` is nullable now that call-level rows exist; this route is
  // addressed by assignment id so it is always set here, but the type must know.
  if (!record || !record.assignment || !canManageAssignment(context.scope, record.assignment)) {
    return NextResponse.json({ error: 'Follow-up not found.' }, { status: 404 })
  }
  if (record.created_by_user_id !== context.user.id && !context.scope.fundingDept.isHead && !context.isAdmin) {
    return NextResponse.json(
      { error: 'Only the person who recorded this follow-up can remove it.' },
      { status: 403 }
    )
  }

  await prisma.assignmentFollowUp.delete({ where: { id: record.id } })
  return NextResponse.json({ removed: true })
}
