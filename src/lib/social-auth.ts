import type { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'
import { isAccessExpired } from '@/lib/ati-kind-policy'
import type { OAuthProvider } from '@/lib/oauth-config'

/**
 * Normalised identity handed back by a provider callback. Every provider
 * adapter reduces its own payload to this shape so that linking, security
 * checks and session issuance stay in one place.
 */
export interface SocialIdentity {
  provider: OAuthProvider
  providerUserId: string
  /** Raw email from the provider; null when the provider does not supply one. */
  email: string | null
  /**
   * Whether the provider asserts the email is verified. Only a verified email
   * may be auto-linked to a pre-existing account — otherwise anyone able to
   * set an arbitrary unverified address at the provider could take over a
   * Grapsi account just by matching its email.
   */
  emailVerified: boolean
  name?: string
  firstName?: string
  lastName?: string
  profile?: unknown
}

const userWithTenant = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: { tenant: true }
})
export type UserWithTenant = Prisma.UserGetPayload<typeof userWithTenant>

export type SocialResolution =
  /** Known identity (or freshly linked) — proceed to issue a session. */
  | { kind: 'login'; user: UserWithTenant }
  /** Unknown identity and no account to link to — send to ATI-token signup. */
  | { kind: 'signup' }
  /** Refuse, and bounce back to /login?error=<reason>. */
  | { kind: 'error'; reason: string }

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email || '').trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function toPrismaProvider(provider: OAuthProvider) {
  return provider.toUpperCase() as 'GOOGLE' | 'FACEBOOK' | 'LINKEDIN' | 'TWITTER'
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue
}

/**
 * Resolves a provider identity to a Grapsi account.
 *
 * Order of precedence:
 *  1. An existing link for this exact (provider, provider user id).
 *  2. An existing account with the same email — linked on the spot, so a
 *     manually created account can start using social login at any time, and
 *     a second provider can be added later without displacing the first.
 *  3. Otherwise the caller routes the user through ATI-token signup.
 */
export async function resolveSocialIdentity(identity: SocialIdentity): Promise<SocialResolution> {
  const provider = toPrismaProvider(identity.provider)
  const email = normalizeEmail(identity.email)

  if (!identity.providerUserId) {
    return { kind: 'error', reason: 'oauth_missing_identity' }
  }

  // 1. Already linked.
  const linked = await prisma.userOAuthAccount.findUnique({
    where: {
      provider_providerUserId: { provider, providerUserId: identity.providerUserId }
    },
    include: { user: { include: { tenant: true } } }
  })

  if (linked) {
    await prisma.userOAuthAccount.update({
      where: { id: linked.id },
      data: {
        email,
        emailVerified: identity.emailVerified,
        profile: toJson(identity.profile),
        lastLoginAt: new Date()
      }
    })
    return { kind: 'login', user: linked.user }
  }

  if (!email) {
    // Nothing to match on and nothing to build an account from.
    return { kind: 'error', reason: 'oauth_no_email' }
  }

  // 2. Match an existing account by email.
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { tenant: true }
  })

  if (!existingUser) {
    return { kind: 'signup' }
  }

  if (!identity.emailVerified) {
    // Refuse to hand an existing account to an unverified provider email.
    return { kind: 'error', reason: 'oauth_email_unverified' }
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.userOAuthAccount.upsert({
      where: { userId_provider: { userId: existingUser.id, provider } },
      create: {
        userId: existingUser.id,
        provider,
        providerUserId: identity.providerUserId,
        email,
        emailVerified: true,
        profile: toJson(identity.profile),
        lastLoginAt: new Date()
      },
      update: {
        providerUserId: identity.providerUserId,
        email,
        emailVerified: true,
        profile: toJson(identity.profile),
        lastLoginAt: new Date()
      }
    })

    // Keep the legacy single-provider columns pointing at the newest link.
    return tx.user.update({
      where: { id: existingUser.id },
      data: {
        oauthProvider: provider,
        oauthProviderId: identity.providerUserId,
        oauthProfile: toJson(identity.profile),
        emailVerified: true
      },
      include: { tenant: true }
    })
  })

  await createAuditLog({
    actorUserId: user.id,
    tenantId: user.tenantId || undefined,
    action: 'USER_OAUTH_LINKED',
    resource: `user:${user.id}`,
    meta: { email: user.email, oauth_provider: provider }
  })

  return { kind: 'login', user }
}

/**
 * The same gate the password login route applies, so social login cannot be
 * used to bypass suspension, tenant deactivation or event access expiry.
 * Returns an error reason, or null when the user may sign in.
 */
export function checkSocialSignInAllowed(user: UserWithTenant): string | null {
  if (user.status !== 'ACTIVE') return 'user_suspended'
  if (isAccessExpired(user.accessExpiresAt, new Date())) return 'access_expired'

  const isPlatformScope = !!(user.tenantId && user.tenant?.atiId === 'PLATFORM')
  const isTenantScope = !!(user.tenantId && user.tenant?.atiId !== 'PLATFORM')
  if (!isPlatformScope && !isTenantScope) return 'invalid_scope'

  if (user.tenant && user.tenant.status !== 'ACTIVE') return 'scope_inactive'

  return null
}

/**
 * Issues the access + refresh tokens on an existing redirect response and
 * writes the login audit entry.
 */
export async function issueSocialSession(
  response: NextResponse,
  request: NextRequest,
  user: UserWithTenant,
  provider: OAuthProvider
): Promise<NextResponse> {
  const accessToken = generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant'
  })

  const ip = request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown'

  const refreshTokenData = generateRefreshToken(user.id)
  await storeRefreshToken(user.id, refreshTokenData, {
    userAgent: request.headers.get('user-agent') || undefined,
    ipAddress: ip
  })

  await createAuditLog({
    actorUserId: user.id,
    tenantId: user.tenantId || undefined,
    action: 'USER_LOGIN',
    resource: `user:${user.id}`,
    ip,
    meta: {
      email: user.email,
      roles: user.roles,
      login_method: `${provider}_oauth`,
      oauth_provider: toPrismaProvider(provider)
    }
  })

  response.cookies.set('refresh_token', refreshTokenData.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/'
  })

  response.cookies.set('access_token', accessToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60,
    path: '/'
  })

  return response
}

/**
 * Records the OAuth link for an account created through social signup.
 * Call inside the signup transaction.
 */
export async function recordOAuthAccountLink(
  tx: Prisma.TransactionClient,
  userId: string,
  identity: SocialIdentity
): Promise<void> {
  await tx.userOAuthAccount.create({
    data: {
      userId,
      provider: toPrismaProvider(identity.provider),
      providerUserId: identity.providerUserId,
      email: normalizeEmail(identity.email),
      emailVerified: identity.emailVerified,
      profile: toJson(identity.profile),
      lastLoginAt: new Date()
    }
  })
}
