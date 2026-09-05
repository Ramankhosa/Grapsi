import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import {
  removeProposalMilestone,
  updateProposalMilestone,
} from '@/lib/proposals/postAwardService'
import { ProposalError } from '@/lib/proposals/proposalService'
import { lensCanManage, MILESTONE_STATUSES } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  status: z.enum(MILESTONE_STATUSES).optional(),
  dueAt: z.string().trim().nullable().optional(),
  amount: z.number().min(0).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * Move one obligation along.
 *
 * SUBMITTED and CLEARED are deliberately different: a utilisation certificate
 * that has gone to the agency may still come back, and treating the two as one
 * state is how an office believes a filing is finished when it is only sent.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; milestoneId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json({ error: 'Only the funding department can do that.' }, { status: 403 })
  }

  let payload: z.infer<typeof patchSchema>
  try {
    payload = patchSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  try {
    const milestone = await updateProposalMilestone({
      tenantId: context.tenantId,
      proposalId: params.id,
      milestoneId: params.milestoneId,
      actorUserId: context.user.id,
      status: payload.status,
      dueAt: parseDate(payload.dueAt),
      amount: payload.amount,
      note: payload.note,
    })
    return NextResponse.json({ milestone })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] milestone update failed', error)
    return NextResponse.json({ error: 'Could not update that obligation.' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; milestoneId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json({ error: 'Only the funding department can do that.' }, { status: 403 })
  }

  try {
    await removeProposalMilestone({ proposalId: params.id, milestoneId: params.milestoneId })
    return NextResponse.json({ removed: true })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] milestone delete failed', error)
    return NextResponse.json({ error: 'Could not remove that obligation.' }, { status: 500 })
  }
}
