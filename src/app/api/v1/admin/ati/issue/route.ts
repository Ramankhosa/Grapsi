import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'
import { generateATIToken, hashATIToken, createATIFingerprint, createAuditLog, encryptToken } from '@/lib/auth'

const issueSchema = z.object({
  expires_at: z.string().optional(), // ISO date string
  max_uses: z.number().optional(),
  notes: z.string().optional(),
  // New: Explicit role and team assignment for granular control
  assigned_role: z.enum(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']).optional(),
  assigned_team_id: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    // Authenticate and check role
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const user = authResult.user!
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    const body = await request.json()
    const { expires_at, max_uses, notes, assigned_role, assigned_team_id } = issueSchema.parse(body)

    // Get the tenant admin's signup ATI token to inherit the plan tier
    const tenantAdmin = await prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        signupAtiTokenId: true,
        tenant: {
          select: { id: true, name: true }
        }
      }
    })

    if (!tenantAdmin?.signupAtiTokenId) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Tenant admin must have been created via ATI token' },
        { status: 403 }
      )
    }

    // Get the plan tier from the original ATI token used for signup
    const signupToken = await prisma.aTIToken.findUnique({
      where: { id: tenantAdmin.signupAtiTokenId },
      select: { planTier: true }
    })

    if (!signupToken) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Signup ATI token not found' },
        { status: 404 }
      )
    }

    // Use the plan tier from the signup token (inherited from super admin)
    const planTier = signupToken.planTier

    // Generate token
    const rawToken = generateATIToken()
    const tokenHash = hashATIToken(rawToken)
    const fingerprint = createATIFingerprint(tokenHash)

    // Check if user belongs to a tenant
    if (!user.tenant_id) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'You must belong to a tenant to issue ATI tokens' },
        { status: 403 }
      )
    }
    
    // Store encrypted raw token for potential revelation (expires in 30 days)
    const encryptedRawToken = encryptToken(rawToken)
    const rawTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Validate assigned_team_id if provided
    if (assigned_team_id) {
      const team = await prisma.team.findUnique({
        where: { id: assigned_team_id },
        select: { tenantId: true, isActive: true }
      })
      
      if (!team || team.tenantId !== user.tenant_id || !team.isActive) {
        return NextResponse.json(
          { code: 'INVALID_TEAM', message: 'Invalid or inactive team specified' },
          { status: 400 }
        )
      }
    }

    // Create ATI token record
    const atiToken = await prisma.aTIToken.create({
      data: {
        tenantId: user.tenant_id,
        tokenHash,
        rawToken: encryptedRawToken,
        rawTokenExpiry,
        fingerprint,
        expiresAt: expires_at ? new Date(expires_at) : null,
        maxUses: max_uses,
        planTier: planTier, // Use tenant's active plan tier
        notes,
        // New: Explicit role and team assignment
        assignedRole: assigned_role as any || null,
        assignedTeamId: assigned_team_id || null
      }
    })

    // Audit log
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: user.sub,
      tenantId: user.tenant_id,
      action: 'ATI_ISSUE',
      resource: `ati_token:${atiToken.id}`,
      ip,
      meta: {
        fingerprint: atiToken.fingerprint,
        expiresAt: atiToken.expiresAt,
        maxUses: atiToken.maxUses,
        planTier: atiToken.planTier,
        assignedRole: atiToken.assignedRole,
        assignedTeamId: atiToken.assignedTeamId
      }
    })

    // Return token display-once (WARNING: this is the only time the raw token is shown)
    return NextResponse.json({
      token_display_once: rawToken,
      fingerprint: atiToken.fingerprint,
      token_id: atiToken.id,
      assigned_role: atiToken.assignedRole,
      assigned_team_id: atiToken.assignedTeamId,
      warning: "This token will not be shown again. Copy it now and store securely."
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('ATI issue error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
