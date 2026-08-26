import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { serializeMember } from '@/lib/fundingDept/shared'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * The caller's own Funding Department standing, and what the server will
 * actually let them do.
 *
 * Every client-side gate reads from here rather than sniffing role strings.
 * Roles are a poor proxy — a covering member holds none, an org head holds
 * none, and the two screens that guessed from roles both got it wrong — so the
 * capability flags are derived server-side from the same ManagedScope the API
 * routes enforce with.
 */
export async function GET(request: NextRequest) {
  const context = await requireTenantScope(request)
  if (isAccessError(context)) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  // Read membership directly rather than from scope: tenant-wide admins return
  // from resolveManagedScope before the department lookup runs, and an admin
  // who is also a member should still see their own membership here.
  const membership = await getMembership(context.tenantId, context.user.id)
  const member = membership && membership.is_active ? serializeMember(membership) : null

  // The schools that define the caller's REACH, as opposed to their personal
  // rota: a head answers for every school any active member covers, so their
  // faculty and filter views must span the department even when they hold no
  // coverage rows themselves. `schools` stays personal on purpose — the member
  // home page shows "my schools", and the head's own rota is a real thing.
  let reachSchools = member?.schools ?? []
  if (member?.isHead) {
    const coverage = await prisma.fundingDeptSchoolAssignment.findMany({
      where: { tenant_id: context.tenantId, member: { is_active: true } },
      select: { org_unit: { select: { id: true, name: true, code: true } } },
      orderBy: { created_at: 'asc' },
    })
    const seen = new Map<string, { id: string; name: string | null; code: string | null }>()
    for (const row of coverage) {
      if (row.org_unit && !seen.has(row.org_unit.id)) seen.set(row.org_unit.id, row.org_unit)
    }
    reachSchools = Array.from(seen.values())
  }

  return NextResponse.json({
    isMember: Boolean(member),
    isHead: Boolean(member?.isHead),
    memberId: member?.id ?? null,
    title: member?.title ?? null,
    schools: member?.schools ?? [],
    reachSchools,
    canAdminister: context.isAdmin,
    capabilities: {
      canAssign: context.scope.canAssign,
      canViewReports: context.scope.canViewReports,
      isTenantWide: context.scope.isTenantWide,
    },
  })
}
