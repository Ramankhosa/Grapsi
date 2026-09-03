import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { parseDate } from '@/lib/assignments/shared'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { FOLLOW_UP_KINDS, canOpenSchoolWork, serializeFollowUp } from '@/lib/fundingDept/shared'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Edit or remove one call-level follow-up. Mirrors the assignment-level
 * sibling: the author may edit; the department head or an admin may also
 * remove. TRIAGE rows are the audit trail of a decision and cannot be edited
 * or removed through the log — restore or re-decide the call instead.
 */

const patchSchema = z
  .object({
    kind: z.enum(FOLLOW_UP_KINDS).optional(),
    note: z.string().trim().min(1).max(5000).optional(),
    happenedAt: z.string().trim().nullable().optional(),
    remindAt: z.string().trim().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })

const followUpInclude = {
  created_by: { select: { id: true, name: true, email: true } },
} as const

async function load(tenantId: string, callId: string, followUpId: string) {
  return prisma.assignmentFollowUp.findFirst({
    where: { id: followUpId, funding_call_id: callId, tenant_id: tenantId, assignment_id: null },
    include: followUpInclude,
  })
}

function mayEdit(
  context: { user: { id: string }; isAdmin: boolean; scope: { fundingDept: { isHead: boolean } } },
  record: { created_by_user_id: string }
) {
  return (
    record.created_by_user_id === context.user.id ||
    context.scope.fundingDept.isHead ||
    context.isAdmin
  )
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { callId: string; followUpId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await load(context.tenantId, params.callId, params.followUpId)
  if (!record || !record.org_unit_id || !canOpenSchoolWork(context.scope, record.org_unit_id)) {
    return NextResponse.json({ error: 'Follow-up not found.' }, { status: 404 })
  }
  if (record.kind === 'TRIAGE') {
    return NextResponse.json(
      { error: 'A triage decision is part of the record and cannot be edited here.' },
      { status: 400 }
    )
  }
  if (!mayEdit(context, record)) {
    return NextResponse.json(
      { error: 'Only the person who recorded this follow-up can edit it.' },
      { status: 403 }
    )
  }

  let payload
  try {
    payload = patchSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const data: Record<string, unknown> = {}
  if (payload.kind) data.kind = payload.kind
  if (payload.note) data.note = payload.note
  if (payload.happenedAt !== undefined) {
    data.happened_at = parseDate(payload.happenedAt) || record.happened_at
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
    // Moving a reminder re-arms it.
    if (remindAt) data.reminder_sent_at = null
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
  { params }: { params: { callId: string; followUpId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await load(context.tenantId, params.callId, params.followUpId)
  if (!record || !record.org_unit_id || !canOpenSchoolWork(context.scope, record.org_unit_id)) {
    return NextResponse.json({ error: 'Follow-up not found.' }, { status: 404 })
  }
  if (record.kind === 'TRIAGE') {
    return NextResponse.json(
      { error: 'A triage decision is part of the record and cannot be removed.' },
      { status: 400 }
    )
  }
  if (!mayEdit(context, record)) {
    return NextResponse.json(
      { error: 'Only the person who recorded this follow-up can remove it.' },
      { status: 403 }
    )
  }

  await prisma.assignmentFollowUp.delete({ where: { id: record.id } })
  return NextResponse.json({ ok: true })
}
