import { describe, expect, it, vi } from 'vitest'

import { ensureTenantEntitlementForSignup, resolveSignupPlanCode } from '@/lib/entitlement-service'

describe('entitlement service signup provisioning', () => {
  it('maps ATI plan tier aliases to plan codes', () => {
    expect(resolveSignupPlanCode('BASIC')).toBe('FREE_PLAN')
    expect(resolveSignupPlanCode('pro')).toBe('PRO_PLAN')
    expect(resolveSignupPlanCode('all features')).toBe('ENTERPRISE_PLAN')
    expect(resolveSignupPlanCode('ENTERPRISE_PLAN')).toBe('ENTERPRISE_PLAN')
  })

  it('creates an entitlement from ATI plan tier when tenant has no active plan', async () => {
    const client = {
      tenantPlan: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'tenant-plan-1' }),
        update: vi.fn()
      },
      plan: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          if (where.code === 'ENTERPRISE_PLAN') {
            return Promise.resolve({ id: 'plan-enterprise', code: 'ENTERPRISE_PLAN', status: 'ACTIVE' })
          }

          return Promise.resolve(null)
        })
      }
    }

    const result = await ensureTenantEntitlementForSignup({
      tenantId: 'tenant-1',
      atiTokenId: 'ati-1',
      planTier: 'ENTERPRISE'
    }, client as any)

    expect(result).toMatchObject({ created: true, planCode: 'ENTERPRISE_PLAN' })
    expect(client.tenantPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        planId: 'plan-enterprise',
        status: 'ACTIVE',
        source: 'SUPERADMIN_GRANT',
        sourceRef: 'ati-signup:ati-1'
      })
    })
  })

  it('does not touch an existing active entitlement of an equal or higher tier', async () => {
    const client = {
      tenantPlan: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'tenant-plan-1',
          plan: { code: 'PRO_PLAN' }
        }),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      },
      plan: {
        findUnique: vi.fn()
      }
    }

    // BASIC maps to FREE_PLAN, which ranks below the tenant's existing PRO_PLAN,
    // so the signup must leave the entitlement completely alone.
    const result = await ensureTenantEntitlementForSignup({
      tenantId: 'tenant-1',
      atiTokenId: 'ati-1',
      planTier: 'BASIC'
    }, client as any)

    expect(result).toMatchObject({ created: false, planCode: 'PRO_PLAN' })
    expect(client.plan.findUnique).not.toHaveBeenCalled()
    expect(client.tenantPlan.create).not.toHaveBeenCalled()
    expect(client.tenantPlan.update).not.toHaveBeenCalled()
  })

  it('upgrades an existing lower-tier entitlement in place instead of creating a second one', async () => {
    const client = {
      tenantPlan: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'tenant-plan-1',
          plan: { code: 'FREE_PLAN' },
          metadata: { reason: 'ati_signup_default_entitlement' }
        }),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'tenant-plan-1' })
      },
      plan: {
        findUnique: vi.fn().mockImplementation(({ where }) =>
          Promise.resolve(
            where.code === 'ENTERPRISE_PLAN'
              ? { id: 'plan-enterprise', code: 'ENTERPRISE_PLAN', status: 'ACTIVE' }
              : null
          )
        )
      }
    }

    const result = await ensureTenantEntitlementForSignup({
      tenantId: 'tenant-1',
      atiTokenId: 'ati-1',
      planTier: 'ENTERPRISE'
    }, client as any)

    expect(result).toMatchObject({ created: false, planCode: 'ENTERPRISE_PLAN' })
    expect(client.tenantPlan.create).not.toHaveBeenCalled()
    expect(client.tenantPlan.update).toHaveBeenCalledWith({
      where: { id: 'tenant-plan-1' },
      data: expect.objectContaining({
        planId: 'plan-enterprise',
        metadata: expect.objectContaining({ upgradedFrom: 'FREE_PLAN' })
      })
    })
  })
})
