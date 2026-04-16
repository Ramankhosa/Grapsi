import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword, validateATIToken, incrementATITokenUsage, createAuditLog } from '@/lib/auth'
import { generateToken, hashToken } from '@/lib/token-utils'
import { sendEmail } from '@/lib/mailer'
import { verificationTemplate } from '@/lib/email-templates'
import { autoAssignToDefaultTeam } from '@/lib/org-access-service'
import { validateInviteToken, recordSignup } from '@/lib/trial-invite-service'
import { assignTrialPlanToTenant } from '@/lib/trial-plan-service'

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

    // Check if this is the first user for this tenant
    const existingUsersCount = await prisma.user.count({
      where: { tenantId: tenant.id }
    })

    // Validate tenant user limit based on original tenant creation token
    if (existingUsersCount > 0) {
      // Find the original tenant admin user (first user) and their signup token
      const tenantAdmin = await prisma.user.findFirst({
        where: {
          tenantId: tenant.id,
          roles: { hasSome: ['OWNER', 'ADMIN'] } // Find tenant admin
        },
        select: {
          id: true,
          signupAtiTokenId: true
        },
        orderBy: { createdAt: 'asc' } // Get the first admin user
      })

      console.log('Tenant user limit validation:', {
        tenantId: tenant.id,
        existingUsersCount,
        tenantAdminFound: !!tenantAdmin,
        tenantAdminSignupTokenId: tenantAdmin?.signupAtiTokenId
      })

      if (tenantAdmin?.signupAtiTokenId) {
        // Get the original token used to create the tenant admin
        const originalToken = await prisma.aTIToken.findUnique({
          where: { id: tenantAdmin.signupAtiTokenId }
        })

        console.log('Original token check:', {
          tokenId: tenantAdmin.signupAtiTokenId,
          tokenFound: !!originalToken,
          tokenMaxUses: originalToken?.maxUses,
          wouldExceedLimit: originalToken?.maxUses ? existingUsersCount >= originalToken.maxUses : false
        })

        // Check if adding this user would exceed the tenant's user limit
        // existingUsersCount is the current count before adding this user
        // So we reject if current count >= maxUses (meaning tenant is already at limit)
        // Note: if maxUses is null/undefined, it means unlimited users allowed
        if (originalToken?.maxUses && existingUsersCount >= originalToken.maxUses) {
          return NextResponse.json(
            {
              code: 'TENANT_USER_LIMIT_EXCEEDED',
              message: `Tenant has reached its maximum user limit of ${originalToken.maxUses} users.`,
              current_users: existingUsersCount,
              max_users: originalToken.maxUses
            },
            { status: 400 }
          )
        }
      } else {
        console.log('No tenant admin with signup token found - allowing signup (unlimited)')
      }
    }

    // Determine role based on context
    // Priority: 1. First user = OWNER, 2. Explicit assignedRole on token, 3. Token creator logic, 4. Default ANALYST
    let userRole = 'ANALYST' // Default role
    let tokenCreator = null
    let roleReason = 'default'

    if (existingUsersCount === 0) {
      // First user for this tenant - make them OWNER (cannot be overridden)
      userRole = 'OWNER'
      roleReason = 'first_tenant_user'
    } else if (fullToken?.assignedRole) {
      // Explicit role set on the ATI token (highest priority for non-first users)
      // Validate the role is not SUPER_ADMIN or SUPER_ADMIN_VIEWER
      const explicitRole = fullToken.assignedRole
      if (['SUPER_ADMIN', 'SUPER_ADMIN_VIEWER'].includes(explicitRole)) {
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
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          tenantId: tenant.id,
          signupAtiTokenId: tokenValidation.atiToken!.id, // Track which ATI token was used
          roles: [userRole as any],
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

      // Get current token state for status update logic
      const currentToken = await tx.aTIToken.findUnique({
        where: { id: tokenValidation.atiToken!.id }
      })

      // Increment ATI token usage atomically
      await tx.aTIToken.update({
        where: { id: tokenValidation.atiToken!.id },
        data: {
          usageCount: { increment: 1 },
          // Update status if usage limit reached
          ...(currentToken && currentToken.maxUses && currentToken.usageCount + 1 >= currentToken.maxUses
            ? { status: 'USED_UP' }
            : {})
        }
      })

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
            assigned_role_reason: roleReason,
            signup_method: 'ati_token',
            ati_token_fingerprint: tokenValidation.atiToken!.fingerprint,
            ati_token_creator: tokenCreator?.actorUserId || null,
            ati_explicit_role: fullToken?.assignedRole || null,
            ati_assigned_team: fullToken?.assignedTeamId || null,
            is_first_tenant_user: existingUsersCount === 0
          }
        }
      })

      return user
    })

    const user = result
    
    // Auto-assign to team (outside transaction for flexibility)
    // Priority: 1. Explicit team from ATI token, 2. Default team
    try {
      await autoAssignToDefaultTeam(
        user.id,
        tenant.id,
        fullToken?.assignedTeamId || undefined
      )
      console.log('User auto-assigned to team:', fullToken?.assignedTeamId || 'default')
    } catch (teamError) {
      // Non-fatal - log but don't fail signup
      console.warn('Failed to auto-assign user to team:', teamError)
    }

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

    // Record trial invite signup if applicable
    if (trialInvite) {
      try {
        await recordSignup(atiToken, user.id)
        console.log('Trial signup recorded for invite:', trialInvite.id)
      } catch (trialError) {
        console.warn('Failed to record trial signup:', trialError)
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

