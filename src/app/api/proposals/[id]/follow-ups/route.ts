import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { listProposalFollowUps, recordProposalFollowUp } from '@/lib/proposals/followUpService'
import { getProposalDossier, ProposalError } from '@/lib/proposals/proposalService'
import {
  FOLLOW_UP_KINDS,
  lensCanManage,
  PROPOSAL_STATUSES,
} from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * The officer's contact log on a live application.
 *
 * One POST does the three things the job involves: what the researcher said,
 * where that puts the proposal, and when to ask again. The status change runs
 * through the ordinary transition path, so a move this tenant does not allow
 * stops the whole action rather than leaving a note describing something that
 * never happened.
 */

const postSchema = z.object({
  kind: z.enum(FOLLOW_UP_KINDS).default('CALL'),
  note: z.string().trim().min(1, 'Write down what was said').max(5000),
  happenedAt: z.string().trim().nullable().optional(),
  recordStatus: z.enum(PROPOSAL_STATUSES).nullable().optional(),
  agencyStatusNote: z.string().trim().max(2000).nullable().optional(),
  sanctionedAmount: z.number().min(0).nullable().optional(),
  sanctionReference: z.string().trim().max(200).nullable().optional(),
  remindAt: z.string().trim().nullable().optional(),
  visibleToFaculty: z.boolean().default(false),
})

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

  return NextResponse.json({ followUps: await listProposalFollowUps(params.id, access.lens) })
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
      { error: 'Only the funding department keeps the contact log.' },
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
    const followUp = await recordProposalFollowUp({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      lens: access.lens,
      kind: payload.kind,
      note: payload.note,
      happenedAt: parseDate(payload.happenedAt),
      recordStatus: payload.recordStatus ?? null,
      agencyStatusNote: payload.agencyStatusNote ?? null,
      sanctionedAmount: payload.sanctionedAmount ?? null,
      sanctionReference: payload.sanctionReference ?? null,
      remindAt: parseDate(payload.remindAt),
      visibleToFaculty: payload.visibleToFaculty,
    })

    // The dossier comes back with it, because recording a follow-up usually
    // moves the status and the screen should not have to ask twice.
    return NextResponse.json(
      { followUp, dossier: await getProposalDossier(params.id, access.lens) },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] follow-up failed', error)
    return NextResponse.json({ error: 'Could not record that follow-up.' }, { status: 500 })
  }
}
