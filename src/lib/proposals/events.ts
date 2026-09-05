/**
 * The proposal's history.
 *
 * One table serves three readers — the audit trail, the applicant's activity
 * feed, and the call dossier's merged timeline — with `visible_to_faculty`
 * deciding which of them a row reaches. Writing three tables instead would mean
 * three chances for them to disagree about what happened.
 */
import type { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'

import type { ProposalEventKind, ProposalLens } from './shared'
import { lensSeesInternal, serializeProposalEvent } from './shared'

type Tx = Prisma.TransactionClient | typeof prisma

export interface RecordEventInput {
  tenantId: string
  proposalId: string
  actorUserId?: string | null
  kind: ProposalEventKind
  fromStatus?: string | null
  toStatus?: string | null
  payload?: Record<string, unknown> | null
  /**
   * Default true. The exceptions are the department's own working notes and the
   * mechanics of a review run, which mean nothing to the applicant until the
   * result is deliberately shared.
   */
  visibleToFaculty?: boolean
}

/**
 * Write one event. Takes a transaction client so a state change and its record
 * land together — a status that moved without an event is a gap in the history
 * nobody can reconstruct later.
 */
export async function recordProposalEvent(tx: Tx, input: RecordEventInput) {
  return tx.grantProposalEvent.create({
    data: {
      tenant_id: input.tenantId,
      proposal_id: input.proposalId,
      actor_user_id: input.actorUserId || null,
      kind: input.kind,
      from_status: input.fromStatus || null,
      to_status: input.toStatus || null,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      visible_to_faculty: input.visibleToFaculty !== false,
    },
    select: { id: true },
  })
}

/** Best-effort event: for places where losing the note must not fail the write. */
export async function recordProposalEventQuietly(input: RecordEventInput) {
  try {
    await recordProposalEvent(prisma, input)
  } catch (error) {
    console.error('[proposals] could not record event', input.kind, error)
  }
}

export async function listProposalEvents(
  proposalId: string,
  lens: ProposalLens,
  options?: { limit?: number }
) {
  const rows = await prisma.grantProposalEvent.findMany({
    where: {
      proposal_id: proposalId,
      ...(lensSeesInternal(lens) ? {} : { visible_to_faculty: true }),
    },
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(options?.limit ?? 100, 1), 400),
    include: { actor: { select: { id: true, name: true, email: true } } },
  })

  return rows.map((row) => serializeProposalEvent(row, lens))
}
