import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requirePlatformScope } from '@/lib/middleware'
import { createAuditLog } from '@/lib/auth'
import { createTenantInvite, listTenantInvites } from '@/lib/tenant-invite-service'
import {
  changeTenantAdmin,
  TENANT_ADMIN_ROLE_VALUES,
  DEMOTION_ROLE_VALUES
} from '@/lib/tenant-admin-service'

export const dynamic = 'force-dynamic'

/**
 * Platform-tier administrator management.
 *
 * POST is the entry point of the whole onboarding chain: a super admin invites
 * a named person to administer a tenant, and that person receives an
 * email-locked, single-use link. When they sign up they are the tenant's first
 * user, so the signup transaction promotes them to OWNER — from there they
 * invite their own members through /api/v1/admin/invites.
 *
 * This replaces the previous hand-off, which required a super admin to copy a
 * raw ATI token out of the dashboard and deliver it out of band.
 *
 * PATCH covers the case the invite cannot: the incoming administrator already
 * has an account in the tenant, so there is nothing to invite — the seat just
 * moves. `createTenantInvite` refuses an email that already has an account, and
 * no in-tenant role path can mint an OWNER, so this is the only way to replace
 * an administrator who has left.
 */

const createSchema = z.object({
  tenant_id: z.string().min(1),
  email: z.string().email()
})

const changeSchema = z.object({
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  // OWNER hands over the tenant principal seat; ADMIN adds a co-administrator.
  role: z.enum(TENANT_ADMIN_ROLE_VALUES).default('OWNER'),
  // Omit to leave the sitting owner in place (adding an admin rather than
  // replacing one). Explicit null means the same thing.
  demote_current_to: z.enum(DEMOTION_ROLE_VALUES).nullish().default(null)
})

export async function POST(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const { user: authUser } = await authenticateRequest(request)
    const body = createSchema.parse(await request.json())

    const tenant = await prisma.tenant.findUnique({
      where: { id: body.tenant_id },
      select: { id: true, name: true, atiId: true, status: true }
    })

    if (!tenant || tenant.atiId === 'PLATFORM') {
      return NextResponse.json(
        { code: 'INVALID_TENANT', message: 'Select a customer tenant' },
        { status: 400 }
      )
    }

    if (tenant.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'TENANT_INACTIVE', message: 'Tenant is not active' },
        { status: 400 }
      )
    }

    // Only the first user of a tenant is promoted to OWNER. Later invitees get
    // ADMIN, which is still full workspace administration — surface which one
    // happened so the super admin is not surprised.
    const existingUserCount = await prisma.user.count({ where: { tenantId: tenant.id } })
    const isFoundingAdmin = existingUserCount === 0

    // Carry the tenant's plan through to the invite so the admin's entitlement
    // matches what was sold, the same way the onboarding ATI token would have.
    const planToken = await prisma.aTIToken.findFirst({
      where: { tenantId: tenant.id, planTier: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { planTier: true }
    })

    const inviter = await prisma.user.findUnique({
      where: { id: authUser!.sub },
      select: { name: true, email: true }
    })

    const result = await createTenantInvite({
      tenantId: tenant.id,
      tenantName: tenant.name,
      invitedByUserId: authUser!.sub,
      inviterName: inviter?.name || inviter?.email || 'The Grapsi team',
      planTier: planToken?.planTier ?? null,
      email: body.email,
      role: 'ADMIN',
      isFoundingAdmin
    })

    if (!result.ok) {
      return NextResponse.json(
        { code: 'INVITE_FAILED', message: result.error || 'Failed to create admin invite' },
        { status: 400 }
      )
    }

    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: tenant.id,
      action: 'TENANT_ADMIN_INVITE_SENT',
      resource: `tenant_invite:${result.inviteId}`,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      meta: {
        email: result.email,
        tenantName: tenant.name,
        isFoundingAdmin,
        issuedByPlatform: true
      }
    })

    return NextResponse.json(
      {
        invite_id: result.inviteId,
        email: result.email,
        tenant_id: tenant.id,
        role: 'ADMIN',
        // The founding admin lands as OWNER; anyone after them lands as ADMIN.
        becomes_role: isFoundingAdmin ? 'OWNER' : 'ADMIN',
        is_founding_admin: isFoundingAdmin
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Tenant admin invite error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Move the administrator seat to an existing user of the tenant.
 *
 * `requirePlatformScope` gates every non-GET method to a full SUPER_ADMIN, so
 * SUPER_ADMIN_VIEWER cannot reach this.
 */
export async function PATCH(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const { user: authUser } = await authenticateRequest(request)
    const body = changeSchema.parse(await request.json())

    const result = await changeTenantAdmin({
      tenantId: body.tenant_id,
      newAdminUserId: body.user_id,
      role: body.role,
      demoteCurrentTo: body.demote_current_to ?? null,
      actorUserId: authUser!.sub
    })

    if (!result.ok) {
      return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
    }

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    // One entry per affected user, so a tenant's own audit trail explains why
    // somebody's role moved without them or their admin doing anything.
    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: body.tenant_id,
      action: 'TENANT_ADMIN_CHANGED',
      resource: `user:${result.promoted.id}`,
      ip,
      meta: {
        tenantName: result.tenantName,
        email: result.promoted.email,
        previousRoles: result.promoted.previousRoles,
        newRoles: result.promoted.newRoles,
        grantedRole: body.role,
        issuedByPlatform: true
      }
    })

    for (const demoted of result.demoted) {
      await createAuditLog({
        actorUserId: authUser!.sub,
        tenantId: body.tenant_id,
        action: 'TENANT_ADMIN_DEMOTED',
        resource: `user:${demoted.id}`,
        ip,
        meta: {
          tenantName: result.tenantName,
          email: demoted.email,
          previousRoles: demoted.previousRoles,
          newRoles: demoted.newRoles,
          replacedBy: result.promoted.email,
          issuedByPlatform: true
        }
      })
    }

    return NextResponse.json({
      tenant_id: body.tenant_id,
      promoted: {
        id: result.promoted.id,
        email: result.promoted.email,
        name: result.promoted.name,
        roles: result.promoted.newRoles
      },
      demoted: result.demoted.map(d => ({
        id: d.id,
        email: d.email,
        name: d.name,
        roles: d.newRoles
      }))
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Tenant admin change error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const tenantId = new URL(request.url).searchParams.get('tenant_id')
    if (!tenantId) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'tenant_id is required' },
        { status: 400 }
      )
    }

    const invites = await listTenantInvites(tenantId)
    return NextResponse.json({
      invites: invites
        .filter(i => i.role === 'ADMIN')
        .map(i => ({
          id: i.id,
          email: i.email,
          role: i.role,
          status: i.status,
          expires_at: i.expiresAt,
          accepted_at: i.acceptedAt,
          created_at: i.createdAt,
          invited_by: i.invitedBy?.name || i.invitedBy?.email || null
        }))
    })
  } catch (error) {
    console.error('Tenant admin invite list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
