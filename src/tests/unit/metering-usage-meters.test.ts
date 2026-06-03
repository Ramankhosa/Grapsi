import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  featureFindUniqueMock,
  usageMeterUpsertMock,
  usageMeterFindFirstMock,
  usageMeterCreateMock,
  usageMeterUpdateMock,
} = vi.hoisted(() => ({
  featureFindUniqueMock: vi.fn(),
  usageMeterUpsertMock: vi.fn(),
  usageMeterFindFirstMock: vi.fn(),
  usageMeterCreateMock: vi.fn(),
  usageMeterUpdateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    feature: {
      findUnique: featureFindUniqueMock,
    },
    usageMeter: {
      upsert: usageMeterUpsertMock,
      findFirst: usageMeterFindFirstMock,
      create: usageMeterCreateMock,
      update: usageMeterUpdateMock,
    },
  },
}))

import { defaultConfig } from '@/lib/metering/config'
import { createMeteringService } from '@/lib/metering/metering'

describe('metering usage meter writes', () => {
  beforeEach(() => {
    featureFindUniqueMock.mockReset()
    usageMeterUpsertMock.mockReset()
    usageMeterFindFirstMock.mockReset()
    usageMeterCreateMock.mockReset()
    usageMeterUpdateMock.mockReset()

    usageMeterFindFirstMock.mockResolvedValue(null)
    usageMeterCreateMock.mockResolvedValue({})
    usageMeterUpdateMock.mockResolvedValue({})
    usageMeterUpsertMock.mockResolvedValue({})
  })

  it('writes meters without compound upsert when featureId is null', async () => {
    const service = createMeteringService(defaultConfig)

    await service.updateUsageMeters(
      {
        tenantId: 'tenant-1',
        featureId: null,
        taskCode: 'GRANT_PREP_CHAT',
      },
      {
        outputTokens: 2920,
      }
    )

    expect(usageMeterUpsertMock).not.toHaveBeenCalled()
    expect(usageMeterFindFirstMock).toHaveBeenCalledTimes(2)
    expect(usageMeterCreateMock).toHaveBeenCalledTimes(2)
    expect(usageMeterCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        featureId: null,
        taskCode: 'GRANT_PREP_CHAT',
        periodType: 'MONTHLY',
        currentUsage: 2920,
      }),
    })
    expect(usageMeterCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        featureId: null,
        taskCode: 'GRANT_PREP_CHAT',
        periodType: 'DAILY',
        currentUsage: 2920,
      }),
    })
  })

  it('reads usage by feature id without validating the id as a feature code', async () => {
    featureFindUniqueMock.mockResolvedValueOnce({ id: 'feature-grant-prep' })
    usageMeterFindFirstMock.mockResolvedValueOnce({ currentUsage: 42 })

    const service = createMeteringService(defaultConfig)
    await expect(
      service.getCurrentUsage('tenant-1', 'feature-grant-prep', 'MONTHLY')
    ).resolves.toBe(42)

    expect(featureFindUniqueMock).toHaveBeenCalledTimes(1)
    expect(featureFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'feature-grant-prep' },
      select: { id: true },
    })
    expect(usageMeterFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        featureId: 'feature-grant-prep',
        periodType: 'MONTHLY',
      }),
    })
  })

  it('falls back to a feature-code lookup when the input is not a feature id', async () => {
    featureFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'feature-grant-prep' })
    usageMeterFindFirstMock.mockResolvedValueOnce({ currentUsage: 17 })

    const service = createMeteringService(defaultConfig)
    await expect(
      service.getCurrentUsage('tenant-1', 'GRANT_PREP', 'DAILY')
    ).resolves.toBe(17)

    expect(featureFindUniqueMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'GRANT_PREP' },
      select: { id: true },
    })
    expect(featureFindUniqueMock).toHaveBeenNthCalledWith(2, {
      where: { code: 'GRANT_PREP' },
      select: { id: true },
    })
  })
})
