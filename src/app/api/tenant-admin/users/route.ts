/**
 * Tenant Admin - Users Management API
 *
 * GET  - List all users in tenant with their roles and team memberships
 * POST - Create a user directly in the tenant, with an activation link
 *
 * For individual user operations, see [userId]/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { getTenantUsers, canAddRole, canChangeRole } from '@/lib/org-access-service'
import { provisionUser } from '@/lib/user-provisioning'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * The hierarchy slot a new member can be created into. OWNER is absent by
 * design — the tenant principal seat moves through the platform's
 * "change administrator" flow, never by minting a second owner.
 */
const CREATABLE_HIERARCHY_ROLES = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as unknown as UserRole[]

/** Tags that can be attached at creation time. Same set the role editor offers. */
const CREATABLE_ADDITIVE_ROLES = [
  'CALL_ADMIN',
  'CALL_ASSIGNER',
  'MEMBER',
  'QUALITY_AUDITOR'
] as unknown as UserRole[]

/**
 * What this actor may hand out. `canChangeRole` is asked against VIEWER — the
 * floor of the hierarchy — because a user who does not exist yet has no current
 * role to be measured against; the check that matters is the actor's own rank.
 */
function resolveGrantableRoles(actorRoles: UserRole[]) {
  return {
    hierarchy: CREATABLE_HIERARCHY_ROLES.filter(
      role => canChangeRole(actorRoles, 'VIEWER' as UserRole, role).allowed
    ),
    additive: CREATABLE_ADDITIVE_ROLES.filter(role => canAddRole(actorRoles, role).allowed)
  }
}

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

    // MANAGER can read this list but cannot create; the page uses these to
    // decide whether to show "Add user" and which roles to offer.
    const actorRoles = (user.roles || []) as UserRole[]
    const grantable = resolveGrantableRoles(actorRoles)
    const canCreateUsers = actorRoles.some(role => role === 'OWNER' || role === 'ADMIN')

    return NextResponse.json({
      tenant,
      users,
      total: users.length,
      permissions: {
        canCreateUsers,
        creatableRoles: canCreateUsers ? grantable.hierarchy : [],
        grantableAdditiveRoles: canCreateUsers ? grantable.additive : []
      }
    })

  } catch (error) {
    console.error('[TenantAdmin] Users list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

const createSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  role: z.string().min(1),
  additiveRoles: z.array(z.string().min(1)).max(4).default([]),
  sendActivationEmail: z.boolean().default(true)
})

/**
 * POST /api/tenant-admin/users
 *
 * Create a member directly, rather than inviting them and waiting. The account
 * exists immediately with the chosen roles and no password; the person sets
 * their own via the returned activation link (emailed by default, and always
 * returned so the admin can deliver it themselves when mail is unreliable).
 *
 * Invites (/api/v1/admin/invites) remain the better tool when the person should
 * pick their own moment to join — this is for the cases where they can't, or
 * where an invite has already gone missing.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const actor = authResult.user!

    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    if (!actor.tenant_id) {
      return NextResponse.json({ error: 'No tenant associated with user' }, { status: 400 })
    }

    const body = createSchema.parse(await request.json())
    const actorRoles = (actor.roles || []) as UserRole[]
    const grantable = resolveGrantableRoles(actorRoles)

    const role = body.role as UserRole
    if (!grantable.hierarchy.includes(role)) {
      return NextResponse.json(
        { error: `You cannot create users with the ${role} role` },
        { status: 403 }
      )
    }

    const additiveRoles = body.additiveRoles as UserRole[]
    const forbiddenTag = additiveRoles.find(tag => !grantable.additive.includes(tag))
    if (forbiddenTag) {
      return NextResponse.json({ error: `You cannot grant ${forbiddenTag}` }, { status: 403 })
    }

    const result = await provisionUser({
      email: body.email,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      tenantId: actor.tenant_id,
      roles: [role, ...additiveRoles],
      actorUserId: actor.sub,
      sendActivationEmail: body.sendActivationEmail,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.status })
    }

    return NextResponse.json(
      {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          roles: result.user.roles,
          status: result.user.status,
          createdAt: result.user.createdAt.toISOString()
        },
        activationLink: result.activationLink,
        activationExpiresAt: result.activationExpiresAt.toISOString(),
        activationEmailSent: result.activationEmailSent,
        activationEmailError: result.activationEmailError
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid input data' },
        { status: 400 }
      )
    }

    console.error('[TenantAdmin] User create error:', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

