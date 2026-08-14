import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  hashPassword,
  generateJWT,
  generateRefreshToken,
  storeRefreshToken,
  createAuditLog,
} from '@/lib/auth'
import { isAccessExpired } from '@/lib/ati-kind-policy'

/**
 * First-login activation for SEEDED accounts (email + Employee ID).
 *
 * Faculty imported via the roster CSV are created without a password
 * (`facultyImportService.ts`). Instead of an activation email, the person
 * proves identity here with the Employee ID that is already in the roster and
 * sets their own password — then they are logged straight in.
 *
 * Security model:
 *  - Only accounts with NO passwordHash and NO oauthProvider can activate.
 *  - The Employee ID (stored on ResearcherProfile, unique per tenant) is a
 *    knowledge factor beyond the public email; without it, knowing a
 *    colleague's address is not enough to claim their account.
 *  - Every failure returns ONE generic message so this cannot be used to probe
 *    which emails are seeded, and attempts are rate-limited per IP+email to
 *    blunt brute-forcing of guessable Employee IDs.
 */

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  email: z.string().email(),
  employeeId: z.string().trim().min(1, 'Employee ID is required').max(64),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

// Same generic response for every non-success path (missing user, wrong
// Employee ID, already-active, suspended...) so nothing is leaked.
const GENERIC_FAILURE = {
  code: 'ACTIVATION_FAILED',
  message:
    "That email and Employee ID don't match our records, or the account is already active. If you already set a password, sign in normally.",
} as const

// --- In-memory rate limiter -------------------------------------------------
// Prod runs a persistent Node server, so a module-level map is a good-enough
// brute-force brake without a new DB table/migration. Keyed by ip+email.
const RATE_WINDOW_MS = 15 * 60 * 1000
const RATE_MAX_ATTEMPTS = 8
const globalForRate = globalThis as typeof globalThis & {
  __grapsiFirstLoginAttempts?: Map<string, { count: number; resetAt: number }>
}
const attempts = globalForRate.__grapsiFirstLoginAttempts ?? new Map()
globalForRate.__grapsiFirstLoginAttempts = attempts

function rateLimit(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_MAX_ATTEMPTS) return false
  entry.count += 1
  return true
}

function clearRate(key: string) {
  attempts.delete(key)
}

export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }
    const email = parsed.data.email.trim().toLowerCase()
    const employeeId = parsed.data.employeeId.trim()

    const ip =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown'

    const rateKey = `${ip}:${email}`
    if (!rateLimit(rateKey)) {
      return NextResponse.json(
        { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Please wait a few minutes and try again.' },
        { status: 429 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true, researcher_profile: { select: { employee_id: true } } },
    })

    // Social accounts sign in through their provider, not here.
    if (user && !user.passwordHash && user.oauthProvider) {
      const providerName = user.oauthProvider.charAt(0) + user.oauthProvider.slice(1).toLowerCase()
      return NextResponse.json(
        {
          code: 'SOCIAL_LOGIN_REQUIRED',
          message: `This account uses ${providerName} login. Please sign in with ${providerName} instead.`,
          provider: user.oauthProvider.toLowerCase(),
        },
        { status: 401 }
      )
    }

    // Must be a seeded, tenant-bound, active account whose Employee ID matches.
    const storedEmployeeId = user?.researcher_profile?.employee_id?.trim() || ''
    const eligible =
      !!user &&
      !user.passwordHash &&
      !user.oauthProvider &&
      !!user.tenantId &&
      user.status === 'ACTIVE' &&
      !isAccessExpired(user.accessExpiresAt, new Date()) &&
      storedEmployeeId.length > 0 &&
      storedEmployeeId.toLowerCase() === employeeId.toLowerCase()

    if (!user || !eligible) {
      return NextResponse.json(GENERIC_FAILURE, { status: 401 })
    }

    // Scope validation, mirroring the login route.
    const isPlatformScope = !!(user.tenantId && user.tenant?.atiId === 'PLATFORM')
    const isTenantScope = !!(user.tenantId && user.tenant?.atiId !== 'PLATFORM')
    if (!isPlatformScope && !isTenantScope) {
      return NextResponse.json(GENERIC_FAILURE, { status: 401 })
    }
    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'SCOPE_INACTIVE', message: 'Your organization is inactive. Please contact your administrator.' },
        { status: 401 }
      )
    }

    // Set the password and mark the email trusted (the admin vouched for it by
    // seeding, and identity was proven with the Employee ID).
    const passwordHash = await hashPassword(parsed.data.password)
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, emailVerified: true },
    })
    clearRate(rateKey)

    // Issue the same session a normal login would — the user is now signed in.
    const accessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null,
      scope: isPlatformScope ? 'platform' : 'tenant',
      access_expires_at: user.accessExpiresAt ? user.accessExpiresAt.toISOString() : null,
    })

    const userAgent = request.headers.get('user-agent') || undefined
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, { userAgent, ipAddress: ip })

    await createAuditLog({
      actorUserId: user.id,
      tenantId: user.tenantId || undefined,
      action: 'USER_FIRST_LOGIN_ACTIVATION',
      resource: `user:${user.id}`,
      ip,
      meta: { email: user.email, roles: user.roles },
    })

    const response = NextResponse.json(
      { token: accessToken, expires_in: 900 },
      { status: 200 }
    )
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })
    return response
  } catch (error) {
    console.error('First-login activation error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
