import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computePatentCosts } from '@/lib/admin-usage-service'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  tenantId: z.string(),
  userId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
})

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Verify token via whoami
    const whoamiResponse = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    )

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()

    const userRoles: string[] = Array.isArray(userData.roles) ? userData.roles : []
    const isSuperAdmin = userRoles.some((r: string) => r === 'SUPER_ADMIN' || r === 'SUPER_ADMIN_VIEWER')
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const getParam = (key: string) => {
      const value = searchParams.get(key)
      return value === null ? undefined : value
    }

    const parsed = QuerySchema.parse({
      tenantId: getParam('tenantId'),
      userId: getParam('userId'),
      startDate: getParam('startDate'),
      endDate: getParam('endDate')
    })

    if (!parsed.tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    // Validate and parse dates with error handling
    let endDate: Date
    let startDate: Date
    
    try {
      endDate = parsed.endDate ? new Date(parsed.endDate) : new Date()
      if (isNaN(endDate.getTime())) {
        return NextResponse.json({ error: 'Invalid endDate format' }, { status: 400 })
      }
      
      startDate = parsed.startDate ? new Date(parsed.startDate) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      if (isNaN(startDate.getTime())) {
        return NextResponse.json({ error: 'Invalid startDate format' }, { status: 400 })
      }
      
      // Ensure startDate is before endDate
      if (startDate > endDate) {
        return NextResponse.json({ error: 'startDate must be before endDate' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }

    const patentCosts = await computePatentCosts(
      parsed.tenantId,
      startDate,
      endDate,
      parsed.userId
    )

    // Calculate totals
    const totals = patentCosts.reduce((acc, p) => ({
      totalInputTokens: acc.totalInputTokens + p.totalInputTokens,
      totalOutputTokens: acc.totalOutputTokens + p.totalOutputTokens,
      totalApiCalls: acc.totalApiCalls + p.totalApiCalls,
      actualCost: acc.actualCost + p.actualCost,
      contingencyCost: acc.contingencyCost + p.contingencyCost,
      patentCount: acc.patentCount + 1
    }), {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      actualCost: 0,
      contingencyCost: 0,
      patentCount: 0
    })

    return NextResponse.json({
      startDate,
      endDate,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      totals,
      patents: patentCosts
    })
  } catch (error) {
    console.error('Patent costs API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

