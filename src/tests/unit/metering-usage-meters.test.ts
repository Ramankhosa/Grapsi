import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  usageMeterUpsertMock,
  usageMeterFindFirstMock,
  usageMeterCreateMock,
  usageMeterUpdateMock,
} = vi.hoisted(() => ({
  usageMeterUpsertMock: vi.fn(),
  usageMeterFindFirstMock: vi.fn(),
  usageMeterCreateMock: vi.fn(),
  usageMeterUpdateMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
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
})
