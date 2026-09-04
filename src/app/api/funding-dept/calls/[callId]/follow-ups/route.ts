import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { parseDate } from '@/lib/assignments/shared'
import {
  isAccessError,
  requireTenantScope,
  type TenantScopeContext,
} from '@/lib/auth/tenantAccess'
import {
  FOLLOW_UP_KINDS,
  FOLLOW_UP_STAGES,
  canOpenSchoolWork,
  serializeFollowUp,
} from '@/lib/fundingDept/shared'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * The department's contact log against one call in one school, BEFORE anyone
 * has been assigned.
 *
 * The earliest chasing — "rang the HoD, nobody free yet", "sounded out two
 * people at the faculty meeting" — is the most useful record there is when a
 * call later fails, and it happens before an assignment exists. The
 * assignment-level log (`/api/assignments/[id]/follow-ups`) could not hold it.
 * Same shape, same guards, same serializer; the only difference is what the
 * row hangs off, and that a reminder here is always the author's own — there
 * is no faculty member yet to email.
 *
 * Department-internal, like the assignment-level log. The assignee never sees
 * either.
 */

const createSchema = z.object({
  orgUnitId: z.string().trim().min(1, 'Choose the school this note is about'),
  kind: z.enum(FOLLOW_UP_KINDS).default('NOTE'),
  /**
   * Where the application stands. SUBMITTED is rejected here: a call-level note
   * is chasing recorded before anyone is assigned, so there is no application
   * to have been submitted. It goes on the assignment instead.
   */
  stage: z
    .enum(FOLLOW_UP_STAGES)
    .nullable()
    .optional()
    .refine((value) => value !== 'SUBMITTED', {
      message: 'Record a submission against the assignment, not the school.',
    }),
  note: z.string().trim().min(1, 'Add a note').max(5000),
  happenedAt: z.string().trim().nullable().optional(),
  remindAt: z.string().trim().nullable().optional(),
  remindFaculty: z.boolean().default(false),
})

const followUpInclude = {
  created_by: { select: { id: true, name: true, email: true } },
} as const

/**
 * The (call, school) pair this request is about, or an error response.
 * Callers must be department members or admins, the school must be a root
 * unit in the tenant, and the caller must be allowed to open that school.
 */
async function resolveTarget(
  request: NextRequest,
  callId: string,
  orgUnitId: string
): Promise<
  | {
      ok: true
      context: TenantScopeContext
      call: { id: string }
      unit: { id: string; name: string }
    }
  | { ok: false; response: NextResponse }
> {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return { ok: false, response: NextResponse.json({ error: context.error }, { status: context.status }) }
  }

  const membership = await getMembership(context.tenantId, context.user.id)
  if (!membership?.is_active && !context.isAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You are not a member of the funding department.' },
        { status: 403 }
      ),
    }
  }

  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: orgUnitId, tenant_id: context.tenantId, depth: 0, is_active: true },
    select: { id: true, name: true },
  })
  if (!unit) {
    return { ok: false, response: NextResponse.json({ error: 'School not found.' }, { status: 404 }) }
  }
  if (!canOpenSchoolWork(context.scope, unit.id)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'That school is outside the ones you cover.' },
        { status: 403 }
      ),
    }
  }

  const call = await prisma.fundingCall.findUnique({ where: { id: callId }, select: { id: true } })
  if (!call) {
    return { ok: false, response: NextResponse.json({ error: 'Funding call not found.' }, { status: 404 }) }
  }

  return { ok: true, context, call, unit }
}

export async function GET(request: NextRequest, { params }: { params: { callId: string } }) {
  const orgUnitId = (new URL(request.url).searchParams.get('orgUnitId') || '').trim()
  if (!orgUnitId) {
    return NextResponse.json({ error: 'orgUnitId is required.' }, { status: 400 })
  }
  const target = await resolveTarget(request, params.callId, orgUnitId)
  if (!target.ok) return target.response

  // Call-level rows only. Assignment-level notes for this school appear on the
  // dossier timeline, merged with everything else; this endpoint is the form's
  // own list and must not double-show them.
  const followUps = await prisma.assignmentFollowUp.findMany({
    where: {
      tenant_id: target.context.tenantId,
      funding_call_id: target.call.id,
      org_unit_id: target.unit.id,
      assignment_id: null,
    },
    include: followUpInclude,
    orderBy: [{ happened_at: 'desc' }, { created_at: 'desc' }],
    take: 200,
  })

  return NextResponse.json({ followUps: followUps.map(serializeFollowUp) })
}

export async function POST(request: NextRequest, { params }: { params: { callId: string } }) {
  let payload
  try {
    payload = createSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const target = await resolveTarget(request, params.callId, payload.orgUnitId)
  if (!target.ok) return target.response

  const remindAt = parseDate(payload.remindAt)
  if (payload.remindAt && !remindAt) {
    return NextResponse.json({ error: 'That reminder date is not valid.' }, { status: 400 })
  }
  if (remindAt && remindAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Pick a reminder time in the future.' }, { status: 400 })
  }
  if (payload.remindFaculty) {
    return NextResponse.json(
      { error: 'Nobody is assigned to this call yet, so there is no faculty member to remind.' },
      { status: 400 }
    )
  }

  const followUp = await prisma.assignmentFollowUp.create({
    data: {
      tenant_id: target.context.tenantId,
      assignment_id: null,
      funding_call_id: target.call.id,
      org_unit_id: target.unit.id,
      created_by_user_id: target.context.user.id,
      kind: payload.kind,
      stage: payload.stage ?? null,
      note: payload.note,
      happened_at: parseDate(payload.happenedAt) || new Date(),
      remind_at: remindAt,
      remind_faculty: false,
    },
    include: followUpInclude,
  })

  return NextResponse.json({ followUp: serializeFollowUp(followUp) }, { status: 201 })
}
