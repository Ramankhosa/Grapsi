/**
 * Tenant Admin - Individual Team Management API
 * 
 * GET    - Get team details with members and service access
 * PATCH  - Update team settings
 * DELETE - Deactivate team (soft delete)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tenant-admin/teams/[teamId]
 * Get detailed team information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const user = authResult.user!
    
    // Require at least MANAGER role
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN', 'MANAGER'])(request)
    if (roleCheck) return roleCheck
    
    const { teamId } = params
    
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                firstName: true,
                lastName: true,
                roles: true,
                status: true
              }
            }
          }
        },
        serviceAccess: true,
        _count: { select: { members: true } }
      }
    })
    
    if (!team || team.tenantId !== user.tenant_id) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    
    // Check if current user is a team lead
    const userMembership = team.members.find(m => m.userId === user.sub)
    const isTeamLead = userMembership?.role === 'LEAD'
    const isAdmin = (user.roles || []).some((r: string) => ['OWNER', 'ADMIN'].includes(r))
    
    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        isDefault: team.isDefault,
        isActive: team.isActive,
        createdAt: team.createdAt,
        memberCount: team._count.members
      },
      members: team.members.map(m => ({
        id: m.id,
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name || `${m.user.firstName || ''} ${m.user.lastName || ''}`.trim(),
        role: m.role,
        userRole: m.user.roles[0],
        status: m.user.status,
        joinedAt: m.joinedAt
      })),
      serviceAccess: team.serviceAccess,
      permissions: {
        canEdit: isTeamLead || isAdmin,
        canAddMembers: isTeamLead || isAdmin,
        canRemoveMembers: isTeamLead || isAdmin,
        canChangeServiceAccess: isAdmin,
        canDelete: isAdmin
      }
    })
    
  } catch (error) {
    console.error('[TenantAdmin] Team details error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch team details' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/tenant-admin/teams/[teamId]
 * Update team settings
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const user = authResult.user!
    
    const { teamId } = params
    const body = await request.json()
    const { action, ...data } = body
    
    // Get team and check access
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: { where: { userId: user.sub } }
      }
    })
    
    if (!team || team.tenantId !== user.tenant_id) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    
    const isTeamLead = team.members.some(m => m.role === 'LEAD')
    const isAdmin = (user.roles || []).some((r: string) => ['OWNER', 'ADMIN'].includes(r))
    
    // Handle different actions
    switch (action) {
      case 'update_info': {
        if (!isTeamLead && !isAdmin) {
          return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
        }
        
        const { name, description, isDefault } = data
        
        // If setting as default, unset other defaults
        if (isDefault && !team.isDefault) {
          await prisma.team.updateMany({
            where: { tenantId: user.tenant_id!, isDefault: true },
            data: { isDefault: false }
          })
        }
        
        await prisma.team.update({
          where: { id: teamId },
          data: {
            ...(name !== undefined && { name: name.trim() }),
            ...(description !== undefined && { description: description?.trim() || null }),
            ...(isDefault !== undefined && { isDefault })
          }
        })
        
        return NextResponse.json({ success: true })
      }
      
      case 'add_member': {
        if (!isTeamLead && !isAdmin) {
          return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
        }
        
        const { userId: targetUserId, role = 'MEMBER' } = data
        
        // Verify target user exists and is in same tenant
        const targetUser = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, tenantId: true }
        })
        
        if (!targetUser || targetUser.tenantId !== user.tenant_id) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }
        
        // Check if already a member
        const existing = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId: targetUserId } }
        })
        
        if (existing) {
          return NextResponse.json({ error: 'User is already a team member' }, { status: 400 })
        }
        
        await prisma.teamMember.create({
          data: { teamId, userId: targetUserId, role }
        })
        
        // Audit log
        await prisma.auditLog.create({
          data: {
            actorUserId: user.sub,
            tenantId: user.tenant_id!,
            action: 'TEAM_MEMBER_ADD',
            resource: `team:${teamId}`,
            meta: { addedUserId: targetUserId, role }
          }
        })
        
        return NextResponse.json({ success: true })
      }
      
      case 'remove_member': {
        if (!isTeamLead && !isAdmin) {
          return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
        }
        
        const { userId: targetUserId } = data
        
        // Check if member exists
        const membership = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId: targetUserId } }
        })
        
        if (!membership) {
          return NextResponse.json({ error: 'User is not a team member' }, { status: 400 })
        }
        
        // Cannot remove the last lead
        if (membership.role === 'LEAD') {
          const leadCount = await prisma.teamMember.count({
            where: { teamId, role: 'LEAD' }
          })
          if (leadCount <= 1) {
            return NextResponse.json(
              { error: 'Cannot remove the last team lead' },
              { status: 400 }
            )
          }
        }
        
        await prisma.teamMember.delete({
          where: { teamId_userId: { teamId, userId: targetUserId } }
        })
        
        // Audit log
        await prisma.auditLog.create({
          data: {
            actorUserId: user.sub,
            tenantId: user.tenant_id!,
            action: 'TEAM_MEMBER_REMOVE',
            resource: `team:${teamId}`,
            meta: { removedUserId: targetUserId }
          }
        })
        
        return NextResponse.json({ success: true })
      }
      
      case 'change_member_role': {
        if (!isTeamLead && !isAdmin) {
          return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
        }
        
        const { userId: targetUserId, newRole } = data
        
        if (!['LEAD', 'MEMBER'].includes(newRole)) {
          return NextResponse.json({ error: 'Invalid team role' }, { status: 400 })
        }
        
        // Check if member exists
        const membership = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId: targetUserId } }
        })
        
        if (!membership) {
          return NextResponse.json({ error: 'User is not a team member' }, { status: 400 })
        }
        
        // If demoting from LEAD, ensure not the last lead
        if (membership.role === 'LEAD' && newRole === 'MEMBER') {
          const leadCount = await prisma.teamMember.count({
            where: { teamId, role: 'LEAD' }
          })
          if (leadCount <= 1) {
            return NextResponse.json(
              { error: 'Cannot demote the last team lead' },
              { status: 400 }
            )
          }
        }
        
        await prisma.teamMember.update({
          where: { teamId_userId: { teamId, userId: targetUserId } },
          data: { role: newRole }
        })
        
        return NextResponse.json({ success: true })
      }
      
      case 'update_service_access': {
        // Only OWNER/ADMIN can change service access
        if (!isAdmin) {
          return NextResponse.json({ error: 'Only OWNER or ADMIN can change service access' }, { status: 403 })
        }
        
        const { serviceType, isEnabled, monthlyQuota, dailyQuota } = data
        
        await prisma.teamServiceAccess.upsert({
          where: { teamId_serviceType: { teamId, serviceType } },
          create: {
            teamId,
            serviceType,
            isEnabled: isEnabled ?? true,
            monthlyQuota: monthlyQuota ?? null,
            dailyQuota: dailyQuota ?? null
          },
          update: {
            ...(isEnabled !== undefined && { isEnabled }),
            ...(monthlyQuota !== undefined && { monthlyQuota }),
            ...(dailyQuota !== undefined && { dailyQuota })
          }
        })
        
        // Audit log
        await prisma.auditLog.create({
          data: {
            actorUserId: user.sub,
            tenantId: user.tenant_id!,
            action: 'TEAM_SERVICE_ACCESS_UPDATE',
            resource: `team:${teamId}`,
            meta: { serviceType, isEnabled, monthlyQuota, dailyQuota }
          }
        })
        
        return NextResponse.json({ success: true })
      }
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
    
  } catch (error) {
    console.error('[TenantAdmin] Team update error:', error)
    return NextResponse.json(
      { error: 'Failed to update team' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tenant-admin/teams/[teamId]
 * Deactivate team (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const user = authResult.user!
    
    // Only OWNER/ADMIN can delete teams
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck
    
    const { teamId } = params
    
    const team = await prisma.team.findUnique({
      where: { id: teamId }
    })
    
    if (!team || team.tenantId !== user.tenant_id) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }
    
    // Soft delete - just deactivate
    await prisma.team.update({
      where: { id: teamId },
      data: { isActive: false }
    })
    
    // Audit log
    await prisma.auditLog.create({
      data: {
        actorUserId: user.sub,
        tenantId: user.tenant_id!,
        action: 'TEAM_DEACTIVATE',
        resource: `team:${teamId}`,
        meta: { teamName: team.name }
      }
    })
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('[TenantAdmin] Team delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete team' },
      { status: 500 }
    )
  }
}

