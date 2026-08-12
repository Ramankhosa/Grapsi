import { NextRequest, NextResponse } from 'next/server'
import sgMail from '@sendgrid/mail'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { canAssignToUser, resolveAssignerUnitId } from '@/lib/orgUnits/scope'
import { notifyQuietly } from '@/lib/notifications/notificationService'
import {
  ASSIGNMENT_STATUSES,
  assignmentInclude,
  parseDate,
  serializeAssignment,
  tenantVisibleCallWhere,
} from '@/lib/assignments/shared'

export const dynamic = 'force-dynamic'

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)
}

/**
 * Funding call assignments.
 *
 * A tenant admin hands a call to a faculty member with an internal deadline and
 * a message; the faculty member completes it from /assignments by recording
 * submission info. The message is stored and shown in-app — email is a
 * best-effort courtesy on top, since there is no in-app inbox.
 */

const createSchema = z.object({
  fundingCallId: z.string().trim().min(1, 'A funding call is required'),
  assigneeUserId: z.string().trim().min(1, 'A faculty member is required'),
  deadlineAt: z.string().trim().nullable().optional(),
  message: z.string().trim().max(5000).nullable().optional(),
  matchScore: z.number().nullable().optional(),
  matchTier: z.string().trim().max(20).nullable().optional(),
  matchBasis: z.string().trim().max(20).nullable().optional(),
})

/**
 * GET ?view=mine (default) | assigned-by-me | team (alias: managed)
 *
 *   mine            — assignments I have to deliver
 *   assigned-by-me  — what I delegated, and where it stands
 *   team            — everything landing in the part of the org I manage,
 *                     whoever assigned it (tenant-wide callers see all)
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const { searchParams } = new URL(request.url)
  const rawView = searchParams.get('view') || 'mine'
  const view =
    rawView === 'managed' || rawView === 'team'
      ? 'team'
      : rawView === 'assigned-by-me'
        ? 'assigned-by-me'
        : 'mine'
  const status = searchParams.get('status')
  const orgUnitId = (searchParams.get('orgUnitId') || '').trim()
  const outcome = (searchParams.get('outcome') || '').trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 200, 1), 500)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  const { scope } = context
  const canSeeOthers = scope.isTenantWide || (scope.isHead && scope.canViewReports)
  if (view === 'team' && !canSeeOthers) {
    return NextResponse.json(
      { error: 'You do not have permission to view your organization’s assignments.' },
      { status: 403 }
    )
  }

  let where: any
  if (view === 'mine') {
    where = { assignee_user_id: context.user.id, tenant_id: context.tenantId }
  } else if (view === 'assigned-by-me') {
    where = { assigned_by_user_id: context.user.id, tenant_id: context.tenantId }
  } else if (scope.isTenantWide) {
    where = { tenant_id: context.tenantId }
  } else {
    // A head sees their subtree plus anything they delegated themselves — the
    // OR keeps a call they handed out visible even after the assignee moves
    // out of their branch.
    where = {
      tenant_id: context.tenantId,
      OR: [
        { assigned_by_user_id: context.user.id },
        { assignee_org_unit_id: { in: scope.managedUnitIds } },
      ],
    }
  }

  if (status && (ASSIGNMENT_STATUSES as readonly string[]).includes(status)) {
    where.status = status
  }
  if (outcome && ['PENDING', 'AWARDED', 'REJECTED', 'WITHDRAWN'].includes(outcome)) {
    where.outcome = outcome
  }
  if (orgUnitId) {
    where.assignee_org_unit_id = orgUnitId
  }

  const [records, total] = await Promise.all([
    prisma.callAssignment.findMany({
      where,
      include: assignmentInclude,
      orderBy: [{ status: 'asc' }, { deadline_at: 'asc' }, { created_at: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.callAssignment.count({ where }),
  ])

  return NextResponse.json({
    view,
    assignments: records.map(serializeAssignment),
    total,
    limit,
    offset,
  })
}

export async function POST(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }
  // A named head can assign without holding CALL_ASSIGNER — that grant IS the
  // delegation. `canAssign` folds both paths together.
  if (!context.scope.canAssign) {
    return NextResponse.json(
      { error: 'You do not have permission to assign funding calls.' },
      { status: 403 }
    )
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

  const call = await prisma.fundingCall.findFirst({
    where: { AND: [{ id: payload.fundingCallId }, tenantVisibleCallWhere(context.tenantId)] },
    select: { id: true },
  })
  if (!call) {
    return NextResponse.json({ error: 'Funding call not found or not accessible.' }, { status: 404 })
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

  // The delegation boundary: a head may only assign within the part of the org
  // they manage. 403 rather than 404 — the person plainly exists, they are just
  // out of reach, and pretending otherwise makes the error unactionable.
  const permission = await canAssignToUser(context.scope, assignee.id)
  if (!permission.allowed) {
    return NextResponse.json(
      { error: permission.reason || 'That person is not in a department you manage.' },
      { status: 403 }
    )
  }

  const existing = await prisma.callAssignment.findUnique({
    where: {
      funding_call_id_assignee_user_id: {
        funding_call_id: call.id,
        assignee_user_id: assignee.id,
      },
    },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json(
      {
        error: `${assignee.name || assignee.email} has already been assigned this call.`,
        assignmentId: existing.id,
      },
      { status: 409 }
    )
  }

  const record = await prisma.callAssignment.create({
    data: {
      tenant_id: context.tenantId,
      funding_call_id: call.id,
      assignee_user_id: assignee.id,
      assigned_by_user_id: context.user.id,
      message: payload.message || null,
      deadline_at: parseDate(payload.deadlineAt),
      match_score: payload.matchScore ?? null,
      match_tier: payload.matchTier || null,
      match_basis: payload.matchBasis || null,
      // Org placement snapshotted at assignment time: moving someone next
      // semester must not rewrite last year's report, and the assigner is often
      // an admin with no researcher profile to join against.
      assignee_org_unit_id: permission.assigneeUnitId,
      assigner_org_unit_id: await resolveAssignerUnitId(context.scope),
    },
    include: assignmentInclude,
  })

  const callTitle =
    record.funding_call?.scheme_title || record.funding_call?.title || 'a funding call'

  // In-app is the primary channel (there is no other inbox); email is a
  // best-effort courtesy. Neither may fail the assignment write.
  await notifyQuietly({
    tenantId: context.tenantId,
    userIds: [assignee.id],
    title: `New assignment: ${callTitle}`,
    body: record.deadline_at
      ? `Due ${new Date(record.deadline_at).toLocaleDateString('en-IN')}.${record.message ? ` ${record.message}` : ''}`
      : record.message || 'You have been assigned a funding call.',
    category: 'ASSIGNMENT',
    linkUrl: '/assignments',
    assignmentId: record.id,
    createdByUserId: context.user.id,
  })

  await notifyAssignee(record, context.user).catch((error) => {
    console.warn('Assignment email failed:', error instanceof Error ? error.message : String(error))
  })

  return NextResponse.json({ assignment: serializeAssignment(record) }, { status: 201 })
}

async function notifyAssignee(record: any, assigner: any) {
  const email = record.assignee?.email
  if (!email) {
    return
  }

  const callTitle = record.funding_call?.scheme_title || record.funding_call?.title || 'a funding call'
  const deadline = record.deadline_at
    ? new Date(record.deadline_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null

  if (!process.env.SENDGRID_API_KEY) {
    console.log(`[ASSIGNMENT] Would email ${email} about "${callTitle}"`)
    return
  }

  await sgMail.send({
    to: email,
    from: 'noreply@patentnest.ai',
    subject: `You have been assigned: ${callTitle}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="margin-bottom: 8px;">New funding call assignment</h2>
        <p>${assigner?.name || assigner?.email || 'An administrator'} has assigned you a funding call.</p>
        <p style="font-size: 16px; font-weight: 600; margin: 16px 0 4px;">${callTitle}</p>
        ${record.funding_call?.agencyName ? `<p style="color:#6b7280; margin:0 0 12px;">${record.funding_call.agencyName}</p>` : ''}
        ${deadline ? `<p><strong>Internal deadline:</strong> ${deadline}</p>` : ''}
        ${record.message ? `<blockquote style="border-left:3px solid #d1d5db; margin:16px 0; padding-left:12px; color:#374151;">${record.message}</blockquote>` : ''}
        <p style="margin-top:20px;">Open <strong>Assignments</strong> in Grapsi to review it and record your submission once you have applied.</p>
      </div>
    `,
  })
}
