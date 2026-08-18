import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computeServiceRunCosts } from '@/lib/admin-usage-service'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  tenantId: z.string(),
  userId: z.string().optional(),
  service: z.enum(['FUNDING_INTELLIGENCE', 'GRANT_REVIEW', 'FUNDING_CHAT']).optional(),
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
      service: getParam('service'),
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

    const allRuns = await computeServiceRunCosts(
      parsed.tenantId,
      startDate,
      endDate,
      parsed.userId
    )

    const runs = parsed.service ? allRuns.filter(run => run.service === parsed.service) : allRuns

    // Calculate totals
    const totals = runs.reduce((acc, run) => ({
      totalInputTokens: acc.totalInputTokens + run.totalInputTokens,
      totalOutputTokens: acc.totalOutputTokens + run.totalOutputTokens,
      totalApiCalls: acc.totalApiCalls + run.totalApiCalls,
      actualCost: acc.actualCost + run.actualCost,
      contingencyCost: acc.contingencyCost + run.contingencyCost,
      runCount: acc.runCount + 1
    }), {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      actualCost: 0,
      contingencyCost: 0,
      runCount: 0
    })

    // Per-service rollup so a tenant's bill can be read by product line
    const byService = runs.reduce<Record<string, { runCount: number; actualCost: number; contingencyCost: number }>>(
      (acc, run) => {
        const bucket = acc[run.service] || { runCount: 0, actualCost: 0, contingencyCost: 0 }
        bucket.runCount += 1
        bucket.actualCost += run.actualCost
        bucket.contingencyCost += run.contingencyCost
        acc[run.service] = bucket
        return acc
      },
      {}
    )

    return NextResponse.json({
      startDate,
      endDate,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      totals,
      byService,
      runs
    })
  } catch (error) {
    console.error('Service run costs API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
