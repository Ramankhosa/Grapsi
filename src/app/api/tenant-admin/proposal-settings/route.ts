import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantRoles, TENANT_ADMIN_ROLES } from '@/lib/auth/tenantAccess'
import {
  DEFAULT_PROPOSAL_SETTINGS,
  getProposalSettings,
  PROPOSAL_TOGGLES,
  saveProposalSettings,
  TOGGLE_COPY,
  type ProposalToggle,
} from '@/lib/proposals/settings'
import { BUDGET_HEADS, BUDGET_HEAD_LABELS } from '@/lib/proposals/shared'

export const dynamic = 'force-dynamic'

/**
 * How this institution runs its proposal desk.
 *
 * The tenant's own administrator decides which stages the office operates —
 * whether drafts get an AI review, whether budgets and co-investigators are
 * captured here, whether the record follows the agency's decision, and whether
 * an internal cut-off is enforced. Distinct from the plan entitlements, which
 * the platform sets and which still apply underneath these choices.
 */

/**
 * Built from PROPOSAL_TOGGLES rather than listed by hand.
 *
 * A toggle spelled out here and forgotten there parses to nothing, saves
 * nothing, and still answers "Saved" — the switch simply springs back. Deriving
 * the schema from the list makes that impossible.
 */
const toggleShape = Object.fromEntries(
  PROPOSAL_TOGGLES.map((key) => [key, z.boolean().optional()])
) as Record<ProposalToggle, z.ZodOptional<z.ZodBoolean>>

const putSchema = z.object({
  ...toggleShape,
  cutoffOffsetDays: z.number().int().min(0).max(90).optional(),
  reviewSlaDays: z.number().int().min(1).max(60).optional(),
  agencyStaleDays: z.number().int().min(7).max(730).optional(),
  budgetHeads: z.array(z.enum(BUDGET_HEADS)).min(1).optional(),
  // An empty template is a real choice: start every proposal with a blank
  // checklist and let the officer add what that agency wants.
  checklistTemplate: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
})

export async function GET(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  return NextResponse.json({
    settings: await getProposalSettings(context.tenantId),
    // The screen's vocabulary travels with the data, so the labels and the
    // rules they describe can never drift apart.
    toggles: PROPOSAL_TOGGLES.map((key) => ({ key, ...TOGGLE_COPY[key] })),
    budgetHeadOptions: BUDGET_HEADS.map((head) => ({ key: head, label: BUDGET_HEAD_LABELS[head] })),
    defaultChecklistTemplate: DEFAULT_PROPOSAL_SETTINGS.checklistTemplate,
  })
}

export async function PUT(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
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

  try {
    return NextResponse.json({ settings: await saveProposalSettings(context.tenantId, payload) })
  } catch (error) {
    console.error('[proposals] could not save settings', error)
    return NextResponse.json({ error: 'Could not save those settings.' }, { status: 500 })
  }
}
