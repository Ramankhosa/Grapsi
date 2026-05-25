import { prisma } from '@/lib/prisma'
import type { FeatureCode, LLMResponse, TaskCode } from './types'
import { calculateCost, ensurePricingLoaded, getProviderFromModel, logLLMCost, type CostBreakdown } from './cost-calculator'

export interface LLMUsageOperation {
  operation: string
  taskCode?: string | null
  stageCode?: string | null
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  totalTokens: number
  inputCostUsd: number
  outputCostUsd: number
  thoughtCostUsd: number
  actualCostUsd: number
  contingencyCostUsd: number
  durationMs?: number | null
}

export interface LLMUsageTotal {
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  totalTokens: number
  actualCostUsd: number
  contingencyCostUsd: number
}

export interface LLMUsageSummary {
  operations: LLMUsageOperation[]
  total: LLMUsageTotal
}

export interface StandaloneUsageLogInput {
  tenantId: string
  userId?: string | null
  featureCode?: FeatureCode | string | null
  taskCode?: TaskCode | string | null
  operation: string
  stageCode?: string | null
  modelClass: string
  inputTokens?: number | null
  outputTokens?: number | null
  thoughtTokens?: number | null
  apiCode?: string | null
  apiCalls?: number | null
  idempotencyKey?: string | null
  status?: 'COMPLETED' | 'FAILED'
  error?: string | null
  startedAt?: Date
  completedAt?: Date
  metadata?: Record<string, unknown> | null
  skipTerminalLog?: boolean
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function normalizeTokenCount(value: unknown): number {
  const parsed = readNumber(value)
  return parsed && parsed > 0 ? Math.floor(parsed) : 0
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function buildOperationFromCost(input: {
  operation: string
  taskCode?: string | null
  stageCode?: string | null
  model: string
  provider?: string | null
  durationMs?: number | null
  cost: CostBreakdown
}): LLMUsageOperation {
  return {
    operation: input.operation,
    taskCode: input.taskCode || null,
    stageCode: input.stageCode || null,
    model: input.model,
    provider: input.provider || input.cost.provider || getProviderFromModel(input.model),
    inputTokens: input.cost.inputTokens,
    outputTokens: input.cost.outputTokens,
    thoughtTokens: input.cost.thoughtTokens,
    totalTokens: input.cost.totalTokens,
    inputCostUsd: input.cost.inputCost,
    outputCostUsd: input.cost.outputCost,
    thoughtCostUsd: input.cost.thoughtCost,
    actualCostUsd: input.cost.actualCost,
    contingencyCostUsd: input.cost.contingencyCost,
    durationMs: input.durationMs ?? null,
  }
}

export function estimateTokensFromText(value: string | null | undefined): number {
  if (!value) return 0
  const hasJson = value.includes('{') && value.includes('}')
  const hasCode = /\b(function|const|import|class)\b/.test(value)
  const charsPerToken = hasJson ? 2.5 : hasCode ? 3 : 4
  return Math.ceil(value.length / charsPerToken)
}

export function extractLLMUsageOperation(input: {
  response?: LLMResponse | null
  operation: string
  taskCode?: string | null
  stageCode?: string | null
  fallbackModel?: string | null
}): LLMUsageOperation | null {
  const response = input.response
  if (!response) return null

  const metadata = readRecord(response.metadata)
  const tokenUsage = readRecord(metadata.tokenUsage)
  const costBreakdown = readRecord(metadata.costBreakdown)
  const model = String(
    metadata.modelUsed ||
    metadata.model ||
    response.modelClass ||
    input.fallbackModel ||
    'unknown'
  )
  const provider = String(metadata.selectedProvider || metadata.provider || getProviderFromModel(model))
  const inputTokens = normalizeTokenCount(
    tokenUsage.inputTokens ??
    metadata.inputTokens
  )
  const outputTokens = normalizeTokenCount(
    tokenUsage.outputTokens ??
    metadata.outputTokens ??
    response.outputTokens
  )
  const thoughtTokens = normalizeTokenCount(
    tokenUsage.thoughtTokens ??
    metadata.thoughtTokens
  )
  const durationMs = readNumber(metadata.durationMs)

  const cost = Object.keys(costBreakdown).length > 0
    ? {
        inputTokens,
        outputTokens,
        thoughtTokens,
        totalTokens: normalizeTokenCount(costBreakdown.totalTokens) || inputTokens + outputTokens + thoughtTokens,
        inputCost: readNumber(costBreakdown.inputCost) ?? 0,
        outputCost: readNumber(costBreakdown.outputCost) ?? 0,
        thoughtCost: readNumber(costBreakdown.thoughtCost) ?? 0,
        actualCost: readNumber(costBreakdown.actualCost) ?? 0,
        contingencyCost: readNumber(costBreakdown.contingencyCost) ?? 0,
        modelCode: model,
        provider,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        thoughtPricePerMillion: 0,
      } satisfies CostBreakdown
    : calculateCost(model, inputTokens, outputTokens, thoughtTokens)

  return buildOperationFromCost({
    operation: input.operation,
    taskCode: input.taskCode,
    stageCode: input.stageCode,
    model,
    provider,
    durationMs,
    cost,
  })
}

export function summarizeLLMUsage(operations: Array<LLMUsageOperation | null | undefined>): LLMUsageSummary {
  const normalized = operations.filter((operation): operation is LLMUsageOperation => Boolean(operation))
  const total = normalized.reduce<LLMUsageTotal>((acc, operation) => {
    acc.inputTokens += operation.inputTokens
    acc.outputTokens += operation.outputTokens
    acc.thoughtTokens += operation.thoughtTokens
    acc.totalTokens += operation.totalTokens
    acc.actualCostUsd += operation.actualCostUsd
    acc.contingencyCostUsd += operation.contingencyCostUsd
    return acc
  }, {
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    totalTokens: 0,
    actualCostUsd: 0,
    contingencyCostUsd: 0,
  })

  return { operations: normalized, total }
}

export function getStoredUsageLogActualCost(meta: unknown): number | null {
  const payload = typeof meta === 'string'
    ? (() => {
        try {
          return JSON.parse(meta) as unknown
        } catch {
          return null
        }
      })()
    : meta
  const record = readRecord(payload)
  const cost = readRecord(record.cost)
  const actualCost = readNumber(cost.actualCost)
  return actualCost !== null && Number.isFinite(actualCost) ? actualCost : null
}

export async function recordStandaloneLLMUsage(input: StandaloneUsageLogInput): Promise<LLMUsageOperation | null> {
  if (!input.tenantId || !input.modelClass) {
    return null
  }

  const startedAt = input.startedAt || new Date()
  const completedAt = input.completedAt || new Date()
  const inputTokens = normalizeTokenCount(input.inputTokens)
  const outputTokens = normalizeTokenCount(input.outputTokens)
  const thoughtTokens = normalizeTokenCount(input.thoughtTokens)
  await ensurePricingLoaded()
  const cost = input.skipTerminalLog
    ? calculateCost(input.modelClass, inputTokens, outputTokens, thoughtTokens)
    : logLLMCost(
        input.operation,
        input.modelClass,
        inputTokens,
        outputTokens,
        thoughtTokens,
        {
          taskCode: input.taskCode || undefined,
          stageCode: input.stageCode || undefined,
          userId: input.userId || undefined,
          tenantId: input.tenantId,
          module: typeof input.metadata?.module === 'string' ? input.metadata.module : undefined,
          action: typeof input.metadata?.action === 'string' ? input.metadata.action : input.operation,
          duration: completedAt.getTime() - startedAt.getTime(),
        }
      )
  const operation = buildOperationFromCost({
    operation: input.operation,
    taskCode: input.taskCode,
    stageCode: input.stageCode,
    model: input.modelClass,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    cost,
  })

  try {
    const feature = input.featureCode
      ? await prisma.feature.findUnique({
          where: { code: input.featureCode as FeatureCode },
          select: { id: true },
        })
      : null

    await prisma.usageLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId || undefined,
        featureId: feature?.id || undefined,
        taskCode: input.taskCode ? input.taskCode as TaskCode : undefined,
        modelClass: input.modelClass,
        apiCode: input.apiCode || undefined,
        inputTokens,
        outputTokens,
        apiCalls: input.apiCalls || 1,
        startedAt,
        completedAt,
        status: input.status || 'COMPLETED',
        error: input.error || undefined,
        idempotencyKey: input.idempotencyKey || undefined,
        meta: {
          ...(input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : {}),
          operation: input.operation,
          stageCode: input.stageCode || null,
          thoughtTokens,
          totalTokens: operation.totalTokens,
          cost: {
            actualCost: operation.actualCostUsd,
            contingencyCost: operation.contingencyCostUsd,
            inputCost: operation.inputCostUsd,
            outputCost: operation.outputCostUsd,
            thoughtCost: operation.thoughtCostUsd,
          },
        },
      },
    })
  } catch (error: any) {
    if (error?.code === 'P2003') {
      console.warn(`[LLMUsage] Skipping usage log for ${input.operation}: missing related task/feature row`)
    } else {
      console.warn(`[LLMUsage] Failed to write usage log for ${input.operation}:`, error)
    }
  }

  return operation
}
