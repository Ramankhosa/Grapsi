import { prisma } from '@/lib/prisma'
import type { Prisma, UserRole } from '@prisma/client'
import { createAuditLog } from '@/lib/auth'
import {
  ADDITIVE_ROLES,
  PLATFORM_ROLES,
  TENANT_HIERARCHY_ROLES,
  getPrimaryRole,
  isPlatformRole,
  validateRoleShape
} from '@/lib/user-provisioning'
import { PLATFORM_ROLE_DEFINITIONS } from '@/lib/platformTeamRoles'

/**
 * Cross-tenant user directory and role authority for the platform console.
 *
 * The tenant-side role helpers in `org-access-service` deliberately cannot do
 * this: `assertSameTenant` rejects an actor whose tenant differs from the
 * target's (a super admin always sits in the PLATFORM tenant), `canChangeRole`
 * refuses to grant a role at or above the actor's own rank *within the tenant*,
 * and both hard-refuse the SUPER_ADMIN roles. Those rules are right for a
 * tenant admin and wrong for platform staff, who sit outside every tenant
 * hierarchy — so this module reimplements the checks around what platform staff
 * actually need protecting from, which is themselves.
 *
 * Three invariants, none of which the tenant path needs:
 *   - nobody edits their own roles or status (no self-demotion, no self-lockout);
 *   - the last active super admin cannot be demoted or suspended (that would
 *     leave the platform administrable only from a shell script);
 *   - platform roles stay inside the PLATFORM tenant, tenant roles stay outside
 *     it — `requirePlatformScope` keys off the tenant, so a SUPER_ADMIN in a
 *     customer tenant is a super admin who cannot open a single platform route.
 */

const PLATFORM_ATI_ID = 'PLATFORM'

export interface PlatformUserSummary {
  id: string
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  roles: UserRole[]
  primaryRole: UserRole | null
  status: string
  tenantId: string | null
  tenantName: string | null
  tenantAtiId: string | null
  isPlatformStaff: boolean
  /** No password and no social provider — the account was created but never activated. */
  isPendingActivation: boolean
  createdAt: Date
  updatedAt: Date
}

export interface TenantOption {
  id: string
  name: string
  atiId: string
  status: string
  isPlatform: boolean
  userCount: number
}

export interface ListPlatformUsersFilters {
  search?: string | null
  tenantId?: string | null
  role?: string | null
  status?: string | null
  /** 'platform' = staff only, 'tenant' = customers only, 'all' = both. */
  scope?: 'platform' | 'tenant' | 'all' | null
  limit?: number
  offset?: number
}

function toSummary(user: {
  id: string
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  roles: UserRole[]
  status: string
  tenantId: string | null
  passwordHash: string | null
  oauthProvider: string | null
  createdAt: Date
  updatedAt: Date
  tenant: { id: string; name: string; atiId: string } | null
}): PlatformUserSummary {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles,
    primaryRole: getPrimaryRole(user.roles),
    status: user.status,
    tenantId: user.tenantId,
    tenantName: user.tenant?.name ?? null,
    tenantAtiId: user.tenant?.atiId ?? null,
    isPlatformStaff: user.tenant?.atiId === PLATFORM_ATI_ID || user.roles.some(isPlatformRole),
    isPendingActivation: !user.passwordHash && !user.oauthProvider,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }
}

/**
 * Every user on the platform, filtered. Platform staff are included — the
 * console is the only place another super admin can be created or demoted, so
 * hiding them would defeat the purpose.
 */
export async function listPlatformUsers(
  filters: ListPlatformUsersFilters = {}
): Promise<{ users: PlatformUserSummary[]; total: number }> {
  const where: Prisma.UserWhereInput = {}
  const and: Prisma.UserWhereInput[] = []

  const search = filters.search?.trim()
  if (search) {
    and.push({
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { id: search }
      ]
    })
  }

  if (filters.tenantId) {
    and.push({ tenantId: filters.tenantId })
  }

  if (filters.role) {
    and.push({ roles: { has: filters.role as UserRole } })
  }

  if (filters.status === 'ACTIVE' || filters.status === 'SUSPENDED') {
    and.push({ status: filters.status })
  }

  if (filters.scope === 'platform') {
    and.push({ tenant: { atiId: PLATFORM_ATI_ID } })
  } else if (filters.scope === 'tenant') {
    and.push({ tenant: { atiId: { not: PLATFORM_ATI_ID } } })
  }

  if (and.length > 0) where.AND = and

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        roles: true,
        status: true,
        tenantId: true,
        passwordHash: true,
        oauthProvider: true,
        createdAt: true,
        updatedAt: true,
        tenant: { select: { id: true, name: true, atiId: true } }
      },
      // Email breaks createdAt ties — seeded batches share a timestamp, and an
      // unstable order reshuffles the table on every refresh.
      orderBy: [{ createdAt: 'desc' }, { email: 'asc' }],
      take: limit,
      skip: offset
    }),
    prisma.user.count({ where })
  ])

  return { users: users.map(toSummary), total }
}

/** Tenants for the directory's filter and the create-user picker, platform first. */
export async function listTenantOptions(): Promise<TenantOption[]> {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      atiId: true,
      status: true,
      _count: { select: { users: true } }
    },
    orderBy: [{ name: 'asc' }]
  })

  return tenants
    .map(tenant => ({
      id: tenant.id,
      name: tenant.name,
      atiId: tenant.atiId,
      status: tenant.status,
      isPlatform: tenant.atiId === PLATFORM_ATI_ID,
      userCount: tenant._count.users
    }))
    .sort((a, b) => (a.isPlatform === b.isPlatform ? a.name.localeCompare(b.name) : a.isPlatform ? -1 : 1))
}

/**
 * The PLATFORM tenant, created on demand.
 *
 * `scripts/create-super-admin.js` does the same find-or-create, and the setup
 * route does not — so an environment bootstrapped through the API can have
 * super admins with a null tenantId, who then fail `requirePlatformScope` on
 * every platform route. Creating staff through this service always attaches the
 * tenant, and `setUserRoles` repairs the untenanted ones on the way past.
 */
export async function ensurePlatformTenant(): Promise<{ id: string; name: string }> {
  const existing = await prisma.tenant.findUnique({
    where: { atiId: PLATFORM_ATI_ID },
    select: { id: true, name: true }
  })
  if (existing) return existing

  return prisma.tenant.create({
    data: { name: 'Platform Administration', atiId: PLATFORM_ATI_ID, status: 'ACTIVE' },
    select: { id: true, name: true }
  })
}

/** Roles a platform actor may hand out, grouped for the UI. */
export function getAssignableRoles() {
  return {
    platform: PLATFORM_ROLES,
    hierarchy: TENANT_HIERARCHY_ROLES,
    additive: ADDITIVE_ROLES,
    // The capability presets a platform account can be granted. Sent with the
    // role pools so the create form can offer them inline rather than sending
    // the admin to Team Roles as a second trip.
    platform_team: PLATFORM_ROLE_DEFINITIONS.map(role => ({
      code: role.code,
      label: role.label,
      description: role.description
    }))
  }
}

async function countOtherActiveSuperAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({
    where: {
      id: { not: excludeUserId },
      status: 'ACTIVE',
      roles: { has: 'SUPER_ADMIN' as UserRole }
    }
  })
}

export type PlatformRoleUpdateResult =
  | {
      ok: true
      user: { id: string; email: string; name: string | null; previousRoles: UserRole[]; roles: UserRole[] }
      /** True when an untenanted platform account was attached to the PLATFORM tenant. */
      tenantAttached: boolean
    }
  | { ok: false; code: string; message: string; status: number }

/**
 * Replace a user's role array with platform authority — the full range,
 * including the super admin roles no tenant path can mint.
 *
 * The array is replaced wholesale rather than diffed, because the editor sends
 * the complete intended state. That is safe here (unlike the tenant-side
 * `changeUserRole`, which drops additive tags as a side effect) precisely
 * because the caller submits the tags it wants kept.
 */
export async function setUserRoles(params: {
  actorUserId: string
  targetUserId: string
  roles: UserRole[]
  ip?: string
}): Promise<PlatformRoleUpdateResult> {
  if (params.actorUserId === params.targetUserId) {
    return {
      ok: false,
      code: 'SELF_EDIT',
      message: 'You cannot change your own roles. Ask another super admin to do it.',
      status: 400
    }
  }

  const target = await prisma.user.findUnique({
    where: { id: params.targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      roles: true,
      status: true,
      tenantId: true,
      tenant: { select: { id: true, name: true, atiId: true } }
    }
  })

  if (!target) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found', status: 404 }
  }

  const wantsPlatformRole = params.roles.some(isPlatformRole)
  const heldPlatformRole = target.roles.some(isPlatformRole)

  // An untenanted account (the API bootstrap route leaves tenantId null) is
  // treated as platform staff — it holds a platform role and belongs nowhere
  // else. Granting it one attaches the PLATFORM tenant so the account can
  // actually reach the platform routes its role implies.
  const isPlatformScoped =
    target.tenant?.atiId === PLATFORM_ATI_ID || (!target.tenantId && (heldPlatformRole || wantsPlatformRole))

  if (wantsPlatformRole && !isPlatformScoped) {
    return {
      ok: false,
      code: 'WRONG_SCOPE',
      message: `Super admin roles only apply inside the platform workspace. ${target.email} belongs to ${target.tenant?.name || 'a customer tenant'}.`,
      status: 400
    }
  }

  const shape = validateRoleShape(params.roles, { platformTenant: isPlatformScoped })
  if (!shape.ok) {
    return { ok: false, code: 'INVALID_ROLES', message: shape.message, status: 400 }
  }

  // Losing SUPER_ADMIN when nobody else holds it locks the platform out of its
  // own console — the only recovery is a shell on the server.
  const losesSuperAdmin =
    target.roles.includes('SUPER_ADMIN' as UserRole) && !shape.roles.includes('SUPER_ADMIN' as UserRole)
  if (losesSuperAdmin && (await countOtherActiveSuperAdmins(target.id)) === 0) {
    return {
      ok: false,
      code: 'LAST_SUPER_ADMIN',
      message: 'This is the only active super admin. Promote someone else first.',
      status: 400
    }
  }

  let tenantAttached = false
  const data: Prisma.UserUpdateInput = { roles: shape.roles }
  if (!target.tenantId && isPlatformScoped) {
    const platformTenant = await ensurePlatformTenant()
    data.tenant = { connect: { id: platformTenant.id } }
    tenantAttached = true
  }

  await prisma.user.update({ where: { id: target.id }, data })

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: target.tenantId || undefined,
    action: 'USER_ROLES_SET_BY_PLATFORM',
    resource: `user:${target.id}`,
    ip: params.ip || 'unknown',
    meta: {
      email: target.email,
      previousRoles: target.roles,
      newRoles: shape.roles,
      tenantName: target.tenant?.name || null,
      platformTenantAttached: tenantAttached
    }
  })

  return {
    ok: true,
    user: {
      id: target.id,
      email: target.email,
      name: target.name,
      previousRoles: target.roles,
      roles: shape.roles
    },
    tenantAttached
  }
}

export type PlatformStatusUpdateResult =
  | { ok: true; user: { id: string; email: string; status: string } }
  | { ok: false; code: string; message: string; status: number }

export async function setUserStatus(params: {
  actorUserId: string
  targetUserId: string
  status: 'ACTIVE' | 'SUSPENDED'
  ip?: string
}): Promise<PlatformStatusUpdateResult> {
  if (params.actorUserId === params.targetUserId) {
    return {
      ok: false,
      code: 'SELF_EDIT',
      message: 'You cannot change your own status.',
      status: 400
    }
  }

  const target = await prisma.user.findUnique({
    where: { id: params.targetUserId },
    select: { id: true, email: true, status: true, roles: true, tenantId: true }
  })

  if (!target) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found', status: 404 }
  }

  // Suspending the last super admin is the same lockout as demoting them.
  if (
    params.status === 'SUSPENDED' &&
    target.roles.includes('SUPER_ADMIN' as UserRole) &&
    (await countOtherActiveSuperAdmins(target.id)) === 0
  ) {
    return {
      ok: false,
      code: 'LAST_SUPER_ADMIN',
      message: 'This is the only active super admin. Promote someone else first.',
      status: 400
    }
  }

  await prisma.user.update({ where: { id: target.id }, data: { status: params.status } })

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: target.tenantId || undefined,
    action: 'USER_STATUS_SET_BY_PLATFORM',
    resource: `user:${target.id}`,
    ip: params.ip || 'unknown',
    meta: { email: target.email, previousStatus: target.status, newStatus: params.status }
  })

  return { ok: true, user: { id: target.id, email: target.email, status: params.status } }
}
