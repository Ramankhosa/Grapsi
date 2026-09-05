/**
 * The bundle an agency demands alongside the proposal.
 *
 * This is what makes "cleared for submission" mean something. Without it the
 * clearance is one officer's recollection that the CV, the endorsement letter
 * and the ethics clearance were all attached — and the failure mode is a
 * rejection on a technicality months later, with nobody able to say who missed
 * what.
 *
 * The list is seeded per proposal from the tenant's template rather than read
 * live, so editing the template never rewrites the checklist of an application
 * already being processed against the old one.
 */
import type { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'

import { recordProposalEvent } from './events'
import { ProposalError } from './proposalService'
import { getProposalSettings } from './settings'
import {
  CHECKLIST_SETTLED,
  serializeChecklistItem,
  type ChecklistStatus,
} from './shared'

type Tx = Prisma.TransactionClient | typeof prisma

/**
 * Give a new proposal its checklist. Called at creation; safe to call again,
 * because an existing list is never replaced.
 */
export async function seedChecklist(tx: Tx, input: { tenantId: string; proposalId: string }) {
  const existing = await tx.grantProposalChecklistItem.count({
    where: { proposal_id: input.proposalId },
  })
  if (existing > 0) return 0

  const settings = await getProposalSettings(input.tenantId)
  if (!settings.checklistEnabled || settings.checklistTemplate.length === 0) return 0

  for (const [index, label] of settings.checklistTemplate.entries()) {
    await tx.grantProposalChecklistItem.create({
      data: {
        tenant_id: input.tenantId,
        proposal_id: input.proposalId,
        label: label.slice(0, 200),
        // A line the office cannot say is optional would be a line it cannot
        // clear past; every seeded line starts required and can be waived.
        is_required: true,
        status: 'PENDING',
        sort_order: index,
      },
    })
  }

  return settings.checklistTemplate.length
}

export async function listChecklist(proposalId: string, includeInternal: boolean) {
  const rows = await prisma.grantProposalChecklistItem.findMany({
    where: {
      proposal_id: proposalId,
      ...(includeInternal ? {} : { visible_to_faculty: true }),
    },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    include: {
      document: { select: { id: true, file_name: true } },
      completed_by: { select: { id: true, name: true, email: true } },
    },
  })
  return rows.map(serializeChecklistItem)
}

/** What still stands between this proposal and a clean clearance. */
export async function outstandingRequiredItems(proposalId: string): Promise<string[]> {
  const rows = await prisma.grantProposalChecklistItem.findMany({
    where: {
      proposal_id: proposalId,
      is_required: true,
      status: { notIn: CHECKLIST_SETTLED },
    },
    select: { label: true },
    orderBy: { sort_order: 'asc' },
  })
  return rows.map((row) => row.label)
}

export interface UpdateChecklistItemInput {
  tenantId: string
  proposalId: string
  itemId: string
  actorUserId: string
  status?: ChecklistStatus
  note?: string | null
  isRequired?: boolean
}

export async function updateChecklistItem(input: UpdateChecklistItemInput) {
  const item = await prisma.grantProposalChecklistItem.findFirst({
    where: { id: input.itemId, proposal_id: input.proposalId },
    select: { id: true, label: true, status: true },
  })
  if (!item) throw new ProposalError('That checklist line was not found.', 404, 'NOT_FOUND')

  const settling = input.status ? CHECKLIST_SETTLED.includes(input.status) : false

  // Waiving a required attachment is a decision the office should be able to
  // explain later, so it carries a reason.
  if (input.status === 'WAIVED' && !(input.note || '').trim()) {
    throw new ProposalError('Say why this is being waived.', 400, 'REASON_REQUIRED')
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.grantProposalChecklistItem.update({
      where: { id: item.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim().slice(0, 1000) || null } : {}),
        ...(input.isRequired !== undefined ? { is_required: input.isRequired } : {}),
        ...(input.status
          ? settling
            ? { completed_by_user_id: input.actorUserId, completed_at: new Date() }
            : { completed_by_user_id: null, completed_at: null }
          : {}),
      },
      include: {
        document: { select: { id: true, file_name: true } },
        completed_by: { select: { id: true, name: true, email: true } },
      },
    })

    if (input.status && input.status !== item.status) {
      await recordProposalEvent(tx, {
        tenantId: input.tenantId,
        proposalId: input.proposalId,
        actorUserId: input.actorUserId,
        kind: 'CHECKLIST_CHANGED',
        payload: { label: item.label, from: item.status, to: input.status, note: input.note ?? null },
      })
    }

    return row
  })

  return serializeChecklistItem(updated)
}

export async function addChecklistItem(input: {
  tenantId: string
  proposalId: string
  actorUserId: string
  label: string
  isRequired: boolean
  visibleToFaculty?: boolean
}) {
  const label = input.label.trim()
  if (!label) throw new ProposalError('Give the line a label.', 400, 'EMPTY_LABEL')

  const last = await prisma.grantProposalChecklistItem.findFirst({
    where: { proposal_id: input.proposalId },
    orderBy: { sort_order: 'desc' },
    select: { sort_order: true },
  })

  const created = await prisma.grantProposalChecklistItem.create({
    data: {
      tenant_id: input.tenantId,
      proposal_id: input.proposalId,
      label: label.slice(0, 200),
      is_required: input.isRequired,
      visible_to_faculty: input.visibleToFaculty !== false,
      sort_order: (last?.sort_order ?? -1) + 1,
    },
    include: {
      document: { select: { id: true, file_name: true } },
      completed_by: { select: { id: true, name: true, email: true } },
    },
  })

  return serializeChecklistItem(created)
}

export async function removeChecklistItem(input: { proposalId: string; itemId: string }) {
  const item = await prisma.grantProposalChecklistItem.findFirst({
    where: { id: input.itemId, proposal_id: input.proposalId },
    select: { id: true },
  })
  if (!item) throw new ProposalError('That checklist line was not found.', 404, 'NOT_FOUND')
  await prisma.grantProposalChecklistItem.delete({ where: { id: item.id } })
}
