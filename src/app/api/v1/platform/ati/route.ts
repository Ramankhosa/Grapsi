import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requirePlatformScope } from '@/lib/middleware'
import { createATIFingerprint, createAuditLog, encryptToken, generateATIToken, hashATIToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const createTokenSchema = z.object({
  tenant_id: z.string().min(1),
  expires_at: z.string().datetime().optional(),
  max_uses: z.number().int().min(1).optional(),
  plan_tier: z.string().optional(),
  notes: z.string().optional(),
  assigned_role: z.enum(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']).optional(),
  assigned_team_id: z.string().optional(),
  // Governance kind: STANDARD (self-administered), MANAGED (platform-run),
  // EVENT (MANAGED + time-boxed member access for workshops/demos)
  kind: z.enum(['STANDARD', 'MANAGED', 'EVENT']).default('STANDARD'),
  member_access_hours: z.number().int().min(1).max(8760).optional(),
  access_ends_at: z.string().datetime().optional(),
  event_label: z.string().max(200).optional()
})

export async function POST(request: NextRequest) {
  try {
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    const { user: authUser } = await authenticateRequest(request)
    const body = createTokenSchema.parse(await request.json())

    const tenant = await prisma.tenant.findUnique({
      where: { id: body.tenant_id },
      select: { id: true, atiId: true, status: true }
    })

    if (!tenant || tenant.status !== 'ACTIVE' || tenant.atiId === 'PLATFORM') {
      return NextResponse.json(
        { code: 'INVALID_TENANT', message: 'Select an active customer tenant' },
        { status: 400 }
      )
    }

    if (body.kind !== 'EVENT' && (body.member_access_hours || body.access_ends_at || body.event_label)) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'member_access_hours, access_ends_at and event_label only apply to EVENT tokens' },
        { status: 400 }
      )
    }

    if (body.kind === 'EVENT' && body.access_ends_at && new Date(body.access_ends_at) <= new Date()) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'access_ends_at must be in the future' },
        { status: 400 }
      )
    }

    // MANAGED/EVENT members never get admin-capable roles; STANDARD tokens
    // assign service roles only (VIEWER is reserved for managed groups)
    if (body.kind !== 'STANDARD' && body.assigned_role && !['ANALYST', 'VIEWER'].includes(body.assigned_role)) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: `${body.kind} tokens can only assign ANALYST or VIEWER roles` },
        { status: 400 }
      )
    }
    if (body.kind === 'STANDARD' && body.assigned_role === 'VIEWER') {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'STANDARD tokens can only assign ADMIN, MANAGER or ANALYST roles' },
        { status: 400 }
      )
    }

    if (body.assigned_team_id) {
      const team = await prisma.team.findFirst({
        where: { id: body.assigned_team_id, tenantId: tenant.id, isActive: true },
        select: { id: true }
      })

      if (!team) {
        return NextResponse.json(
          { code: 'INVALID_TEAM', message: 'Assigned team must be active and belong to the selected tenant' },
          { status: 400 }
        )
      }
    }

    const rawToken = generateATIToken()
    const tokenHash = hashATIToken(rawToken)
    const fingerprint = createATIFingerprint(tokenHash)
    const token = await prisma.aTIToken.create({
      data: {
        tenantId: tenant.id,
        tokenHash,
        rawToken: encryptToken(rawToken),
        rawTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        fingerprint,
        expiresAt: body.expires_at ? new Date(body.expires_at) : null,
        maxUses: body.max_uses,
        planTier: body.plan_tier,
        notes: body.notes,
        assignedRole: body.assigned_role || null,
        assignedTeamId: body.assigned_team_id || null,
        kind: body.kind,
        memberAccessHours: body.kind === 'EVENT' ? body.member_access_hours || null : null,
        accessEndsAt: body.kind === 'EVENT' && body.access_ends_at ? new Date(body.access_ends_at) : null,
        eventLabel: body.kind === 'EVENT' ? body.event_label || null : null
      }
    })

    await createAuditLog({
      actorUserId: authUser!.sub,
      tenantId: tenant.id,
      action: 'ATI_ISSUE',
      resource: `ati_token:${token.id}`,
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      meta: {
        fingerprint,
        expiresAt: token.expiresAt,
        maxUses: token.maxUses,
        assignedRole: token.assignedRole,
        assignedTeamId: token.assignedTeamId,
        kind: token.kind,
        eventLabel: token.eventLabel,
        issuedByPlatform: true
      }
    })

    const siteUrl = process.env.SITE_URL || process.env.NEXTAUTH_URL || ''
    return NextResponse.json({
      token_id: token.id,
      token_display_once: rawToken,
      fingerprint,
      assigned_role: token.assignedRole,
      assigned_team_id: token.assignedTeamId,
      kind: token.kind,
      event_label: token.eventLabel,
      invite_link: `${siteUrl}/register?invite=${encodeURIComponent(rawToken)}`,
      warning: 'Copy this token now and store it securely.'
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Super Admin ATI issue error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check platform scope access
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as any
    const tenantId = searchParams.get('tenant_id')
    const expBefore = searchParams.get('exp_before')
    const expAfter = searchParams.get('exp_after')
    const planTier = searchParams.get('plan_tier')

    // Build where clause
    const where: any = {}

    if (status) {
      where.status = status
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    if (expBefore || expAfter) {
      where.expiresAt = {}
      if (expBefore) where.expiresAt.lt = new Date(expBefore)
      if (expAfter) where.expiresAt.gt = new Date(expAfter)
    }

    if (planTier) {
      where.planTier = planTier
    }

    // Get ATI tokens with tenant info
    const tokens = await prisma.aTIToken.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            atiId: true
          }
        }
      }
    })

    // Format response
    const formattedTokens = tokens.map(token => ({
      id: token.id,
      fingerprint: token.fingerprint,
      status: token.status,
      expires_at: token.expiresAt?.toISOString(),
      max_uses: token.maxUses,
      usage_count: token.usageCount,
      plan_tier: token.planTier,
      notes: token.notes,
      assigned_role: token.assignedRole,
      assigned_team_id: token.assignedTeamId,
      kind: token.kind,
      member_access_hours: token.memberAccessHours,
      access_ends_at: token.accessEndsAt?.toISOString() || null,
      event_label: token.eventLabel,
      created_at: token.createdAt.toISOString(),
      updated_at: token.updatedAt.toISOString(),
      ...(token.tenant && {
        tenant: {
          id: token.tenant.id,
          name: token.tenant.name,
          ati_id: token.tenant.atiId
        }
      })
    }))

    return NextResponse.json(formattedTokens, { status: 200 })

  } catch (error) {
    console.error('Super Admin ATI list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
