/**
 * Tenant Admin - Individual User Management API
 * 
 * GET    - Get user details with teams and quotas
 * PATCH  - Update user role or status
 * DELETE - Deactivate user (soft delete)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { 
  changeUserRole, 
  canChangeRole,
  getHighestRole,
  getUserTeams
} from '@/lib/org-access-service'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tenant-admin/users/[userId]
 * Get detailed user information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const actor = authResult.user!
    
    // Require at least MANAGER role
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN', 'MANAGER'])(request)
    if (roleCheck) return roleCheck
    
    const { userId } = params
    
    // Get target user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        roles: true,
        status: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
        teamMemberships: {
          include: {
            team: { select: { id: true, name: true, description: true } }
          }
        },
        serviceQuotas: true,
        _count: {
          select: {
            patents: true,
            projects: true
          }
        }
      }
    })
    
    if (!user || user.tenantId !== actor.tenant_id) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    // Determine what role changes are allowed
    const actorRoles = actor.roles || []
    const userHighestRole = getHighestRole(user.roles)
    const availableRoles: UserRole[] = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']
      .filter(role => canChangeRole(actorRoles as UserRole[], userHighestRole, role as UserRole).allowed) as UserRole[]
    
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles,
        currentRole: userHighestRole,
        status: user.status,
        teams: user.teamMemberships.map(m => ({
          id: m.team.id,
          name: m.team.name,
          description: m.team.description,
          role: m.role,
          isLead: m.role === 'LEAD'
        })),
        serviceQuotas: user.serviceQuotas,
        stats: {
          patents: user._count.patents,
          projects: user._count.projects
        },
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      permissions: {
        canChangeRole: availableRoles.length > 0,
        availableRoles,
        canDeactivate: canChangeRole(actorRoles as UserRole[], userHighestRole, 'VIEWER').allowed
      }
    })
    
  } catch (error) {
    console.error('[TenantAdmin] User details error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user details' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/tenant-admin/users/[userId]
 * Update user role or status
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const actor = authResult.user!
    
    // Require OWNER or ADMIN role
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck
    
    const { userId } = params
    const body = await request.json()
    const { action, newRole, status } = body
    
    if (!actor.tenant_id) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 })
    }
    
    // Handle role change
    if (action === 'change_role' && newRole) {
      const result = await changeUserRole(
        {
          userId: actor.sub,
          tenantId: actor.tenant_id,
          roles: (actor.roles || []) as UserRole[],
          email: actor.email
        },
        userId,
        newRole as UserRole
      )
      
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 })
      }
      
      return NextResponse.json({ success: true, message: 'Role updated successfully' })
    }
    
    // Handle status change (activate/deactivate)
    if (action === 'change_status' && status) {
      // Get target user to verify permissions
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { tenantId: true, roles: true }
      })
      
      if (!targetUser || targetUser.tenantId !== actor.tenant_id) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      
      // Cannot deactivate someone with equal or higher role
      const actorHighest = getHighestRole((actor.roles || []) as UserRole[])
      const targetHighest = getHighestRole(targetUser.roles)
      
      if (getHighestRole(targetUser.roles) === actorHighest || 
          ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'].includes(targetHighest)) {
        return NextResponse.json(
          { error: 'Cannot change status of user with equal or higher role' },
          { status: 403 }
        )
      }
      
      await prisma.user.update({
        where: { id: userId },
        data: { status: status as 'ACTIVE' | 'SUSPENDED' }
      })
      
      // Audit log
      await prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          tenantId: actor.tenant_id,
          action: 'USER_STATUS_CHANGE',
          resource: `user:${userId}`,
          meta: { newStatus: status }
        }
      })
      
      return NextResponse.json({ success: true, message: 'Status updated successfully' })
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    
  } catch (error) {
    console.error('[TenantAdmin] User update error:', error)
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    )
  }
}

