import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { canOpenSchoolWork } from '@/lib/fundingDept/shared'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Where one school stands on one call.
 *
 * This is the second way a pendency clears. The first is assigning it to
 * someone; this is saying "not ours" — which a department needs just as much,
 * because a queue that can only grow stops being read.
 */

const TRIAGE_STATUSES = ['NEW', 'IN_REVIEW', 'SHORTLISTED', 'NOT_RELEVANT'] as const

const bodySchema = z.object({
  fundingCallId: z.string().trim().min(1),
  orgUnitId: z.string().trim().min(1),
  status: z.enum(TRIAGE_STATUSES),
  note: z.string().trim().max(500).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const membership = await getMembership(context.tenantId, context.user.id)
  if (!membership?.is_active && !context.isAdmin) {
    return NextResponse.json(
      { error: 'You are not a member of the funding department.' },
      { status: 403 }
    )
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

  // Skipping a call deserves the same one-liner a faculty decline requires:
  // "why did we pass on this" is exactly what a head asks six months later.
  if (payload.status === 'NOT_RELEVANT' && !(payload.note || '').trim()) {
    return NextResponse.json(
      { error: 'Say briefly why this call is not relevant to the school, for the record.' },
      { status: 400 }
    )
  }

  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: payload.orgUnitId, tenant_id: context.tenantId },
    select: { id: true, name: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'School not found.' }, { status: 404 })
  }

  // The same fence every per-school surface draws (canOpenSchoolWork): you may
  // only triage inside the schools you cover, so discovery never outruns
  // responsibility — with admins and the department head exempt.
  const { scope } = context
  if (!canOpenSchoolWork(scope, unit.id)) {
    return NextResponse.json(
      { error: 'That school is outside the ones you cover.' },
      { status: 403 }
    )
  }

  const call = await prisma.fundingCall.findUnique({
    where: { id: payload.fundingCallId },
    select: { id: true },
  })
  if (!call) {
    return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })
  }

  const now = new Date()
  const previous = await prisma.callSchoolTriage.findUnique({
    where: {
      funding_call_id_org_unit_id: { funding_call_id: call.id, org_unit_id: unit.id },
    },
    select: { status: true },
  })
  const triage = await prisma.callSchoolTriage.upsert({
    where: {
      funding_call_id_org_unit_id: { funding_call_id: call.id, org_unit_id: unit.id },
    },
    create: {
      tenant_id: context.tenantId,
      funding_call_id: call.id,
      org_unit_id: unit.id,
      status: payload.status,
      note: payload.note || null,
      decided_by_user_id: context.user.id,
      decided_at: now,
    },
    update: {
      status: payload.status,
      note: payload.note ?? null,
      decided_by_user_id: context.user.id,
      decided_at: now,
    },
    select: {
      id: true,
      status: true,
      note: true,
      decided_at: true,
      funding_call_id: true,
      org_unit_id: true,
    },
  })

  // The triage row only holds the latest state. The history — "not relevant,
  // then restored, then shortlisted" — lives in the contact log as TRIAGE rows,
  // which is also what puts the decision on the call's timeline.
  if ((previous?.status || 'NEW') !== payload.status) {
    const label: Record<string, string> = {
      NEW: 'Restored to the queue',
      IN_REVIEW: 'Marked in review',
      SHORTLISTED: `Shortlisted for ${unit.name}`,
      NOT_RELEVANT: `Marked not relevant for ${unit.name}`,
    }
    const note = [label[payload.status] || payload.status, (payload.note || '').trim()]
      .filter(Boolean)
      .join(' — ')
    try {
      await prisma.assignmentFollowUp.create({
        data: {
          tenant_id: context.tenantId,
          funding_call_id: call.id,
          org_unit_id: unit.id,
          created_by_user_id: context.user.id,
          kind: 'TRIAGE',
          note,
          happened_at: now,
        },
      })
    } catch (error) {
      console.warn('Call triage: history row failed', error)
    }
  }

  return NextResponse.json({
    triage: {
      id: triage.id,
      fundingCallId: triage.funding_call_id,
      orgUnitId: triage.org_unit_id,
      status: triage.status,
      note: triage.note,
      decidedAt: triage.decided_at,
    },
  })
}
