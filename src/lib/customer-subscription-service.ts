import { prisma } from './prisma'
import { applySubscriptionEntitlement, revokeTenantEntitlement } from './entitlement-service'

function buildIndividualTenantAtiId(userId: string) {
  return `CUSTOMER${userId.replace(/[^a-zA-Z0-9]/g, '').slice(-18).toUpperCase()}`
}

/**
 * Payment webhook adapters should call this after verifying the provider
 * signature and paid-through date. It is idempotent by subscriptionId.
 */
export async function activateCustomerSubscription(input: {
  userId: string
  planCode: string
  subscriptionId: string
  paidThrough: Date
  metadata?: Record<string, unknown>
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, tenantId: true }
  })

  if (!user) {
    throw new Error('Customer user not found')
  }

  let tenantId = user.tenantId
  if (!tenantId) {
    const tenant = await prisma.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          name: user.name?.trim() || 'Individual Customer',
          atiId: buildIndividualTenantAtiId(user.id),
          type: 'INDIVIDUAL',
          status: 'ACTIVE'
        }
      })

      await tx.user.update({
        where: { id: user.id },
        data: { tenantId: createdTenant.id, roles: ['OWNER'] }
      })

      return createdTenant
    })
    tenantId = tenant.id
  }

  return applySubscriptionEntitlement({
    tenantId,
    planCode: input.planCode,
    subscriptionId: input.subscriptionId,
    paidThrough: input.paidThrough,
    metadata: input.metadata
  })
}

/**
 * Cancellation prevents future renewal but keeps paid access until expiresAt.
 * Use this only for immediate revocation events such as refunds or chargebacks.
 */
export async function revokeCustomerSubscription(subscriptionId: string) {
  return revokeTenantEntitlement('SUBSCRIPTION', subscriptionId)
}
