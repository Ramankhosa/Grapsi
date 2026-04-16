// Catalog service (Module 2)
// Manages plans, features, and their relationships

import type { MeteringConfig, CatalogService, PlanDetails, FeatureDetails, FeatureCode, TaskCode } from './types'
import { MeteringErrorUtils } from './errors'
import { prisma } from '@/lib/prisma'

// Placeholder implementation - to be completed
export function createCatalogService(config: MeteringConfig): CatalogService {
  return {
    async getPlanDetails(planId: string): Promise<PlanDetails | null> {
      throw new Error('Catalog service not fully implemented yet')
    },

    async getFeatureDetails(featureCode: FeatureCode): Promise<FeatureDetails | null> {
      try {
        const feature = await prisma.feature.findUnique({
          where: { code: featureCode }
        })

        if (!feature) {
          return null
        }

        return {
          code: feature.code,
          name: feature.name,
          unit: feature.unit,
        }
      } catch (error) {
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    },

    async getTaskDetails(taskCode: TaskCode): Promise<{ code: TaskCode; name: string; linkedFeature: FeatureCode } | null> {
      try {
        const task = await prisma.task.findUnique({
          where: { code: taskCode },
          include: { linkedFeature: true }
        })

        if (!task) {
          return null
        }

        return {
          code: task.code,
          name: task.name,
          linkedFeature: task.linkedFeature.code,
        }
      } catch (error) {
        throw MeteringErrorUtils.wrap(error, 'DATABASE_ERROR')
      }
    }
  }
}
