import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requirePlatformScope, authenticateRequest } from '@/lib/middleware'
import { createAuditLog, generateATIToken, hashATIToken, createATIFingerprint, encryptToken, verifyJWT } from '@/lib/auth'

const createTenantSchema = z.object({
  name: z.string().min(1),
  atiId: z.string().min(1).regex(/^[A-Z0-9]+$/, 'ATI ID must be uppercase alphanumeric'),
  generateInitialToken: z.boolean().optional().default(true),
  initialTokenConfig: z.object({
    expires_at: z.string().optional(),
    max_uses: z.number().optional(),
    plan_tier: z.string().optional(),
    notes: z.string().optional()
  }).optional()
})

export async function POST(request: NextRequest) {
  try {
    // Check platform scope access
    const scopeCheck = await requirePlatformScope()(request)
    if (scopeCheck) return scopeCheck

    // Get authenticated user for audit logging
    const { user: authUser } = await authenticateRequest(request)

    const body = await request.json()
    const { name, atiId, generateInitialToken, initialTokenConfig } = createTenantSchema.parse(body)

    // Check if ATI ID is unique
    const existingTenant = await prisma.tenant.findUnique({
      where: { atiId }
    })

    if (existingTenant) {
      return NextResponse.json(
        { code: 'ATI_ID_EXISTS', message: 'ATI ID already exists' },
        { status: 400 }
      )
    }

    // Create tenant
    const tenant = await prisma.tenant.create({
      data: {
        name,
        atiId
      }
    })

    let initialToken = null

    let rawTokenForDisplay = null

    // Generate initial ATI token if requested
    if (generateInitialToken) {
      rawTokenForDisplay = generateATIToken()
      const tokenHash = hashATIToken(rawTokenForDisplay)
      const fingerprint = createATIFingerprint(tokenHash)

      // Store encrypted raw token for potential revelation (expires in 30 days)
      const encryptedRawToken = encryptToken(rawTokenForDisplay)
      const rawTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

      initialToken = await prisma.aTIToken.create({
        data: {
          tenantId: tenant.id,
          tokenHash,
          rawToken: encryptedRawToken,
          rawTokenExpiry,
          fingerprint,
          expiresAt: initialTokenConfig?.expires_at ? new Date(initialTokenConfig.expires_at) : null,
          maxUses: initialTokenConfig?.max_uses,
          planTier: initialTokenConfig?.plan_tier,
          notes: initialTokenConfig?.notes || 'Initial tenant onboarding token'
        }
      })

      // Audit log for token creation
      await createAuditLog({
        actorUserId: authUser!.sub,
        tenantId: tenant.id,
        action: 'ATI_ISSUE',
        resource: `ati_token:${initialToken.id}`,
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        meta: {
          fingerprint: initialToken.fingerprint,
          isInitialToken: true,
          expiresAt: initialToken.expiresAt,
          maxUses: initialToken.maxUses,
          planTier: initialToken.planTier
        }
      })
    }

    // Audit log for tenant creation
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown'

    await createAuditLog({
      actorUserId: authUser!.sub,
      action: 'TENANT_CREATE',
      resource: `tenant:${tenant.id}`,
      ip,
      meta: {
        tenantName: tenant.name,
        atiId: tenant.atiId,
        initialTokenGenerated: !!initialToken
      }
    })

    const response: any = {
      id: tenant.id,
      name: tenant.name,
      ati_id: tenant.atiId,
      status: tenant.status,
      created_at: tenant.createdAt.toISOString()
    }

    // Include initial token info if generated
    if (initialToken && rawTokenForDisplay) {
      response.initial_token = {
        id: initialToken.id,
        fingerprint: initialToken.fingerprint,
        token_display_once: rawTokenForDisplay,
        expires_at: initialToken.expiresAt?.toISOString(),
        max_uses: initialToken.maxUses,
        plan_tier: initialToken.planTier,
        notes: initialToken.notes,
        warning: "This is the initial tenant token - copy it now for onboarding users! It will never be shown again."
      }
    }

    return NextResponse.json(response, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 'INVALID_INPUT', message: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Tenant create error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    // Custom authentication for compatibility with dashboard
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Verify JWT directly (same as whoami endpoint)
    const payload = verifyJWT(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 })
    }

    // Check if user is super admin or super admin viewer
    if (!payload.roles?.some((role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')) {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
    }

    // Get all tenants (exclude platform tenant)
    const tenants = await prisma.tenant.findMany({
      where: {
        atiId: {
          not: 'PLATFORM' // Exclude platform administration tenant
        }
      },
      include: {
        _count: {
          select: {
            users: true,
            atiTokens: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const tenantList = tenants.map(tenant => ({
      id: tenant.id,
      name: tenant.name,
      ati_id: tenant.atiId,
      status: tenant.status,
      user_count: tenant._count.users,
      ati_token_count: tenant._count.atiTokens,
      created_at: tenant.createdAt.toISOString()
    }))

    return NextResponse.json(tenantList, { status: 200 })

  } catch (error) {
    console.error('Tenant list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
