import { randomInt } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createAuditLog, hashPassword, revokeAllUserTokens } from '@/lib/auth'
import { generateToken, hashToken } from '@/lib/token-utils'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { adminPasswordResetTemplate } from '@/lib/email-templates'

/**
 * Administrator-driven password recovery for the platform console.
 *
 * "Forgot password" already covers the ordinary case, and `resendActivation`
 * covers an account that never had a password. Both dead-end when the person
 * cannot receive the mail at all — a wrong address on the roster, a mailbox the
 * university has closed, a sender the mail provider is currently refusing — and
 * that is exactly when support gets called. This module is the manual override
 * for those accounts, in two escalating steps:
 *
 *   1. `issuePasswordReset` mints a reset link and hands it back to the admin.
 *      The password does not change until the person uses the link, so reading
 *      one out over the phone is no worse than the self-service flow.
 *   2. `setTemporaryPassword` writes a password the admin can dictate directly.
 *      That is a real credential travelling over an unauthenticated channel, so
 *      it is deliberately single-use: `mustChangePassword` makes the next login
 *      return a reset token instead of a session (see the login route), and
 *      every existing session is revoked on the spot.
 *
 * Authority is not decided here — callers gate on `requirePlatformScope`, which
 * admits only a full SUPER_ADMIN. What this module enforces is the part that
 * does not depend on the caller's rank: nobody acts on their own account, since
 * a temporary password on yourself is a lockout waiting to happen and
 * self-service reset is right there.
 *
 * Accounts with no password of their own — never activated, or signed up
 * through Google — are handled rather than refused. An earlier version turned
 * them away on the grounds that an admin should not invent a password login for
 * somebody. The refusal was worse than the thing it prevented: it hid the whole
 * feature from the console with no explanation, in exactly the situation it
 * exists for. A super admin can already create an account with any role, so the
 * capability was never the line; visibility is. The action is labelled for what
 * it does, forces a change, revokes sessions, and is audited.
 */

/**
 * Shorter than the 7-day activation window, longer than the 1-hour
 * self-service one. The admin is on the phone with the person now, but the link
 * is often pasted into a ticket and picked up after the call.
 */
export const ADMIN_RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const ADMIN_RESET_TOKEN_TTL_HOURS = ADMIN_RESET_TOKEN_TTL_MS / (60 * 60 * 1000)

/**
 * The window a forced password change gets once the correct temporary password
 * has been presented. Minutes, not hours: the holder is at the keyboard.
 */
export const FORCED_CHANGE_TOKEN_TTL_MS = 15 * 60 * 1000

export const MIN_TEMPORARY_PASSWORD_LENGTH = 12

/** No look-alike glyphs — these get read aloud down a phone line. */
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** 16 characters from a 57-glyph alphabet — ~93 bits, and it survives dictation. */
export function generateTemporaryPassword(length = 16): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)]
  }
  return out
}

export type AdminPasswordFailure = { ok: false; code: string; message: string; status: number }

interface TargetUser {
  id: string
  email: string
  name: string | null
  passwordHash: string | null
  oauthProvider: string | null
  status: string
  tenantId: string | null
  tenantName: string | null
}

/**
 * Load the target and apply the two guards every action here shares: it exists,
 * and it is not the caller.
 */
async function loadTarget(
  targetUserId: string,
  actorUserId: string
): Promise<{ ok: true; user: TargetUser } | AdminPasswordFailure> {
  if (targetUserId === actorUserId) {
    return {
      ok: false,
      code: 'SELF_TARGET',
      message: 'Use "Forgot password" on the sign-in page to reset your own password.',
      status: 400
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      oauthProvider: true,
      status: true,
      tenantId: true,
      tenant: { select: { name: true } }
    }
  })

  if (!user) {
    return { ok: false, code: 'USER_NOT_FOUND', message: 'User not found', status: 404 }
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: user.passwordHash,
      oauthProvider: user.oauthProvider,
      status: user.status,
      tenantId: user.tenantId,
      tenantName: user.tenant?.name ?? null
    }
  }
}

/** Only the newest link should work, so burn whatever is outstanding first. */
async function invalidateOutstandingResets(userId: string) {
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() }
  })
}

async function mintResetToken(userId: string, ttlMs: number): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + ttlMs)
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt }
  })
  return { token, expiresAt }
}

export function resetLinkFor(token: string): string {
  return `${SITE_URL}/reset-password?token=${encodeURIComponent(token)}`
}

export type IssuePasswordResetResult =
  | {
      ok: true
      email: string
      resetLink: string
      expiresAt: Date
      emailSent: boolean
      /** Non-null when the link was minted but the mailer refused it. */
      emailError: string | null
    }
  | AdminPasswordFailure

/**
 * Mint a reset link for somebody else's account.
 *
 * The link comes back whether or not the email was sent: broken mail delivery
 * is the most likely reason this is being used at all, and an admin who can
 * read the link to the user has already solved the problem.
 */
export async function issuePasswordReset(params: {
  targetUserId: string
  actorUserId: string
  sendEmail: boolean
  ip?: string
}): Promise<IssuePasswordResetResult> {
  const target = await loadTarget(params.targetUserId, params.actorUserId)
  if (!target.ok) return target
  const { user } = target

  await invalidateOutstandingResets(user.id)
  const { token, expiresAt } = await mintResetToken(user.id, ADMIN_RESET_TOKEN_TTL_MS)

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: user.tenantId || undefined,
    action: 'USER_PASSWORD_RESET_ISSUED',
    resource: `user:${user.id}`,
    ip: params.ip || 'unknown',
    meta: { email: user.email, emailRequested: params.sendEmail, expiresAt: expiresAt.toISOString() }
  })

  let emailSent = false
  let emailError: string | null = null

  if (params.sendEmail) {
    try {
      const tpl = adminPasswordResetTemplate({
        email: user.email,
        name: user.name,
        token,
        expiresInHours: ADMIN_RESET_TOKEN_TTL_HOURS
      })
      await sendEmail({
        to: user.email,
        toName: user.name || undefined,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Failed to send the reset email'
      console.warn('[issuePasswordReset] email failed for', user.email, emailError)
    }
  }

  return {
    ok: true,
    email: user.email,
    resetLink: resetLinkFor(token),
    expiresAt,
    emailSent,
    emailError
  }
}

export type SetTemporaryPasswordResult =
  | {
      ok: true
      email: string
      /** Shown to the admin once; never stored in plaintext. */
      temporaryPassword: string
      mustChangePassword: boolean
      sessionsRevoked: boolean
      /** The account had no password before, so it just gained one as a way in. */
      addedPasswordLogin: boolean
      /** Set when the account also has a social login that still works. */
      oauthProvider: string | null
    }
  | AdminPasswordFailure

/**
 * Write a password the admin can dictate, and mark the account so that password
 * is spent the moment it is used.
 *
 * Outstanding reset links are burned too: leaving one live after a manual reset
 * means two ways into the account when the admin believes there is one.
 *
 * On an account with no password this creates one. That is the point when mail
 * is not being delivered: a person whose only route in was a link they cannot
 * receive has no route in at all. A social login on the account is untouched
 * and keeps working alongside the new password.
 */
export async function setTemporaryPassword(params: {
  targetUserId: string
  actorUserId: string
  /** Omit to generate one; a supplied password still clears the length floor. */
  password?: string | null
  /** False only for a deliberate permanent set — audited either way. */
  requireChange?: boolean
  ip?: string
}): Promise<SetTemporaryPasswordResult> {
  const target = await loadTarget(params.targetUserId, params.actorUserId)
  if (!target.ok) return target
  const { user } = target

  const supplied = params.password?.trim()
  if (supplied && supplied.length < MIN_TEMPORARY_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: 'WEAK_PASSWORD',
      message: `A temporary password needs at least ${MIN_TEMPORARY_PASSWORD_LENGTH} characters`,
      status: 400
    }
  }

  const password = supplied || generateTemporaryPassword()
  const requireChange = params.requireChange !== false
  const addedPasswordLogin = !user.passwordHash
  const passwordHash = await hashPassword(password)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: requireChange, passwordChangedAt: new Date() }
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    })
  ])

  // Outside the transaction on purpose: a session surviving a failed revoke is
  // worth an error in the log, not a rolled-back password the admin has already
  // read out loud.
  await revokeAllUserTokens(user.id, 'admin_password_reset')

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: user.tenantId || undefined,
    action: 'USER_PASSWORD_SET_BY_ADMIN',
    resource: `user:${user.id}`,
    ip: params.ip || 'unknown',
    meta: { email: user.email, requireChange, generated: !supplied, addedPasswordLogin }
  })

  return {
    ok: true,
    email: user.email,
    temporaryPassword: password,
    mustChangePassword: requireChange,
    sessionsRevoked: true,
    addedPasswordLogin,
    oauthProvider: user.oauthProvider
  }
}

export type RequirePasswordChangeResult =
  | { ok: true; email: string; mustChangePassword: boolean; sessionsRevoked: boolean }
  | AdminPasswordFailure

/**
 * Flag an account so its next login has to go through a password change,
 * without touching the current password.
 *
 * This is the "their password may have been seen" case — a credential shared
 * between colleagues, or one mailed in plaintext years ago. Sessions are
 * revoked by default, because leaving the open ones alive means the flag does
 * nothing until the person happens to sign out.
 *
 * The flag gates password sign-in only. Somebody who gets in through Google is
 * not stopped by it, so on a social account it is a no-op until a password is
 * actually used.
 */
export async function requirePasswordChange(params: {
  targetUserId: string
  actorUserId: string
  required: boolean
  revokeSessions?: boolean
  ip?: string
}): Promise<RequirePasswordChangeResult> {
  const target = await loadTarget(params.targetUserId, params.actorUserId)
  if (!target.ok) return target
  const { user } = target

  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: params.required }
  })

  const revokeSessions = params.required && params.revokeSessions !== false
  if (revokeSessions) {
    await revokeAllUserTokens(user.id, 'admin_password_change_required')
  }

  await createAuditLog({
    actorUserId: params.actorUserId,
    tenantId: user.tenantId || undefined,
    action: params.required ? 'USER_PASSWORD_CHANGE_REQUIRED' : 'USER_PASSWORD_CHANGE_REQUIREMENT_CLEARED',
    resource: `user:${user.id}`,
    ip: params.ip || 'unknown',
    meta: { email: user.email, sessionsRevoked: revokeSessions }
  })

  return { ok: true, email: user.email, mustChangePassword: params.required, sessionsRevoked: revokeSessions }
}

/**
 * Exchange a proven-correct temporary password for a one-time reset token.
 *
 * Called by the login route when `mustChangePassword` is set. The credential
 * has already been verified, so this is not a second authentication step — it
 * is the login's reply, redirecting into the change instead of handing back a
 * session.
 */
export async function startForcedPasswordChange(userId: string): Promise<{ token: string; expiresAt: Date }> {
  await invalidateOutstandingResets(userId)
  return mintResetToken(userId, FORCED_CHANGE_TOKEN_TTL_MS)
}
