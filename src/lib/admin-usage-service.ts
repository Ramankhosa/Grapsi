import { prisma } from './prisma'
import { calculateCost, CONTINGENCY_MULTIPLIER, ensurePricingLoaded } from './metering/cost-calculator'
import { getStoredUsageLogActualCost } from './metering/llm-usage'
import {
  collectServiceUsage,
  emptyServiceUsageCounts,
  NO_TENANT_KEY,
  NO_USER_KEY,
  type ServiceUsageCounts,
} from './usage/service-usage-metrics'

export interface TenantUsageMetrics extends ServiceUsageCounts {
  tenantId: string | null
  tenantName: string | null
  tenantType: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
}

export interface GlobalUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
  totalFundingIntelligenceRuns: number
  totalReviewerRuns: number
  totalReviewerCalls: number
  totalChatSessions: number
  totalChatMessages: number
}

export interface UsageSummaryResult {
  startDate: Date
  endDate: Date
  global: GlobalUsageSummary
  tenants: TenantUsageMetrics[]
}

interface TokenBucket {
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCost: number
}

function emptyTokenBucket(): TokenBucket {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    totalCost: 0,
  }
}

/**
 * Calculate cost for a usage log using centralized cost-calculator
 * This ensures consistent pricing with terminal logs and other cost calculations
 *
 * @param log - Usage log with token counts and model class
 * @returns Cost in USD
 */
function calculateCostForLog(
  log: { inputTokens: number | null; outputTokens: number | null; modelClass: string | null; meta?: unknown }
): number {
  const inputTokens = log.inputTokens ?? 0
  const outputTokens = log.outputTokens ?? 0
  const storedCost = getStoredUsageLogActualCost(log.meta)
  if (storedCost !== null && (storedCost > 0 || (inputTokens === 0 && outputTokens === 0))) {
    return storedCost
  }

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

function normalizeDayBounds(startDate: Date, endDate: Date) {
  const normalizedStart = new Date(startDate)
  const normalizedEnd = new Date(endDate)
  normalizedStart.setHours(0, 0, 0, 0)
  normalizedEnd.setHours(23, 59, 59, 999)
  return { normalizedStart, normalizedEnd }
}

export async function computeUsageSummary(
  startDate: Date,
  endDate: Date,
  tenantFilterId?: string
): Promise<UsageSummaryResult> {
  const { normalizedStart, normalizedEnd } = normalizeDayBounds(startDate, endDate)
  const dateRange = { gte: normalizedStart, lte: normalizedEnd }

  const usageWhere: any = {
    startedAt: dateRange,
    status: 'COMPLETED'
  }

  if (tenantFilterId) {
    usageWhere.tenantId = tenantFilterId
  }

  // Ensure pricing is loaded from database before calculating costs
  await ensurePricingLoaded()

  const [usageLogs, serviceUsage] = await Promise.all([
    prisma.usageLog.findMany({
      where: usageWhere,
      select: {
        tenantId: true,
        inputTokens: true,
        outputTokens: true,
        apiCalls: true,
        modelClass: true,
        meta: true
      }
    }),
    collectServiceUsage(dateRange, tenantFilterId ? { tenantId: tenantFilterId } : {})
  ])

  const tokenByTenant = new Map<string, TokenBucket>()

  const global: GlobalUsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    totalCost: 0,
    totalFundingIntelligenceRuns: serviceUsage.totals.fundingIntelligenceRuns,
    totalReviewerRuns: serviceUsage.totals.reviewerRuns,
    totalReviewerCalls: serviceUsage.totals.reviewerCalls,
    totalChatSessions: serviceUsage.totals.chatSessions,
    totalChatMessages: serviceUsage.totals.chatMessages
  }

  // Token + cost aggregation from usage logs
  for (const log of usageLogs) {
    const tId = log.tenantId || NO_TENANT_KEY
    let bucket = tokenByTenant.get(tId)
    if (!bucket) {
      bucket = emptyTokenBucket()
      tokenByTenant.set(tId, bucket)
    }

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

  const tenantKeys = new Set<string>([...tokenByTenant.keys(), ...serviceUsage.byTenant.keys()])

  const tenantIds = Array.from(tenantKeys).filter(id => id !== NO_TENANT_KEY)
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

  const tenants: TenantUsageMetrics[] = Array.from(tenantKeys).map(id => {
    const meta = tenantMeta.get(id)
    const isNoTenant = id === NO_TENANT_KEY
    const tokens = tokenByTenant.get(id) ?? emptyTokenBucket()
    const counts = serviceUsage.byTenant.get(id) ?? emptyServiceUsageCounts()
    return {
      tenantId: isNoTenant ? null : id,
      tenantName: isNoTenant ? 'No tenant' : (meta?.name ?? 'Unknown tenant'),
      tenantType: isNoTenant ? null : (meta?.type ?? null),
      totalInputTokens: tokens.totalInputTokens,
      totalOutputTokens: tokens.totalOutputTokens,
      totalApiCalls: tokens.totalApiCalls,
      totalCost: tokens.totalCost,
      ...counts
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

export interface UserCostMetrics extends ServiceUsageCounts {
  userId: string
  userName: string | null
  userEmail: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number  // 10% buffer
}

export async function computeUserCostsByTenant(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<UserCostMetrics[]> {
  const { normalizedStart, normalizedEnd } = normalizeDayBounds(startDate, endDate)
  const dateRange = { gte: normalizedStart, lte: normalizedEnd }

  await ensurePricingLoaded()

  const [usageLogs, serviceUsage] = await Promise.all([
    // Get all usage logs for this tenant with user info
    prisma.usageLog.findMany({
      where: {
        tenantId,
        startedAt: dateRange,
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
    }),
    collectServiceUsage(dateRange, { tenantId })
  ])

  // Aggregate by user
  const tokenByUser = new Map<string, TokenBucket>()

  for (const log of usageLogs) {
    const userId = log.userId || NO_USER_KEY
    let bucket = tokenByUser.get(userId)
    if (!bucket) {
      bucket = emptyTokenBucket()
      tokenByUser.set(userId, bucket)
    }

    // Use ?? (nullish coalescing) to handle 0 as a valid value
    bucket.totalInputTokens += log.inputTokens ?? 0
    bucket.totalOutputTokens += log.outputTokens ?? 0
    bucket.totalApiCalls += log.apiCalls ?? 0
    bucket.totalCost += calculateCostForLog(log)
  }

  const userKeys = new Set<string>([...tokenByUser.keys(), ...serviceUsage.byUser.keys()])

  // Get user metadata
  const userIds = Array.from(userKeys).filter(id => id !== NO_USER_KEY)
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true }
  }) : []

  const userMeta = new Map<string, { name: string | null; email: string }>()
  for (const u of users) {
    userMeta.set(u.id, { name: u.name, email: u.email })
  }

  return Array.from(userKeys).map(userId => {
    const meta = userMeta.get(userId)
    const tokens = tokenByUser.get(userId) ?? emptyTokenBucket()
    const counts = serviceUsage.byUser.get(userId) ?? emptyServiceUsageCounts()
    return {
      userId,
      userName: meta?.name ?? null,
      userEmail: meta?.email ?? 'unknown@unknown.com',
      totalInputTokens: tokens.totalInputTokens,
      totalOutputTokens: tokens.totalOutputTokens,
      totalApiCalls: tokens.totalApiCalls,
      actualCost: tokens.totalCost,
      contingencyCost: tokens.totalCost * CONTINGENCY_MULTIPLIER,
      ...counts
    }
  })
}

// ============================================================================
// RUN-WISE COST TRACKING
// ============================================================================

export type BillableService = 'FUNDING_INTELLIGENCE' | 'GRANT_REVIEW' | 'FUNDING_CHAT'

export const BILLABLE_SERVICE_LABELS: Record<BillableService, string> = {
  FUNDING_INTELLIGENCE: 'Funding intelligence',
  GRANT_REVIEW: 'Reviewer',
  FUNDING_CHAT: 'Funding chat'
}

export interface ServiceRunStageBreakdown {
  stage: string
  inputTokens: number
  outputTokens: number
  actualCost: number
  contingencyCost: number
  callCount: number
}

export interface ServiceRunCostMetrics {
  /** Domain id of the run: idea-intelligence run, reviewer call, or chat conversation. */
  runId: string
  service: BillableService
  serviceLabel: string
  title: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  actualCost: number
  contingencyCost: number  // 10% buffer
  /** First LLM call seen for this run inside the window. */
  firstActivityAt: Date
  lastActivityAt: Date
  stageBreakdown: ServiceRunStageBreakdown[]
}

const UNATTRIBUTED_RUN_ID = 'unattributed'

/**
 * Work out which billable service an LLM call belongs to, and which domain run
 * inside that service. Reviewer calls share `GRANT_SECTION_GENERATE` with grant
 * drafting, so they are identified by their stage code instead.
 */
function classifyUsageLog(taskCode: string | null, meta: Record<string, any>): { service: BillableService; runId: string } | null {
  const stageCode = typeof meta.stageCode === 'string' ? meta.stageCode : ''

  if (stageCode.startsWith('GRANT_REVIEWER')) {
    return {
      service: 'GRANT_REVIEW',
      runId: typeof meta.reviewerCallId === 'string' ? meta.reviewerCallId : UNATTRIBUTED_RUN_ID
    }
  }

  if (taskCode === 'IDEA_INTELLIGENCE') {
    return {
      service: 'FUNDING_INTELLIGENCE',
      runId: typeof meta.runId === 'string' ? meta.runId : UNATTRIBUTED_RUN_ID
    }
  }

  if (taskCode === 'FUNDING_CHAT') {
    return {
      service: 'FUNDING_CHAT',
      runId: typeof meta.conversationId === 'string' ? meta.conversationId : UNATTRIBUTED_RUN_ID
    }
  }

  return null
}

async function loadRunTitles(
  service: BillableService,
  runIds: string[]
): Promise<Map<string, { title: string; userId: string | null }>> {
  const result = new Map<string, { title: string; userId: string | null }>()
  if (runIds.length === 0) return result

  if (service === 'FUNDING_INTELLIGENCE') {
    const runs = await prisma.ideaIntelligenceRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, title: true, userId: true }
    })
    for (const run of runs) {
      result.set(run.id, { title: run.title || 'Untitled analysis', userId: run.userId })
    }
    return result
  }

  if (service === 'GRANT_REVIEW') {
    const calls = await prisma.reviewerCall.findMany({
      where: { id: { in: runIds } },
      select: { id: true, project_title: true, user_id: true }
    })
    for (const call of calls) {
      result.set(call.id, { title: call.project_title || 'Untitled proposal', userId: call.user_id })
    }
    return result
  }

  const conversations = await prisma.recommendationConversation.findMany({
    where: { id: { in: runIds } },
    select: { id: true, title: true, user_id: true }
  })
  for (const conversation of conversations) {
    result.set(conversation.id, { title: conversation.title || 'Funding chat', userId: conversation.user_id })
  }
  return result
}

/**
 * Per-run LLM cost for the three billable services, so a tenant's bill can be
 * traced back to the analysis, review, or conversation that produced it.
 */
export async function computeServiceRunCosts(
  tenantId: string,
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<ServiceRunCostMetrics[]> {
  const { normalizedStart, normalizedEnd } = normalizeDayBounds(startDate, endDate)

  await ensurePricingLoaded()

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
      userId: true,
      startedAt: true,
      inputTokens: true,
      outputTokens: true,
      apiCalls: true,
      modelClass: true,
      taskCode: true,
      meta: true
    }
  })

  const runMap = new Map<string, ServiceRunCostMetrics>()

  for (const log of usageLogs) {
    const meta = (log.meta && typeof log.meta === 'object' ? log.meta : {}) as Record<string, any>
    const classification = classifyUsageLog(log.taskCode, meta)
    if (!classification) continue

    const key = `${classification.service}:${classification.runId}`
    let metrics = runMap.get(key)
    if (!metrics) {
      metrics = {
        runId: classification.runId,
        service: classification.service,
        serviceLabel: BILLABLE_SERVICE_LABELS[classification.service],
        title: classification.runId === UNATTRIBUTED_RUN_ID
          ? `${BILLABLE_SERVICE_LABELS[classification.service]} (unlinked calls)`
          : classification.runId,
        userId: log.userId,
        userName: null,
        userEmail: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalApiCalls: 0,
        actualCost: 0,
        contingencyCost: 0,
        firstActivityAt: log.startedAt,
        lastActivityAt: log.startedAt,
        stageBreakdown: []
      }
      runMap.set(key, metrics)
    }

    // Use ?? (nullish coalescing) to handle 0 as a valid value
    const input = log.inputTokens ?? 0
    const output = log.outputTokens ?? 0
    const calls = log.apiCalls ?? 1
    const actualCost = calculateCostForLog(log)

    metrics.totalInputTokens += input
    metrics.totalOutputTokens += output
    metrics.totalApiCalls += calls
    metrics.actualCost += actualCost
    if (log.startedAt < metrics.firstActivityAt) metrics.firstActivityAt = log.startedAt
    if (log.startedAt > metrics.lastActivityAt) metrics.lastActivityAt = log.startedAt

    const stageCode = meta.stageCode || meta.purpose || log.taskCode || 'OTHER'
    let stageEntry = metrics.stageBreakdown.find(s => s.stage === stageCode)
    if (!stageEntry) {
      stageEntry = {
        stage: String(stageCode),
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

  const runs = Array.from(runMap.values())

  // Resolve run titles and owners per service
  const services: BillableService[] = ['FUNDING_INTELLIGENCE', 'GRANT_REVIEW', 'FUNDING_CHAT']
  await Promise.all(services.map(async service => {
    const ids = runs
      .filter(run => run.service === service && run.runId !== UNATTRIBUTED_RUN_ID)
      .map(run => run.runId)
    if (ids.length === 0) return

    const titles = await loadRunTitles(service, Array.from(new Set(ids)))
    for (const run of runs) {
      if (run.service !== service) continue
      const info = titles.get(run.runId)
      if (info) {
        run.title = info.title
        run.userId = run.userId || info.userId
      }
    }
  }))

  // Attach user identity
  const userIds = Array.from(new Set(runs.map(run => run.userId).filter((id): id is string => Boolean(id))))
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true }
      })
    : []
  const userMap = new Map(users.map(u => [u.id, u]))

  for (const run of runs) {
    const user = run.userId ? userMap.get(run.userId) : undefined
    run.userName = user?.name ?? null
    run.userEmail = user?.email ?? null
    run.contingencyCost = run.actualCost * CONTINGENCY_MULTIPLIER
    for (const stage of run.stageBreakdown) {
      stage.contingencyCost = stage.actualCost * CONTINGENCY_MULTIPLIER
    }
  }

  return runs.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
}
