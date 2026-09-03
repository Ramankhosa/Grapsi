import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  TENANT_SCOPED_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
} from '@/lib/auth/tenantAccess'
import {
  SUGGEST_STRATEGIES,
  suggestAreasForUnits,
} from '@/lib/orgUnits/researchAreaSuggest'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Propose research areas for ONE org unit.
 *
 * The whole ladder lives in `researchAreaSuggest`, shared with the bulk route,
 * so the single-unit modal and the review table can never drift into giving
 * different answers for the same unit. `mode` is kept for the existing client:
 * it simply pins the ladder to one rung.
 *
 * Suggestions are NEVER saved here. This endpoint only reads; the admin
 * confirms a selection through PUT on the parent route. A mapping that appeared
 * without anyone choosing it would be indistinguishable later from one that was
 * reviewed, and the confirm step is what makes that difference legible.
 */

const bodySchema = z.object({
  /** Legacy two-mode control from the original modal. */
  mode: z.enum(['from_name', 'from_faculty']).optional(),
  /** Full control: which rungs to try, in order. Overrides `mode`. */
  strategies: z.array(z.enum(SUGGEST_STRATEGIES)).min(1).optional(),
  allowBroad: z.boolean().optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const unit = await prisma.tenantOrgUnit.findFirst({
    where: { id: params.id, tenant_id: context.tenantId },
    select: { id: true, name: true },
  })
  if (!unit) {
    return NextResponse.json({ error: 'Org unit not found.' }, { status: 404 })
  }

  let payload
  try {
    payload = bodySchema.parse(await request.json().catch(() => ({})))
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.errors?.[0]?.message || 'Invalid request body' },
      { status: 400 }
    )
  }

  const strategies =
    payload.strategies ??
    (payload.mode === 'from_faculty'
      ? (['faculty_areas', 'faculty_departments'] as const).slice()
      : payload.mode === 'from_name'
        ? (['name'] as const).slice()
        : undefined)

  const [result] = await suggestAreasForUnits(context.tenantId, [unit.id], {
    strategies,
    allowBroad: payload.allowBroad,
  })

  if (!result) {
    return NextResponse.json(
      {
        error:
          'No research-area catalog is active yet. A platform administrator must load one before units can be mapped.',
      },
      { status: 409 }
    )
  }

  return NextResponse.json({
    unit: { id: unit.id, name: unit.name },
    mode: payload.mode ?? 'auto',
    strategy: result.strategy,
    coverage: result.coverage,
    evidence: result.evidence,
    data: result.data,
    suggestions: result.suggestions,
  })
}
