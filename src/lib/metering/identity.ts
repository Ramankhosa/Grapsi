// Identity resolution service (Module 1)
// Resolves tenant_id and plan_id from ATI tokens

import type { MeteringConfig, IdentityService, TenantContext } from './types'
import { MeteringError, MeteringErrorUtils } from './errors'
import { prisma } from '@/lib/prisma'

// Placeholder implementation - to be completed
export function createIdentityService(config: MeteringConfig): IdentityService {
  return {
    async resolveTenantContext(atiToken: string): Promise<TenantContext | null> {
      try {
        // Find tenant by ATI token
        const tenant = await prisma.tenant.findFirst({
          where: { atiId: atiToken },
          include: {
            tenantPlans: {
              where: {
                status: 'ACTIVE',
                effectiveFrom: { lte: new Date() },
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } }
                ]
              },
              orderBy: { effectiveFrom: 'desc' },
              take: 1,
            }
          }
        })

        if (!tenant) {
          return null
        }

        // Check tenant status
        if (tenant.status !== 'ACTIVE') {
          throw MeteringErrorUtils.tenantNotFound(tenant.id)
        }

        // Get active plan
        const activePlan = tenant.tenantPlans[0]
        if (!activePlan) {
          throw new MeteringError('TENANT_UNRESOLVED', 'No active plan found for tenant')
        }

        return {
          tenantId: tenant.id,
          planId: activePlan.planId,
          tenantStatus: tenant.status,
        }
      } catch (error) {
        if (error instanceof MeteringError) {
          throw error
        }
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async validateTenantAccess(tenantId: string): Promise<boolean> {
      try {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { status: true }
        })

        return tenant?.status === 'ACTIVE'
      } catch (error) {
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    }
  }
}
