// Policy service (Modules 3-4)
// Evaluates access and enforces policy rules

import type { MeteringConfig, PolicyService, FeatureRequest, EnforcementDecision, PolicyLimits } from './types'
import { MeteringErrorUtils, MeteringError } from './errors'
import { prisma } from '@/lib/prisma'
import { getTrialUserInfo } from '@/lib/trial-plan-service'
import { createMeteringService } from './metering'
import { createReservationService } from './reservation'

const POLICY_LIMITS_CACHE_TTL_MS = 30_000

export function createPolicyService(config: MeteringConfig): PolicyService {
  const meteringService = createMeteringService(config)
  const reservationService = createReservationService(config)
  const policyLimitsCache = new Map<string, { value: PolicyLimits; expiresAt: number }>()

  const getPolicyLimitsCacheKey = (tenantId: string, taskCode?: any): string => {
    return `${tenantId}::${String(taskCode || '*')}`
  }

  const getCachedPolicyLimits = (cacheKey: string): PolicyLimits | null => {
    const cached = policyLimitsCache.get(cacheKey)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
      policyLimitsCache.delete(cacheKey)
      return null
    }
    return { ...cached.value }
  }

  const setCachedPolicyLimits = (cacheKey: string, value: PolicyLimits): void => {
    policyLimitsCache.set(cacheKey, {
      value: { ...value },
      expiresAt: Date.now() + POLICY_LIMITS_CACHE_TTL_MS
    })
  }

  return {
    async evaluateAccess(request: FeatureRequest): Promise<EnforcementDecision> {
      try {
        // 1. Get tenant context (already resolved by identity service)
        const tenant = await prisma.tenant.findUnique({
          where: { id: request.tenantId },
          select: { status: true }
        })

        if (!tenant || tenant.status !== 'ACTIVE') {
          return {
            allowed: false,
            reason: 'Tenant not found or inactive'
          }
        }

        // 2. Get tenant's current active plan assignment
        const tenantPlan = await prisma.tenantPlan.findFirst({
          where: {
            tenantId: request.tenantId,
            status: 'ACTIVE'
          },
          include: {
            plan: true
          },
          orderBy: {
            effectiveFrom: 'desc'
          }
        })

        if (!tenantPlan?.plan) {
          return {
            allowed: false,
            reason: 'No active plan found for tenant'
          }
        }

        // 3. Get plan details
        const plan = await prisma.plan.findFirst({
          where: {
            id: tenantPlan.planId,
            status: 'ACTIVE'
          },
          include: {
            planFeatures: {
              include: { feature: true }
            },
            planLLMAccess: {
              include: { defaultClass: true }
            },
            policyRules: true
          }
        })

        if (!plan) {
          return {
            allowed: false,
            reason: 'Plan not found or inactive'
          }
        }

        // 4. Check feature availability
        const planFeature = plan.planFeatures.find(
          pf => pf.feature.code === request.featureCode
        )

        if (!planFeature) {
          return {
            allowed: false,
            reason: `Feature '${request.featureCode}' not available in plan '${plan.code}'`
          }
        }

        // 5. Check if user is a trial user (bypass quotas for trial users)
        const trialUserInfo = request.userId ? await getTrialUserInfo(request.userId) : { isTrialUser: false }
        const isTrialUser = trialUserInfo.isTrialUser

        // Debug logging for trial user detection
        console.log(`[Policy] User ${request.userId} trial status: ${isTrialUser}`, {
          hasInvite: !!trialUserInfo.invite,
          hasCampaign: !!trialUserInfo.campaign,
          tenantAtiId: trialUserInfo.invite?.campaign?.trialAtiTokenId ? 'campaign-specific' : 'unknown'
        })

        let quotaRemaining: any = { monthly: 999999, daily: 999999 }

        // 6. Check quota limits (skip for trial users)
        if (!isTrialUser) {
          const quotaCheck = await this.checkQuota(request)
          if (!quotaCheck.allowed) {
            return {
              allowed: false,
              reason: quotaCheck.resetTime
                ? `Quota exceeded. Resets at ${quotaCheck.resetTime.toISOString()}`
                : 'Quota exceeded',
              remainingQuota: quotaCheck.remaining
            }
          }
          quotaRemaining = quotaCheck.remaining
        }

        // 6. Get LLM access for tasks
        let modelClass = null
        if (request.taskCode) {
          const llmAccess = plan.planLLMAccess.find(
            access => access.taskCode === request.taskCode
          )

          if (llmAccess) {
            modelClass = llmAccess.defaultClass.code
          }
        }

        // 7. Get policy limits
        const policyLimits = await this.getPolicyLimits(request.tenantId, request.taskCode)

        // 8. Create reservation for enforcement
        const reservationId = await this.createReservation(request, policyLimits)

        return {
          allowed: true,
          modelClass: modelClass as any,
          maxTokensIn: policyLimits.maxTokensIn,
          maxTokensOut: policyLimits.maxTokensOut,
          maxSteps: policyLimits.agentMaxSteps,
          topK: policyLimits.retrievalTopK,
          maxFiles: policyLimits.diagramFilesPerReq,
          concurrencyLimit: policyLimits.concurrencyLimit,
          reservationId,
          remainingQuota: quotaRemaining
        }

      } catch (error) {
        console.error('Policy evaluation error:', error)

        // If it's a MeteringError, re-throw it to preserve error type and details
        if (error instanceof MeteringError) {
          throw error
        }

        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async getPolicyLimits(tenantId: string, taskCode?: any): Promise<PolicyLimits> {
      try {
        const cacheKey = getPolicyLimitsCacheKey(tenantId, taskCode)
        const cached = getCachedPolicyLimits(cacheKey)
        if (cached) {
          return cached
        }

        // Get tenant's current active plan
        const tenantPlan = await prisma.tenantPlan.findFirst({
          where: {
            tenantId,
            status: 'ACTIVE'
          },
          include: {
            plan: true
          },
          orderBy: {
            effectiveFrom: 'desc'
          }
        })

        if (!tenantPlan?.plan) {
          const fallback = { ...config.defaultLimits }
          setCachedPolicyLimits(cacheKey, fallback)
          return fallback
        }

        // Get plan policy rules
        const policyRules = await prisma.policyRule.findMany({
          where: {
            OR: [
              { scope: 'plan', scopeId: tenantPlan.plan.id },
              { scope: 'tenant', scopeId: tenantId }
            ],
            ...(taskCode && { taskCode })
          }
        })

        // Convert rules to limits object
        const limits: PolicyLimits = { ...config.defaultLimits }

        policyRules.forEach(rule => {
          switch (rule.key) {
            case 'max_tokens_in':
              limits.maxTokensIn = rule.value
              break
            case 'max_tokens_out':
              limits.maxTokensOut = rule.value
              break
            case 'agent_max_steps':
              limits.agentMaxSteps = rule.value
              break
            case 'retrieval_top_k':
              limits.retrievalTopK = rule.value
              break
            case 'diagram_files_per_req':
              limits.diagramFilesPerReq = rule.value
              break
            case 'concurrency_limit':
              limits.concurrencyLimit = rule.value
              break
          }
        })

        setCachedPolicyLimits(cacheKey, limits)
        return limits

      } catch (error) {
        console.warn('Failed to get policy limits, using defaults:', error)
        return { ...config.defaultLimits }
      }
    },

    async checkQuota(request: FeatureRequest): Promise<{ allowed: boolean, remaining: any, resetTime?: Date }> {
      return await meteringService.checkQuota(request)
    },

    async createReservation(request: FeatureRequest, limits: PolicyLimits): Promise<string> {
      // Estimate units based on limits
      const estimatedUnits = limits.maxTokensOut || 1000

      return await reservationService.createReservation({
        tenantId: request.tenantId,
        featureCode: request.featureCode,
        taskCode: request.taskCode,
        userId: request.userId,
        idempotencyKey: `policy-${Date.now()}-${Math.random()}`,
        metadata: request.metadata
      }, estimatedUnits)
    }
  }
}
