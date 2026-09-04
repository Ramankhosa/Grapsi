import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'
import { generateToken, hashToken } from '@/lib/token-utils'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { activationTemplate } from '@/lib/email-templates'
import { createAuditLog } from '@/lib/auth'
import {
  grantPlatformRolesInTransaction,
  parsePlatformRoleCodes
} from '@/lib/services/platformTeamRoleService'

/**
 * Direct user provisioning for administrators.
 *
 * Every other path into the `users` table is asynchronous: an invite or an ATI
 * token is minted and the account only exists once the recipient signs up
 * themselves. That leaves an administrator unable to stand up an account on
 * demand — which is exactly what a super admin needs when onboarding a customer
 * over a call, or a tenant admin needs when a colleague's invite never arrived.
 *
 * This module is the synchronous half: the row is created immediately, with the
 * roles the admin chose, and the person receives (or is handed) a set-password
 * link. As with the roster import, the admin never sets or sees a password —
 * activation is backed by a PasswordResetToken, so `/reset-password` is the
 * single place a password is ever chosen.
 *
 * Role authority is NOT decided here. Callers pass the roles they have already
 * established the actor may grant: the platform surface allows the full range
 * including SUPER_ADMIN, the tenant surface clamps to what `canChangeRole` /
 * `canAddRole` permit. This module only checks that the resulting array is a
 * coherent shape for the tenant it lands in.
 */

/**
 * Platform staff roles. Only ever valid inside the PLATFORM tenant.
 *
 * PLATFORM_STAFF is the empty base: it is a legal primary role here purely so
 * the account qualifies for `PlatformTeamRoleAssignment` grants, and carries no
 * access of its own — `requirePlatformScope` keys off SUPER_ADMIN /
 * SUPER_ADMIN_VIEWER, so staff never reach the platform console. Before it
 * existed the only way to hand somebody a scoped capability (say, funding call
 * ingestion) was to make them a Super Admin Viewer first, which granted
 * cross-tenant read over every platform screen on the way.
 */
export const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER', 'PLATFORM_STAFF'] as unknown as UserRole[]

/**
 * Platform roles that are meaningful on their own. PLATFORM_STAFF is excluded:
 * it is inert until team roles are attached, so callers that ask "does this
 * account do anything by itself?" want this list, not `PLATFORM_ROLES`.
 */
export const PLATFORM_CONSOLE_ROLES = ['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'] as unknown as UserRole[]

/**
 * The hierarchy slot inside a customer tenant. Exactly one of these, or one
 * platform role, is the user's "primary" role — the rest are tags.
 */
export const TENANT_HIERARCHY_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'] as unknown as UserRole[]

/**
 * Additive tenant-scoped tags. A user holds any subset of these alongside one
 * hierarchy role. Cast because a dev box's generated client can lag the schema;
 * the Postgres enum has these values via migration.
 */
export const ADDITIVE_ROLES = ['MEMBER', 'CALL_ASSIGNER', 'CALL_ADMIN', 'QUALITY_AUDITOR'] as unknown as UserRole[]

/**
 * A week, rather than the one hour `forgot-password` uses. A reset is requested
 * by somebody sitting at the login screen; an admin-provisioned account is
 * created ahead of the person being told about it, and a link that dies before
 * they read the email just generates support traffic.
 */
export const ACTIVATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ACTIVATION_TOKEN_TTL_HOURS = ACTIVATION_TOKEN_TTL_MS / (60 * 60 * 1000)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isPlatformRole(role: UserRole): boolean {
  return PLATFORM_ROLES.includes(role)
}

export function isAdditiveRole(role: UserRole): boolean {
  return ADDITIVE_ROLES.includes(role)
}

/** The role that decides what a user *is*, as opposed to what they may also do. */
export function getPrimaryRole(roles: UserRole[]): UserRole | null {
  return roles.find(role => isPlatformRole(role) || TENANT_HIERARCHY_ROLES.includes(role)) ?? null
}

export type RoleShapeResult =
  | { ok: true; roles: UserRole[] }
  | { ok: false; message: string }

/**
 * Validate that a role array is a legal shape for the tenant it belongs to:
 * exactly one primary role, plus any additive tags.
 *
 * Scope matters because the two role families are not interchangeable —
 * `requirePlatformScope` keys off the PLATFORM tenant, so a SUPER_ADMIN sitting
 * in a customer tenant would be a super admin who cannot open any platform
 * route, and an OWNER inside the PLATFORM tenant owns nothing.
 */
export function validateRoleShape(
  roles: UserRole[],
  options: { platformTenant: boolean }
): RoleShapeResult {
  const unique = Array.from(new Set(roles))

  if (unique.length === 0) {
    return { ok: false, message: 'Pick at least one role' }
  }

  const known = [...PLATFORM_ROLES, ...TENANT_HIERARCHY_ROLES, ...ADDITIVE_ROLES]
  const unknown = unique.filter(role => !known.includes(role))
  if (unknown.length > 0) {
    return { ok: false, message: `Unknown role: ${unknown.join(', ')}` }
  }

  const primaries = unique.filter(role => isPlatformRole(role) || TENANT_HIERARCHY_ROLES.includes(role))
  if (primaries.length === 0) {
    return {
      ok: false,
      message: options.platformTenant
        ? 'Pick a platform role (Super Admin, Super Admin Viewer or Platform Staff)'
        : 'Pick one primary role (Owner, Admin, Manager, Analyst or Viewer)'
    }
  }
  if (primaries.length > 1) {
    return { ok: false, message: `Pick only one primary role — got ${primaries.join(' and ')}` }
  }

  const primary = primaries[0]

  if (options.platformTenant) {
    if (!isPlatformRole(primary)) {
      return {
        ok: false,
        message: 'Platform staff hold Super Admin, Super Admin Viewer or Platform Staff — tenant roles do not apply inside the platform workspace'
      }
    }
    const tags = unique.filter(role => isAdditiveRole(role))
    if (tags.length > 0) {
      return { ok: false, message: `${tags.join(', ')} are tenant-scoped tags and cannot be given to platform staff` }
    }
  } else if (isPlatformRole(primary)) {
    return {
      ok: false,
      message: 'Super admin roles only exist inside the platform workspace. Create the account there instead.'
    }
  }

  // Primary first, so `roles[0]` is the meaningful one for UI that reads it.
  return { ok: true, roles: [primary, ...unique.filter(role => role !== primary)] }
}

export interface ProvisionUserInput {
  email: string
  firstName?: string | null
  lastName?: string | null
  /** Tenant the account lands in. Pass the PLATFORM tenant to create staff. */
  tenantId: string
  roles: UserRole[]
  /**
   * Platform team roles (FUNDING_OPERATIONS_MANAGER, …) granted in the same
   * transaction as the account. Only meaningful in the PLATFORM tenant; a
   * non-empty list anywhere else is rejected rather than silently dropped.
   */
  platformRoleCodes?: string[]
  actorUserId: string
  /** When false the admin delivers the returned activation link themselves. */
  sendActivationEmail: boolean
  ip?: string
}

export interface ProvisionedUser {
  id: string
  email: string
  name: string | null
  roles: UserRole[]
  /** Platform team roles granted at creation, empty for tenant accounts. */
  platformRoleCodes: string[]
  status: string
  tenantId: string
  tenantName: string
  createdAt: Date
}

export type ProvisionUserResult =
  | {
      ok: true
      user: ProvisionedUser
      /** Set-password link, always returned so the admin can deliver it out of band. */
      activationLink: string
      activationExpiresAt: Date
      activationEmailSent: boolean
      /** Non-null when the account was created but the email bounced off the mailer. */
      activationEmailError: string | null
    }
  | { ok: false; code: string; message: string; status: number }

/**
 * Create an account and issue its activation link.
 *
 * A failed activation email does not fail the call: the user row is the
 * expensive, non-idempotent part (emails are unique, so a retry would 409),
 * and the link is returned regardless. The caller surfaces the mailer error so
 * the admin knows to copy the link instead.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
  const email = input.email.trim().toLowerCase()

  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Enter a valid email address', status: 400 }
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, name: true, atiId: true, status: true }
  })

  if (!tenant) {
    return { ok: false, code: 'TENANT_NOT_FOUND', message: 'Tenant not found', status: 404 }
  }

  if (tenant.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'TENANT_INACTIVE',
      message: `${tenant.name} is not active — reactivate it before adding users`,
      status: 400
    }
  }

  const isPlatformTenant = tenant.atiId === 'PLATFORM'

  const shape = validateRoleShape(input.roles, { platformTenant: isPlatformTenant })
  if (!shape.ok) {
    return { ok: false, code: 'INVALID_ROLES', message: shape.message, status: 400 }
  }

  // Parsed before the insert so an unknown code fails the whole call rather
  // than leaving an account behind that the admin then has to hunt down.
  let platformRoleCodes: string[] = []
  if (input.platformRoleCodes?.length) {
    if (!isPlatformTenant) {
      return {
        ok: false,
        code: 'INVALID_PLATFORM_ROLES',
        message: 'Platform team roles only apply to accounts in the platform workspace',
        status: 400
      }
    }
    try {
      platformRoleCodes = parsePlatformRoleCodes(input.platformRoleCodes)
    } catch (error) {
      return {
        ok: false,
        code: 'INVALID_PLATFORM_ROLES',
        message: error instanceof Error ? error.message : 'Unknown platform role',
        status: 400
      }
    }
  }

  // PLATFORM_STAFF is inert on its own, so an account created with neither a
  // console role nor a team role could not do anything at all — almost always a
  // half-finished form rather than an intent.
  if (isPlatformTenant && shape.roles[0] === ('PLATFORM_STAFF' as UserRole) && platformRoleCodes.length === 0) {
    return {
      ok: false,
      code: 'INVALID_PLATFORM_ROLES',
      message: 'Platform Staff carries no access on its own — pick at least one platform team role',
      status: 400
    }
  }

  // Emails are globally unique, so a clash may be in another organization
  // entirely. Say which one — "email already taken" with no context is the
  // single most common support ticket on flows like this.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tenantId: true, tenant: { select: { name: true, atiId: true } } }
  })

  if (existing) {
    const sameTenant = existing.tenantId === tenant.id
    return {
      ok: false,
      code: 'EMAIL_TAKEN',
      message: sameTenant
        ? `${email} already has an account in ${tenant.name}. Edit their roles instead of creating a second account.`
        : `${email} already belongs to ${existing.tenant?.name || 'another organization'}. An email address can only hold one account.`,
      status: 409
    }
  }

  const firstName = input.firstName?.trim() || null
  const lastName = input.lastName?.trim() || null
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || null

  const rawToken = generateToken()
  const activationExpiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS)

  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({
      // No passwordHash: the person sets their own at /reset-password via the
      // activation token below. emailVerified is true because an administrator
      // vouched for the address by typing it in — the same reasoning the ATI
      // signup path uses.
      data: {
        email,
        tenantId: tenant.id,
        roles: shape.roles,
        status: 'ACTIVE',
        emailVerified: true,
        firstName,
        lastName,
        name
      },
      select: { id: true, email: true, name: true, roles: true, status: true, createdAt: true }
    })

    await tx.passwordResetToken.create({
      data: {
        userId: created.id,
        tokenHash: hashToken(rawToken),
        expiresAt: activationExpiresAt
      }
    })

    if (platformRoleCodes.length > 0) {
      await grantPlatformRolesInTransaction(tx, {
        targetUserId: created.id,
        roleCodes: platformRoleCodes,
        assignedByUserId: input.actorUserId
      })
    }

    return created
  })

  await createAuditLog({
    actorUserId: input.actorUserId,
    tenantId: tenant.id,
    action: 'USER_PROVISIONED',
    resource: `user:${user.id}`,
    ip: input.ip || 'unknown',
    meta: {
      email: user.email,
      roles: shape.roles,
      platformRoleCodes,
      tenantName: tenant.name,
      isPlatformStaff: isPlatformTenant,
      activationEmailRequested: input.sendActivationEmail
    }
  })

  let activationEmailSent = false
  let activationEmailError: string | null = null

  if (input.sendActivationEmail) {
    try {
      const tpl = activationTemplate({
        email: user.email,
        name: user.name,
        tenantName: tenant.name,
        token: rawToken,
        expiresInHours: ACTIVATION_TOKEN_TTL_HOURS
      })
      await sendEmail({
        to: user.email,
        toName: user.name || undefined,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text
      })
      activationEmailSent = true
    } catch (error) {
      activationEmailError = error instanceof Error ? error.message : 'Failed to send activation email'
      console.warn('[provisionUser] activation email failed for', user.email, activationEmailError)
    }
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      platformRoleCodes,
      status: user.status,
      tenantId: tenant.id,
      tenantName: tenant.name,
      createdAt: user.createdAt
    },
    activationLink: `${SITE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`,
    activationExpiresAt,
    activationEmailSent,
    activationEmailError
  }
}

export type ResendActivationResult =
  | { ok: true; activationLink: string; activationExpiresAt: Date; activationEmailSent: boolean; activationEmailError: string | null }
  | { ok: false; code: string; message: string; status: number }

/**
 * Mint a fresh set-password link for an account that has not been activated.
 *
 * Refused once a password exists — reissuing then would be an admin-triggered
 * account takeover rather than an onboarding aid. Those users go through
 * "Forgot password" like everybody else.
 */
export async function resendActivation(params: {
  targetUserId: string
  actorUserId: string
  sendEmail: boolean
  ip?: string
}): Promise<ResendActivationResult> {
  const user = await prisma.user.findUnique({
    where: { id: params.targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      oauthProvider: true,
      tenantId: true,
      tenant: { select: { name: true } }
    }
  })

  if (!user) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found', status: 404 }
  }

  if (user.passwordHash) {
    return {
      ok: false,
      code: 'ALREADY_ACTIVE',
      message: 'This account already has a password. Ask them to use "Forgot password" on the sign-in page.',
      status: 400
    }
  }

  if (user.oauthProvider) {
    const provider = user.oauthProvider.charAt(0) + user.oauthProvider.slice(1).toLowerCase()
    return {
      ok: false,
      code: 'SOCIAL_ACCOUNT',
      message: `This account signs in with ${provider} and has no password to set.`,
      status: 400
    }
  }

  // Only the newest link should work.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() }
  })

  const rawToken = generateToken()
  const activationExpiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS)
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt: activationExpiresAt }
  })

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: user.tenantId || undefined,
    action: 'USER_ACTIVATION_REISSUED',
    resource: `user:${user.id}`,
    ip: params.ip || 'unknown',
    meta: { email: user.email, emailRequested: params.sendEmail }
  })

  let activationEmailSent = false
  let activationEmailError: string | null = null

  if (params.sendEmail) {
    try {
      const tpl = activationTemplate({
        email: user.email,
        name: user.name,
        tenantName: user.tenant?.name || 'your organization',
        token: rawToken,
        expiresInHours: ACTIVATION_TOKEN_TTL_HOURS
      })
      await sendEmail({
        to: user.email,
        toName: user.name || undefined,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text
      })
      activationEmailSent = true
    } catch (error) {
      activationEmailError = error instanceof Error ? error.message : 'Failed to send activation email'
      console.warn('[resendActivation] email failed for', user.email, activationEmailError)
    }
  }

  return {
    ok: true,
    activationLink: `${SITE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`,
    activationExpiresAt,
    activationEmailSent,
    activationEmailError
  }
}
