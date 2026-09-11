import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantRoles, TENANT_ADMIN_ROLES } from '@/lib/auth/tenantAccess'
import {
  DEPT_NUMBERS,
  DEPT_SETTING_COPY,
  DEPT_TOGGLES,
  getDeptSettings,
  saveDeptSettings,
  type DeptNumber,
  type DeptToggle,
} from '@/lib/fundingDept/settings'

export const dynamic = 'force-dynamic'

/**
 * What this institution counts as late.
 *
 * Seven days of an unallocated call is a pendency at one university and normal
 * at another. These were constants in the source: right defaults, wrong place
 * for a policy an office has to be able to argue about in a meeting and then
 * change.
 *
 * Distinct from the proposal-desk settings next door, which say which stages the
 * office runs, and from the plan entitlements, which the platform sets.
 */

/**
 * Built from the constants rather than listed by hand, for the same reason the
 * proposal settings schema is: a field spelled out here and forgotten there
 * parses to nothing, saves nothing, and still answers "Saved" while the control
 * springs back.
 */
const toggleShape = Object.fromEntries(
  DEPT_TOGGLES.map((key) => [key, z.boolean().optional()])
) as Record<DeptToggle, z.ZodOptional<z.ZodBoolean>>

const numberShape = Object.fromEntries(
  DEPT_NUMBERS.map((key) => [key, z.number().int().min(0).max(3650).optional()])
) as Record<DeptNumber, z.ZodOptional<z.ZodNumber>>

// The real bounds live with the settings module and are applied by
// normalizeDeptSettings on the way in, so a value that passes this loose schema
// is still clamped before it reaches an interval literal.
const putSchema = z.object({ ...toggleShape, ...numberShape })

export async function GET(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  return NextResponse.json({
    settings: await getDeptSettings(context.tenantId),
    // The screen vocabulary travels with the data, so the labels and the rules
    // they describe can never drift apart.
    toggles: DEPT_TOGGLES.map((key) => ({ key, ...DEPT_SETTING_COPY[key] })),
    numbers: DEPT_NUMBERS.map((key) => ({ key, ...DEPT_SETTING_COPY[key] })),
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
    return NextResponse.json({ settings: await saveDeptSettings(context.tenantId, payload) })
  } catch (error) {
    console.error('[fundingDept] could not save settings', error)
    return NextResponse.json({ error: 'Could not save those settings.' }, { status: 500 })
  }
}
