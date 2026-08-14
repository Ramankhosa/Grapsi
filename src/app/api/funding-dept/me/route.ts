import { NextRequest, NextResponse } from 'next/server'

import { isAccessError, requireTenantScope } from '@/lib/auth/tenantAccess'
import { getMembership } from '@/lib/fundingDept/membershipService'
import { serializeMember } from '@/lib/fundingDept/shared'

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

  return NextResponse.json({
    isMember: Boolean(member),
    isHead: Boolean(member?.isHead),
    memberId: member?.id ?? null,
    title: member?.title ?? null,
    schools: member?.schools ?? [],
    canAdminister: context.isAdmin,
    capabilities: {
      canAssign: context.scope.canAssign,
      canViewReports: context.scope.canViewReports,
      isTenantWide: context.scope.isTenantWide,
    },
  })
}
