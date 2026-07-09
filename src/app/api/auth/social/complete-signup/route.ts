import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { validateATIToken, generateJWT, generateRefreshToken, storeRefreshToken, createAuditLog } from '@/lib/auth'
import { ATIRedemptionError, assignSignupTeam, claimATITokenUse } from '@/lib/ati-redemption-service'
import { ensureTenantEntitlementForSignup } from '@/lib/entitlement-service'
import { verifySocialSignupToken } from '@/lib/social-signup-token'
import {
  computeAccessExpiresAt,
  resolveAssignedRole,
  shouldPromoteFirstUserToOwner,
  type ATIKind
} from '@/lib/ati-kind-policy'
import { markInviteAccepted, validateInviteEmailLock } from '@/lib/tenant-invite-service'

const completeSignupSchema = z.object({
  atiToken: z.string().min(1),
  pendingToken: z.string().min(1) // Token from social OAuth flow
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { atiToken, pendingToken } = completeSignupSchema.parse(body)

    // Verify that the pending profile came from a completed OAuth callback.
    let pendingData
    try {
      pendingData = verifySocialSignupToken(pendingToken)
    } catch {
      return NextResponse.json(
        { code: 'INVALID_PENDING_TOKEN', message: 'Invalid or expired registration token' },
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

    // If this token is backed by a named member invite, signup is locked to
    // the invited email address
    const inviteLock = await validateInviteEmailLock(tokenValidation.atiToken!.id, pendingData.email)
    if (!inviteLock.ok) {
      return NextResponse.json(
        { code: 'INVITE_EMAIL_MISMATCH', message: inviteLock.error },
        { status: 400 }
      )
    }

    // Determine user role under the token's governance kind
    const tokenKind: ATIKind = (fullToken?.kind as ATIKind) || 'STANDARD'
    let userRole = 'ANALYST'
    let roleReason = tokenKind !== 'STANDARD' ? 'managed_kind_default' : 'default'

    const resolvedRole = resolveAssignedRole(tokenKind, fullToken?.assignedRole)
    if (resolvedRole.role) {
      userRole = resolvedRole.role
      roleReason = resolvedRole.clamped ? 'ati_token_role_clamped_by_kind' : 'ati_token_explicit_role'
    }

    // Create user with social OAuth data
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tenant-signup:${tenant.id}`}))`
      await claimATITokenUse(tx, tokenValidation.atiToken!.id)

      await ensureTenantEntitlementForSignup({
        tenantId: tenant.id,
        atiTokenId: tokenValidation.atiToken!.id,
        planTier: fullToken?.planTier || tokenValidation.atiToken!.planTier || null
      }, tx)

      const transactionExistingUsersCount = await tx.user.count({
        where: { tenantId: tenant.id }
      })
      // Only self-administered (STANDARD) tenants promote their first user to OWNER
      const promoteToOwner =
        transactionExistingUsersCount === 0 && shouldPromoteFirstUserToOwner(tokenKind)
      const assignedUserRole = promoteToOwner ? 'OWNER' : userRole
      const assignedRoleReason = promoteToOwner ? 'first_tenant_user' : roleReason

      // EVENT signups get a hard access expiry
      const accessExpiresAt = computeAccessExpiresAt(
        {
          kind: tokenKind,
          memberAccessHours: fullToken?.memberAccessHours ?? null,
          accessEndsAt: fullToken?.accessEndsAt ?? null
        },
        new Date()
      )

      const user = await tx.user.create({
        data: {
          email: pendingData.email,
          name: pendingData.name || `${pendingData.firstName || ''} ${pendingData.lastName || ''}`.trim(),
          firstName: pendingData.firstName,
          lastName: pendingData.lastName,
          tenantId: tenant.id,
          signupAtiTokenId: tokenValidation.atiToken!.id,
          roles: [assignedUserRole as any],
          status: 'ACTIVE',
          emailVerified: true, // Social logins are verified
          oauthProvider: pendingData.provider.toUpperCase() as any,
          oauthProviderId: pendingData.providerId,
          oauthProfile: pendingData.profile,
          accessExpiresAt
        }
      })

      // If this signup redeemed a named member invite, mark it accepted
      await markInviteAccepted(tx, tokenValidation.atiToken!.id, user.id)

      // Create default project
      await tx.project.create({
        data: {
          name: 'Default Project',
          userId: user.id,
          tenantId: tenant.id,
        }
      })

      await assignSignupTeam(tx, user.id, tenant.id, fullToken?.assignedTeamId)

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
            assigned_role_reason: assignedRoleReason,
            signup_method: 'social_oauth_with_ati',
            oauth_provider: pendingData.provider,
            ati_token_fingerprint: tokenValidation.atiToken!.fingerprint,
            is_first_tenant_user: transactionExistingUsersCount === 0
          }
        }
      })

      return user
    })

    const user = result

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

    if (error instanceof ATIRedemptionError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
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

