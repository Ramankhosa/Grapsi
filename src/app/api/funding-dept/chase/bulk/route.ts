import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { parseDate } from '@/lib/assignments/shared'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { FOLLOW_UP_KINDS } from '@/lib/fundingDept/shared'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Chasing several people in one action.
 *
 * The per-assignment log is right for the call you just made to one person. It
 * is wrong for the meeting you just held with six, and for the Friday sweep
 * where every reminder needs pushing a week — both of which currently mean
 * expanding six rows and typing the same sentence six times.
 *
 * Partial success by design, like bulk assignment: an assignment that has moved
 * out of reach since the page loaded is reported and skipped, not allowed to
 * fail the other five.
 */

const MAX_TARGETS = 100

const logSchema = z.object({
  action: z.literal('log'),
  assignmentIds: z.array(z.string().trim().min(1)).min(1).max(MAX_TARGETS),
  kind: z.enum(FOLLOW_UP_KINDS).default('NOTE'),
  note: z.string().trim().min(1, 'Add a note').max(5000),
  remindAt: z.string().trim().nullable().optional(),
  remindFaculty: z.boolean().default(false),
})

const snoozeSchema = z.object({
  action: z.literal('snooze'),
  followUpIds: z.array(z.string().trim().min(1)).min(1).max(MAX_TARGETS),
  remindAt: z.string().trim().min(1, 'Choose a new date'),
})

const bodySchema = z.discriminatedUnion('action', [logSchema, snoozeSchema])

export async function POST(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  let payload
  try {
    payload = bodySchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  if (payload.action === 'snooze') {
    const remindAt = parseDate(payload.remindAt)
    if (!remindAt) {
      return NextResponse.json({ error: 'That is not a valid date.' }, { status: 400 })
    }

    // Only reminders on assignments the caller can manage, and only ones that
    // have not already fired — moving a sent reminder would re-send it.
    const reminders = await prisma.assignmentFollowUp.findMany({
      where: {
        id: { in: Array.from(new Set(payload.followUpIds)) },
        tenant_id: context.tenantId,
        reminder_sent_at: null,
      },
      select: {
        id: true,
        org_unit_id: true,
        assignment: {
          select: {
            id: true,
            assigned_by_user_id: true,
            assignee_org_unit_id: true,
          },
        },
      },
    })

    // Assignment-level reminders answer to the assignment's reach; call-level
    // ones (no assignment yet) to the school they were logged against.
    const allowed = reminders
      .filter((row) =>
        row.assignment
          ? canManageAssignment(context.scope, row.assignment)
          : Boolean(
              row.org_unit_id &&
                (context.scope.isTenantWide ||
                  context.scope.fundingDept.isHead ||
                  context.scope.managedUnitIds.includes(row.org_unit_id))
            )
      )
      .map((row) => row.id)

    if (allowed.length > 0) {
      await prisma.assignmentFollowUp.updateMany({
        where: { id: { in: allowed } },
        data: { remind_at: remindAt },
      })
    }

    return NextResponse.json({
      snoozed: allowed.length,
      skipped: payload.followUpIds.length - allowed.length,
      remindAt,
    })
  }

  const ids = Array.from(new Set(payload.assignmentIds))
  const assignments = await prisma.callAssignment.findMany({
    where: { id: { in: ids }, tenant_id: context.tenantId },
    select: {
      id: true,
      funding_call_id: true,
      assigned_by_user_id: true,
      assignee_org_unit_id: true,
      assignee: { select: { name: true, email: true } },
    },
  })

  const found = new Map(assignments.map((row) => [row.id, row]))
  const skipped: Array<{ assignmentId: string; reason: string }> = []
  const targets: string[] = []

  for (const id of ids) {
    const record = found.get(id)
    if (!record) {
      skipped.push({ assignmentId: id, reason: 'No longer exists' })
      continue
    }
    if (!canManageAssignment(context.scope, record)) {
      skipped.push({
        assignmentId: id,
        reason: `${record.assignee?.name || record.assignee?.email || 'That person'} is outside the schools you cover`,
      })
      continue
    }
    targets.push(id)
  }

  const remindAt = payload.remindAt ? parseDate(payload.remindAt) : null

  if (targets.length > 0) {
    await prisma.assignmentFollowUp.createMany({
      data: targets.map((assignmentId) => ({
        tenant_id: context.tenantId,
        assignment_id: assignmentId,
        funding_call_id: found.get(assignmentId)?.funding_call_id ?? null,
        org_unit_id: found.get(assignmentId)?.assignee_org_unit_id ?? null,
        created_by_user_id: context.user.id,
        kind: payload.kind,
        note: payload.note,
        remind_at: remindAt,
        remind_faculty: payload.remindFaculty,
      })),
    })
  }

  return NextResponse.json(
    {
      created: targets.length,
      skipped,
      remindAt,
    },
    { status: 201 }
  )
}
