import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformScope } from '@/lib/middleware'

export const dynamic = 'force-dynamic'

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
