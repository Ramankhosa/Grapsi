// Metering service (Module 7)
// Records and tracks usage

import type { MeteringConfig, MeteringService, FeatureRequest, QuotaCheckResult, UsageStats, MeteringResult } from './types'
import { MeteringErrorUtils, MeteringError } from './errors'
import { prisma } from '@/lib/prisma'
import { calculateCost, CONTINGENCY_MULTIPLIER } from './cost-calculator'

function getCurrentPeriod(type: 'DAILY' | 'MONTHLY'): { key: string, start: Date, end: Date } {
  const now = new Date()
  let key: string
  let start: Date
  let end: Date

  if (type === 'DAILY') {
    key = now.toISOString().split('T')[0] // YYYY-MM-DD
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  } else {
    key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` // YYYY-MM
    start = new Date(now.getFullYear(), now.getMonth(), 1)
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  }

  return { key, start, end }
}

export function createMeteringService(config: MeteringConfig): MeteringService {
  return {
    async recordUsage(reservationId: string, stats: UsageStats, userId?: string): Promise<MeteringResult> {
      try {
        // Verify reservation exists and is active
        const reservation = await prisma.usageReservation.findUnique({
          where: { id: reservationId },
          include: { tenant: true }
        })

        if (!reservation) {
          throw new MeteringError('RESERVATION_NOT_FOUND', 'Reservation not found')
        }

        if (reservation.status !== 'ACTIVE') {
          throw new MeteringError('RESERVATION_FAILED', `Reservation status: ${reservation.status}`)
        }

        // Update usage meters
        await this.updateUsageMeters(reservation, stats)

        // Calculate cost using the model class
        // Use ?? (nullish coalescing) instead of || to handle 0 as a valid token count
        let costData: { actualCost: number; contingencyCost: number; inputCost: number; outputCost: number } | null = null
        if (stats.modelClass) {
          const costBreakdown = calculateCost(
            stats.modelClass,
            stats.inputTokens ?? 0,
            stats.outputTokens ?? 0,
            stats.metadata?.thoughtTokens
          )
          costData = {
            actualCost: costBreakdown.actualCost,
            contingencyCost: costBreakdown.contingencyCost,
            inputCost: costBreakdown.inputCost,
            outputCost: costBreakdown.outputCost
          }
        }

        // Create usage log with cost data in metadata
        try {
          await prisma.usageLog.create({
            data: {
              tenantId: reservation.tenantId,
              userId: userId,
              featureId: reservation.featureId,
              taskCode: reservation.taskCode,
              modelClass: stats.modelClass,
              apiCode: stats.apiCode,
              inputTokens: stats.inputTokens,
              outputTokens: stats.outputTokens,
              apiCalls: stats.apiCalls || 1,
              startedAt: reservation.createdAt,
              completedAt: new Date(),
              status: 'COMPLETED',
              idempotencyKey: reservation.idempotencyKey,
              reservationId: reservation.id,
              meta: {
                ...(stats.metadata ? JSON.parse(JSON.stringify(stats.metadata)) : {}),
                // Store cost data in metadata
                cost: costData
              }
            }
          })
        } catch (logError: any) {
          // Handle foreign key constraint violations gracefully (e.g., when migrations haven't been run)
          if (logError.code === 'P2003') {
            console.warn(`Skipping usage log creation due to missing task code: ${reservation.taskCode}`)
          } else {
            console.error('Failed to create usage log:', logError)
          }
        }

        // Mark reservation as completed
        await prisma.usageReservation.update({
          where: { id: reservationId },
          data: { status: 'COMPLETED' }
        })

        // Check for quota alerts
        await this.checkQuotaAlerts(reservation.tenantId, reservation.featureId || undefined, reservation.taskCode || undefined)

        return {
          success: true,
          reservationId,
          usageCommitted: true
        }

      } catch (error) {
        // Mark reservation as failed
        try {
          await prisma.usageReservation.update({
            where: { id: reservationId },
            data: { status: 'FAILED' }
          })
        } catch (updateError) {
          console.error('Failed to update reservation status:', updateError)
        }

        // Create failed usage log
        try {
          const reservation = await prisma.usageReservation.findUnique({
            where: { id: reservationId }
          })

          if (reservation) {
            try {
              await prisma.usageLog.create({
                data: {
                  tenantId: reservation.tenantId,
                  userId: undefined, // User ID not stored in reservation
                  featureId: reservation.featureId,
                  taskCode: reservation.taskCode,
                  startedAt: reservation.createdAt,
                  completedAt: new Date(),
                  status: 'FAILED',
                  error: error instanceof Error ? error.message : String(error),
                  idempotencyKey: reservation.idempotencyKey,
                  reservationId: reservation.id
                }
              })
            } catch (logError: any) {
              // Handle foreign key constraint violations gracefully (e.g., when migrations haven't been run)
              if (logError.code === 'P2003') {
                console.warn(`Skipping failed usage log creation due to missing task code: ${reservation.taskCode}`)
              } else {
                console.error('Failed to create error log:', logError)
              }
            }
          }
        } catch (logError) {
          console.error('Failed to create error log:', logError)
        }

        if (error instanceof MeteringError) {
          return {
            success: false,
            error
          }
        }

        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async checkQuota(request: FeatureRequest): Promise<QuotaCheckResult> {
      try {
        // Get tenant's current active plan
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
          return { allowed: false, remaining: { monthly: 0, daily: 0 } }
        }

        // Get plan feature limits
        const planFeature = await prisma.planFeature.findFirst({
          where: {
            planId: tenantPlan.plan.id,
            feature: { code: request.featureCode }
          }
        })

        if (!planFeature) {
          return { allowed: false, remaining: { monthly: 0, daily: 0 } }
        }

        // Get current usage
        const monthlyUsage = await this.getCurrentUsage(
          request.tenantId,
          request.featureCode,
          'MONTHLY'
        )

        const dailyUsage = await this.getCurrentUsage(
          request.tenantId,
          request.featureCode,
          'DAILY'
        )

        // Calculate remaining
        const monthlyRemaining = Math.max(0, (planFeature.monthlyQuota || 0) - monthlyUsage)
        const dailyRemaining = Math.max(0, (planFeature.dailyQuota || 0) - dailyUsage)

        // Check if quota exceeded
        const allowed = monthlyRemaining > 0 && dailyRemaining > 0

        // Calculate reset time (monthly by default)
        const resetTime = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)

        return {
          allowed,
          remaining: {
            monthly: monthlyRemaining,
            daily: dailyRemaining
          },
          resetTime
        }

      } catch (error) {
        console.error('Quota check failed:', error)
        // Fail open - allow request if quota check fails
        return {
          allowed: true,
          remaining: { monthly: 999999, daily: 999999 }
        }
      }
    },

    async getUsage(tenantId: string, featureCode?: any, period?: any) {
      const periodType = (period === 'daily' ? 'DAILY' : 'MONTHLY') as 'DAILY' | 'MONTHLY'

      const usage = await this.getCurrentUsage(tenantId, featureCode, periodType)

      const { start, end } = getCurrentPeriod(periodType)

      // Get plan limits
      let limit: number | undefined
      if (featureCode) {
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

        if (tenantPlan?.plan) {
          const planFeature = await prisma.planFeature.findFirst({
            where: {
              planId: tenantPlan.plan.id,
              feature: { code: featureCode }
            }
          })

          limit = periodType === 'DAILY'
            ? planFeature?.dailyQuota || undefined
            : planFeature?.monthlyQuota || undefined
        }
      }

      return {
        current: usage,
        limit,
        resetTime: end
      }
    },

    async updateUsageMeters(reservation: any, stats: UsageStats): Promise<void> {
      const updates = []

      // Update monthly meter
      const monthlyPeriod = getCurrentPeriod('MONTHLY')
      updates.push(
        prisma.usageMeter.upsert({
          where: {
            tenantId_featureId_taskCode_periodType_periodKey: {
              tenantId: reservation.tenantId,
              featureId: reservation.featureId,
              taskCode: reservation.taskCode,
              periodType: 'MONTHLY',
              periodKey: monthlyPeriod.key
            }
          },
          update: {
            currentUsage: {
              increment: stats.outputTokens || stats.apiCalls || 1
            },
            lastUpdated: new Date()
          },
          create: {
            tenantId: reservation.tenantId,
            featureId: reservation.featureId,
            taskCode: reservation.taskCode,
            periodType: 'MONTHLY',
            periodKey: monthlyPeriod.key,
            currentUsage: stats.outputTokens || stats.apiCalls || 1
          }
        })
      )

      // Update daily meter
      const dailyPeriod = getCurrentPeriod('DAILY')
      updates.push(
        prisma.usageMeter.upsert({
          where: {
            tenantId_featureId_taskCode_periodType_periodKey: {
              tenantId: reservation.tenantId,
              featureId: reservation.featureId,
              taskCode: reservation.taskCode,
              periodType: 'DAILY',
              periodKey: dailyPeriod.key
            }
          },
          update: {
            currentUsage: {
              increment: stats.outputTokens || stats.apiCalls || 1
            },
            lastUpdated: new Date()
          },
          create: {
            tenantId: reservation.tenantId,
            featureId: reservation.featureId,
            taskCode: reservation.taskCode,
            periodType: 'DAILY',
            periodKey: dailyPeriod.key,
            currentUsage: stats.outputTokens || stats.apiCalls || 1
          }
        })
      )

      await Promise.all(updates)
    },

    async getCurrentUsage(tenantId: string, featureCode?: string, periodType: 'DAILY' | 'MONTHLY' = 'MONTHLY'): Promise<number> {
      const { key } = getCurrentPeriod(periodType)

      const meter = await prisma.usageMeter.findFirst({
        where: {
          tenantId,
          featureId: featureCode,
          periodType,
          periodKey: key
        }
      })

      return meter?.currentUsage || 0
    },

    async checkQuotaAlerts(tenantId: string, featureId?: string, taskCode?: any): Promise<void> {
      try {
        // Get current usage
        const monthlyUsage = await this.getCurrentUsage(tenantId, featureId, 'MONTHLY')

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

        if (!tenantPlan?.plan) return

        // Look up feature code from feature ID
        const feature = await prisma.feature.findUnique({
          where: { id: featureId },
          select: { code: true }
        })

        if (!feature) return

        const planFeature = await prisma.planFeature.findFirst({
          where: {
            planId: tenantPlan.plan.id,
            feature: { code: feature.code }
          }
        })

        if (!planFeature?.monthlyQuota) return

        const usagePercentage = (monthlyUsage / planFeature.monthlyQuota) * 100

        // Check alert thresholds
        if (usagePercentage >= 80) {
          const alertType = usagePercentage >= 100 ? 'QUOTA_EXCEEDED' : 'QUOTA_WARNING'

          const existingAlert = await prisma.quotaAlert.findFirst({
            where: {
              tenantId,
              featureId,
              taskCode,
              alertType: alertType as any
            }
          })

          if (existingAlert) {
            await prisma.quotaAlert.update({
              where: { id: existingAlert.id },
              data: {
                threshold: Math.floor(usagePercentage),
                notifiedAt: new Date()
              }
            })
          } else {
            await prisma.quotaAlert.create({
              data: {
                tenantId,
                featureId,
                taskCode,
                alertType: alertType as any,
                threshold: Math.floor(usagePercentage)
              }
            })
          }
        }
      } catch (error) {
        console.warn('Quota alert check failed:', error)
      }
    }
  }
}
