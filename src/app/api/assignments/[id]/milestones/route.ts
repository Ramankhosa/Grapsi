import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { parseDate } from '@/lib/assignments/shared'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canManageAssignment } from '@/lib/orgUnits/scope'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * What is still owed after the award.
 *
 * Instalments to claim, utilisation certificates and statements of expenditure
 * to file. The assignee can see them and mark them submitted; only an officer
 * can create one or clear it, because clearing a UC is a finance judgement.
 */

const MILESTONE_KINDS = ['INSTALMENT', 'UC', 'SE', 'REPORT', 'OTHER'] as const
const MILESTONE_STATUSES = ['PENDING', 'SUBMITTED', 'CLEARED', 'WAIVED'] as const

const createSchema = z.object({
  kind: z.enum(MILESTONE_KINDS).default('OTHER'),
  title: z.string().trim().min(1, 'Give it a name').max(200),
  dueAt: z.string().trim().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().max(10).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

async function loadAssignment(tenantId: string, id: string) {
  return prisma.callAssignment.findFirst({
    where: { id, tenant_id: tenantId },
    select: {
      id: true,
      outcome: true,
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
  if (!record) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }
  const isManager = canManageAssignment(context.scope, record)
  const isAssignee = record.assignee_user_id === context.user.id
  if (!isManager && !isAssignee) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }

  const milestones = await prisma.assignmentMilestone.findMany({
    where: { assignment_id: record.id },
    select: {
      id: true,
      kind: true,
      title: true,
      due_at: true,
      amount: true,
      currency: true,
      status: true,
      completed_at: true,
      note: true,
      created_by: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
  })

  return NextResponse.json({
    canManage: isManager,
    outcome: record.outcome,
    milestones: milestones.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      dueAt: row.due_at,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      completedAt: row.completed_at,
      note: row.note,
      createdBy: row.created_by?.name || row.created_by?.email || null,
    })),
  })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  if (!record) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }
  if (!canManageAssignment(context.scope, record)) {
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

  const milestone = await prisma.assignmentMilestone.create({
    data: {
      tenant_id: context.tenantId,
      assignment_id: record.id,
      kind: payload.kind,
      title: payload.title,
      due_at: parseDate(payload.dueAt),
      amount: payload.amount ?? null,
      currency: payload.currency || null,
      note: payload.note || null,
      created_by_user_id: context.user.id,
    },
    select: { id: true, title: true, kind: true, due_at: true, status: true },
  })

  return NextResponse.json({ milestone }, { status: 201 })
}

const updateSchema = z.object({
  milestoneId: z.string().trim().min(1),
  status: z.enum(MILESTONE_STATUSES).optional(),
  dueAt: z.string().trim().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const record = await loadAssignment(context.tenantId, params.id)
  if (!record) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 })
  }
  const isManager = canManageAssignment(context.scope, record)
  const isAssignee = record.assignee_user_id === context.user.id
  if (!isManager && !isAssignee) {
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

  // The assignee can say "I have filed it"; deciding it is cleared or waived
  // is a finance call, and moving the date is the officer's to make.
  if (!isManager) {
    if (payload.status && payload.status !== 'SUBMITTED') {
      return NextResponse.json(
        { error: 'You can mark this submitted. Clearing it is for the funding department.' },
        { status: 403 }
      )
    }
    if (payload.dueAt !== undefined) {
      return NextResponse.json(
        { error: 'Only the funding department can move a due date.' },
        { status: 403 }
      )
    }
  }

  const existing = await prisma.assignmentMilestone.findFirst({
    where: { id: payload.milestoneId, assignment_id: record.id, tenant_id: context.tenantId },
    select: { id: true, due_at: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Milestone not found.' }, { status: 404 })
  }

  const nextDue = payload.dueAt === undefined ? undefined : parseDate(payload.dueAt)
  const dueMoved =
    nextDue !== undefined &&
    (existing.due_at ? existing.due_at.getTime() : null) !==
      (nextDue ? nextDue.getTime() : null)

  const milestone = await prisma.assignmentMilestone.update({
    where: { id: existing.id },
    data: {
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.status && ['SUBMITTED', 'CLEARED', 'WAIVED'].includes(payload.status)
        ? { completed_at: new Date() }
        : payload.status === 'PENDING'
          ? { completed_at: null }
          : {}),
      ...(nextDue === undefined ? {} : { due_at: nextDue }),
      ...(payload.note === undefined ? {} : { note: payload.note }),
      // Moving the date restarts the countdown, exactly as it does on an
      // assignment deadline — otherwise an extended UC silently skips its
      // warnings.
      ...(dueMoved ? { auto_nudge_stages: [] } : {}),
    },
    select: { id: true, status: true, due_at: true, completed_at: true, note: true },
  })

  return NextResponse.json({ milestone })
}
