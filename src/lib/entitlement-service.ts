import type { Prisma } from '@/lib/prisma-generated'

import { prisma } from './prisma'
import { PRODUCT_MODULE_LIST, isModuleUnlocked, planCodeToTier, planTierRank } from './access/modules'

export const ENTITLEMENT_SOURCES = [
  'LEGACY',
  'SUPERADMIN_GRANT',
  'SUBSCRIPTION',
  'TRIAL'
] as const

export type EntitlementSource = typeof ENTITLEMENT_SOURCES[number]

export interface GrantTenantEntitlementInput {
  tenantId: string
  planCode: string
  source: EntitlementSource
  sourceRef?: string | null
  effectiveFrom?: Date
  expiresAt?: Date | null
  metadata?: Record<string, unknown> | null
}

type EntitlementClient = typeof prisma | Prisma.TransactionClient

const DEFAULT_SIGNUP_PLAN_CODE = 'FREE_PLAN'

const SIGNUP_PLAN_ALIASES: Record<string, string> = {
  BASIC: 'FREE_PLAN',
  BASE: 'FREE_PLAN',
  FREE: 'FREE_PLAN',
  FREE_PLAN: 'FREE_PLAN',
  STARTER: 'FREE_PLAN',
  PRO: 'PRO_PLAN',
  PROFESSIONAL: 'PRO_PLAN',
  PRO_PLAN: 'PRO_PLAN',
  ENTERPRISE: 'ENTERPRISE_PLAN',
  ENTERPRISE_PLAN: 'ENTERPRISE_PLAN',
  FULL_ACCESS: 'ENTERPRISE_PLAN',
  ALL_FEATURES: 'ENTERPRISE_PLAN',
  TRIAL: 'TRIAL'
}

export function resolveSignupPlanCode(planTier?: string | null) {
  const rawPlanCode = planTier?.trim() || process.env.DEFAULT_ATI_SIGNUP_PLAN_CODE || DEFAULT_SIGNUP_PLAN_CODE
  const normalized = rawPlanCode.toUpperCase().replace(/[\s-]+/g, '_')

  return SIGNUP_PLAN_ALIASES[normalized] || normalized
}

async function findActiveTenantPlan(client: EntitlementClient, tenantId: string, now = new Date()) {
  return client.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: now },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } }
      ],
      plan: { status: 'ACTIVE' }
    },
    include: {
      plan: true
    },
    orderBy: { effectiveFrom: 'desc' }
  })
}

export async function getActiveTenantEntitlement(tenantId: string, now = new Date()) {
  return prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: now },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } }
      ],
      plan: { status: 'ACTIVE' }
    },
    include: {
      plan: {
        include: {
          planFeatures: {
            include: { feature: true }
          }
        }
      }
    },
    orderBy: { effectiveFrom: 'desc' }
  })
}

async function resolveExistingPlan(client: EntitlementClient, requestedPlanCode: string) {
  const requestedPlan = await client.plan.findUnique({
    where: { code: requestedPlanCode },
    select: { id: true, code: true, status: true }
  })

  if (requestedPlan?.status === 'ACTIVE') {
    return requestedPlan
  }

  const fallbackPlanCode = resolveSignupPlanCode(process.env.DEFAULT_ATI_SIGNUP_PLAN_CODE || DEFAULT_SIGNUP_PLAN_CODE)
  if (fallbackPlanCode === requestedPlanCode) {
    return null
  }

  const fallbackPlan = await client.plan.findUnique({
    where: { code: fallbackPlanCode },
    select: { id: true, code: true, status: true }
  })

  return fallbackPlan?.status === 'ACTIVE' ? fallbackPlan : null
}

export async function ensureTenantEntitlementForSignup(
  input: {
    tenantId: string
    atiTokenId?: string | null
    planTier?: string | null
  },
  client: EntitlementClient = prisma
) {
  const now = new Date()
  const existingActiveEntitlement = await findActiveTenantPlan(client, input.tenantId, now)
  const requestedPlanCode = resolveSignupPlanCode(input.planTier)

  if (existingActiveEntitlement) {
    const existingRank = planTierRank(existingActiveEntitlement.plan.code)
    const requestedRank = planTierRank(requestedPlanCode)

    if (requestedRank <= existingRank) {
      return {
        entitlement: existingActiveEntitlement,
        created: false,
        planCode: existingActiveEntitlement.plan.code
      }
    }

    const upgradePlan = await resolveExistingPlan(client, requestedPlanCode)
    if (upgradePlan) {
      const upgraded = await client.tenantPlan.update({
        where: { id: existingActiveEntitlement.id },
        data: {
          planId: upgradePlan.id,
          metadata: {
            ...(existingActiveEntitlement.metadata as any || {}),
            upgradedFrom: existingActiveEntitlement.plan.code,
            upgradedAt: now.toISOString(),
            upgradedViaAtiTokenId: input.atiTokenId || null,
            upgradedViaPlanTier: input.planTier || null
          } as any
        }
      })

      return {
        entitlement: upgraded,
        created: false,
        planCode: upgradePlan.code
      }
    }

    return {
      entitlement: existingActiveEntitlement,
      created: false,
      planCode: existingActiveEntitlement.plan.code
    }
  }
  const plan = await resolveExistingPlan(client, requestedPlanCode)

  if (!plan) {
    throw new Error(`No active signup entitlement plan found for '${requestedPlanCode}'`)
  }

  const sourceRef = input.atiTokenId
    ? `ati-signup:${input.atiTokenId}`
    : `ati-signup:${input.tenantId}`

  const data = {
    tenantId: input.tenantId,
    planId: plan.id,
    effectiveFrom: now,
    expiresAt: null,
    status: 'ACTIVE',
    source: 'SUPERADMIN_GRANT',
    sourceRef,
    metadata: {
      reason: 'ati_signup_default_entitlement',
      atiTokenId: input.atiTokenId || null,
      atiPlanTier: input.planTier || null,
      requestedPlanCode
    } as any
  }

  const existingBySource = await client.tenantPlan.findUnique({
    where: { source_sourceRef: { source: data.source, sourceRef } }
  })

  if (existingBySource) {
    const entitlement = await client.tenantPlan.update({
      where: { id: existingBySource.id },
      data
    })

    return { entitlement, created: false, planCode: plan.code }
  }

  const entitlement = await client.tenantPlan.create({ data })

  return { entitlement, created: true, planCode: plan.code }
}

/**
 * Feature-access summary for a tenant, derived from its active plan. This is the
 * central read used by the `/api/v1/me/entitlements` endpoint and by any code
 * that needs to know "which features/modules does this tenant have".
 */
export async function getTenantEntitlementSummary(tenantId: string, now = new Date()) {
  const entitlement = await getActiveTenantEntitlement(tenantId, now)

  const featureCodes = entitlement
    ? entitlement.plan.planFeatures.map((pf) => pf.feature.code as string)
    : []
  const featureSet = new Set(featureCodes)

  const modules = PRODUCT_MODULE_LIST.map((module) => ({
    key: module.key,
    name: module.name,
    description: module.description,
    entryRoute: module.entryRoute,
    minTier: module.minTier,
    icon: module.icon,
    featureCodes: module.featureCodes,
    unlocked: isModuleUnlocked(module, featureSet)
  }))

  return {
    plan: entitlement
      ? {
          code: entitlement.plan.code,
          name: entitlement.plan.name,
          tier: planCodeToTier(entitlement.plan.code)
        }
      : null,
    featureCodes,
    modules
  }
}

export type TenantEntitlementSummary = Awaited<ReturnType<typeof getTenantEntitlementSummary>>

/** Does the tenant's active plan include the given FeatureCode? */
export async function hasFeature(tenantId: string, featureCode: string, now = new Date()) {
  const entitlement = await getActiveTenantEntitlement(tenantId, now)
  if (!entitlement) return false
  return entitlement.plan.planFeatures.some((pf) => (pf.feature.code as string) === featureCode)
}

export async function grantTenantEntitlement(input: GrantTenantEntitlementInput) {
  const effectiveFrom = input.effectiveFrom || new Date()
  const sourceRef = input.sourceRef?.trim() || null

  if (input.expiresAt && input.expiresAt <= effectiveFrom) {
    throw new Error('Entitlement expiry must be after its effective date')
  }

  return prisma.$transaction(async (tx) => {
    const [tenant, plan] = await Promise.all([
      tx.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true, status: true } }),
      tx.plan.findUnique({ where: { code: input.planCode }, select: { id: true, status: true } })
    ])

    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new Error('Tenant not found or inactive')
    }

    if (!plan || plan.status !== 'ACTIVE') {
      throw new Error('Plan not found or inactive')
    }

    if (sourceRef) {
      const existing = await tx.tenantPlan.findUnique({
        where: { source_sourceRef: { source: input.source, sourceRef } }
      })

      if (existing) {
        if (existing.tenantId !== input.tenantId) {
          throw new Error('Entitlement reference is already assigned to a different tenant')
        }

        return tx.tenantPlan.update({
          where: { id: existing.id },
          data: {
            planId: plan.id,
            effectiveFrom,
            expiresAt: input.expiresAt ?? null,
            status: 'ACTIVE',
            metadata: input.metadata as any
          }
        })
      }
    }

    return tx.tenantPlan.create({
      data: {
        tenantId: input.tenantId,
        planId: plan.id,
        effectiveFrom,
        expiresAt: input.expiresAt ?? null,
        status: 'ACTIVE',
        source: input.source,
        sourceRef,
        metadata: input.metadata as any
      }
    })
  })
}

export async function revokeTenantEntitlement(source: EntitlementSource, sourceRef: string) {
  return prisma.tenantPlan.updateMany({
    where: { source, sourceRef, status: 'ACTIVE' },
    data: { status: 'REVOKED' }
  })
}

export async function applySubscriptionEntitlement(input: {
  tenantId: string
  planCode: string
  subscriptionId: string
  paidThrough: Date
  metadata?: Record<string, unknown>
}) {
  return grantTenantEntitlement({
    tenantId: input.tenantId,
    planCode: input.planCode,
    source: 'SUBSCRIPTION',
    sourceRef: input.subscriptionId,
    expiresAt: input.paidThrough,
    metadata: input.metadata
  })
}
