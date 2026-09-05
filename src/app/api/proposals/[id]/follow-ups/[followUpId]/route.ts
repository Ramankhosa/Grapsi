import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { deleteProposalFollowUp } from '@/lib/proposals/followUpService'
import { ProposalError } from '@/lib/proposals/proposalService'
import { lensCanManage } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * Remove a note from the contact log.
 *
 * The author or somebody who answers for the department, and nobody else: one
 * officer quietly deleting a colleague's record of a conversation is exactly
 * what a contact log exists to prevent.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; followUpId: string } }
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
    await deleteProposalFollowUp({
      proposalId: params.id,
      followUpId: params.followUpId,
      actorUserId: context.user.id,
      isHeadOrAdmin: access.lens === 'admin' || context.scope.fundingDept.isHead,
    })
    return NextResponse.json({ removed: true })
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] follow-up delete failed', error)
    return NextResponse.json({ error: 'Could not remove that note.' }, { status: 500 })
  }
}
