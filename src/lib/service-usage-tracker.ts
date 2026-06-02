/**
 * Unified Service Usage Tracker
 * 
 * Provides comprehensive tracking for all services with dual-quota support:
 * - Completion-based quotas (counts completed operations)
 * - Token-based quotas (prevents regeneration abuse)
 * 
 * Each service type has specific completion criteria:
 * - PATENT_DRAFTING: Both description + claims drafted
 * - NOVELTY_SEARCH: Search run completed with results
 * - PRIOR_ART_SEARCH: Search completed with results
 * - DIAGRAM_GENERATION: Diagram successfully generated
 * - SKETCH_GENERATION: Sketch successfully generated (future)
 * - IDEA_BANK: Idea reservation confirmed
 * - PERSONA_SYNC: Style learning completed
 */

import { prisma } from './prisma'
import type { ServiceType } from '@prisma/client'

// ============================================================================
// Types
// ============================================================================

export interface ServiceQuotaStatus {
  serviceType: ServiceType
  
  // Completion-based
  dailyCompletions: number
  monthlyCompletions: number
  dailyCompletionLimit: number | null
  monthlyCompletionLimit: number | null
  dailyCompletionsRemaining: number | null
  monthlyCompletionsRemaining: number | null
  
  // Token-based
  dailyTokens: number
  monthlyTokens: number
  dailyTokenLimit: number | null
  monthlyTokenLimit: number | null
  dailyTokensRemaining: number | null
  monthlyTokensRemaining: number | null
  
  // Cost tracking
  dailyCostUsd: number
  monthlyCostUsd: number
  
  // Status
  completionQuotaExceeded: boolean
  tokenQuotaExceeded: boolean
  anyQuotaExceeded: boolean
}

export interface TrackUsageParams {
  tenantId: string
  userId: string
  serviceType: ServiceType
  operationId: string
  operationType: string
  inputTokens?: number
  outputTokens?: number
  modelClass?: string
  isCompleted?: boolean
  metadata?: Record<string, any>
}

export interface QuotaCheckResult {
  allowed: boolean
  reason?: string
  quotaStatus: ServiceQuotaStatus
}

export class ServiceQuotaExceededError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ServiceQuotaExceededError'
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getCurrentPeriods() {
  const now = new Date()
  return {
    currentDay: now.toISOString().substring(0, 10),
    currentMonth: now.toISOString().substring(0, 7)
  }
}

/**
 * Calculate cost from tokens using model prices
 * Falls back to average pricing if modelClass not provided or not found
 */
async function calculateCost(
  inputTokens: number,
  outputTokens: number,
  modelClass?: string
): Promise<number> {
  if (inputTokens === 0 && outputTokens === 0) {
    return 0
  }
  
  let price = null
  
  // Try to find specific model price
  if (modelClass) {
    price = await prisma.lLMModelPrice.findFirst({
      where: { modelClass }
    })
  }
  
  // Fallback: use average of all configured prices
  if (!price) {
    const allPrices = await prisma.lLMModelPrice.findMany()
    if (allPrices.length > 0) {
      const avgInput = allPrices.reduce((sum, p) => sum + p.inputPricePerMTokens, 0) / allPrices.length
      const avgOutput = allPrices.reduce((sum, p) => sum + p.outputPricePerMTokens, 0) / allPrices.length
      price = { inputPricePerMTokens: avgInput, outputPricePerMTokens: avgOutput }
    }
  }
  
  if (!price) {
    // No prices configured at all - use conservative defaults ($1/1M input, $2/1M output)
    price = { inputPricePerMTokens: 1.0, outputPricePerMTokens: 2.0 }
  }
  
  // Prices are per million tokens
  const inputCost = (inputTokens / 1_000_000) * price.inputPricePerMTokens
  const outputCost = (outputTokens / 1_000_000) * price.outputPricePerMTokens
  
  return inputCost + outputCost
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get quota limits for a service from tenant's plan
 */
async function getPlanQuotaLimits(tenantId: string, serviceType: ServiceType, client: any = prisma): Promise<{
  dailyCompletionLimit: number | null
  monthlyCompletionLimit: number | null
  dailyTokenLimit: number | null
  monthlyTokenLimit: number | null
}> {
  const featureCodeMap: Record<ServiceType, string> = {
    PATENT_DRAFTING: 'PATENT_DRAFTING',
    NOVELTY_SEARCH: 'PRIOR_ART_SEARCH',
    PRIOR_ART_SEARCH: 'PRIOR_ART_SEARCH',
    IDEA_BANK: 'IDEA_BANK',
    PERSONA_SYNC: 'PERSONA_SYNC',
    DIAGRAM_GENERATION: 'DIAGRAM_GENERATION',
    PATENT_REVIEW: 'PATENT_DRAFTING', // review shares drafting quota feature
    IDEATION: 'IDEATION',
    FUNDING_DISCOVERY: 'FUNDING_DISCOVERY',
    GRANT_PREP: 'GRANT_PREP',
    GRANT_DRAFTING: 'GRANT_DRAFTING'
  }
  
  const tenantPlan = await client.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: new Date() },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    },
    include: {
      plan: {
        include: {
          planFeatures: {
            include: { feature: true }
          }
        }
      }
    }
  })
  
  if (!tenantPlan) {
    return {
      dailyCompletionLimit: null,
      monthlyCompletionLimit: null,
      dailyTokenLimit: null,
      monthlyTokenLimit: null
    }
  }
  
  const featureCode = featureCodeMap[serviceType]
  const planFeature = tenantPlan.plan.planFeatures?.find(
    (pf: any) => pf.feature.code === featureCode
  )
  
  if (!planFeature) {
    return {
      dailyCompletionLimit: null,
      monthlyCompletionLimit: null,
      dailyTokenLimit: null,
      monthlyTokenLimit: null
    }
  }
  
  return {
    dailyCompletionLimit: planFeature.dailyQuota,
    monthlyCompletionLimit: planFeature.monthlyQuota,
    dailyTokenLimit: (planFeature as any).dailyTokenLimit || null,
    monthlyTokenLimit: (planFeature as any).monthlyTokenLimit || null
  }
}

function getReservationWindowStart() {
  return new Date(Date.now() - 30 * 60 * 1000)
}

async function countReservedUsage(
  client: any,
  where: Record<string, unknown>,
  periodField: 'completionDate' | 'completionMonth',
  periodValue: string
) {
  return client.serviceCompletionUsage.count({
    where: {
      ...where,
      OR: [
        { isCompleted: true, [periodField]: periodValue },
        { isCompleted: false, createdAt: { gte: getReservationWindowStart() } }
      ]
    }
  })
}

export async function reserveServiceUsage(params: {
  tenantId: string
  userId: string
  serviceType: ServiceType
  operationId: string
  operationType: string
  metadata?: Record<string, any>
}) {
  const { currentDay, currentMonth } = getCurrentPeriods()

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`service-usage:${params.tenantId}:${params.serviceType}`}))`

    const existing = await tx.serviceCompletionUsage.findUnique({
      where: {
        tenantId_serviceType_operationId: {
          tenantId: params.tenantId,
          serviceType: params.serviceType,
          operationId: params.operationId
        }
      }
    })
    if (existing) return existing

    const userQuota = await tx.userServiceQuota.findUnique({
      where: {
        userId_serviceType: {
          userId: params.userId,
          serviceType: params.serviceType
        }
      }
    })

    if (userQuota) {
      if (!userQuota.isEnabled) {
        throw new ServiceQuotaExceededError('SERVICE_DISABLED', `${params.serviceType} is disabled for this user`)
      }

      const userWhere = { tenantId: params.tenantId, userId: params.userId, serviceType: params.serviceType }
      const [dailyUserUsage, monthlyUserUsage] = await Promise.all([
        countReservedUsage(tx, userWhere, 'completionDate', currentDay),
        countReservedUsage(tx, userWhere, 'completionMonth', currentMonth)
      ])
      if (userQuota.dailyQuota !== null && dailyUserUsage >= userQuota.dailyQuota) {
        throw new ServiceQuotaExceededError('DAILY_QUOTA_EXCEEDED', `User daily quota exceeded for ${params.serviceType}`)
      }
      if (userQuota.monthlyQuota !== null && monthlyUserUsage >= userQuota.monthlyQuota) {
        throw new ServiceQuotaExceededError('MONTHLY_QUOTA_EXCEEDED', `User monthly quota exceeded for ${params.serviceType}`)
      }
    } else {
      const memberships = await tx.teamMember.findMany({
        where: { userId: params.userId, team: { isActive: true } },
        include: {
          team: {
            include: {
              serviceAccess: { where: { serviceType: params.serviceType } }
            }
          }
        }
      })
      const configuredTeams = memberships.filter(membership => membership.team.serviceAccess.length > 0)

      if (configuredTeams.length > 0) {
        let allowedByTeam = false
        for (const membership of configuredTeams) {
          const teamAccess = membership.team.serviceAccess[0]
          if (!teamAccess.isEnabled) continue

          const members = await tx.teamMember.findMany({
            where: { teamId: membership.teamId },
            select: { userId: true }
          })
          const teamWhere = {
            tenantId: params.tenantId,
            userId: { in: members.map(member => member.userId) },
            serviceType: params.serviceType
          }
          const [dailyTeamUsage, monthlyTeamUsage] = await Promise.all([
            countReservedUsage(tx, teamWhere, 'completionDate', currentDay),
            countReservedUsage(tx, teamWhere, 'completionMonth', currentMonth)
          ])
          const withinDailyQuota = teamAccess.dailyQuota === null || dailyTeamUsage < teamAccess.dailyQuota
          const withinMonthlyQuota = teamAccess.monthlyQuota === null || monthlyTeamUsage < teamAccess.monthlyQuota
          if (withinDailyQuota && withinMonthlyQuota) {
            allowedByTeam = true
            break
          }
        }

        if (!allowedByTeam) {
          throw new ServiceQuotaExceededError('TEAM_QUOTA_EXCEEDED', `Team quota exceeded or service disabled for ${params.serviceType}`)
        }
      }
    }

    const limits = await getPlanQuotaLimits(params.tenantId, params.serviceType, tx)
    const baseWhere = { tenantId: params.tenantId, serviceType: params.serviceType }
    const [dailyUsage, monthlyUsage] = await Promise.all([
      countReservedUsage(tx, baseWhere, 'completionDate', currentDay),
      countReservedUsage(tx, baseWhere, 'completionMonth', currentMonth)
    ])

    if (limits.dailyCompletionLimit !== null && dailyUsage >= limits.dailyCompletionLimit) {
      throw new ServiceQuotaExceededError('DAILY_QUOTA_EXCEEDED', `Tenant daily quota exceeded for ${params.serviceType}`)
    }
    if (limits.monthlyCompletionLimit !== null && monthlyUsage >= limits.monthlyCompletionLimit) {
      throw new ServiceQuotaExceededError('MONTHLY_QUOTA_EXCEEDED', `Tenant monthly quota exceeded for ${params.serviceType}`)
    }

    return tx.serviceCompletionUsage.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        serviceType: params.serviceType,
        operationId: params.operationId,
        operationType: params.operationType,
        isCompleted: false,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : null
      }
    })
  })
}

export async function releaseReservedServiceUsage(
  tenantId: string,
  serviceType: ServiceType,
  operationId: string
) {
  await prisma.serviceCompletionUsage.deleteMany({
    where: { tenantId, serviceType, operationId, isCompleted: false }
  })
}

/**
 * Get current usage for a service
 */
export async function getServiceUsage(
  tenantId: string,
  serviceType: ServiceType
): Promise<ServiceQuotaStatus> {
  const { currentDay, currentMonth } = getCurrentPeriods()
  
  // Get completions count
  const [dailyCompletions, monthlyCompletions] = await Promise.all([
    prisma.serviceCompletionUsage.count({
      where: {
        tenantId,
        serviceType,
        isCompleted: true,
        completionDate: currentDay
      }
    }),
    prisma.serviceCompletionUsage.count({
      where: {
        tenantId,
        serviceType,
        isCompleted: true,
        completionMonth: currentMonth
      }
    })
  ])
  
  // Get token usage aggregates
  const [dailyTokenAgg, monthlyTokenAgg] = await Promise.all([
    prisma.serviceCompletionUsage.aggregate({
      where: {
        tenantId,
        serviceType,
        completionDate: currentDay
      },
      _sum: {
        totalTokensUsed: true,
        estimatedCostUsd: true
      }
    }),
    prisma.serviceCompletionUsage.aggregate({
      where: {
        tenantId,
        serviceType,
        completionMonth: currentMonth
      },
      _sum: {
        totalTokensUsed: true,
        estimatedCostUsd: true
      }
    })
  ])
  
  const dailyTokens = dailyTokenAgg._sum.totalTokensUsed || 0
  const monthlyTokens = monthlyTokenAgg._sum.totalTokensUsed || 0
  const dailyCostUsd = dailyTokenAgg._sum.estimatedCostUsd || 0
  const monthlyCostUsd = monthlyTokenAgg._sum.estimatedCostUsd || 0
  
  // Get quota limits
  const limits = await getPlanQuotaLimits(tenantId, serviceType)
  
  // Calculate remaining
  const dailyCompletionsRemaining = limits.dailyCompletionLimit !== null
    ? Math.max(0, limits.dailyCompletionLimit - dailyCompletions)
    : null
  const monthlyCompletionsRemaining = limits.monthlyCompletionLimit !== null
    ? Math.max(0, limits.monthlyCompletionLimit - monthlyCompletions)
    : null
  const dailyTokensRemaining = limits.dailyTokenLimit !== null
    ? Math.max(0, limits.dailyTokenLimit - dailyTokens)
    : null
  const monthlyTokensRemaining = limits.monthlyTokenLimit !== null
    ? Math.max(0, limits.monthlyTokenLimit - monthlyTokens)
    : null
  
  // Check if quotas exceeded
  const completionQuotaExceeded = 
    (limits.dailyCompletionLimit !== null && dailyCompletions >= limits.dailyCompletionLimit) ||
    (limits.monthlyCompletionLimit !== null && monthlyCompletions >= limits.monthlyCompletionLimit)
  
  const tokenQuotaExceeded =
    (limits.dailyTokenLimit !== null && dailyTokens >= limits.dailyTokenLimit) ||
    (limits.monthlyTokenLimit !== null && monthlyTokens >= limits.monthlyTokenLimit)
  
  return {
    serviceType,
    dailyCompletions,
    monthlyCompletions,
    dailyCompletionLimit: limits.dailyCompletionLimit,
    monthlyCompletionLimit: limits.monthlyCompletionLimit,
    dailyCompletionsRemaining,
    monthlyCompletionsRemaining,
    dailyTokens,
    monthlyTokens,
    dailyTokenLimit: limits.dailyTokenLimit,
    monthlyTokenLimit: limits.monthlyTokenLimit,
    dailyTokensRemaining,
    monthlyTokensRemaining,
    dailyCostUsd,
    monthlyCostUsd,
    completionQuotaExceeded,
    tokenQuotaExceeded,
    anyQuotaExceeded: completionQuotaExceeded || tokenQuotaExceeded
  }
}

/**
 * Check if a service operation is allowed (both completion and token quotas)
 */
export async function checkServiceQuota(
  tenantId: string,
  serviceType: ServiceType,
  operationId?: string
): Promise<QuotaCheckResult> {
  const quotaStatus = await getServiceUsage(tenantId, serviceType)
  
  // If operation already exists and is tracked, allow continuation
  if (operationId) {
    const existing = await prisma.serviceCompletionUsage.findUnique({
      where: {
        tenantId_serviceType_operationId: {
          tenantId,
          serviceType,
          operationId
        }
      }
    })
    
    if (existing) {
      // Allow continuing an existing operation
      return { allowed: true, quotaStatus }
    }
  }
  
  // Check completion quota
  if (quotaStatus.completionQuotaExceeded) {
    const isDaily = quotaStatus.dailyCompletionLimit !== null && 
      quotaStatus.dailyCompletions >= quotaStatus.dailyCompletionLimit
    
    return {
      allowed: false,
      reason: isDaily 
        ? `Tenant daily quota exceeded for ${serviceType}`
        : `Tenant monthly quota exceeded for ${serviceType}`,
      quotaStatus
    }
  }
  
  // Check token quota
  if (quotaStatus.tokenQuotaExceeded) {
    const isDaily = quotaStatus.dailyTokenLimit !== null &&
      quotaStatus.dailyTokens >= quotaStatus.dailyTokenLimit
    
    return {
      allowed: false,
      reason: isDaily
        ? `Tenant daily token limit exceeded for ${serviceType}`
        : `Tenant monthly token limit exceeded for ${serviceType}`,
      quotaStatus
    }
  }
  
  return { allowed: true, quotaStatus }
}

/**
 * Track usage for a service operation (tokens and/or completion)
 * Uses transaction for atomic updates to prevent race conditions
 */
export async function trackServiceUsage(params: TrackUsageParams): Promise<{
  tracked: boolean
  isNewCompletion: boolean
  quotaStatus: ServiceQuotaStatus
}> {
  const { currentDay, currentMonth } = getCurrentPeriods()
  const {
    tenantId,
    userId,
    serviceType,
    operationId,
    operationType,
    inputTokens = 0,
    outputTokens = 0,
    modelClass,
    isCompleted = false,
    metadata
  } = params
  
  const totalTokens = inputTokens + outputTokens
  const cost = await calculateCost(inputTokens, outputTokens, modelClass)
  
  // Use transaction for atomic read-modify-write to prevent race conditions
  const result = await prisma.$transaction(async (tx) => {
    // Check existing record
    const existing = await tx.serviceCompletionUsage.findUnique({
      where: {
        tenantId_serviceType_operationId: {
          tenantId,
          serviceType,
          operationId
        }
      }
    })
    
    const wasAlreadyCompleted = existing?.isCompleted ?? false
    
    await tx.serviceCompletionUsage.upsert({
      where: {
        tenantId_serviceType_operationId: {
          tenantId,
          serviceType,
          operationId
        }
      },
      create: {
        tenantId,
        userId,
        serviceType,
        operationId,
        operationType,
        isCompleted,
        completionDate: isCompleted ? currentDay : null,
        completionMonth: isCompleted ? currentMonth : null,
        completedAt: isCompleted ? new Date() : null,
        inputTokensUsed: inputTokens,
        outputTokensUsed: outputTokens,
        totalTokensUsed: totalTokens,
        estimatedCostUsd: cost,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null
      },
      update: {
        inputTokensUsed: { increment: inputTokens },
        outputTokensUsed: { increment: outputTokens },
        totalTokensUsed: { increment: totalTokens },
        estimatedCostUsd: { increment: cost },
        isCompleted: isCompleted || undefined,
        completionDate: isCompleted && !wasAlreadyCompleted ? currentDay : undefined,
        completionMonth: isCompleted && !wasAlreadyCompleted ? currentMonth : undefined,
        completedAt: isCompleted && !wasAlreadyCompleted ? new Date() : undefined,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined
      }
    })
    
    return { wasAlreadyCompleted }
  })
  
  const isNewCompletion = isCompleted && !result.wasAlreadyCompleted
  const quotaStatus = await getServiceUsage(tenantId, serviceType)
  
  if (isNewCompletion) {
    console.log(`[ServiceUsageTracker] Completion recorded: ${serviceType} - ${operationId} (tenant: ${tenantId})`)
  }
  
  return {
    tracked: true,
    isNewCompletion,
    quotaStatus
  }
}

/**
 * Get all service usage for a tenant (for dashboard)
 */
export async function getTenantServiceUsage(tenantId: string): Promise<ServiceQuotaStatus[]> {
  const serviceTypes: ServiceType[] = [
    'PATENT_DRAFTING',
    'NOVELTY_SEARCH',
    'PRIOR_ART_SEARCH',
    'DIAGRAM_GENERATION',
    'IDEA_BANK',
    'PERSONA_SYNC',
    'FUNDING_DISCOVERY',
    'GRANT_PREP',
    'GRANT_DRAFTING'
  ]
  
  return Promise.all(
    serviceTypes.map(serviceType => getServiceUsage(tenantId, serviceType))
  )
}

/**
 * Get usage breakdown by user for a tenant
 */
export async function getTenantUserUsage(
  tenantId: string,
  serviceType?: ServiceType
): Promise<Array<{
  userId: string
  userEmail: string
  userName: string | null
  serviceType: ServiceType
  completions: number
  tokens: number
  costUsd: number
}>> {
  const { currentMonth } = getCurrentPeriods()
  
  const whereClause: any = {
    tenantId,
    completionMonth: currentMonth
  }
  
  if (serviceType) {
    whereClause.serviceType = serviceType
  }
  
  const usageByUser = await prisma.serviceCompletionUsage.groupBy({
    by: ['userId', 'serviceType'],
    where: whereClause,
    _count: {
      id: true
    },
    _sum: {
      totalTokensUsed: true,
      estimatedCostUsd: true
    }
  })
  
  // Get user details
  const userIds = Array.from(new Set(usageByUser.map(u => u.userId)))
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true }
  })
  
  const userMap = new Map(users.map(u => [u.id, u]))
  
  return usageByUser.map(usage => {
    const user = userMap.get(usage.userId)
    return {
      userId: usage.userId,
      userEmail: user?.email || 'Unknown',
      userName: user?.name || null,
      serviceType: usage.serviceType,
      completions: usage._count.id,
      tokens: usage._sum.totalTokensUsed || 0,
      costUsd: usage._sum.estimatedCostUsd || 0
    }
  })
}

/**
 * Get cost breakdown by service for a tenant
 */
export async function getTenantCostBreakdown(tenantId: string): Promise<{
  daily: Record<ServiceType, { completions: number; tokens: number; costUsd: number }>
  monthly: Record<ServiceType, { completions: number; tokens: number; costUsd: number }>
  averagePerCompletion: Record<ServiceType, { tokens: number; costUsd: number }>
}> {
  const { currentDay, currentMonth } = getCurrentPeriods()
  
  const serviceTypes: ServiceType[] = [
    'PATENT_DRAFTING',
    'NOVELTY_SEARCH',
    'PRIOR_ART_SEARCH',
    'DIAGRAM_GENERATION',
    'IDEA_BANK',
    'PERSONA_SYNC',
    'FUNDING_DISCOVERY',
    'GRANT_PREP',
    'GRANT_DRAFTING'
  ]
  
  const daily: Record<string, { completions: number; tokens: number; costUsd: number }> = {}
  const monthly: Record<string, { completions: number; tokens: number; costUsd: number }> = {}
  const averagePerCompletion: Record<string, { tokens: number; costUsd: number }> = {}
  
  for (const serviceType of serviceTypes) {
    // Daily stats
    const dailyAgg = await prisma.serviceCompletionUsage.aggregate({
      where: {
        tenantId,
        serviceType,
        completionDate: currentDay,
        isCompleted: true
      },
      _count: { id: true },
      _sum: { totalTokensUsed: true, estimatedCostUsd: true }
    })
    
    daily[serviceType] = {
      completions: dailyAgg._count.id,
      tokens: dailyAgg._sum.totalTokensUsed || 0,
      costUsd: dailyAgg._sum.estimatedCostUsd || 0
    }
    
    // Monthly stats
    const monthlyAgg = await prisma.serviceCompletionUsage.aggregate({
      where: {
        tenantId,
        serviceType,
        completionMonth: currentMonth,
        isCompleted: true
      },
      _count: { id: true },
      _sum: { totalTokensUsed: true, estimatedCostUsd: true }
    })
    
    monthly[serviceType] = {
      completions: monthlyAgg._count.id,
      tokens: monthlyAgg._sum.totalTokensUsed || 0,
      costUsd: monthlyAgg._sum.estimatedCostUsd || 0
    }
    
    // Average per completion (safe division)
    const completionCount = monthlyAgg._count.id || 0
    const totalTokens = monthlyAgg._sum.totalTokensUsed || 0
    const totalCost = monthlyAgg._sum.estimatedCostUsd || 0
    
    averagePerCompletion[serviceType] = {
      tokens: completionCount > 0 ? Math.round(totalTokens / completionCount) : 0,
      costUsd: completionCount > 0 ? totalCost / completionCount : 0
    }
  }
  
  return {
    daily: daily as any,
    monthly: monthly as any,
    averagePerCompletion: averagePerCompletion as any
  }
}

/**
 * Reset usage counters (for admin use or scheduled jobs)
 */
export async function resetUsageCounters(
  tenantId: string,
  serviceType?: ServiceType,
  period?: 'daily' | 'monthly'
): Promise<number> {
  const { currentDay, currentMonth } = getCurrentPeriods()
  
  const whereClause: any = { tenantId }
  
  if (serviceType) {
    whereClause.serviceType = serviceType
  }
  
  if (period === 'daily') {
    whereClause.completionDate = currentDay
  } else if (period === 'monthly') {
    whereClause.completionMonth = currentMonth
  }
  
  const result = await prisma.serviceCompletionUsage.deleteMany({
    where: whereClause
  })
  
  console.log(`[ServiceUsageTracker] Reset ${result.count} usage records for tenant ${tenantId}`)
  
  return result.count
}

