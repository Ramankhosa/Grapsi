import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

/**
 * Platform-side tenant administrator management.
 *
 * The invite flow in `tenant-invite-service` covers the case where the new
 * administrator does not have an account yet. This module covers the other
 * half: handing the workspace to somebody who is *already* a user of the
 * tenant — a founder leaving, an admin changing departments, or a tenant that
 * was onboarded against the wrong mailbox.
 *
 * Why this cannot reuse `changeUserRole` from `org-access-service`:
 *   - that helper rejects an actor whose tenant differs from the target's, and
 *     a super admin always sits in the PLATFORM tenant;
 *   - `canChangeRole` refuses to grant a role at or above the actor's own rank
 *     *within the tenant*, so no in-tenant path can ever mint an OWNER.
 * A super admin is outside the tenant hierarchy, so the checks here are about
 * the tenant's own consistency rather than about rank.
 */

/**
 * Roles that make somebody a tenant administrator. Mirrors
 * `TENANT_ADMIN_ROLES` in `@/lib/auth/tenantAccess`, typed as `UserRole[]` and
 * kept import-light so this module only depends on Prisma.
 */
export const TENANT_ADMIN_ROLE_VALUES = ['OWNER', 'ADMIN'] as const
export type TenantAdminRole = (typeof TENANT_ADMIN_ROLE_VALUES)[number]

/** What an outgoing administrator may be moved to. Never OWNER — that is the seat being handed over. */
export const DEMOTION_ROLE_VALUES = ['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as const
export type DemotionRole = (typeof DEMOTION_ROLE_VALUES)[number]

/**
 * Additive tenant-scoped tags. These sit *beside* the hierarchy slot rather
 * than inside it, so a promotion or demotion must carry them across untouched —
 * otherwise transferring ownership would silently strip somebody's CALL_ADMIN
 * or QUALITY_AUDITOR grant. Cast because a dev box's generated client can lag
 * the schema; the Postgres enum has these values via migration.
 */
const ADDITIVE_ROLES = ['MEMBER', 'CALL_ASSIGNER', 'CALL_ADMIN', 'QUALITY_AUDITOR'] as unknown as UserRole[]

/** Platform staff must never be re-slotted into a tenant role by this path. */
const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'] as unknown as UserRole[]

export interface TenantAdminCandidate {
  id: string
  email: string
  name: string | null
  roles: UserRole[]
  status: string
  isAdmin: boolean
  isOwner: boolean
  createdAt: Date
}

export interface ChangeTenantAdminInput {
  tenantId: string
  /** Existing user in the tenant who takes over. */
  newAdminUserId: string
  /** Seat to grant. OWNER is the tenant principal; ADMIN adds a co-administrator. */
  role: TenantAdminRole
  /**
   * What to do with the sitting OWNER(s). `null` leaves them untouched, which
   * is how you add a second administrator rather than replace the first.
   */
  demoteCurrentTo: DemotionRole | null
  actorUserId: string
}

export interface ChangedUserSummary {
  id: string
  email: string
  name: string | null
  previousRoles: UserRole[]
  newRoles: UserRole[]
}

export type ChangeTenantAdminResult =
  | {
      ok: true
      tenantName: string
      promoted: ChangedUserSummary
      demoted: ChangedUserSummary[]
    }
  | { ok: false; code: string; message: string; status: number }

/**
 * Replace the hierarchy slot in a role array while preserving additive tags.
 * The tenant-side `changeUserRole` overwrites the whole array; doing that here
 * would drop tags that are unrelated to being an administrator.
 */
export function withHierarchyRole(currentRoles: UserRole[], nextRole: UserRole): UserRole[] {
  const tags = currentRoles.filter(role => ADDITIVE_ROLES.includes(role))
  return Array.from(new Set<UserRole>([nextRole, ...tags]))
}

/**
 * Everybody in the tenant who could be handed the administrator seat, with the
 * sitting administrators flagged. Suspended users are returned but marked, so
 * the picker can explain why they are not selectable instead of hiding them.
 */
export async function listTenantAdminCandidates(tenantId: string): Promise<TenantAdminCandidate[]> {
  const users = await prisma.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      email: true,
      name: true,
      roles: true,
      status: true,
      createdAt: true
    },
    // Email breaks createdAt ties — users seeded in one batch share a
    // timestamp, and an unstable order reshuffles the picker on every refresh.
    orderBy: [{ createdAt: 'asc' }, { email: 'asc' }]
  })

  return users.map(user => ({
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    status: user.status,
    isOwner: user.roles.includes('OWNER'),
    isAdmin: user.roles.some(role => (TENANT_ADMIN_ROLE_VALUES as readonly string[]).includes(role)),
    createdAt: user.createdAt
  }))
}

/**
 * Hand the tenant's administrator seat to an existing user, optionally moving
 * the sitting OWNER(s) down to another role in the same transaction so the
 * tenant is never left with two principals or none.
 */
export async function changeTenantAdmin(
  input: ChangeTenantAdminInput
): Promise<ChangeTenantAdminResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, name: true, atiId: true, status: true }
  })

  if (!tenant || tenant.atiId === 'PLATFORM') {
    return {
      ok: false,
      code: 'INVALID_TENANT',
      message: 'Select a customer tenant',
      status: 400
    }
  }

  const target = await prisma.user.findUnique({
    where: { id: input.newAdminUserId },
    select: { id: true, email: true, name: true, roles: true, status: true, tenantId: true }
  })

  if (!target || target.tenantId !== tenant.id) {
    return {
      ok: false,
      code: 'USER_NOT_IN_TENANT',
      message: 'That user does not belong to this tenant',
      status: 404
    }
  }

  if (target.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'USER_NOT_ACTIVE',
      message: 'Reactivate the user before making them an administrator',
      status: 400
    }
  }

  if (target.roles.some(role => PLATFORM_ROLES.includes(role))) {
    return {
      ok: false,
      code: 'PLATFORM_USER',
      message: 'Platform staff cannot be assigned a tenant administrator seat',
      status: 400
    }
  }

  // The sitting principal(s). Anyone holding OWNER other than the incoming
  // administrator — normally exactly one, but the model permits several.
  const incumbents = await prisma.user.findMany({
    where: {
      tenantId: tenant.id,
      id: { not: target.id },
      roles: { has: 'OWNER' }
    },
    select: { id: true, email: true, name: true, roles: true }
  })

  const promotedRoles = withHierarchyRole(target.roles, input.role)
  const demotions = input.demoteCurrentTo
    ? incumbents.map(user => ({
        user,
        newRoles: withHierarchyRole(user.roles, input.demoteCurrentTo as UserRole)
      }))
    : []

  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: target.id },
      data: { roles: promotedRoles }
    })

    for (const demotion of demotions) {
      await tx.user.update({
        where: { id: demotion.user.id },
        data: { roles: demotion.newRoles }
      })
    }
  })

  return {
    ok: true,
    tenantName: tenant.name,
    promoted: {
      id: target.id,
      email: target.email,
      name: target.name,
      previousRoles: target.roles,
      newRoles: promotedRoles
    },
    demoted: demotions.map(d => ({
      id: d.user.id,
      email: d.user.email,
      name: d.user.name,
      previousRoles: d.user.roles,
      newRoles: d.newRoles
    }))
  }
}
