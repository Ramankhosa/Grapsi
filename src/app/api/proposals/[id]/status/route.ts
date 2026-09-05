import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { getProposalDossier, ProposalError } from '@/lib/proposals/proposalService'
import { PROPOSAL_STATUSES } from '@/lib/proposals/shared'
import { transitionProposal } from '@/lib/proposals/statusService'

export const dynamic = 'force-dynamic'

/**
 * Move the proposal along.
 *
 * Every transition is checked against one table (`statusMachine.ts`) rather
 * than a chain of `if`s per endpoint, and a submission recorded here goes
 * through the same `buildSubmissionUpdate` the assignment routes use, so the
 * department's dashboards and this desk cannot disagree about what happened.
 */

const postSchema = z.object({
  to: z.enum(PROPOSAL_STATUSES),
  submissionReference: z.string().trim().max(200).nullable().optional(),
  submissionUrl: z.string().trim().max(2000).nullable().optional(),
  submissionNotes: z.string().trim().max(2000).nullable().optional(),
  submittedAt: z.string().trim().nullable().optional(),
  sanctionedAmount: z.number().min(0).nullable().optional(),
  sanctionReference: z.string().trim().max(200).nullable().optional(),
  sanctionDate: z.string().trim().nullable().optional(),
  agencyStatusNote: z.string().trim().max(2000).nullable().optional(),
  overrideReason: z.string().trim().max(500).nullable().optional(),
})

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

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
    await transitionProposal({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      lens: access.lens,
      to: payload.to,
      submissionReference: payload.submissionReference ?? null,
      submissionUrl: payload.submissionUrl ?? null,
      submissionNotes: payload.submissionNotes ?? null,
      submittedAt: parseDate(payload.submittedAt),
      sanctionedAmount: payload.sanctionedAmount ?? undefined,
      sanctionReference: payload.sanctionReference ?? undefined,
      sanctionDate: parseDate(payload.sanctionDate),
      agencyStatusNote: payload.agencyStatusNote ?? undefined,
      overrideReason: payload.overrideReason ?? null,
    })

    return NextResponse.json(await getProposalDossier(params.id, access.lens))
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] transition failed', error)
    return NextResponse.json({ error: 'Could not update the proposal status.' }, { status: 500 })
  }
}
