import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, requirePlatformScope } from '@/lib/middleware'
import {
  getAssignableRoles,
  listPlatformUsers,
  listTenantOptions
} from '@/lib/platform-user-service'
import { provisionUser } from '@/lib/user-provisioning'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Platform-wide user directory and provisioning.
 *
 * Until now a super admin could only *invite* somebody and wait for them to
 * sign up, and could not see users across tenants at all — the sole cross-tenant
 * roster was the "change administrator" picker, scoped to one tenant. That left
 * no way to stand up an account on demand, and no way to create another super
 * admin without shell access to `scripts/create-super-admin.js`.
 *
 * GET  — the directory. Read-only, so SUPER_ADMIN_VIEWER is admitted.
 * POST — create an account directly, in any tenant, with any role the platform
 *        may grant. `requirePlatformScope` gates non-GET to full SUPER_ADMIN.
 *
 * Invites are still the right tool when the person should choose their own
 * moment to join; this is for when the admin needs the account to exist now.
 */

const createSchema = z.object({
  email: z.string().email(),
  first_name: z.string().trim().max(80).optional(),
  last_name: z.string().trim().max(80).optional(),
  tenant_id: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1).max(6),
  // Platform team roles granted alongside the account, so standing up an
  // operator is one action instead of create-then-go-to-Team-Roles.
  platform_role_codes: z.array(z.string().min(1)).max(8).optional(),
  // Default true: provisioning normally means "get this person in", and the
  // link is returned either way for out-of-band delivery.
  send_activation_email: z.boolean().default(true)
})

export async function GET(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const params = new URL(request.url).searchParams
    const scopeParam = params.get('scope')
    const scope =
      scopeParam === 'platform' || scopeParam === 'tenant' || scopeParam === 'all' ? scopeParam : 'all'

    const limit = Number.parseInt(params.get('limit') || '50', 10)
    const offset = Number.parseInt(params.get('offset') || '0', 10)

    const [{ users, total }, tenants] = await Promise.all([
      listPlatformUsers({
        search: params.get('search'),
        tenantId: params.get('tenant_id'),
        role: params.get('role'),
        status: params.get('status'),
        scope,
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      }),
      // Bundled so the page can populate its tenant filter and the create-user
      // picker from one request.
      listTenantOptions()
    ])

    return NextResponse.json({
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        first_name: user.firstName,
        last_name: user.lastName,
        roles: user.roles,
        primary_role: user.primaryRole,
        status: user.status,
        tenant_id: user.tenantId,
        tenant_name: user.tenantName,
        tenant_ati_id: user.tenantAtiId,
        is_platform_staff: user.isPlatformStaff,
        is_pending_activation: user.isPendingActivation,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString()
      })),
      total,
      tenants: tenants.map(tenant => ({
        id: tenant.id,
        name: tenant.name,
        ati_id: tenant.atiId,
        status: tenant.status,
        is_platform: tenant.isPlatform,
        user_count: tenant.userCount
      })),
      assignable_roles: getAssignableRoles()
    })
  } catch (error) {
    console.error('Platform user list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const { user: authUser } = await authenticateRequest(request)
    const body = createSchema.parse(await request.json())

    const result = await provisionUser({
      email: body.email,
      firstName: body.first_name ?? null,
      lastName: body.last_name ?? null,
      tenantId: body.tenant_id,
      roles: body.roles as UserRole[],
      platformRoleCodes: body.platform_role_codes,
      actorUserId: authUser!.sub,
      sendActivationEmail: body.send_activation_email,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    })

    if (!result.ok) {
      return NextResponse.json({ code: result.code, message: result.message }, { status: result.status })
    }

    return NextResponse.json(
      {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          roles: result.user.roles,
          platform_role_codes: result.user.platformRoleCodes,
          status: result.user.status,
          tenant_id: result.user.tenantId,
          tenant_name: result.user.tenantName,
          created_at: result.user.createdAt.toISOString()
        },
        activation_link: result.activationLink,
        activation_expires_at: result.activationExpiresAt.toISOString(),
        activation_email_sent: result.activationEmailSent,
        activation_email_error: result.activationEmailError
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: error.errors[0]?.message || 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Platform user create error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
