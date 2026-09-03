import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import { parseDate } from '@/lib/assignments/shared'
import { FOLLOW_UP_KINDS, serializeFollowUp } from '@/lib/fundingDept/shared'

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
      funding_call_id: true,
      assigned_by_user_id: true,
      assignee_org_unit_id: true,
      assignee_user_id: true,
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

  const followUp = await prisma.assignmentFollowUp.create({
    data: {
      tenant_id: context.tenantId,
      assignment_id: record.id,
      // Stamped on assignment-level rows too, so a call's whole history in a
      // school is one indexed scan rather than a union through assignments.
      funding_call_id: record.funding_call_id,
      org_unit_id: record.assignee_org_unit_id,
      created_by_user_id: context.user.id,
      kind: payload.kind,
      note: payload.note,
      happened_at: parseDate(payload.happenedAt) || new Date(),
      remind_at: remindAt,
      remind_faculty: payload.remindFaculty,
    },
    include: followUpInclude,
  })

  return NextResponse.json({ followUp: serializeFollowUp(followUp) }, { status: 201 })
}
