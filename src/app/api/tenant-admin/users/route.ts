/**
 * Tenant Admin - Users Management API
 * 
 * GET  - List all users in tenant with their roles and team memberships
 * POST - Bulk operations (future)
 * 
 * For individual user operations, see [userId]/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { getTenantUsers } from '@/lib/org-access-service'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tenant-admin/users
 * List all users in the tenant
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const user = authResult.user!
    
    // Require at least MANAGER role to view users
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN', 'MANAGER'])(request)
    if (roleCheck) return roleCheck
    
    if (!user.tenant_id) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }
    
    // Get users with team info
    const users = await getTenantUsers(user.tenant_id)
    
    // Get tenant info for context
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenant_id },
      select: { id: true, name: true, type: true }
    })
    
    return NextResponse.json({
      tenant,
      users,
      total: users.length
    })
    
  } catch (error) {
    console.error('[TenantAdmin] Users list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

