import { prisma } from '@/lib/prisma'
import {
  createATIFingerprint,
  decryptToken,
  encryptToken,
  generateATIToken,
  hashATIToken
} from '@/lib/auth'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { tenantInviteTemplate } from '@/lib/email-templates'

/**
 * Named, email-locked invitations for joining a tenant.
 *
 * Each invite is backed by a single-use ATI token so redemption reuses the
 * existing atomic claim logic. The invite adds identity on top: who was
 * invited, by whom, with which role, and locks signup to the invited email.
 */

export const INVITE_VALIDITY_DAYS = 14

// Roles a tenant admin may grant through an invite
export const INVITABLE_ROLES = ['ADMIN', 'MANAGER', 'ANALYST'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export interface CreateInviteInput {
  tenantId: string
  tenantName: string
  invitedByUserId: string
  inviterName: string
  planTier: string | null
  email: string
  role: InvitableRole
  teamId?: string | null
  /**
   * Platform-issued invite for a tenant's first administrator. Only changes the
   * email copy — the recipient becomes OWNER through the normal first-user
   * promotion in the signup transaction.
   */
  isFoundingAdmin?: boolean
}

export interface CreateInviteResult {
  ok: boolean
  email: string
  inviteId?: string
  error?: string
}

export function buildInviteLink(rawToken: string, email: string): string {
  return `${SITE_URL}/register?invite=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`
}

export async function createTenantInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase()

  // Emails are globally unique — an existing account can't be invited
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existingUser) {
    return { ok: false, email, error: 'A user with this email already exists' }
  }

  const existingInvite = await prisma.tenantMemberInvite.findFirst({
    where: { tenantId: input.tenantId, email, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { id: true }
  })
  if (existingInvite) {
    return { ok: false, email, error: 'A pending invite for this email already exists' }
  }

  const rawToken = generateATIToken()
  const tokenHash = hashATIToken(rawToken)
  const fingerprint = createATIFingerprint(tokenHash)
  const expiresAt = new Date(Date.now() + INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000)

  const invite = await prisma.$transaction(async tx => {
    const atiToken = await tx.aTIToken.create({
      data: {
        tenantId: input.tenantId,
        tokenHash,
        rawToken: encryptToken(rawToken),
        rawTokenExpiry: expiresAt, // raw token only needed while the invite is resendable
        fingerprint,
        status: 'ACTIVE',
        expiresAt,
        maxUses: 1,
        planTier: input.planTier,
        notes: `Member invite for ${email}`,
        assignedRole: input.role,
        assignedTeamId: input.teamId || null
      }
    })

    return tx.tenantMemberInvite.create({
      data: {
        tenantId: input.tenantId,
        email,
        role: input.role,
        teamId: input.teamId || null,
        atiTokenId: atiToken.id,
        invitedByUserId: input.invitedByUserId,
        expiresAt
      }
    })
  })

  const tpl = tenantInviteTemplate({
    email,
    inviterName: input.inviterName,
    tenantName: input.tenantName,
    role: input.role,
    inviteLink: buildInviteLink(rawToken, email),
    expiresAt,
    isFoundingAdmin: input.isFoundingAdmin
  })

  try {
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })
  } catch (err) {
    console.error('Failed to send tenant invite email:', err)
    // Keep the invite — the admin can resend from the dashboard
  }

  return { ok: true, email, inviteId: invite.id }
}

export async function listTenantInvites(tenantId: string) {
  return prisma.tenantMemberInvite.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      createdAt: true,
      invitedBy: { select: { email: true, name: true } }
    }
  })
}

export async function revokeTenantInvite(inviteId: string, tenantId: string): Promise<boolean> {
  const invite = await prisma.tenantMemberInvite.findFirst({
    where: { id: inviteId, tenantId, status: 'PENDING' },
    select: { id: true, atiTokenId: true }
  })
  if (!invite) return false

  await prisma.$transaction([
    prisma.tenantMemberInvite.update({
      where: { id: invite.id },
      data: { status: 'REVOKED' }
    }),
    prisma.aTIToken.update({
      where: { id: invite.atiTokenId },
      data: { status: 'REVOKED' }
    })
  ])
  return true
}

export async function resendTenantInvite(
  inviteId: string,
  tenantId: string,
  tenantName: string,
  inviterName: string
): Promise<{ ok: boolean; error?: string }> {
  const invite = await prisma.tenantMemberInvite.findFirst({
    where: { id: inviteId, tenantId, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { email: true, role: true, expiresAt: true, atiToken: { select: { rawToken: true } } }
  })
  if (!invite) return { ok: false, error: 'Invite not found or no longer pending' }
  if (!invite.atiToken.rawToken) return { ok: false, error: 'Invite link can no longer be regenerated' }

  let rawToken: string | null = null
  try {
    rawToken = decryptToken(invite.atiToken.rawToken)
  } catch {
    // fall through to the null check below
  }
  if (!rawToken) {
    return { ok: false, error: 'Invite link can no longer be regenerated' }
  }

  // An invite into a tenant that still has no users is a founding-admin invite
  // (the recipient will be promoted to OWNER on signup), so resend the copy
  // that says so rather than the generic "join the team" wording.
  const tenantUserCount = await prisma.user.count({ where: { tenantId } })

  const tpl = tenantInviteTemplate({
    email: invite.email,
    inviterName,
    tenantName,
    role: invite.role,
    inviteLink: buildInviteLink(rawToken, invite.email),
    expiresAt: invite.expiresAt,
    isFoundingAdmin: tenantUserCount === 0
  })
  await sendEmail({ to: invite.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
  return { ok: true }
}

/**
 * Signup-time enforcement. If the ATI token being redeemed is backed by a
 * member invite, the signup email must match the invited email and the
 * invite must still be pending.
 */
export async function validateInviteEmailLock(
  atiTokenId: string,
  signupEmail: string
): Promise<{ ok: boolean; error?: string }> {
  const invite = await prisma.tenantMemberInvite.findUnique({
    where: { atiTokenId },
    select: { email: true, status: true, expiresAt: true }
  })
  if (!invite) return { ok: true } // plain ATI token, no invite attached

  if (invite.status !== 'PENDING') {
    return { ok: false, error: 'This invitation is no longer valid' }
  }
  if (invite.expiresAt < new Date()) {
    return { ok: false, error: 'This invitation has expired' }
  }
  if (invite.email !== signupEmail.trim().toLowerCase()) {
    return { ok: false, error: 'This invitation was issued for a different email address' }
  }
  return { ok: true }
}

/** Mark the invite accepted inside the signup transaction. */
export async function markInviteAccepted(
  tx: { tenantMemberInvite: { updateMany: (args: any) => Promise<any> } },
  atiTokenId: string,
  userId: string
): Promise<void> {
  await tx.tenantMemberInvite.updateMany({
    where: { atiTokenId, status: 'PENDING' },
    data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedUserId: userId }
  })
}
