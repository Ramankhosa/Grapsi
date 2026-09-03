import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantUser } from '@/lib/auth/tenantAccess'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/lib/prisma-generated'

export const dynamic = 'force-dynamic'

/**
 * How many research areas each org unit has mapped.
 *
 * One aggregate for the whole tree, so the structure page can flag an unmapped
 * unit inline instead of firing a request per node. Units with none are simply
 * absent from the map — the client treats a missing key as zero.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantUser(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const rows = await prisma.$queryRaw<Array<{ org_unit_id: string; count: number }>>(Prisma.sql`
    SELECT org_unit_id, COUNT(*)::int AS count
      FROM tenant_org_unit_research_areas
     WHERE tenant_id = ${context.tenantId}
     GROUP BY org_unit_id
  `)

  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.org_unit_id] = row.count

  return NextResponse.json({ counts })
}
