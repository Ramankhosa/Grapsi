import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canAssignToUser, resolveAssignerUnitId } from '@/lib/orgUnits/scope'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import { sendEmail } from '@/lib/mailer'
import { assignmentNotificationTemplate } from '@/lib/email-templates'
import { parseDate, serializeAssignment, tenantVisibleCallWhere } from '@/lib/assignments/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * One call, many faculty.
 *
 * Circulating a scheme to a whole school is the normal unit of work in a
 * sponsored-research office; doing it one modal at a time was the single
 * biggest friction in the assignment flow. This route is deliberately
 * partial-success: an assignee who is already on the call, or who sits outside
 * the caller's reach, is reported and skipped rather than failing the batch —
 * a 30-person circulation must not be lost because one person was already
 * assigned yesterday.
 *
 * Every per-assignee rule is the same one POST /api/assignments applies, called
 * through the same helper, so the two routes cannot drift apart on permissions.
 */

const MAX_ASSIGNEES = 100

const bulkSchema = z.object({
  fundingCallId: z.string().trim().min(1, 'A funding call is required'),
  assignees: z
    .array(
      z.object({
        userId: z.string().trim().min(1),
        matchScore: z.number().nullable().optional(),
        matchTier: z.string().trim().max(40).nullable().optional(),
      })
    )
    .min(1, 'Select at least one person')
    .max(MAX_ASSIGNEES, `You can assign to at most ${MAX_ASSIGNEES} people at once`),
  message: z.string().trim().max(5000).nullable().optional(),
  deadlineAt: z.string().trim().nullable().optional(),
  matchBasis: z.string().trim().max(40).nullable().optional(),
})

export interface BulkAssignSkip {
  userId: string
  name: string | null
  reason: string
}

export async function POST(request: NextRequest) {
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
    payload = bulkSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const call = await prisma.fundingCall.findFirst({
    where: { AND: [{ id: payload.fundingCallId }, tenantVisibleCallWhere(context.tenantId)] },
    select: { id: true, title: true, scheme_title: true, agencyName: true },
  })
  if (!call) {
    return NextResponse.json({ error: 'Funding call not found or not accessible.' }, { status: 404 })
  }

  // De-duplicate: a UI multi-select plus a "select all" can easily send the
  // same id twice, and that would surface as a confusing self-collision.
  const requested = Array.from(new Map(payload.assignees.map((a) => [a.userId, a])).values())

  const [users, existing] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: requested.map((a) => a.userId) }, tenantId: context.tenantId },
      select: { id: true, name: true, email: true },
    }),
    prisma.callAssignment.findMany({
      where: { funding_call_id: call.id, assignee_user_id: { in: requested.map((a) => a.userId) } },
      select: { assignee_user_id: true },
    }),
  ])

  const usersById = new Map(users.map((user) => [user.id, user]))
  const alreadyAssigned = new Set(existing.map((row) => row.assignee_user_id))
  // Resolved once for the whole batch rather than per assignee.
  const assignerUnitId = await resolveAssignerUnitId(context.scope)
  const deadlineAt = parseDate(payload.deadlineAt)
  const callTitle = call.scheme_title || call.title || 'a funding call'

  const created: any[] = []
  const skipped: BulkAssignSkip[] = []

  for (const entry of requested) {
    const user = usersById.get(entry.userId)
    if (!user) {
      skipped.push({
        userId: entry.userId,
        name: null,
        reason: 'Not part of your organization.',
      })
      continue
    }
    if (alreadyAssigned.has(entry.userId)) {
      skipped.push({
        userId: entry.userId,
        name: user.name || user.email,
        reason: 'Already assigned this call.',
      })
      continue
    }

    const permission = await canAssignToUser(context.scope, user.id)
    if (!permission.allowed) {
      skipped.push({
        userId: entry.userId,
        name: user.name || user.email,
        reason: permission.reason || 'Outside the schools you cover.',
      })
      continue
    }

    try {
      const record = await prisma.callAssignment.create({
        data: {
          tenant_id: context.tenantId,
          funding_call_id: call.id,
          assignee_user_id: user.id,
          assigned_by_user_id: context.user.id,
          message: payload.message || null,
          deadline_at: deadlineAt,
          match_score: entry.matchScore ?? null,
          match_tier: entry.matchTier || null,
          match_basis: payload.matchBasis || null,
          assignee_org_unit_id: permission.assigneeUnitId,
          assigner_org_unit_id: assignerUnitId,
        },
        select: { id: true, assignee_user_id: true },
      })
      created.push({ id: record.id, userId: user.id, name: user.name || user.email })
    } catch (error: any) {
      // The unique key is the final word: another member may have assigned this
      // person between our read and our write.
      if (error?.code === 'P2002') {
        skipped.push({
          userId: entry.userId,
          name: user.name || user.email,
          reason: 'Already assigned this call.',
        })
        continue
      }
      throw error
    }
  }

  // Notifications and email are best-effort and must never fail the batch — the
  // assignments are already committed and visible in-app.
  const deadlineLabel = deadlineAt
    ? deadlineAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  if (created.length > 0) {
    await notifyQuietly({
      tenantId: context.tenantId,
      userIds: created.map((row) => row.userId),
      title: `New assignment: ${callTitle}`,
      body: deadlineLabel
        ? `Due ${deadlineLabel}.${payload.message ? ` ${payload.message}` : ''}`
        : payload.message || 'You have been assigned a funding call.',
      category: 'ASSIGNMENT',
      linkUrl: '/assignments',
      createdByUserId: context.user.id,
    })
  }

  const assignerName = context.user.name || context.user.email || 'An administrator'
  let emailed = 0
  for (const row of created) {
    const user = usersById.get(row.userId)
    if (!user?.email) continue
    try {
      await sendEmail({
        to: user.email,
        toName: user.name || undefined,
        ...assignmentNotificationTemplate({
          email: user.email,
          name: user.name,
          assignerName,
          callTitle,
          agency: call.agencyName || null,
          deadline: deadlineLabel,
          message: payload.message || null,
        }),
      })
      emailed += 1
      // Spaced like the alert dispatcher, so a 100-person circulation does not
      // arrive at the mail provider as a burst.
      await new Promise((resolve) => setTimeout(resolve, 250))
    } catch (error) {
      console.warn('Bulk assignment email failed', error)
    }
  }

  return NextResponse.json(
    {
      call: { id: call.id, title: callTitle },
      createdCount: created.length,
      skippedCount: skipped.length,
      emailed,
      created,
      skipped,
    },
    { status: created.length > 0 ? 201 : 200 }
  )
}
