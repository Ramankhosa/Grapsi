import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { removeChecklistItem, updateChecklistItem } from '@/lib/proposals/checklistService'
import { ProposalError } from '@/lib/proposals/proposalService'
import { CHECKLIST_STATUSES, lensCanManage } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  status: z.enum(CHECKLIST_STATUSES).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  isRequired: z.boolean().optional(),
})

/**
 * Tick, waive or annotate one line.
 *
 * The department owns this. A checklist an applicant could tick themselves
 * would record only that they believe they attached something.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (!lensCanManage(access.lens)) {
    return NextResponse.json(
      { error: 'Only the funding department signs a line off.' },
      { status: 403 }
    )
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
    const item = await updateChecklistItem({
      tenantId: context.tenantId,
      proposalId: params.id,
      itemId: params.itemId,
      actorUserId: context.user.id,
      status: payload.status,
      note: payload.note,
      isRequired: payload.isRequired,
    })
    return NextResponse.json({ item })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] checklist update failed', error)
    return NextResponse.json({ error: 'Could not update that line.' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
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
    await removeChecklistItem({ proposalId: params.id, itemId: params.itemId })
    return NextResponse.json({ removed: true })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] checklist delete failed', error)
    return NextResponse.json({ error: 'Could not remove that line.' }, { status: 500 })
  }
}
