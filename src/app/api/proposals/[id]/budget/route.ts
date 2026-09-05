import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { listProposalBudget, replaceProposalBudget } from '@/lib/proposals/budgetService'
import { loadProposalForAccess } from '@/lib/proposals/access'
import { ProposalError } from '@/lib/proposals/proposalService'
import { getProposalSettings } from '@/lib/proposals/settings'
import { BUDGET_HEADS, MAX_BUDGET_YEARS } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

const putSchema = z.object({
  lines: z
    .array(
      z.object({
        head: z.enum(BUDGET_HEADS),
        yearNo: z.number().int().min(1).max(MAX_BUDGET_YEARS),
        amount: z.number().min(0),
        note: z.string().trim().max(500).nullable().optional(),
      })
    )
    .max(BUDGET_HEADS.length * MAX_BUDGET_YEARS),
  /** Used only when there are no lines: one figure typed by hand. */
  totalOverride: z.number().min(0).nullable().optional(),
  durationMonths: z.number().int().min(1).max(240).nullable().optional(),
  currency: z.string().trim().min(1).max(8).nullable().optional(),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })

  return NextResponse.json({ budget: await listProposalBudget(params.id) })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const access = await loadProposalForAccess(context, params.id)
  if (!access) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 })
  if (access.lens === 'head') {
    return NextResponse.json({ error: 'This view is read-only.' }, { status: 403 })
  }
  if (access.lens === 'faculty' && !['DRAFT', 'IN_REVIEW'].includes(access.record.status)) {
    return NextResponse.json(
      { error: 'This proposal has been cleared. Ask your funding officer to change the budget.' },
      { status: 403 }
    )
  }

  const settings = await getProposalSettings(context.tenantId)
  if (!settings.budgetEnabled) {
    return NextResponse.json(
      { error: 'Budget capture is switched off for this institution.', code: 'FEATURE_DISABLED' },
      { status: 403 }
    )
  }

  let payload: z.infer<typeof putSchema>
  try {
    payload = putSchema.parse(await request.json())
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  // A head this institution does not budget under is a typo or a stale client,
  // not a new category to accept silently.
  const unknownHead = payload.lines.find((line) => !settings.budgetHeads.includes(line.head))
  if (unknownHead) {
    return NextResponse.json(
      { error: `Your institution does not budget under "${unknownHead.head}".` },
      { status: 400 }
    )
  }

  try {
    const result = await replaceProposalBudget({
      tenantId: context.tenantId,
      proposalId: params.id,
      actorUserId: context.user.id,
      lines: payload.lines.map((line) => ({
        head: line.head,
        yearNo: line.yearNo,
        amount: line.amount,
        note: line.note ?? null,
      })),
      totalOverride: payload.totalOverride ?? null,
      durationMonths: payload.durationMonths,
      currency: payload.currency ?? null,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[proposals] budget update failed', error)
    return NextResponse.json({ error: 'Could not save the budget.' }, { status: 500 })
  }
}
