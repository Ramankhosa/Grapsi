import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { visibleFundingCallWhere } from '@/lib/funding/callVisibility'
import { CANDIDATE_STATUSES } from '@/lib/fundingDept/shared'
import { canAssignToUser } from '@/lib/orgUnits/scope'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * The shortlist for one call: everyone considered, not only whoever was
 * assigned it.
 *
 * Matching gives you a ranked list and one action. That loses everything in
 * between — who you meant to approach, who you spoke to, who you passed over
 * and why — so a colleague working the same call cannot see your thinking and
 * next year's officer sees only the person who said yes.
 */

const upsertSchema = z.object({
  userId: z.string().trim().min(1, 'Choose a faculty member'),
  status: z.enum(CANDIDATE_STATUSES).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  matchScore: z.number().nullable().optional(),
  matchTier: z.string().trim().max(20).nullable().optional(),
})

/** The call must be one this caller can act on, and they must be an assigner. */
async function authorize(request: NextRequest, callId: string) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) return context

  const { scope } = context
  if (!scope.isTenantWide && !scope.canAssign && !scope.canViewReports) {
    return {
      error: 'Shortlists are available to funding-department members and administrators.',
      status: 403,
    }
  }

  const call = await prisma.fundingCall.findFirst({
    where: {
      AND: [
        { id: callId },
        visibleFundingCallWhere(context.tenantId, {
          includeTenantDrafts: scope.isTenantWide || scope.isHead,
        }),
      ],
    },
    select: { id: true },
  })
  if (!call) {
    return { error: 'Funding call not found or not accessible.', status: 404 }
  }

  return context
}

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await authorize(request, params.callId)
  if (isAccessError(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rows = await prisma.callCandidate.findMany({
    where: { tenant_id: auth.tenantId, funding_call_id: params.callId },
    select: {
      id: true,
      status: true,
      note: true,
      match_score: true,
      match_tier: true,
      created_at: true,
      updated_at: true,
      created_by: { select: { id: true, name: true, email: true } },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          researcher_profile: {
            select: { employee_id: true, school: true, department: true, designation: true },
          },
        },
      },
    },
    // Assigned first, then the people still in play, then the rejects — which
    // is the order an officer reads the list in.
    orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
  })

  return NextResponse.json({
    candidates: rows.map((row) => ({
      id: row.id,
      status: row.status,
      note: row.note,
      matchScore: row.match_score,
      matchTier: row.match_tier,
      updatedAt: row.updated_at,
      addedBy: row.created_by?.name || row.created_by?.email || null,
      addedByIsMe: row.created_by?.id === auth.user.id,
      user: {
        id: row.user.id,
        name: row.user.name || row.user.email,
        email: row.user.email,
        employeeId: row.user.researcher_profile?.employee_id ?? null,
        school: row.user.researcher_profile?.school ?? null,
        department: row.user.researcher_profile?.department ?? null,
        designation: row.user.researcher_profile?.designation ?? null,
      },
    })),
  })
}

/** Add someone to the shortlist, or move them to a new state. */
export async function POST(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await authorize(request, params.callId)
  if (isAccessError(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!auth.scope.canAssign) {
    return NextResponse.json(
      { error: 'You do not have permission to build a shortlist for this call.' },
      { status: 403 }
    )
  }

  let payload
  try {
    payload = upsertSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  // The same fence as assignment: you may only shortlist someone you could
  // actually hand the call to, so discovery never outruns responsibility.
  const permission = await canAssignToUser(auth.scope, payload.userId)
  if (!permission.allowed) {
    return NextResponse.json(
      { error: permission.reason || 'That person is not in a department you manage.' },
      { status: 403 }
    )
  }

  const status = payload.status || 'SHORTLISTED'
  const candidate = await prisma.callCandidate.upsert({
    where: {
      funding_call_id_user_id: { funding_call_id: params.callId, user_id: payload.userId },
    },
    create: {
      tenant_id: auth.tenantId,
      funding_call_id: params.callId,
      user_id: payload.userId,
      status,
      note: payload.note || null,
      match_score: payload.matchScore ?? null,
      match_tier: payload.matchTier || null,
      created_by_user_id: auth.user.id,
    },
    // Re-adding is an update rather than a 409: the control an officer reaches
    // for to change someone's state is the same control that added them.
    update: {
      status,
      ...(payload.note !== undefined ? { note: payload.note } : {}),
    },
    select: { id: true, status: true, note: true },
  })

  return NextResponse.json({ candidate }, { status: 201 })
}

/** Remove someone from the shortlist entirely. */
export async function DELETE(request: NextRequest, { params }: { params: { callId: string } }) {
  const auth = await authorize(request, params.callId)
  if (isAccessError(auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!auth.scope.canAssign) {
    return NextResponse.json(
      { error: 'You do not have permission to change this shortlist.' },
      { status: 403 }
    )
  }

  const userId = (new URL(request.url).searchParams.get('userId') || '').trim()
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  await prisma.callCandidate.deleteMany({
    where: { tenant_id: auth.tenantId, funding_call_id: params.callId, user_id: userId },
  })

  return NextResponse.json({ ok: true })
}
