import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  tenantFindUniqueMock,
  tenantPlanFindFirstMock,
  planFindFirstMock,
  getTrialUserInfoMock,
  checkQuotaMock,
  createReservationMock,
} = vi.hoisted(() => ({
  tenantFindUniqueMock: vi.fn(),
  tenantPlanFindFirstMock: vi.fn(),
  planFindFirstMock: vi.fn(),
  getTrialUserInfoMock: vi.fn(),
  checkQuotaMock: vi.fn(),
  createReservationMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: tenantFindUniqueMock,
    },
    tenantPlan: {
      findFirst: tenantPlanFindFirstMock,
    },
    plan: {
      findFirst: planFindFirstMock,
    },
    policyRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('@/lib/trial-plan-service', () => ({
  getTrialUserInfo: getTrialUserInfoMock,
}))

vi.mock('@/lib/metering/metering', () => ({
  createMeteringService: () => ({
    checkQuota: checkQuotaMock,
  }),
}))

vi.mock('@/lib/metering/reservation', () => ({
  createReservationService: () => ({
    createReservation: createReservationMock,
  }),
}))

import { defaultConfig } from '@/lib/metering/config'
import { createPolicyService } from '@/lib/metering/policy'

describe('metering policy plan-agnostic features', () => {
  beforeEach(() => {
    tenantFindUniqueMock.mockReset()
    tenantPlanFindFirstMock.mockReset()
    planFindFirstMock.mockReset()
    getTrialUserInfoMock.mockReset()
    checkQuotaMock.mockReset()
    createReservationMock.mockReset()

    tenantFindUniqueMock.mockResolvedValue({ status: 'ACTIVE' })
    tenantPlanFindFirstMock.mockResolvedValue({
      planId: 'plan-1',
      plan: { id: 'plan-1', code: 'PRO_PLAN' },
    })
    planFindFirstMock.mockResolvedValue({
      id: 'plan-1',
      code: 'PRO_PLAN',
      planFeatures: [],
      planLLMAccess: [],
      policyRules: [],
    })
    getTrialUserInfoMock.mockResolvedValue({ isTrialUser: false })
    checkQuotaMock.mockResolvedValue({ allowed: true, remaining: { monthly: 10, daily: 5 } })
    createReservationMock.mockResolvedValue('reservation-1')
  })

  it('allows Grant Prep when the active plan has no GRANT_PREP PlanFeature row', async () => {
    const policy = createPolicyService(defaultConfig)

    const decision = await policy.evaluateAccess({
      tenantId: 'tenant-1',
      featureCode: 'GRANT_PREP',
      taskCode: 'GRANT_PREP_CHAT',
      userId: 'user-1',
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reservationId).toBe('reservation-1')
    expect(checkQuotaMock).not.toHaveBeenCalled()
  })

  it('keeps the missing-plan-feature denial for non-universal features', async () => {
    const policy = createPolicyService(defaultConfig)

    const decision = await policy.evaluateAccess({
      tenantId: 'tenant-1',
      featureCode: 'IDEA_BANK',
      taskCode: 'IDEA_BANK_ACCESS',
      userId: 'user-1',
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("Feature 'IDEA_BANK' not available in plan 'PRO_PLAN'")
    expect(createReservationMock).not.toHaveBeenCalled()
  })
})
