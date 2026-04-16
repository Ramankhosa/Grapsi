// Reservation service
// Manages usage reservations before execution

import type { MeteringConfig, ReservationService, MeteringContext } from './types'
import { MeteringErrorUtils, MeteringError } from './errors'
import { prisma } from '@/lib/prisma'

const STAGE_CONCURRENCY_OVERRIDES: Record<string, number> = {
  PAPER_MANUSCRIPT_REVIEW_CONTEXT_SUMMARY: 10,
  PAPER_MANUSCRIPT_REVIEW: 10,
  PAPER_MANUSCRIPT_IMPROVE: 10,
}

const CONCURRENCY_CACHE_TTL_MS = 30_000
const FEATURE_ID_CACHE_TTL_MS = 10 * 60 * 1000

export function createReservationService(config: MeteringConfig): ReservationService {
  const concurrencyLimitCache = new Map<string, { value: number; expiresAt: number }>()
  const featureIdCache = new Map<string, { value: string; expiresAt: number }>()

  const getCachedConcurrencyLimit = (cacheKey: string): number | null => {
    const cached = concurrencyLimitCache.get(cacheKey)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
      concurrencyLimitCache.delete(cacheKey)
      return null
    }
    return cached.value
  }

  const setCachedConcurrencyLimit = (cacheKey: string, value: number): void => {
    if (concurrencyLimitCache.size > 500) {
      const firstKey = concurrencyLimitCache.keys().next().value
      if (firstKey) concurrencyLimitCache.delete(firstKey)
    }
    concurrencyLimitCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + CONCURRENCY_CACHE_TTL_MS
    })
  }

  const getFeatureIdByCode = async (featureCode: string | undefined): Promise<string | null> => {
    const cacheKey = String(featureCode || '').trim().toUpperCase()
    if (!cacheKey) return null

    const cached = featureIdCache.get(cacheKey)
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.value
      }
      featureIdCache.delete(cacheKey)
    }

    const feature = await prisma.feature.findUnique({
      where: { code: featureCode as any },
      select: { id: true }
    })

    if (!feature?.id) {
      return null
    }

    if (featureIdCache.size > 500) {
      const firstKey = featureIdCache.keys().next().value
      if (firstKey) featureIdCache.delete(firstKey)
    }

    featureIdCache.set(cacheKey, {
      value: feature.id,
      expiresAt: Date.now() + FEATURE_ID_CACHE_TTL_MS
    })

    return feature.id
  }

  return {
    async createReservation(context: MeteringContext, units: number): Promise<string> {
      try {
        if (!config.enabled) {
          // Return a dummy reservation ID if metering is disabled
          return `disabled-${Date.now()}`
        }

        // Check for existing reservation with same idempotency key
        if (context.idempotencyKey) {
          const existing = await prisma.usageReservation.findUnique({
            where: { idempotencyKey: context.idempotencyKey }
          })

          if (existing) {
            if (existing.status === 'ACTIVE' && existing.expiresAt > new Date()) {
              return existing.id
            }
            // If expired or failed, clean it up and create new
            await this.releaseReservation(existing.id)
          }
        }

        // Check concurrency limits
        if (context.taskCode) {
          const activeCount = await this.getActiveReservations(context.tenantId, context.taskCode)
          const concurrencyLimit = await this.getConcurrencyLimit(
            context.tenantId,
            context.taskCode,
            context.metadata?.stageCode
          )

          if (activeCount >= concurrencyLimit) {
            throw new MeteringError('CONCURRENCY_LIMIT',
              `Too many concurrent ${context.taskCode} operations. Limit: ${concurrencyLimit}`)
          }
        }

        // Look up feature ID from feature code (cached)
        const featureCode = context.featureCode
        if (!featureCode) {
          throw new MeteringError('FEATURE_NOT_FOUND', 'Feature code is required for reservation')
        }
        const featureId = await getFeatureIdByCode(featureCode)

        if (!featureId) {
          throw new MeteringError('FEATURE_NOT_FOUND', `Feature '${context.featureCode}' not found`)
        }

        // Create reservation
        const reservation = await prisma.usageReservation.create({
          data: {
            tenantId: context.tenantId,
            featureId,
            taskCode: context.taskCode,
            reservedUnits: units,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + (config.reservationTimeoutMs || 300000)), // 5 minutes default
            idempotencyKey: context.idempotencyKey || `auto-${Date.now()}-${Math.random()}`
          }
        })

        return reservation.id

      } catch (error) {
        if (error instanceof MeteringError) {
          throw error
        }
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async releaseReservation(reservationId: string): Promise<void> {
      try {
        await prisma.usageReservation.update({
          where: { id: reservationId },
          data: { status: 'RELEASED' }
        })
      } catch (error) {
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async getActiveReservations(tenantId: string, taskCode?: string): Promise<number> {
      try {
        const count = await prisma.usageReservation.count({
          where: {
            tenantId,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            ...(taskCode && { taskCode: taskCode as any })
          }
        })
        return count
      } catch (error) {
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async getConcurrencyLimit(tenantId: string, taskCode?: string, stageCode?: string): Promise<number> {
      try {
        const normalizedStageCode = String(stageCode || '').trim().toUpperCase()
        const cacheKey = `${tenantId}::${String(taskCode || '*')}::${normalizedStageCode || '*'}`
        const cachedLimit = getCachedConcurrencyLimit(cacheKey)
        if (cachedLimit !== null) {
          return cachedLimit
        }

        // Get tenant's plan
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
          setCachedConcurrencyLimit(cacheKey, 1)
          return 1 // Default low limit
        }

        // Get concurrency limit from policy rules
        const concurrencyRule = await prisma.policyRule.findFirst({
          where: {
            OR: [
              { scope: 'plan', scopeId: tenantPlan.plan.id },
              { scope: 'tenant', scopeId: tenantId }
            ],
            key: 'concurrency_limit',
            ...(taskCode && { taskCode: taskCode as any })
          },
          orderBy: { scope: 'desc' } // tenant overrides plan
        })

        const baseLimit = concurrencyRule?.value || 5 // Default concurrency limit (safe for LLM provider rate limits)
        const overrideLimit = taskCode === 'LLM2_DRAFT'
          ? STAGE_CONCURRENCY_OVERRIDES[normalizedStageCode]
          : undefined
        const effectiveLimit = Math.max(baseLimit, overrideLimit || 0)

        if (overrideLimit && effectiveLimit !== baseLimit) {
          console.log(
            `[MeteringReservation] Applying stage concurrency override for ${normalizedStageCode}: ${baseLimit} -> ${effectiveLimit}`
          )
        }

        setCachedConcurrencyLimit(cacheKey, effectiveLimit)
        return effectiveLimit
      } catch (error) {
        console.warn('Failed to get concurrency limit, using default:', error)
        const overrideLimit = taskCode === 'LLM2_DRAFT'
          ? STAGE_CONCURRENCY_OVERRIDES[String(stageCode || '').trim().toUpperCase()]
          : undefined
        return Math.max(5, overrideLimit || 0)
      }
    }
  }
}
