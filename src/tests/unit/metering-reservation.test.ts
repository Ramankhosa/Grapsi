import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  featureFindUniqueMock,
  reservationFindUniqueMock,
  reservationCreateMock,
} = vi.hoisted(() => ({
  featureFindUniqueMock: vi.fn(),
  reservationFindUniqueMock: vi.fn(),
  reservationCreateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    feature: {
      findUnique: featureFindUniqueMock,
    },
    usageReservation: {
      findUnique: reservationFindUniqueMock,
      create: reservationCreateMock,
    },
  },
}))

import { defaultConfig } from '@/lib/metering/config'
import { MeteringError } from '@/lib/metering/errors'
import { createReservationService } from '@/lib/metering/reservation'

describe('metering reservation entitlement features', () => {
  beforeEach(() => {
    featureFindUniqueMock.mockReset()
    reservationFindUniqueMock.mockReset()
    reservationCreateMock.mockReset()

    reservationFindUniqueMock.mockResolvedValue(null)
    reservationCreateMock.mockResolvedValue({ id: 'reservation-1' })
  })

  // GRANT_PREP is in PLAN_AGNOSTIC_FEATURES, so it is reservable without a
  // Feature row on purpose — prep must keep working for tenants whose plan does
  // not enumerate it. Only non-agnostic features still hard-fail (next test).
  it('allows a plan-agnostic Grant Prep reservation without a Feature row', async () => {
    featureFindUniqueMock.mockResolvedValue(null)

    const service = createReservationService(defaultConfig)
    await expect(
      service.createReservation(
        {
          tenantId: 'tenant-1',
          featureCode: 'GRANT_PREP',
          idempotencyKey: 'grant-prep-1',
        },
        1000
      )
    ).resolves.toBe('reservation-1')

    expect(reservationCreateMock).toHaveBeenCalledTimes(1)
  })

  it('still errors when another feature is missing from the Feature table', async () => {
    featureFindUniqueMock.mockResolvedValue(null)

    const service = createReservationService(defaultConfig)

    await expect(
      service.createReservation(
        {
          tenantId: 'tenant-1',
          featureCode: 'IDEA_BANK',
          idempotencyKey: 'idea-bank-1',
        },
        1000
      )
    ).rejects.toMatchObject({
      code: 'FEATURE_NOT_FOUND',
      message: "Feature 'IDEA_BANK' not found",
    } satisfies Partial<MeteringError>)
  })
})
