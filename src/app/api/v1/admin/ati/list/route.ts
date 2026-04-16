import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, requireTenantRole } from '@/lib/middleware'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Authenticate and check role
    const authResult = await authenticateRequest(request)
    if (authResult.error) return authResult.error

    const user = authResult.user!
    const roleCheck = await requireTenantRole(['OWNER', 'ADMIN'])(request)
    if (roleCheck) return roleCheck

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as any
    const expBefore = searchParams.get('exp_before')
    const expAfter = searchParams.get('exp_after')
    const planTier = searchParams.get('plan_tier')

    // Build where clause
    const where: any = {
      tenantId: user.tenant_id
    }

    if (status) {
      where.status = status
    }

    if (expBefore || expAfter) {
      where.expiresAt = {}
      if (expBefore) where.expiresAt.lt = new Date(expBefore)
      if (expAfter) where.expiresAt.gt = new Date(expAfter)
    }

    if (planTier) {
      where.planTier = planTier
    }

    // Get ATI tokens
    const tokens = await prisma.aTIToken.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fingerprint: true,
        status: true,
        expiresAt: true,
        maxUses: true,
        usageCount: true,
        planTier: true,
        notes: true,
        createdAt: true,
        updatedAt: true
      }
    })

    // Mask sensitive info and format response
    const maskedTokens = tokens.map(token => ({
      id: token.id,
      fingerprint: token.fingerprint,
      status: token.status,
      expires_at: token.expiresAt?.toISOString(),
      max_uses: token.maxUses,
      usage_count: token.usageCount,
      plan_tier: token.planTier,
      notes: token.notes,
      created_at: token.createdAt.toISOString(),
      updated_at: token.updatedAt.toISOString()
    }))

    return NextResponse.json(maskedTokens, { status: 200 })

  } catch (error) {
    console.error('ATI list error:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
