import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import {
  addProposalMilestone,
  listProposalMilestones,
  seedPostAwardSchedule,
  setProjectDates,
} from '@/lib/proposals/postAwardService'
import { ProposalError } from '@/lib/proposals/proposalService'
import { getProposalSettings } from '@/lib/proposals/settings'
import { lensCanManage, MILESTONE_KINDS } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * What the institution owes the agency after the money arrives: instalments to
 * claim, utilisation certificates and statements of expenditure to file,
 * progress reports to submit.
 *
 * The applicant sees these too — the certificate is usually theirs to prepare,
 * and a due date only they can meet is no use sitting in the office.
 */

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    kind: z.enum(MILESTONE_KINDS),
    title: z.string().trim().max(300).nullable().optional(),
    dueAt: z.string().trim().nullable().optional(),
    amount: z.number().min(0).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({
    action: z.literal('dates'),
    startAt: z.string().trim().nullable().optional(),
    endAt: z.string().trim().nullable().optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal('schedule'),
    startAt: z.string().trim().min(1, 'When does the project start?'),
    years: z.number().int().min(1).max(10),
  }),
])

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  return NextResponse.json({ milestones: await listProposalMilestones(params.id) })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json(
      { error: 'Only the funding department records post-award obligations.' },
      { status: 403 }
    )
  }

  const settings = await getProposalSettings(context.tenantId)
  if (!settings.postAwardEnabled) {
    return NextResponse.json(
      { error: 'Post-award tracking is switched off for this institution.', code: 'FEATURE_DISABLED' },
      { status: 403 }
    )
  }

  let payload: z.infer<typeof postSchema>
  try {
    payload = postSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    if (payload.action === 'dates') {
      const dates = await setProjectDates({
        tenantId: context.tenantId,
        proposalId: params.id,
        actorUserId: context.user.id,
        startAt: payload.startAt !== undefined ? parseDate(payload.startAt) : undefined,
        endAt: payload.endAt !== undefined ? parseDate(payload.endAt) : undefined,
        reason: payload.reason ?? null,
      })
      return NextResponse.json({ dates })
    }

    if (payload.action === 'schedule') {
      const start = parseDate(payload.startAt)
      if (!start) return NextResponse.json({ error: 'That start date is not valid.' }, { status: 400 })

      const result = await seedPostAwardSchedule({
        tenantId: context.tenantId,
        proposalId: params.id,
        actorUserId: context.user.id,
        startAt: start,
        years: payload.years,
      })
      // The schedule sets the project window itself.
      return NextResponse.json({
        scheduled: result,
        milestones: await listProposalMilestones(params.id),
      })
    }

    const milestone = await addProposalMilestone({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      kind: payload.kind,
      title: payload.title ?? null,
      dueAt: parseDate(payload.dueAt),
      amount: payload.amount ?? null,
      note: payload.note ?? null,
    })
    return NextResponse.json({ milestone }, { status: 201 })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] milestone write failed', error)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
