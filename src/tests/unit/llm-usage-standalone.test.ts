import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  feature: {
    findUnique: vi.fn(),
  },
  task: {
    findUnique: vi.fn(),
  },
  usageLog: {
    create: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/metering/cost-calculator', () => ({
  ensurePricingLoaded: vi.fn(),
  getProviderFromModel: vi.fn(() => 'test-provider'),
  calculateCost: vi.fn((modelClass: string, inputTokens: number, outputTokens: number, thoughtTokens: number) => ({
    inputTokens,
    outputTokens,
    thoughtTokens,
    totalTokens: inputTokens + outputTokens + thoughtTokens,
    inputCost: 0.001,
    outputCost: 0.002,
    thoughtCost: 0.003,
    actualCost: 0.006,
    contingencyCost: 0.0066,
    modelCode: modelClass,
    provider: 'test-provider',
    inputPricePerMillion: 1,
    outputPricePerMillion: 1,
    thoughtPricePerMillion: 1,
  })),
  logLLMCost: vi.fn(),
}))

import { recordStandaloneLLMUsage } from '@/lib/metering/llm-usage'

describe('recordStandaloneLLMUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes feature and task foreign keys when metering rows exist', async () => {
    prismaMock.feature.findUnique.mockResolvedValue({ id: 'feature-1' })
    prismaMock.task.findUnique.mockResolvedValue({ code: 'FUNDING_CALL_INGEST' })
    prismaMock.usageLog.create.mockResolvedValue({})

    await recordStandaloneLLMUsage({
      tenantId: 'tenant-1',
      userId: 'user-1',
      featureCode: 'FUNDING_DISCOVERY',
      taskCode: 'FUNDING_CALL_INGEST',
      operation: 'funding_call_core_extraction',
      stageCode: 'FUNDING_CALL_INGEST_TEXT',
      modelClass: 'deepseek-v4-pro',
      inputTokens: 100,
      outputTokens: 20,
      skipTerminalLog: true,
    })

    expect(prismaMock.usageLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        featureId: 'feature-1',
        taskCode: 'FUNDING_CALL_INGEST',
      }),
    }))
  })

  it('still writes usage without broken foreign keys when feature and task rows are missing', async () => {
    prismaMock.feature.findUnique.mockResolvedValue(null)
    prismaMock.task.findUnique.mockResolvedValue(null)
    prismaMock.usageLog.create.mockResolvedValue({})

    await recordStandaloneLLMUsage({
      tenantId: 'tenant-1',
      featureCode: 'FUNDING_DISCOVERY',
      taskCode: 'FUNDING_TEMPLATE_EXTRACT',
      operation: 'FUNDING_TEMPLATE_EXTRACT_TEXT',
      stageCode: 'FUNDING_TEMPLATE_EXTRACT_TEXT',
      modelClass: 'deepseek-v4-pro',
      inputTokens: 100,
      outputTokens: 20,
      skipTerminalLog: true,
    })

    expect(prismaMock.usageLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        featureId: undefined,
        taskCode: undefined,
        meta: expect.objectContaining({
          featureCode: 'FUNDING_DISCOVERY',
          taskCode: 'FUNDING_TEMPLATE_EXTRACT',
          unresolvedFeatureCode: 'FUNDING_DISCOVERY',
          unresolvedTaskCode: 'FUNDING_TEMPLATE_EXTRACT',
        }),
      }),
    }))
  })
})
