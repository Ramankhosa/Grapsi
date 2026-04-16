// Analytics API for LLM usage data
// Supports both Super Admin (tenant-wise) and Tenant Admin (user-wise) views

import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering for API routes that use headers
export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const AnalyticsQuerySchema = z.object({
  // Time range
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),

  // Entity filters
  tenantId: z.string().optional(), // For super admin to filter specific tenant
  userId: z.string().optional(),   // For tenant admin to filter specific user

  // Service filters
  featureCode: z.string().optional(),
  taskCode: z.string().optional(),
  modelClass: z.string().optional(),
  apiCode: z.string().optional(),

  // Grouping
  groupBy: z.enum(['tenant', 'user', 'feature', 'task', 'model', 'provider']).default('user'),
})

type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>

interface UsageMetrics {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  apiCalls: number
  cost: number
  requests: number
}

interface AnalyticsData {
  summary: UsageMetrics
  breakdown: Array<{
    entity: string
    metrics: UsageMetrics
    percentage: number
  }>
  trends: Array<{
    period: string
    metrics: UsageMetrics
  }>
  topUsers: Array<{
    userId: string
    userName: string
    metrics: UsageMetrics
  }>
}

export async function GET(request: NextRequest) {
  try {
    // Custom authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)

    // Verify token by calling whoami endpoint
    const whoamiResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/v1/auth/whoami`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    if (!whoamiResponse.ok) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userData = await whoamiResponse.json()

    const { searchParams } = new URL(request.url)

    // Helper function to convert null to undefined for optional fields
    const getParam = (key: string) => {
      const value = searchParams.get(key)
      return value === null ? undefined : value
    }

    const query = AnalyticsQuerySchema.parse({
      startDate: getParam('startDate'),
      endDate: getParam('endDate'),
      period: getParam('period') || 'monthly',
      tenantId: getParam('tenantId'),
      userId: getParam('userId'),
      featureCode: getParam('featureCode'),
      taskCode: getParam('taskCode'),
      modelClass: getParam('modelClass'),
      apiCode: getParam('apiCode'),
      groupBy: getParam('groupBy') || 'user',
    })

    // Determine access level
    const user = await prisma.user.findUnique({
      where: { email: userData.email },
      include: { tenant: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isSuperAdmin = user.roles?.some((role: string) => role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN_VIEWER')
    const isTenantAdmin = user.roles?.includes('ADMIN')

    if (!isSuperAdmin && !isTenantAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Build date range
    const endDate = query.endDate ? new Date(query.endDate) : new Date()
    const startDate = query.startDate ? new Date(query.startDate) : getStartDate(query.period, endDate)

    // Build where clause based on user role and query filters
    const whereClause = buildWhereClause(user, query, isSuperAdmin, startDate, endDate)

    // Get usage data
    const usageLogs = await prisma.usageLog.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } }
      },
      orderBy: { startedAt: 'desc' }
    })

    // Load dynamic model pricing (if configured)
    const modelPrices = await prisma.lLMModelPrice.findMany()
    const priceMap = new Map<string, { input: number; output: number }>()
    for (const p of modelPrices) {
      priceMap.set(p.modelClass, {
        input: p.inputPricePerMTokens,
        output: p.outputPricePerMTokens
      })
    }

    // Process data
    const analyticsData = processUsageData(usageLogs, query.groupBy, isSuperAdmin, priceMap)

    return NextResponse.json(analyticsData)

  } catch (error) {
    console.error('Analytics API error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query parameters', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function getStartDate(period: string, endDate: Date): Date {
  const start = new Date(endDate)

  switch (period) {
    case 'daily':
      start.setDate(start.getDate() - 30) // Last 30 days
      break
    case 'weekly':
      start.setDate(start.getDate() - 84) // Last 12 weeks
      break
    case 'monthly':
      start.setMonth(start.getMonth() - 12) // Last 12 months
      break
  }

  return start
}

function buildWhereClause(user: any, query: AnalyticsQuery, isSuperAdmin: boolean, startDate: Date, endDate: Date) {
  const where: any = {
    startedAt: {
      gte: startDate,
      lte: endDate
    },
    status: 'COMPLETED' // Only successful operations
  }

  // Role-based filtering
  if (isSuperAdmin) {
    // Super admin can see all tenants, or filter to specific tenant
    if (query.tenantId) {
      where.tenantId = query.tenantId
    }
    // No tenant restriction for super admin
  } else {
    // Tenant admin can only see their own tenant
    where.tenantId = user.tenantId
  }

  // Additional filters
  if (query.userId) {
    where.userId = query.userId
  }
  if (query.featureCode) {
    where.featureId = query.featureCode
  }
  if (query.taskCode) {
    where.taskCode = query.taskCode
  }
  if (query.modelClass) {
    where.modelClass = query.modelClass
  }
  if (query.apiCode) {
    where.apiCode = query.apiCode
  }

  return where
}

function processUsageData(
  usageLogs: any[],
  groupBy: string,
  isSuperAdmin: boolean,
  priceMap?: Map<string, { input: number; output: number }>
): AnalyticsData {
  // Calculate summary metrics
  const summary: UsageMetrics = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    apiCalls: usageLogs.length,
    cost: 0,
    requests: usageLogs.length
  }

  // Group data by entity
  const groupedData = new Map<string, {
    logs: any[]
    metrics: UsageMetrics
  }>()

  for (const log of usageLogs) {
    // Update summary
    summary.inputTokens += log.inputTokens || 0
    summary.outputTokens += log.outputTokens || 0
    summary.totalTokens += (log.inputTokens || 0) + (log.outputTokens || 0)
    summary.cost += calculateCost(log, priceMap)

    // Group by entity
    let entityKey: string
    let entityName: string

    switch (groupBy) {
      case 'tenant':
        entityKey = log.tenantId
        entityName = log.tenant.name
        break
      case 'user':
        entityKey = log.userId || 'unknown'
        entityName = log.user?.name || log.user?.email || 'Unknown User'
        break
      case 'feature':
        entityKey = log.featureId || 'unknown'
        entityName = log.featureId || 'Unknown Feature'
        break
      case 'task':
        entityKey = log.taskCode || 'unknown'
        entityName = log.taskCode || 'Unknown Task'
        break
      case 'model':
        entityKey = log.modelClass || 'unknown'
        entityName = log.modelClass || 'Unknown Model'
        break
      case 'provider':
        entityKey = log.apiCode || 'unknown'
        entityName = log.apiCode || 'Unknown Provider'
        break
      default:
        entityKey = 'all'
        entityName = 'All'
    }

    if (!groupedData.has(entityKey)) {
      groupedData.set(entityKey, {
        logs: [],
        metrics: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          apiCalls: 0,
          cost: 0,
          requests: 0
        }
      })
    }

    const group = groupedData.get(entityKey)!
    group.logs.push(log)
    group.metrics.inputTokens += log.inputTokens || 0
    group.metrics.outputTokens += log.outputTokens || 0
    group.metrics.totalTokens += (log.inputTokens || 0) + (log.outputTokens || 0)
    group.metrics.apiCalls += 1
    group.metrics.requests += 1
    group.metrics.cost += calculateCost(log, priceMap)
  }

  // Convert to breakdown array
  const breakdown = Array.from(groupedData.entries()).map(([entityKey, data]) => ({
    entity: entityKey,
    entityName: data.logs[0]?.tenant?.name || data.logs[0]?.user?.name || entityKey,
    metrics: data.metrics,
    percentage: summary.totalTokens > 0 ? (data.metrics.totalTokens / summary.totalTokens) * 100 : 0
  }))

  // Generate trends data (simplified - group by day/week/month)
  const trends = generateTrendsData(usageLogs, priceMap)

  // Get top users (only relevant for tenant admin view)
  const topUsers = isSuperAdmin ? [] : getTopUsers(usageLogs, priceMap)

  return {
    summary,
    breakdown: breakdown.sort((a, b) => b.metrics.totalTokens - a.metrics.totalTokens),
    trends,
    topUsers
  }
}

function calculateCost(
  log: any,
  priceMap?: Map<string, { input: number; output: number }>
): number {
  const inputTokens = log.inputTokens || 0
  const outputTokens = log.outputTokens || 0

  if (priceMap && log.modelClass && priceMap.has(log.modelClass)) {
    const price = priceMap.get(log.modelClass)!
    const inputCost = inputTokens * (price.input / 1_000_000)
    const outputCost = outputTokens * (price.output / 1_000_000)
    return inputCost + outputCost
  }

  // Fallback: static pricing if no dynamic config
  const inputCost = inputTokens * 0.000005 // $5 per million tokens
  const outputCost = outputTokens * 0.000015 // $15 per million tokens
  return inputCost + outputCost
}

function generateTrendsData(
  usageLogs: any[],
  priceMap?: Map<string, { input: number; output: number }>
): Array<{ period: string; metrics: UsageMetrics }> {
  const trends = new Map<string, UsageMetrics>()

  for (const log of usageLogs) {
    const date = log.startedAt.toISOString().split('T')[0] // YYYY-MM-DD
    const month = date.substring(0, 7) // YYYY-MM

    const period = month // Use monthly for simplicity

    if (!trends.has(period)) {
      trends.set(period, {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        apiCalls: 0,
        cost: 0,
        requests: 0
      })
    }

    const metrics = trends.get(period)!
    metrics.inputTokens += log.inputTokens || 0
    metrics.outputTokens += log.outputTokens || 0
    metrics.totalTokens += (log.inputTokens || 0) + (log.outputTokens || 0)
    metrics.apiCalls += 1
    metrics.requests += 1
    metrics.cost += calculateCost(log, priceMap)
  }

  return Array.from(trends.entries())
    .map(([period, metrics]) => ({ period, metrics }))
    .sort((a, b) => a.period.localeCompare(b.period))
}

function getTopUsers(
  usageLogs: any[],
  priceMap?: Map<string, { input: number; output: number }>
): Array<{ userId: string; userName: string; metrics: UsageMetrics }> {
  const userMetrics = new Map<string, { user: any, metrics: UsageMetrics }>()

  for (const log of usageLogs) {
    const userId = log.userId || 'unknown'
    const userName = log.user?.name || log.user?.email || 'Unknown User'

    if (!userMetrics.has(userId)) {
      userMetrics.set(userId, {
        user: { id: userId, name: userName },
        metrics: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          apiCalls: 0,
          cost: 0,
          requests: 0
        }
      })
    }

    const data = userMetrics.get(userId)!
    data.metrics.inputTokens += log.inputTokens || 0
    data.metrics.outputTokens += log.outputTokens || 0
    data.metrics.totalTokens += (log.inputTokens || 0) + (log.outputTokens || 0)
    data.metrics.apiCalls += 1
    data.metrics.requests += 1
    data.metrics.cost += calculateCost(log, priceMap)
  }

  return Array.from(userMetrics.values())
    .map(({ user, metrics }) => ({
      userId: user.id,
      userName: user.name,
      metrics
    }))
    .sort((a, b) => b.metrics.totalTokens - a.metrics.totalTokens)
    .slice(0, 10) // Top 10 users
}
