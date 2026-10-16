import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isAccessError, requireTenantRoles, TENANT_ADMIN_ROLES } from '@/lib/auth/tenantAccess'
import { previewMatchWidths } from '@/lib/fundingDept/callMatchCensus'
import { MATCH_WIDTHS } from '@/lib/fundingDept/matchBands'
import { getDeptSettings, saveDeptSettings } from '@/lib/fundingDept/settings'

export const dynamic = 'force-dynamic'

/**
 * How good a score has to be before somebody counts as matched.
 *
 * GET returns the three widths with the figures each would produce for this
 * institution right now, read from scores already stored. An administrator can
 * then choose on evidence rather than on a number nobody has intuition for —
 * which is the only way this setting travels to an institution whose corpus,
 * discipline mix and agency wording we have never seen.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) return NextResponse.json({ error: context.error }, { status: context.status })

  const [settings, previews] = await Promise.all([
    getDeptSettings(context.tenantId),
    previewMatchWidths(context.tenantId),
  ])
  return NextResponse.json({ width: settings.matchWidth, previews })
}

export async function PUT(request: NextRequest) {
  const context = await requireTenantRoles(request, TENANT_ADMIN_ROLES)
  if (isAccessError(context)) return NextResponse.json({ error: context.error }, { status: context.status })

  const parsed = z.object({ width: z.enum(MATCH_WIDTHS) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose one of the offered match widths.' }, { status: 400 })
  }

  const settings = await saveDeptSettings(context.tenantId, { matchWidth: parsed.data.width })
  return NextResponse.json({ width: settings.matchWidth })
}
