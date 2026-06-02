import { prisma } from './prisma'

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
