/**
 * The money asked for, by head of expenditure and project year.
 *
 * Rows rather than one JSON blob, because "what did this school ask for under
 * Equipment this year" is a question the office is actually asked, and a blob
 * makes it a full-table scan and a parse.
 *
 * `grant_proposals.requested_amount` is kept in step on every write: a total
 * that disagrees with its own lines is worse than no total.
 */
import prisma from '@/lib/prisma'

import { recordProposalEvent } from './events'
import { ProposalError } from './proposalService'
import {
  BUDGET_HEADS,
  MAX_BUDGET_YEARS,
  serializeBudgetLine,
  type BudgetHead,
} from './shared'

export interface BudgetLineInput {
  head: BudgetHead
  yearNo: number
  amount: number
  note?: string | null
}

export interface ReplaceBudgetInput {
  tenantId: string
  proposalId: string
  actorUserId: string
  lines: BudgetLineInput[]
  /** Set when there are no lines at all: a single figure typed by hand. */
  totalOverride?: number | null
  durationMonths?: number | null
  currency?: string | null
}

export async function replaceProposalBudget(input: ReplaceBudgetInput) {
  const proposal = await prisma.grantProposal.findUnique({
    where: { id: input.proposalId },
    select: { id: true, tenant_id: true },
  })
  if (!proposal) throw new ProposalError('Proposal not found.', 404, 'NOT_FOUND')

  const seen = new Set<string>()
  const lines: BudgetLineInput[] = []

  for (const raw of input.lines || []) {
    const head = String(raw.head || '').toUpperCase() as BudgetHead
    if (!BUDGET_HEADS.includes(head)) {
      throw new ProposalError(`Unknown budget head ${raw.head}.`, 400, 'BAD_HEAD')
    }
    const yearNo = Number(raw.yearNo)
    if (!Number.isInteger(yearNo) || yearNo < 1 || yearNo > MAX_BUDGET_YEARS) {
      throw new ProposalError(`Year must be between 1 and ${MAX_BUDGET_YEARS}.`, 400, 'BAD_YEAR')
    }
    const amount = Number(raw.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      throw new ProposalError('Budget amounts cannot be negative.', 400, 'BAD_AMOUNT')
    }

    const key = `${head}:${yearNo}`
    if (seen.has(key)) {
      throw new ProposalError(`${head} year ${yearNo} appears twice.`, 400, 'DUPLICATE_LINE')
    }
    seen.add(key)

    // A zero line carries no information; dropping it keeps the grid sparse
    // rather than storing seventy empty cells per proposal.
    if (amount === 0 && !raw.note) continue
    lines.push({ head, yearNo, amount, note: raw.note ?? null })
  }

  const computedTotal = lines.reduce((sum, line) => sum + line.amount, 0)
  const total =
    lines.length > 0
      ? computedTotal
      : input.totalOverride !== undefined && input.totalOverride !== null
        ? Number(input.totalOverride)
        : null

  if (total !== null && (!Number.isFinite(total) || total < 0)) {
    throw new ProposalError('The total is not a valid amount.', 400, 'BAD_AMOUNT')
  }

  const rows = await prisma.$transaction(async (tx) => {
    await tx.grantProposalBudgetLine.deleteMany({ where: { proposal_id: proposal.id } })

    for (const line of lines) {
      await tx.grantProposalBudgetLine.create({
        data: {
          tenant_id: proposal.tenant_id,
          proposal_id: proposal.id,
          head: line.head,
          year_no: line.yearNo,
          amount: line.amount,
          note: line.note ? String(line.note).trim().slice(0, 500) : null,
        },
      })
    }

    await tx.grantProposal.update({
      where: { id: proposal.id },
      data: {
        requested_amount: total,
        ...(input.durationMonths !== undefined ? { duration_months: input.durationMonths } : {}),
        ...(input.currency ? { currency: input.currency.trim().slice(0, 8) } : {}),
      },
    })

    await recordProposalEvent(tx, {
      tenantId: proposal.tenant_id,
      proposalId: proposal.id,
      actorUserId: input.actorUserId,
      kind: 'BUDGET_CHANGED',
      payload: { lines: lines.length, total },
    })

    return tx.grantProposalBudgetLine.findMany({
      where: { proposal_id: proposal.id },
      orderBy: [{ year_no: 'asc' }, { head: 'asc' }],
    })
  })

  return { budget: rows.map(serializeBudgetLine), total }
}

export async function listProposalBudget(proposalId: string) {
  const rows = await prisma.grantProposalBudgetLine.findMany({
    where: { proposal_id: proposalId },
    orderBy: [{ year_no: 'asc' }, { head: 'asc' }],
  })
  return rows.map(serializeBudgetLine)
}
