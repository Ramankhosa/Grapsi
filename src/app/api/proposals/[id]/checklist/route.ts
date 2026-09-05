import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { addChecklistItem, listChecklist } from '@/lib/proposals/checklistService'
import { ProposalError } from '@/lib/proposals/proposalService'
import { getProposalSettings } from '@/lib/proposals/settings'
import { lensCanManage, lensSeesInternal } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * The attachments an agency demands alongside the proposal.
 *
 * The applicant sees the lines that are theirs to act on, which is most of
 * them — a checklist they cannot see is one they cannot work through.
 */

const postSchema = z.object({
  label: z.string().trim().min(1, 'Give the line a label').max(200),
  isRequired: z.boolean().default(true),
  visibleToFaculty: z.boolean().default(true),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  return NextResponse.json({
    checklist: await listChecklist(params.id, lensSeesInternal(access.lens)),
  })
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
      { error: 'Only the funding department sets what is required.' },
      { status: 403 }
    )
  }

  const settings = await getProposalSettings(context.tenantId)
  if (!settings.checklistEnabled) {
    return NextResponse.json(
      {
        error: 'The pre-submission checklist is switched off for this institution.',
        code: 'FEATURE_DISABLED',
      },
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
    const item = await addChecklistItem({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      label: payload.label,
      isRequired: payload.isRequired,
      visibleToFaculty: payload.visibleToFaculty,
    })
    return NextResponse.json({ item }, { status: 201 })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] checklist add failed', error)
    return NextResponse.json({ error: 'Could not add that line.' }, { status: 500 })
  }
}
