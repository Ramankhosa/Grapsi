import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword, validateATIToken } from '@/lib/auth'
import { generateToken, hashToken } from '@/lib/token-utils'
import { sendEmail } from '@/lib/mailer'
import { verificationTemplate } from '@/lib/email-templates'
import { validateInviteToken, recordSignupInTransaction } from '@/lib/trial-invite-service'
import { assignTrialPlanToTenant } from '@/lib/trial-plan-service'
import { ATIRedemptionError, assignSignupTeam, claimATITokenUse } from '@/lib/ati-redemption-service'
import { ensureTenantEntitlementForSignup } from '@/lib/entitlement-service'

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  atiToken: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  isTrialInvite: z.boolean().optional() // Flag for trial invite tokens
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, atiToken, firstName, lastName, isTrialInvite } = signupSchema.parse(body)

    // Check if email is already in use globally
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json(
        { code: 'EMAIL_IN_USE', message: 'Email address is already registered' },
        { status: 400 }
      )
    }

    // Check if this is a trial invite token (email-locked)
    let trialInvite = null
    if (isTrialInvite) {
      const inviteValidation = await validateInviteToken(atiToken, email)
      if (!inviteValidation.valid) {
        return NextResponse.json(
          { code: 'INVALID_INVITE', message: inviteValidation.error || 'Invalid trial invite' },
          { status: 400 }
        )
      }
      trialInvite = inviteValidation.invite
    }

    // Validate ATI token by finding the tenant it belongs to
    // For trial invites, we use the campaign's trial ATI or create a trial tenant
    const tokenValidation = trialInvite 
      ? await getTrialTokenValidation(trialInvite)
      : await validateATIToken(atiToken)

    // Get full token with tenant info for scope checking
    let fullToken = null
    if (tokenValidation.valid && tokenValidation.atiToken) {
      fullToken = await prisma.aTIToken.findUnique({
        where: { id: tokenValidation.atiToken.id },
        include: { tenant: true }
      })
    }

    if (!tokenValidation.valid) {
      return NextResponse.json(
        { code: 'ATI_TOKEN_INVALID', message: 'ATI token validation failed' },
        { status: 400 }
      )
    }

    // Determine scope of the token
    const isPlatformToken = fullToken?.tenant?.atiId === 'PLATFORM'

    // Platform tokens can only be used for super admin creation (not regular signup)
    if (isPlatformToken) {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Platform ATI tokens cannot be used for regular user signup' },
        { status: 400 }
      )
    }

    // Get the tenant that owns this token
    const tenant = await prisma.tenant.findUnique({
      where: { id: tokenValidation.atiToken!.tenantId! } // All tokens now have tenantId
    })

    if (!tenant) {
      return NextResponse.json(
        { code: 'INVALID_ATI_TOKEN', message: 'Tenant not found for ATI token' },
        { status: 400 }
      )
    }

    if (tenant.status !== 'ACTIVE') {
      return NextResponse.json(
        { code: 'TENANT_INACTIVE', message: 'Tenant is not active' },
        { status: 400 }
      )
    }

    // Determine role based on context
    // Priority for non-first users: 1. Explicit assignedRole on token,
    // 2. Token creator logic, 3. Default ANALYST. The first user is promoted
    // to OWNER inside the transaction after taking a tenant-level lock.
    let userRole = 'ANALYST' // Default role
    let tokenCreator = null
    let roleReason = 'default'

    if (fullToken?.assignedRole) {
      // Explicit role set on the ATI token (highest priority for non-first users)
      // Only service-capable roles are honored for ATI signups.
      const explicitRole = fullToken.assignedRole
      if (!['ADMIN', 'MANAGER', 'ANALYST'].includes(explicitRole)) {
        console.warn('ATI token has invalid assignedRole:', explicitRole)
        // Fall through to default logic
      } else {
        userRole = explicitRole
        roleReason = 'ati_token_explicit_role'
        console.log('Using explicit assignedRole from ATI token:', userRole)
      }
    } else {
      // Legacy logic: check if this token was created by super admin (platform scope)
      // or by tenant admin
      tokenCreator = await prisma.auditLog.findFirst({
        where: {
          resource: `ati_token:${tokenValidation.atiToken!.id}`,
          action: 'ATI_ISSUE'
        },
        orderBy: { createdAt: 'desc' }
      })

      // If token was created by super admin (platform scope), assign ADMIN role
      // Otherwise, use the default ANALYST role (can be changed later by tenant admin)
      if (tokenCreator && tokenCreator.actorUserId) {
        const creatorUser = await prisma.user.findUnique({
          where: { id: tokenCreator.actorUserId },
          select: {
            roles: true,
            tenantId: true,
            tenant: {
              select: { atiId: true }
            }
          }
        })

        console.log('Token creator details:', {
          creatorId: tokenCreator.actorUserId,
          creatorRoles: creatorUser?.roles,
          creatorTenantId: creatorUser?.tenantId,
          creatorTenantAtiId: creatorUser?.tenant?.atiId
        })

        // If creator is super admin or belongs to platform tenant, assign ADMIN
        if (creatorUser?.roles?.includes('SUPER_ADMIN') || creatorUser?.tenant?.atiId === 'PLATFORM') {
          userRole = 'ADMIN'
          roleReason = 'super_admin_token_creator'
          console.log('Assigned ADMIN role due to super admin token creator')
        } else {
          roleReason = 'tenant_admin_token_creator'
          console.log('Keeping ANALYST role for tenant-admin-created token')
        }
      } else {
        roleReason = 'no_token_creator_found'
        console.log('No token creator found, keeping ANALYST role')
      }
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Use a transaction to ensure atomicity - either everything succeeds or nothing does
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tenant-signup:${tenant.id}`}))`

      // Claim token capacity before creating records. This guarded update prevents
      // concurrent signups from exceeding maxUses.
      await claimATITokenUse(tx, tokenValidation.atiToken!.id)

      await ensureTenantEntitlementForSignup({
        tenantId: tenant.id,
        atiTokenId: tokenValidation.atiToken!.id,
        planTier: fullToken?.planTier || tokenValidation.atiToken!.planTier || null
      }, tx)

      const transactionExistingUsersCount = await tx.user.count({
        where: { tenantId: tenant.id }
      })
      const assignedUserRole = transactionExistingUsersCount === 0 ? 'OWNER' : userRole
      const assignedRoleReason = transactionExistingUsersCount === 0 ? 'first_tenant_user' : roleReason

      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          tenantId: tenant.id,
          signupAtiTokenId: tokenValidation.atiToken!.id, // Track which ATI token was used
          roles: [assignedUserRole as any],
          status: 'ACTIVE',
          emailVerified: true,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`
        }
      })

      // Create default project for the user
      const defaultProjectName = 'Default Project'
      const defaultProject = await tx.project.create({
        data: {
          name: defaultProjectName,
          userId: user.id,
          tenantId: tenant.id,
        }
      })

      await assignSignupTeam(tx, user.id, tenant.id, fullToken?.assignedTeamId)

      if (trialInvite) {
        await recordSignupInTransaction(tx, atiToken, user.id)
      }

      // Audit log within transaction
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
            signup_method: 'ati_token',
            ati_token_fingerprint: tokenValidation.atiToken!.fingerprint,
            ati_token_creator: tokenCreator?.actorUserId || null,
            ati_explicit_role: fullToken?.assignedRole || null,
            ati_assigned_team: fullToken?.assignedTeamId || null,
            is_first_tenant_user: transactionExistingUsersCount === 0
          }
        }
      })

      return user
    })

    const user = result

    // Email verification disabled by default; enable with ENFORCE_EMAIL_VERIFICATION=true
    if (process.env.ENFORCE_EMAIL_VERIFICATION === 'true') {
      try {
        const raw = generateToken()
        const tokenHash = hashToken(raw)
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
        await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash, expiresAt } })
        const tpl = verificationTemplate(user.email, user.name, raw)
        await sendEmail({ to: user.email, toName: user.name || undefined, subject: tpl.subject, html: tpl.html, text: tpl.text })
      } catch (e) {
        console.warn('Failed to send verification email:', e)
      }
    }

    return NextResponse.json({
      user_id: user.id,
      tenant_id: tenant.id,
      roles: user.roles,
      is_trial: !!trialInvite
    }, { status: 201 })

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

    console.error('Signup error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Get token validation for trial invites
 * Uses the campaign's trial ATI token or creates a pseudo-validation for trial tenant
 */
async function getTrialTokenValidation(trialInvite: any) {
  // If campaign has a specific trial ATI token, use it
  if (trialInvite.campaign.trialAtiTokenId) {
    const atiToken = await prisma.aTIToken.findUnique({
      where: { id: trialInvite.campaign.trialAtiTokenId },
      include: { tenant: true }
    })
    if (atiToken) {
      return {
        valid: true,
        atiToken: {
          id: atiToken.id,
          tenantId: atiToken.tenantId,
          fingerprint: atiToken.fingerprint,
          planTier: atiToken.planTier
        }
      }
    }
  }

  // Otherwise, use a trial tenant (create if needed)
  let trialTenant = await prisma.tenant.findFirst({
    where: { atiId: 'TRIAL' }
  })

  if (!trialTenant) {
    // Create trial tenant
    trialTenant = await prisma.tenant.create({
      data: {
        name: 'Trial Users',
        atiId: 'TRIAL',
        type: 'INDIVIDUAL',
        status: 'ACTIVE'
      }
    })
  }

  // Ensure trial tenant has TRIAL plan assigned
  try {
    await assignTrialPlanToTenant(trialTenant.id)
  } catch (e) {
    console.warn('Failed to assign trial plan:', e)
  }

  // Get or create a default trial ATI token
  let trialAtiToken = await prisma.aTIToken.findFirst({
    where: { 
      tenantId: trialTenant.id,
      fingerprint: 'TRIAL_DEFAULT',
      status: { in: ['ACTIVE', 'ISSUED'] }
    }
  })

  if (!trialAtiToken) {
    const crypto = await import('crypto')
    // Use tenant ID in hash to ensure uniqueness per tenant
    const tokenHash = crypto.createHash('sha256')
      .update(`TRIAL_DEFAULT_${trialTenant.id}_${Date.now()}`)
      .digest('hex')
    
    try {
      trialAtiToken = await prisma.aTIToken.create({
        data: {
          tenantId: trialTenant.id,
          tokenHash,
          fingerprint: 'TRIAL_DEFAULT',
          status: 'ACTIVE',
          planTier: 'TRIAL', // Use TRIAL tier instead of BASIC
          notes: 'Default trial token for trial invites'
        }
      })
    } catch (error: any) {
      // Handle race condition - token might have been created by another request
      if (error.code === 'P2002') {
        trialAtiToken = await prisma.aTIToken.findFirst({
          where: { 
            tenantId: trialTenant.id,
            fingerprint: 'TRIAL_DEFAULT',
            status: { in: ['ACTIVE', 'ISSUED'] }
          }
        })
      }
      if (!trialAtiToken) {
        throw error
      }
    }
  }

  return {
    valid: true,
    atiToken: {
      id: trialAtiToken.id,
      tenantId: trialAtiToken.tenantId,
      fingerprint: trialAtiToken.fingerprint,
      planTier: trialAtiToken.planTier
    }
  }
}

