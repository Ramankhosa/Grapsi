/**
 * The officer's contact log on a live application.
 *
 * One action does the three things the job actually involves: record what the
 * researcher said, move the proposal to where that puts it, and set when to ask
 * again. Splitting those apart is how a status ends up describing a phone call
 * nobody wrote down, or a note ends up describing a status nobody moved.
 *
 * A row with `remind_at` is a tickler. The hourly proposal sweep claims it by
 * stamping `reminder_sent_at` — the same claim-then-act lock the assignment
 * reminders use, so two overlapping sweeps cannot both nudge.
 */
import prisma from '@/lib/prisma'

import { recordProposalEvent } from './events'
import { ProposalError } from './proposalService'
import {
  serializeProposalFollowUp,
  type ProposalFollowUpKind,
  type ProposalLens,
  type ProposalStatus,
} from './shared'
import { transitionProposal } from './statusService'

export interface RecordFollowUpInput {
  tenantId: string
  proposalId: string
  actorUserId: string
  lens: ProposalLens
  kind: ProposalFollowUpKind
  note: string
  happenedAt?: Date | null
  /** Where this contact establishes the proposal now stands, if anywhere new. */
  recordStatus?: ProposalStatus | null
  agencyStatusNote?: string | null
  sanctionedAmount?: number | null
  sanctionReference?: string | null
  /** When to be nudged to chase again. */
  remindAt?: Date | null
  /** Whether the applicant should see this note. Off by default. */
  visibleToFaculty?: boolean
}

export async function recordProposalFollowUp(input: RecordFollowUpInput) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: { id: true, tenant_id: true, status: true },
  })
  if (!proposal) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const note = input.note.trim()
  if (!note) throw new ProposalError('Write down what was said.', 400, 'EMPTY_NOTE')

  // The status change goes first and through the ordinary transition path, so
  // a refused move (wrong lens, a stage this tenant does not run) stops the
  // whole action rather than leaving a note claiming something that never
  // happened.
  let movedTo: ProposalStatus | null = null
  if (input.recordStatus && input.recordStatus !== proposal.status) {
    await transitionProposal({
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
      lens: input.lens,
      to: input.recordStatus,
      agencyStatusNote: input.agencyStatusNote ?? note,
      sanctionedAmount: input.sanctionedAmount ?? undefined,
      sanctionReference: input.sanctionReference ?? undefined,
    })
    movedTo = input.recordStatus
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.grantProposalFollowUp.create({
      data: {
        tenant_id: proposal.tenant_id,
        proposal_id: proposal.id,
        kind: input.kind,
        note: note.slice(0, 5000),
        // An officer logging on Friday a call they had on Tuesday must be able
        // to date it Tuesday.
        happened_at: input.happenedAt || new Date(),
        recorded_status: movedTo,
        remind_at: input.remindAt || null,
        visible_to_faculty: input.visibleToFaculty === true,
        created_by_user_id: input.actorUserId,
      },
      include: { created_by: { select: { id: true, name: true, email: true } } },
    })

    await recordProposalEvent(tx, {
      tenantId: proposal.tenant_id,
      proposalId: proposal.id,
      actorUserId: input.actorUserId,
      kind: 'FOLLOW_UP',
      payload: {
        contactKind: input.kind,
        note: note.slice(0, 1000),
        movedTo,
        remindAt: input.remindAt?.toISOString() ?? null,
      },
      visibleToFaculty: input.visibleToFaculty === true,
    })

    return row
  })

  return serializeProposalFollowUp(created, input.lens)
}

export async function listProposalFollowUps(proposalId: string, lens: ProposalLens) {
  const rows = await prisma.grantProposalFollowUp.findMany({
    where: {
      proposal_id: proposalId,
      // The department's contact log is its own. Only what an officer marked
      // for the applicant reaches them.
      ...(lens === 'officer' || lens === 'admin' ? {} : { visible_to_faculty: true }),
    },
    orderBy: { happened_at: 'desc' },
    take: 200,
    include: { created_by: { select: { id: true, name: true, email: true } } },
  })
  return rows.map((row) => serializeProposalFollowUp(row, lens))
}

export async function deleteProposalFollowUp(input: {
  proposalId: string
  followUpId: string
  actorUserId: string
  isHeadOrAdmin: boolean
}) {
  const row = await prisma.grantProposalFollowUp.findFirst({
    where: { id: input.followUpId, proposal_id: input.proposalId },
    select: { id: true, created_by_user_id: true },
  })
  if (!row) throw new ProposalError('That note was not found.', 404, 'NOT_FOUND')

  // Whoever wrote it, or somebody who answers for the department. A colleague
  // quietly deleting another officer's record of a conversation is exactly what
  // a contact log must not allow.
  if (row.created_by_user_id !== input.actorUserId && !input.isHeadOrAdmin) {
    throw new ProposalError('Only the author or the department head can remove a note.', 403, 'FORBIDDEN')
  }

  await prisma.grantProposalFollowUp.delete({ where: { id: row.id } })
}

/**
 * Ticklers whose time has come, claimed one at a time.
 *
 * Returns the rows this caller won, so the sweep can notify for exactly those.
 */
export async function claimDueFollowUpReminders(limit: number): Promise<
  Array<{
    id: string
    tenantId: string
    proposalId: string
    proposalTitle: string
    note: string
    authorUserId: string
    remindAt: Date | null
  }>
> {
  const due = await prisma.grantProposalFollowUp.findMany({
    where: {
      remind_at: { not: null, lte: new Date() },
      reminder_sent_at: null,
      // Nothing to chase on a record that has reached its end.
      proposal: { status: { notIn: ['WITHDRAWN', 'CLOSED', 'REJECTED'] } },
    },
    orderBy: { remind_at: 'asc' },
    take: limit,
    select: {
      id: true,
      tenant_id: true,
      proposal_id: true,
      note: true,
      remind_at: true,
      created_by_user_id: true,
      proposal: { select: { title: true } },
    },
  })

  const claimed = []
  for (const row of due) {
    // Claim-then-act: the conditional update is what makes an overlapping
    // sweep a no-op rather than a second notification.
    const won = await prisma.grantProposalFollowUp.updateMany({
      where: { id: row.id, reminder_sent_at: null },
      data: { reminder_sent_at: new Date() },
    })
    if (won.count === 0) continue

    claimed.push({
      id: row.id,
      tenantId: row.tenant_id,
      proposalId: row.proposal_id,
      proposalTitle: row.proposal.title,
      note: row.note,
      authorUserId: row.created_by_user_id,
      remindAt: row.remind_at,
    })
  }

  return claimed
}
