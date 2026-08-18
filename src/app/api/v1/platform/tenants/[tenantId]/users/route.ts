import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformScope } from '@/lib/middleware'
import { listTenantAdminCandidates } from '@/lib/tenant-admin-service'

export const dynamic = 'force-dynamic'

/**
 * Roster of a single tenant, for the super admin's "change administrator"
 * picker. Until now the only way to see a tenant's users from the platform
 * side was per-ATI-token (`GET /api/v1/platform/ati/[id]` → signup_users),
 * which misses anyone who joined through a member invite.
 *
 * Read-only, so `requirePlatformScope` admits SUPER_ADMIN_VIEWER too.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const tenant = await prisma.tenant.findUnique({
      where: { id: params.tenantId },
      select: { id: true, name: true, atiId: true, status: true }
    })

    if (!tenant || tenant.atiId === 'PLATFORM') {
      return NextResponse.json(
        { code: 'INVALID_TENANT', message: 'Select a customer tenant' },
        { status: 404 }
      )
    }

    const users = await listTenantAdminCandidates(tenant.id)

    return NextResponse.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        ati_id: tenant.atiId,
        status: tenant.status
      },
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        status: user.status,
        is_admin: user.isAdmin,
        is_owner: user.isOwner,
        created_at: user.createdAt.toISOString()
      }))
    })
  } catch (error) {
    console.error('Tenant user list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
