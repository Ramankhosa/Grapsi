import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { validateATIToken, generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'
import { autoAssignToDefaultTeam } from '@/lib/org-access-service'

const completeSignupSchema = z.object({
  atiToken: z.string().min(1),
  pendingToken: z.string().min(1) // Token from social OAuth flow
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { atiToken, pendingToken } = completeSignupSchema.parse(body)

    // Decode and validate the pending registration token
    let pendingData: {
      provider: string
      providerId: string
      email: string
      name?: string
      firstName?: string
      lastName?: string
      profile?: any
      exp: number
    }

    try {
      pendingData = JSON.parse(Buffer.from(pendingToken, 'base64url').toString())
    } catch {
      return NextResponse.json(
        { code: 'INVALID_PENDING_TOKEN', message: 'Invalid or expired registration token' },
        { status: 400 }
      )
    }

    // Check if token has expired (15 minutes validity)
    if (Date.now() > pendingData.exp) {
      return NextResponse.json(
        { code: 'TOKEN_EXPIRED', message: 'Registration session has expired. Please try again.' },
        { status: 400 }
      )
    }

    // Check if email is already in use
    const existingUser = await prisma.user.findUnique({
      where: { email: pendingData.email }
    })

    if (existingUser) {
      return NextResponse.json(
        { code: 'EMAIL_IN_USE', message: 'Email address is already registered. Please log in instead.' },
        { status: 400 }
      )
    }

    // Validate ATI token
    const tokenValidation = await validateATIToken(atiToken)

    if (!tokenValidation.valid) {
      return NextResponse.json(
        { code: tokenValidation.error, message: `ATI token validation failed: ${tokenValidation.error}` },
        { status: 400 }
      )
    }

    // Get full token with tenant info
    const fullToken = await prisma.aTIToken.findUnique({
      where: { id: tokenValidation.atiToken!.id },
      include: { tenant: true }
    })

    // Platform tokens cannot be used for regular signup
    if (fullToken?.tenant?.atiId === 'PLATFORM') {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Platform ATI tokens cannot be used for regular user signup' },
        { status: 400 }
      )
    }

    // Get the tenant
    const tenant = await prisma.tenant.findUnique({
      where: { id: tokenValidation.atiToken!.tenantId! }
    })

    if (!tenant || tenant.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'TENANT_INACTIVE', message: 'Tenant is not active' },
        { status: 400 }
      )
    }

    // Check tenant user limits
    const existingUsersCount = await prisma.user.count({
      where: { tenantId: tenant.id }
    })

    if (existingUsersCount > 0) {
      const tenantAdmin = await prisma.user.findFirst({
        where: {
          tenantId: tenant.id,
          roles: { hasSome: ['OWNER', 'ADMIN'] }
        },
        select: { signupAtiTokenId: true },
        orderBy: { createdAt: 'asc' }
      })

      if (tenantAdmin?.signupAtiTokenId) {
        const originalToken = await prisma.aTIToken.findUnique({
          where: { id: tenantAdmin.signupAtiTokenId }
        })

        if (originalToken?.maxUses && existingUsersCount >= originalToken.maxUses) {
          return NextResponse.json(
            { code: 'TENANT_USER_LIMIT_EXCEEDED', message: `Tenant has reached its maximum user limit.` },
            { status: 400 }
          )
        }
      }
    }

    // Determine user role
    let userRole = 'ANALYST'
    let roleReason = 'default'

    if (existingUsersCount === 0) {
      userRole = 'OWNER'
      roleReason = 'first_tenant_user'
    } else if (fullToken?.assignedRole && !['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'].includes(fullToken.assignedRole)) {
      userRole = fullToken.assignedRole
      roleReason = 'ati_token_explicit_role'
    }

    // Create user with social OAuth data
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: pendingData.email,
          name: pendingData.name || `${pendingData.firstName || ''} ${pendingData.lastName || ''}`.trim(),
          firstName: pendingData.firstName,
          lastName: pendingData.lastName,
          tenantId: tenant.id,
          signupAtiTokenId: tokenValidation.atiToken!.id,
          roles: [userRole as any],
          status: 'ACTIVE',
          emailVerified: true, // Social logins are verified
          oauthProvider: pendingData.provider.toUpperCase() as any,
          oauthProviderId: pendingData.providerId,
          oauthProfile: pendingData.profile
        }
      })

      // Create default project
      await tx.project.create({
        data: {
          name: 'Default Project',
          userId: user.id,
          tenantId: tenant.id,
        }
      })

      // Get current token state
      const currentToken = await tx.aTIToken.findUnique({
        where: { id: tokenValidation.atiToken!.id }
      })

      // Increment ATI token usage
      await tx.aTIToken.update({
        where: { id: tokenValidation.atiToken!.id },
        data: {
          usageCount: { increment: 1 },
          ...(currentToken && currentToken.maxUses && currentToken.usageCount + 1 >= currentToken.maxUses
            ? { status: 'USED_UP' }
            : {})
        }
      })

      // Audit log
      const ip = request.headers.get('x-forwarded-for') ||
                 request.headers.get('x-real-ip') ||
                 'unknown'

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          tenantId: tenant.id,
          action: 'USER_SIGNUP',
          resource: `user:${user.id}`,
          ip,
          meta: {
            email: user.email,
            roles: user.roles,
            assigned_role_reason: roleReason,
            signup_method: 'social_oauth_with_ati',
            oauth_provider: pendingData.provider,
            ati_token_fingerprint: tokenValidation.atiToken!.fingerprint,
            is_first_tenant_user: existingUsersCount === 0
          }
        }
      })

      return user
    })

    const user = result

    // Auto-assign to team
    try {
      await autoAssignToDefaultTeam(user.id, tenant.id, fullToken?.assignedTeamId || undefined)
    } catch (teamError) {
      console.warn('Failed to auto-assign user to team:', teamError)
    }

    // Generate JWT token
    const accessToken = generateJWT({
      sub: user.id,
      email: user.email,
      tenant_id: user.tenantId,
      roles: user.roles,
      ati_id: tenant.atiId,
      tenant_ati_id: tenant.atiId,
      scope: 'tenant'
    })

    // Get request metadata
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    // Generate and store refresh token
    const refreshTokenData = generateRefreshToken(user.id)
    await storeRefreshToken(user.id, refreshTokenData, {
      userAgent: request.headers.get('user-agent') || undefined,
      ipAddress: ip
    })

    // Create response
    const response = NextResponse.json({
      success: true,
      user_id: user.id,
      tenant_id: tenant.id,
      roles: user.roles,
      token: accessToken
    }, { status: 201 })

    // Set refresh token as httpOnly cookie
    response.cookies.set('refresh_token', refreshTokenData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })

    // Set access token cookie
    response.cookies.set('access_token', accessToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60,
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

    console.error('Social signup completion error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

