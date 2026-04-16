/**
 * Tenant Admin - Teams Management API
 * 
 * GET  - List all teams in tenant
 * POST - Create new team
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { createTeam, getTenantTeams } from '@/lib/org-access-service'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tenant-admin/teams
 * List all teams in the tenant
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const user = authResult.user!
    
    // Require at least MANAGER role to view teams
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN', 'MANAGER'])(request)
    if (roleCheck) return roleCheck
    
    if (!user.tenant_id) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }
    
    const teams = await getTenantTeams(user.tenant_id)
    
    return NextResponse.json({
      teams,
      total: teams.length
    })
    
  } catch (error) {
    console.error('[TenantAdmin] Teams list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch teams' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tenant-admin/teams
 * Create a new team
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error
    
    const user = authResult.user!
    
    // Require OWNER, ADMIN, or MANAGER role to create teams
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN', 'MANAGER'])(request)
    if (roleCheck) return roleCheck
    
    if (!user.tenant_id) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }
    
    const body = await request.json()
    const { name, description, isDefault } = body
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
    }
    
    if (name.length > 100) {
      return NextResponse.json({ error: 'Team name must be 100 characters or less' }, { status: 400 })
    }
    
    const result = await createTeam(
      {
        userId: user.sub,
        tenantId: user.tenant_id,
        roles: (user.roles || []) as UserRole[],
        email: user.email
      },
      name.trim(),
      description?.trim(),
      isDefault
    )
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    
    return NextResponse.json({
      success: true,
      team: result.team
    }, { status: 201 })
    
  } catch (error) {
    console.error('[TenantAdmin] Team create error:', error)
    return NextResponse.json(
      { error: 'Failed to create team' },
      { status: 500 }
    )
  }
}

