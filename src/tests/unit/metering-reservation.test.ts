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

  it('rejects a Grant Prep reservation without a Feature row', async () => {
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
    ).rejects.toMatchObject({
      code: 'FEATURE_NOT_FOUND',
      message: "Feature 'GRANT_PREP' not found",
    } satisfies Partial<MeteringError>)
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
