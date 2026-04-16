import { prisma } from './prisma'
import { calculateCost, CONTINGENCY_MULTIPLIER, ensurePricingLoaded } from './metering/cost-calculator'

export interface TenantUsageMetrics {
  tenantId: string | null
  tenantName: string | null
  tenantType: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  patentDrafts: number
  noveltySearches: number
  ideasReserved: number
}

export interface GlobalUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  totalPatentsDrafted: number
  totalNoveltySearches: number
  totalIdeasReserved: number
}

export interface UsageSummaryResult {
  startDate: Date
  endDate: Date
  global: GlobalUsageSummary
  tenants: TenantUsageMetrics[]
}

/**
 * Calculate cost for a usage log using centralized cost-calculator
 * This ensures consistent pricing with terminal logs and other cost calculations
 * 
 * @param log - Usage log with token counts and model class
 * @returns Cost in USD
 */
function calculateCostForLog(
  log: { inputTokens: number | null; outputTokens: number | null; modelClass: string | null }
): number {
  const inputTokens = log.inputTokens ?? 0
  const outputTokens = log.outputTokens ?? 0

  // Use the centralized cost-calculator which reads from LLMModel table (llm-config)
  // This ensures consistent pricing across terminal logs and admin reports
  if (log.modelClass) {
    const costBreakdown = calculateCost(log.modelClass, inputTokens, outputTokens)
    return costBreakdown.actualCost
  }

  // Fallback for logs without model class (shouldn't happen normally)
  // Uses DEFAULT_PRICING from cost-calculator.ts ($1/$4 per million)
  const inputCost = inputTokens * 0.000001
  const outputCost = outputTokens * 0.000004
  return inputCost + outputCost
}

export async function computeUsageSummary(
  startDate: Date,
  endDate: Date,
  tenantFilterId?: string
): Promise<UsageSummaryResult> {
  const normalizedStart = new Date(startDate)
  const normalizedEnd = new Date(endDate)
  normalizedStart.setHours(0, 0, 0, 0)
  normalizedEnd.setHours(23, 59, 59, 999)

  const dateRange = {
    gte: normalizedStart,
    lte: normalizedEnd
  }

  const usageWhere: any = {
    startedAt: dateRange,
    status: 'COMPLETED'
  }

  if (tenantFilterId) {
    usageWhere.tenantId = tenantFilterId
  }

  // Ensure pricing is loaded from database before calculating costs
  await ensurePricingLoaded()

  const [usageLogs, draftsByTenant, noveltyRuns, reservations] = await Promise.all([
    prisma.usageLog.findMany({
      where: usageWhere,
      select: {
        tenantId: true,
        inputTokens: true,
        outputTokens: true,
        apiCalls: true,
        modelClass: true
      }
    }),
    prisma.draftingSession.groupBy({
      by: ['tenantId'],
      where: {
        createdAt: dateRange,
        ...(tenantFilterId ? { tenantId: tenantFilterId } : {})
      },
      _count: { _all: true }
    }),
    prisma.noveltySearchRun.findMany({
      where: {
        createdAt: dateRange,
        status: 'COMPLETED'
      },
      select: {
        user: {
          select: { tenantId: true }
        }
      }
    }),
    prisma.ideaBankReservation.findMany({
      where: {
        reservedAt: dateRange
      },
      select: {
        user: {
          select: { tenantId: true }
        }
      }
    })
  ])

  const tenantMap = new Map<
    string,
    {
      totalInputTokens: number
      totalOutputTokens: number
      totalApiCalls: number
      totalCost: number
      patentDrafts: number
      noveltySearches: number
      ideasReserved: number
    }
  >()

  const global: GlobalUsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    totalCost: 0,
    totalPatentsDrafted: 0,
    totalNoveltySearches: 0,
    totalIdeasReserved: 0
  }

  // Token + cost aggregation from usage logs
  for (const log of usageLogs) {
    const tId = log.tenantId || 'no-tenant'
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!

    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = log.outputTokens ?? 0
    const calls = log.apiCalls ?? 0
    const cost = calculateCostForLog(log)

    bucket.totalInputTokens += input
    bucket.totalOutputTokens += output
    bucket.totalApiCalls += calls
    bucket.totalCost += cost

    global.totalInputTokens += input
    global.totalOutputTokens += output
    global.totalApiCalls += calls
    global.totalCost += cost
  }

  // Drafting sessions per tenant (patent drafts)
  for (const row of draftsByTenant) {
    const tId = row.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.patentDrafts += row._count._all
    global.totalPatentsDrafted += row._count._all
  }

  // Novelty searches per tenant (via user.tenantId)
  for (const run of noveltyRuns) {
    const tId = run.user?.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.noveltySearches += 1
    global.totalNoveltySearches += 1
  }

  // Idea reservations per tenant (via user.tenantId)
  for (const res of reservations) {
    const tId = res.user?.tenantId || 'no-tenant'
    if (tenantFilterId && tId !== tenantFilterId) continue
    if (!tenantMap.has(tId)) {
      tenantMap.set(tId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        totalCost: 0,
        patentDrafts: 0,
        noveltySearches: 0,
        ideasReserved: 0
      })
    }
    const bucket = tenantMap.get(tId)!
    bucket.ideasReserved += 1
    global.totalIdeasReserved += 1
  }

  const tenantIds = Array.from(tenantMap.keys()).filter(id => id !== 'no-tenant')
  const tenantRecords = tenantIds.length
    ? await prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true, type: true }
      })
    : []

  const tenantMeta = new Map<string, { name: string | null; type: string | null }>()
  for (const t of tenantRecords) {
    tenantMeta.set(t.id, { name: t.name, type: t.type })
  }

  const tenants: TenantUsageMetrics[] = Array.from(tenantMap.entries()).map(([id, metrics]) => {
    const meta = tenantMeta.get(id)
    const isNoTenant = id === 'no-tenant'
    return {
      tenantId: isNoTenant ? null : id,
      tenantName: isNoTenant ? 'No tenant' : (meta?.name ?? 'Unknown tenant'),
      tenantType: isNoTenant ? null : (meta?.type ?? null),
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      totalApiCalls: metrics.totalApiCalls,
      totalCost: metrics.totalCost,
      patentDrafts: metrics.patentDrafts,
      noveltySearches: metrics.noveltySearches,
      ideasReserved: metrics.ideasReserved
    }
  })

  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
    global,
    tenants
  }
}

// ============================================================================
// USER-WISE COST TRACKING
// ============================================================================

export interface UserCostMetrics {
  userId: string
  userName: string | null
  userEmail: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number  // 10% buffer
  patentDrafts: number
  noveltySearches: number
}

export async function computeUserCostsByTenant(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<UserCostMetrics[]> {
  const normalizedStart = new Date(startDate)
  const normalizedEnd = new Date(endDate)
  normalizedStart.setHours(0, 0, 0, 0)
  normalizedEnd.setHours(23, 59, 59, 999)

  // Get all usage logs for this tenant with user info
  const usageLogs = await prisma.usageLog.findMany({
    where: {
      tenantId,
      startedAt: {
        gte: normalizedStart,
        lte: normalizedEnd
      },
      status: 'COMPLETED'
    },
    select: {
      userId: true,
      inputTokens: true,
      outputTokens: true,
      apiCalls: true,
      modelClass: true,
      meta: true
    }
  })

  // Get drafting sessions per user
  const draftingSessions = await prisma.draftingSession.findMany({
    where: {
      tenantId,
      createdAt: {
        gte: normalizedStart,
        lte: normalizedEnd
      }
    },
    select: {
      userId: true
    }
  })

  // Get novelty searches per user
  const noveltyRuns = await prisma.noveltySearchRun.findMany({
    where: {
      user: { tenantId },
      createdAt: {
        gte: normalizedStart,
        lte: normalizedEnd
      },
      status: 'COMPLETED'
    },
    select: {
      userId: true
    }
  })

  // Aggregate by user
  const userMap = new Map<string, {
    totalInputTokens: number
    totalOutputTokens: number
    totalApiCalls: number
    actualCost: number
    patentDrafts: number
    noveltySearches: number
  }>()

  for (const log of usageLogs) {
    const userId = log.userId || 'unknown'
    if (!userMap.has(userId)) {
      userMap.set(userId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        patentDrafts: 0,
        noveltySearches: 0
      })
    }
    const bucket = userMap.get(userId)!

    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = log.outputTokens ?? 0
    const calls = log.apiCalls ?? 0

    bucket.totalInputTokens += input
    bucket.totalOutputTokens += output
    bucket.totalApiCalls += calls

    // Calculate cost using our cost calculator
    if (log.modelClass) {
      const costBreakdown = calculateCost(log.modelClass, input, output)
      bucket.actualCost += costBreakdown.actualCost
    } else {
      // Fallback pricing: matches DEFAULT_PRICING in cost-calculator.ts ($1/$4 per million)
      bucket.actualCost += (input * 0.000001) + (output * 0.000004)
    }
  }

  // Add drafting session counts
  for (const session of draftingSessions) {
    if (!userMap.has(session.userId)) {
      userMap.set(session.userId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        patentDrafts: 0,
        noveltySearches: 0
      })
    }
    userMap.get(session.userId)!.patentDrafts += 1
  }

  // Add novelty search counts
  for (const run of noveltyRuns) {
    if (!userMap.has(run.userId)) {
      userMap.set(run.userId, {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        patentDrafts: 0,
        noveltySearches: 0
      })
    }
    userMap.get(run.userId)!.noveltySearches += 1
  }

  // Get user metadata
  const userIds = Array.from(userMap.keys()).filter(id => id !== 'unknown')
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true }
  }) : []

  const userMeta = new Map<string, { name: string | null; email: string }>()
  for (const u of users) {
    userMeta.set(u.id, { name: u.name, email: u.email })
  }

  return Array.from(userMap.entries()).map(([userId, metrics]) => {
    const meta = userMeta.get(userId)
    return {
      userId,
      userName: meta?.name ?? null,
      userEmail: meta?.email ?? 'unknown@unknown.com',
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      totalApiCalls: metrics.totalApiCalls,
      actualCost: metrics.actualCost,
      contingencyCost: metrics.actualCost * CONTINGENCY_MULTIPLIER,
      patentDrafts: metrics.patentDrafts,
      noveltySearches: metrics.noveltySearches
    }
  })
}

// ============================================================================
// PATENT-WISE COST TRACKING
// ============================================================================

export interface PatentCostMetrics {
  patentId: string
  patentTitle: string
  userId: string
  userName: string | null
  userEmail: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number  // 10% buffer
  createdAt: Date
  // Cost breakdown by stage/operation
  stageBreakdown: {
    stage: string
    inputTokens: number
    outputTokens: number
    actualCost: number
    contingencyCost: number
    callCount: number
  }[]
}

export async function computePatentCosts(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<PatentCostMetrics[]> {
  const normalizedStart = new Date(startDate)
  const normalizedEnd = new Date(endDate)
  normalizedStart.setHours(0, 0, 0, 0)
  normalizedEnd.setHours(23, 59, 59, 999)

  // Get drafting sessions with patent info
  const sessionWhere: any = {
    tenantId,
    createdAt: {
      gte: normalizedStart,
      lte: normalizedEnd
    }
  }
  if (userId) {
    sessionWhere.userId = userId
  }

  const sessions = await prisma.draftingSession.findMany({
    where: sessionWhere,
    select: {
      id: true,
      patentId: true,
      userId: true,
      createdAt: true,
      patent: {
        select: {
          id: true,
          title: true
        }
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  })

  // Get usage logs that have patent IDs in their metadata
  const usageLogs = await prisma.usageLog.findMany({
    where: {
      tenantId,
      startedAt: {
        gte: normalizedStart,
        lte: normalizedEnd
      },
      status: 'COMPLETED',
      ...(userId ? { userId } : {})
    },
    select: {
      inputTokens: true,
      outputTokens: true,
      apiCalls: true,
      modelClass: true,
      taskCode: true,
      meta: true
    }
  })

  // Map sessions to metrics
  const patentMap = new Map<string, PatentCostMetrics>()

  // Initialize patents from sessions
  for (const session of sessions) {
    if (!patentMap.has(session.patentId)) {
      patentMap.set(session.patentId, {
        patentId: session.patentId,
        patentTitle: session.patent?.title || 'Untitled Patent',
        userId: session.userId,
        userName: session.user?.name ?? null,
        userEmail: session.user?.email || 'unknown@unknown.com',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        contingencyCost: 0,
        createdAt: session.createdAt,
        stageBreakdown: []
      })
    }
  }

  // Process usage logs and associate with patents
  for (const log of usageLogs) {
    const meta = log.meta as any
    const patentId = meta?.patentId
    
    if (!patentId || !patentMap.has(patentId)) continue

    const metrics = patentMap.get(patentId)!
    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = log.outputTokens ?? 0
    const calls = log.apiCalls ?? 1

    metrics.totalInputTokens += input
    metrics.totalOutputTokens += output
    metrics.totalApiCalls += calls

    // Calculate cost
    let actualCost = 0
    if (log.modelClass) {
      const costBreakdown = calculateCost(log.modelClass, input, output)
      actualCost = costBreakdown.actualCost
    } else {
      // Fallback pricing: matches DEFAULT_PRICING in cost-calculator.ts ($1/$4 per million)
      actualCost = (input * 0.000001) + (output * 0.000004)
    }
    metrics.actualCost += actualCost

    // Track stage breakdown
    const stageCode = meta?.stageCode || log.taskCode || 'OTHER'
    let stageEntry = metrics.stageBreakdown.find(s => s.stage === stageCode)
    if (!stageEntry) {
      stageEntry = {
        stage: stageCode,
        inputTokens: 0,
        outputTokens: 0,
        actualCost: 0,
        contingencyCost: 0,
        callCount: 0
      }
      metrics.stageBreakdown.push(stageEntry)
    }
    stageEntry.inputTokens += input
    stageEntry.outputTokens += output
    stageEntry.actualCost += actualCost
    stageEntry.callCount += calls
  }

  // Calculate contingency costs
  Array.from(patentMap.values()).forEach(metrics => {
    metrics.contingencyCost = metrics.actualCost * CONTINGENCY_MULTIPLIER
    for (const stage of metrics.stageBreakdown) {
      stage.contingencyCost = stage.actualCost * CONTINGENCY_MULTIPLIER
    }
  })

  return Array.from(patentMap.values()).sort((a, b) => 
    b.createdAt.getTime() - a.createdAt.getTime()
  )
}
