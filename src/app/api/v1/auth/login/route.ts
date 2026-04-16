import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyPassword, generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = loginSchema.parse(body)

    // Find user with tenant
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true }
    })

    if (!user) {
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Verify password
    if (!user.passwordHash) {
      // Check if this is a social login user
      if (user.oauthProvider) {
        const providerName = user.oauthProvider.charAt(0) + user.oauthProvider.slice(1).toLowerCase()
        return NextResponse.json(
          {
            code: 'SOCIAL_LOGIN_REQUIRED',
            message: `This account uses ${providerName} login. Please sign in with ${providerName} instead.`,
            provider: user.oauthProvider.toLowerCase()
          },
          { status: 401 }
        )
      }
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash)
    if (!isPasswordValid) {
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Require verified email (disabled by default; enable with ENFORCE_EMAIL_VERIFICATION=true)
    if (process.env.ENFORCE_EMAIL_VERIFICATION === 'true' && !user.emailVerified) {
      return NextResponse.json(
        { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address. Check your inbox for the verification link.' },
        { status: 401 }
      )
    }

    // Check user status
    if (user.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'USER_SUSPENDED', message: 'User account is suspended' },
        { status: 401 }
      )
    }

    // Check if this is a social login user (OAuth users don't need ATI token validation)
    const isSocialLogin = !!user.oauthProvider

    // Determine scope based on tenant membership
    const isPlatformScope = !!(user.tenantId && user.tenant?.atiId === 'PLATFORM')
    const isTenantScope = !!(user.tenantId && user.tenant?.atiId !== 'PLATFORM')

    // For non-social login users, validate ATI token
    if (!isSocialLogin && user.signupAtiTokenId) {
      const signupToken = await prisma.aTIToken.findUnique({
        where: { id: user.signupAtiTokenId },
        include: { tenant: true }
      })

      if (signupToken) {
        // Check if signup token is still valid
        if (signupToken.status === 'REVOKED') {
          return NextResponse.json(
            { code: 'SIGNUP_TOKEN_REVOKED', message: 'Your signup ATI token has been revoked. Please contact your administrator.' },
            { status: 401 }
          )
        }

        if (signupToken.status === 'EXPIRED' || (signupToken.expiresAt && new Date() > signupToken.expiresAt)) {
          return NextResponse.json(
            { code: 'SIGNUP_TOKEN_EXPIRED', message: 'Your signup ATI token has expired. Please contact your administrator.' },
            { status: 401 }
          )
        }

        // Note: We don't check USED_UP for login - the token was already used for signup
        // The usageCount tracks signups, not logins
      }
    }

    // Validate scope: every user must have exactly one scope
    if (!isPlatformScope && !isTenantScope) {
      return NextResponse.json(
        { code: 'INVALID_SCOPE', message: 'User has invalid tenant association. Please contact administrator.' },
        { status: 401 }
      )
    }

    // Check tenant status
    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      const scopeType = isPlatformScope ? 'platform' : 'tenant'
      return NextResponse.json(
        { code: 'SCOPE_INACTIVE', message: `${scopeType} scope is inactive. Please contact administrator.` },
        { status: 401 }
      )
    }

    // Generate JWT with scope information (short-lived access token)
    const accessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId, // Always set - no more null for super admin
      roles: user.roles,
      ati_id: user.tenant?.atiId || null,
      tenant_ati_id: user.tenant?.atiId || null, // For middleware validation
      scope: isPlatformScope ? 'platform' : 'tenant' // Add explicit scope
    })

    // Get request metadata for token tracking
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'
    const userAgent = request.headers.get('user-agent') || undefined

    // Generate and store refresh token (long-lived, in httpOnly cookie)
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, { userAgent, ipAddress: ip })

    // Audit log
    await createAuditLog({
      actorUserId: user.id,
      tenantId: user.tenantId || undefined, // Convert null to undefined for audit log
      action: 'USER_LOGIN',
      resource: `user:${user.id}`,
      ip,
      meta: {
        email: user.email,
        roles: user.roles,
        scope: isPlatformScope ? 'platform' : 'tenant',
        tenant_ati_id: user.tenant?.atiId
      }
    })

    // Create response with access token in body
    const response = NextResponse.json({
      token: accessToken,
      expires_in: 900 // 15 minutes in seconds (matches JWT_EXPIRES_IN)
    }, { status: 200 })

    // Set refresh token as httpOnly cookie (not accessible via JavaScript - XSS protection)
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/'
    })

    return response

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Login error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}



