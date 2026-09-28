import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { utcTimestamp } from '@/lib/fundingDept/callSql'
import { canOpenSchoolWork } from '@/lib/fundingDept/shared'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic = 'force-dynamic'

/**
 * POST /api/funding-dept/calls/[callId]/action-status
 *
 * The coordinator's "action completed" mark, per school. Only a person sets it:
 * an allocation or shortlist never completes a call, so "not actioned" in the
 * Incoming Calls report means what it says. Undoing is allowed and audited.
 *
 * The triage `status` is left alone — this is not a relevance decision — but a
 * missing `decided_at` is stamped, because somebody has now demonstrably looked
 * at the call and the pendency ladder should stop nagging about it.
 */
const bodySchema = z.object({
  schoolIds: z.array(z.string().trim().min(1)).min(1).max(50),
  completed: z.boolean(),
  note: z.string().trim().max(1000).nullable().optional(),
})

export async function POST(request: NextRequest, { params }: { params: { callId: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return NextResponse.json({ error: context.error }, { status: context.status })
  const membership = await getMembership(context.tenantId, context.user.id)
  if (!membership?.is_active && !context.isAdmin)
    return NextResponse.json({ error: 'You are not a member of the funding department.' }, { status: 403 })

  let payload: z.infer<typeof bodySchema>
  try {
    payload = bodySchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json({ error: error?.errors?.[0]?.message || 'Invalid request body' }, { status: 400 })
  }

  // Only a call this tenant can see: another tenant's private call must not be
  // confirmed, marked or reported on from here.
  const call = await prisma.fundingCall.findFirst({
    where: { AND: [{ id: params.callId }, visibleFundingCallWhere(context.tenantId, { includeTenantDrafts: true })] }, select: { id: true },
  })
  if (!call) return NextResponse.json({ error: 'Funding call not found.' }, { status: 404 })

  const schoolIds = [...new Set(payload.schoolIds)]
  const schools = await prisma.tenantOrgUnit.findMany({
    where: { id: { in: schoolIds }, tenant_id: context.tenantId, depth: 0 }, select: { id: true, name: true },
  })
  if (schools.length !== schoolIds.length) return NextResponse.json({ error: 'School not found.' }, { status: 404 })
  const outside = schools.find(s => !canOpenSchoolWork(context.scope, s.id))
  if (outside) return NextResponse.json({ error: `${outside.name} is outside the schools you cover.` }, { status: 403 })

  const now = new Date()
  const note = payload.completed ? payload.note || null : null
  const results = await prisma.$transaction(async tx => {
    const out: Array<{ schoolId: string; completedAt: Date | null; changed: boolean }> = []
    for (const school of schools) {
      const [before] = await tx.$queryRaw<Array<{ action_completed_at: Date | null; action_completed_note: string | null }>>(Prisma.sql`
        SELECT action_completed_at, action_completed_note FROM call_school_triage WHERE funding_call_id=${call.id} AND org_unit_id=${school.id} FOR UPDATE`)
      const wasCompleted = Boolean(before?.action_completed_at)
      if (wasCompleted === payload.completed && (!payload.completed || (before?.action_completed_note || null) === note)) {
        out.push({ schoolId: school.id, completedAt: before?.action_completed_at ?? null, changed: false })
        continue
      }
      const completedAt = payload.completed ? before?.action_completed_at ?? now : null
      const by = payload.completed ? context.user.id : null
      // decided_at is stamped only when empty: marking work done is a human look,
      // but it must never overwrite the date of an earlier review decision.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO call_school_triage (id, tenant_id, funding_call_id, org_unit_id, status, decided_by_user_id, decided_at, action_completed_at, action_completed_by_user_id, action_completed_note, created_at, updated_at)
        VALUES (${randomUUID()}, ${context.tenantId}, ${call.id}, ${school.id}, 'NEW', ${context.user.id}, ${utcTimestamp(now)}, ${utcTimestamp(completedAt)}, ${by}, ${note}, ${utcTimestamp(now)}, ${utcTimestamp(now)})
        ON CONFLICT (funding_call_id, org_unit_id) DO UPDATE SET
          action_completed_at = EXCLUDED.action_completed_at, action_completed_by_user_id = EXCLUDED.action_completed_by_user_id,
          action_completed_note = EXCLUDED.action_completed_note, updated_at = EXCLUDED.updated_at,
          decided_by_user_id = CASE WHEN call_school_triage.decided_at IS NULL THEN EXCLUDED.decided_by_user_id ELSE call_school_triage.decided_by_user_id END,
          decided_at = COALESCE(call_school_triage.decided_at, EXCLUDED.decided_at)`)
      await tx.$executeRaw(Prisma.sql`INSERT INTO dsr_events(tenant_id,school_id,entity_type,entity_id,actor_user_id,kind,before_data,after_data,reason)
        VALUES(${context.tenantId},${school.id},'REVIEW',${call.id},${context.user.id},${payload.completed ? 'ACTION_COMPLETED' : 'ACTION_REOPENED'},
          ${JSON.stringify({ actionCompletedAt: before?.action_completed_at ?? null, note: before?.action_completed_note ?? null })}::jsonb,
          ${JSON.stringify({ actionCompletedAt: completedAt, note, orgUnitId: school.id })}::jsonb, ${note})`)
      out.push({ schoolId: school.id, completedAt, changed: true })
    }
    return out
  })

  return NextResponse.json({ callId: call.id, completed: payload.completed, schools: results })
}
