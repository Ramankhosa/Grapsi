import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  TENANT_SCOPED_ADMIN_ROLES,
  isAccessError,
  requireTenantRoles,
} from '@/lib/auth/tenantAccess'
import {
  DEFAULT_LADDER,
  SUGGEST_STRATEGIES,
  listUnmappedUnitIds,
  suggestAreasForUnits,
} from '@/lib/orgUnits/researchAreaSuggest'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Propose research areas for every unmapped unit at once.
 *
 * Mapping one modal at a time is fine for a handful of units and hopeless for a
 * real university: sixty to a hundred units, each needing open / suggest /
 * review / save / close. The setup then gets abandoned half-done, and a
 * half-mapped tenant is worse than an unmapped one, because some schools
 * silently filter their queue while others show the whole catalog.
 *
 * Read-only. It returns proposals with their evidence; the client confirms them
 * unit by unit through the existing PUT, so a mapping in the database still
 * always means somebody looked at it.
 */

const bodySchema = z.object({
  /** Omit to do every unmapped unit. */
  unitIds: z.array(z.string().trim().min(1)).max(500).optional(),
  /** Which rungs of the ladder to try, in order. */
  strategies: z.array(z.enum(SUGGEST_STRATEGIES)).min(1).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  maxAreas: z.number().int().min(1).max(10).optional(),
  /** Accept a whole-group answer when nothing specific was found. */
  allowBroad: z.boolean().optional(),
  /** Include units that already have a mapping, to review or re-do them. */
  includeMapped: z.boolean().optional(),
})

/** Guard against a pathological tree turning one click into a very long request. */
const MAX_UNITS_PER_RUN = 200

export async function POST(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_SCOPED_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
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

  let unitIds = payload.unitIds
  if (!unitIds || unitIds.length === 0) {
    unitIds = payload.includeMapped
      ? (
          await prisma.tenantOrgUnit.findMany({
            where: { tenant_id: context.tenantId, is_active: true },
            select: { id: true },
            orderBy: [{ depth: 'desc' }, { name: 'asc' }],
          })
        ).map((row) => row.id)
      : await listUnmappedUnitIds(context.tenantId)
  }

  const total = unitIds.length
  const truncated = total > MAX_UNITS_PER_RUN
  const batch = unitIds.slice(0, MAX_UNITS_PER_RUN)

  if (batch.length === 0) {
    return NextResponse.json({
      units: [],
      total: 0,
      truncated: false,
      strategies: payload.strategies ?? DEFAULT_LADDER,
      message: 'Every unit already has research areas mapped.',
    })
  }

  const units = await suggestAreasForUnits(context.tenantId, batch, {
    strategies: payload.strategies,
    minConfidence: payload.minConfidence,
    maxAreas: payload.maxAreas,
    allowBroad: payload.allowBroad,
  })

  if (units.length === 0) {
    return NextResponse.json(
      {
        error:
          'No research-area catalog is active yet. A platform administrator must load one before units can be mapped.',
      },
      { status: 409 }
    )
  }

  return NextResponse.json({
    units,
    total,
    truncated,
    strategies: payload.strategies ?? DEFAULT_LADDER,
    summary: {
      specific: units.filter((row) => row.coverage === 'specific').length,
      broad: units.filter((row) => row.coverage === 'broad').length,
      none: units.filter((row) => row.coverage === 'none').length,
    },
  })
}
