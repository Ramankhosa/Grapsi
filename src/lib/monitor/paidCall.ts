import { llmGateway } from '@/lib/metering/gateway'
import { resolveModel } from '@/lib/metering/model-resolver'
import { getProviderFromModelCode } from '@/lib/metering/providers/llm-provider'
import type { TaskCode } from '@/lib/metering/types'
import type { ContentPart } from '@/lib/metering/types'
import { prisma } from '@/lib/prisma'

import { MonitorConfigError, resolveMonitorActor } from './actor'
import {
  markDispatched,
  markUncertain,
  priceFor,
  reserveAttempt,
  settleAttempt,
  tokenMicros,
  type PriceSnapshot,
} from './budget'
import {
  ProviderPausedError,
  breakerState,
  classifyProviderFailure,
  recordProviderFailure,
  recordProviderSuccess,
  type ProviderErrorClass,
  acquireProviderProbe,
} from './providers'
import type { Lease } from './queue'

/**
 * The only way Source Watch spends money on a model.
 *
 * The monitor drives every attempt itself: each gateway call is pinned to one
 * model, with provider/SDK retries and default routing switched off
 * (executionPolicy), so one reservation covers exactly one billable request.
 * Fallback means a NEW attempt with its own reservation, on the next model in
 * the stage's configured order, skipping providers whose breaker is open.
 * Every attempt is a row in monitor_llm_attempts, failures included; a
 * billable failure keeps the usage the provider reported.
 */

export const ROUTING_POLICY_VERSION = 'sw-routing-1'
const TASK_CODE = 'FUNDING_CALL_INGEST' as TaskCode
const INPUT_SAFETY = 1.15
/** Output allowance doubled for reasoning/thinking tokens billed as output. */
const OUTPUT_ALLOWANCE = 2

export class PaidAttemptsExhaustedError extends Error {
  constructor(operationKey: string, attempts: number) {
    super(`All ${attempts} paid attempts for ${operationKey} are used; it needs a deliberate replay`)
    this.name = 'PaidAttemptsExhaustedError'
  }
}

export class PaidStageFailedError extends Error {
  readonly errorClass: ProviderErrorClass
  readonly retryable: boolean
  constructor(message: string, errorClass: ProviderErrorClass, retryable: boolean) {
    super(message)
    this.name = 'PaidStageFailedError'
    this.errorClass = errorClass
    this.retryable = retryable
  }
}

export interface PaidStageInput {
  stage: string
  operationKey: string
  systemPrompt: string
  prompt: string
  jsonSchema: { name: string; schema: Record<string, unknown> }
  maxOutputTokens: number
  scopes: string[]
  lease?: Lease
  /** Locally selected bounded PDF pages only; never provider-fetched URLs. */
  contentParts?: ContentPart[]
  documentTokenAllowance?: number
  memberKeys?: string[]
}

export interface PaidStageResult {
  text: string
  model: string
  attemptId: string
  actualMicros: bigint
  attemptNo: number
}

/** Accept one fenced JSON value; leave prose and invalid output for stage validation. */
function jsonResponseText(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) {
    try { JSON.parse(fenced[1]); return fenced[1].trim() } catch { /* Stage validators reject malformed JSON. */ }
  }
  return text
}

export function estimateTokens(text: string): number {
  // ~4 chars per token for Latin text; Devanagari tokenises denser, so count
  // non-ASCII characters at one token each to stay conservative.
  let ascii = 0
  let other = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4) + other
}

export function reservationFor(price: PriceSnapshot, inputTokens: number, maxOutputTokens: number): bigint {
  return (
    tokenMicros(Math.ceil(inputTokens * INPUT_SAFETY), price.inputCentsPer1M) +
    tokenMicros(maxOutputTokens * OUTPUT_ALLOWANCE, price.outputCentsPer1M)
  )
}

function actualCost(price: PriceSnapshot, usage: Record<string, unknown>): bigint {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return (
    tokenMicros(n(usage.inputTokens), price.inputCentsPer1M) +
    tokenMicros(n(usage.outputTokens) + n(usage.thoughtTokens), price.outputCentsPer1M)
  )
}

export function maxPaidAttempts(): number {
  const value = Number(process.env.MONITOR_MAX_PAID_ATTEMPTS)
  return Number.isFinite(value) && value > 0 ? Math.min(5, Math.floor(value)) : 3
}

/** The stage's ordered model list. Refuses to run on an unconfigured stage. */
export async function stageModels(stage: string): Promise<{ models: string[]; maxTokensOut?: number }> {
  const actor = await resolveMonitorActor()
  const resolution = await resolveModel(actor.planId, TASK_CODE, stage)
  if (resolution.source !== 'stage') {
    throw new MonitorConfigError(
      'STAGE_NOT_CONFIGURED',
      `LLM stage ${stage} has no model configured for the platform plan (resolved from ${resolution.source}). Run the LLM model seed.`
    )
  }
  const models = [...new Set([resolution.modelCode, ...resolution.fallbacks.map((f) => f.modelCode)])]
  if (new Set(models.map(getProviderFromModelCode)).size < 2) throw new MonitorConfigError('INDEPENDENT_FALLBACK_REQUIRED', `${stage} requires a fallback on a different provider account`)
  return { models, maxTokensOut: resolution.maxTokensOut }
}

export async function runPaidStage(input: PaidStageInput): Promise<PaidStageResult> {
  if (process.env.MONITOR_PAID_WORK_ENABLED !== 'true') throw new MonitorConfigError('PAID_WORK_DISABLED', 'Paid Source Watch work is disabled until its actor, provider and budgets are verified')
  const actor = await resolveMonitorActor()
  const { models } = await stageModels(input.stage)
  const previous = await prisma.monitorLlmAttempt.count({ where: { operation_key: input.operationKey } })
  const limit = maxPaidAttempts()
  if (previous >= limit) throw new PaidAttemptsExhaustedError(input.operationKey, previous)

  // Some independent fallback providers do not consume response_format. Carry
  // the schema in the prompt too so they receive the same output contract.
  const fullPrompt = `${input.systemPrompt.trim()}\n\nReturn only a JSON value matching this schema, without Markdown fences or commentary:\n${JSON.stringify(input.jsonSchema.schema)}\n\n${input.prompt.trim()}`
  // UTF-8 bytes conservatively bound text token counts, including the schema
  // and a protocol envelope. The cheap packing estimator is not a spend cap.
  const inputTokens = Buffer.byteLength(fullPrompt + JSON.stringify(input.jsonSchema), 'utf8') + 1024 + (input.documentTokenAllowance ?? 0)
  let attemptNo = previous + 1
  let lastClass: ProviderErrorClass = 'TRANSIENT'
  let lastMessage = 'no model was available'
  let pausedUntil: Date | null = null
  let pausedAccount = ''

  for (const model of models) {
    if (attemptNo > limit) break
    const account = getProviderFromModelCode(model)
    const breaker = await breakerState(account)
    if (breaker.state === 'OPEN') {
      if (!pausedUntil || (breaker.retryAt && breaker.retryAt < pausedUntil)) {
        pausedUntil = breaker.retryAt ?? null
        pausedAccount = account
      }
      lastClass = (breaker.reason as ProviderErrorClass) ?? 'TRANSIENT'
      continue
    }
    if (breaker.state === 'HALF_OPEN' && !await acquireProviderProbe(account)) continue

    const price = await priceFor(model)
    if (price.inputCentsPer1M <= 0 || price.outputCentsPer1M <= 0) throw new MonitorConfigError('MODEL_PRICE_MISSING', `A positive price snapshot is required for ${model}`)
    const attemptId = await reserveAttempt({
      operationKey: input.operationKey,
      attemptNo,
      stage: input.stage,
      model,
      provider: account,
      price,
      reservedMaxMicros: reservationFor(price, inputTokens, input.maxOutputTokens),
      scopes: [...new Set(['PLATFORM', ...input.scopes, ...(input.lease?.siteId ? [`SITE:${input.lease.siteId}`] : [])])],
      taskId: input.lease?.taskId ?? null,
      leaseGeneration: input.lease?.generation ?? null,
      memberKeys: input.memberKeys,
      memberAttemptLimit: limit,
    })
    attemptNo += 1
    await markDispatched(attemptId)

    let result: Awaited<ReturnType<typeof llmGateway.executeLLMOperation>>
    try {
      result = await llmGateway.executeLLMOperation(
        { tenantContext: actor.tenantContext },
        {
          taskCode: TASK_CODE,
          stageCode: input.stage,
          prompt: fullPrompt,
          ...(input.contentParts?.length ? { content: { parts: [{ type: 'text', text: fullPrompt }, ...input.contentParts] } } : {}),
          inputTokens: estimateTokens(fullPrompt + JSON.stringify(input.jsonSchema)) + (input.documentTokenAllowance ?? 0),
          parameters: {
            temperature: 0,
            maxTokensOut: input.maxOutputTokens,
            response_format: {
              type: 'json_schema',
              json_schema: { name: input.jsonSchema.name, schema: input.jsonSchema.schema, strict: true },
            },
            responseJsonSchema: input.jsonSchema.schema,
            responseSchema: input.jsonSchema.schema,
            responseMimeType: 'application/json',
          },
          metadata: {
            skipFeaturePolicy: true,
            module: 'source-watch',
            action: input.stage,
            primaryModelCode: model,
            disableModelFallbacks: true,
            executionPolicy: { maxProviderAttempts: 1, noDefaultRouting: true, requestTimeoutMs: 60_000 },
            operationKey: input.operationKey,
            attemptNo: attemptNo - 1,
          },
          idempotencyKey: `${input.operationKey}:${attemptNo - 1}`,
        } as Parameters<typeof llmGateway.executeLLMOperation>[1]
      )
    } catch (error) {
      // The gateway normally returns failures; a throw here means we cannot
      // know whether the provider accepted the request.
      await markUncertain(attemptId, error instanceof Error ? error.message : String(error))
      lastClass = 'TIMEOUT'
      lastMessage = error instanceof Error ? error.message : String(error)
      continue
    }

    if (result.success && result.response?.output?.trim()) {
      const meta = (result.response.metadata ?? {}) as Record<string, unknown>
      const usage = {
        inputTokens: meta.inputTokens,
        outputTokens: meta.outputTokens,
        thoughtTokens: meta.thoughtTokens,
        modelUsed: meta.modelUsed,
      }
      // Missing usage is not evidence of a free request. Keep a conservative
      // charge until an operator can reconcile the provider's receipt.
      const actual = typeof meta.inputTokens === 'number' && typeof meta.outputTokens === 'number' ? actualCost(price, usage) : reservationFor(price, inputTokens, input.maxOutputTokens)
      await settleAttempt(attemptId, { status: 'SUCCEEDED', actualMicros: actual, usage })
      await recordProviderSuccess(account)
      return { text: jsonResponseText(result.response.output), model, attemptId, actualMicros: actual, attemptNo: attemptNo - 1 }
    }

    const details = (result.error?.details ?? {}) as Record<string, unknown>
    const errorClass = result.success && !result.response?.output?.trim() ? 'INVALID_OUTPUT' : classifyProviderFailure(details, result.error?.message)
    lastClass = errorClass
    lastMessage = String(details.providerMessage ?? result.error?.message ?? 'provider failed')
    const responseUsage = result.response?.metadata
    const billable = (details.billableUsage ?? (typeof responseUsage?.inputTokens === 'number' ? responseUsage : undefined)) as Record<string, unknown> | undefined
    if (billable) {
      await settleAttempt(attemptId, {
        status: 'FAILED_BILLABLE',
        actualMicros: actualCost(price, billable),
        usage: billable,
        requestId: (details.providerRequestId as string) ?? null,
        errorClass,
        errorMessage: lastMessage,
      })
    } else if (errorClass === 'TIMEOUT' || errorClass === 'TRANSIENT' || errorClass === 'INVALID_OUTPUT') {
      await markUncertain(attemptId, lastMessage)
    } else {
      await settleAttempt(attemptId, {
        status: 'FAILED_UNBILLED',
        actualMicros: 0n,
        requestId: (details.providerRequestId as string) ?? null,
        errorClass,
        errorMessage: lastMessage,
      })
    }
    await recordProviderFailure(account, errorClass, details)
    if (errorClass === 'BILLING' || errorClass === 'AUTH') {
      const state = await breakerState(account)
      pausedUntil = state.retryAt ?? new Date(Date.now() + 30 * 60 * 1000)
      pausedAccount = account
    }
    // A pinned model may reject a capability another configured provider
    // supports. Trying it is a separate, separately reserved attempt.
  }

  // Paused only when EVERY model's provider is open: one healthy account
  // means the work is retryable now, not paused.
  if (pausedUntil) {
    const states = await Promise.all(models.map(async (m) => (await breakerState(getProviderFromModelCode(m))).state))
    if (states.every((state) => state === 'OPEN')) throw new ProviderPausedError(pausedAccount, lastClass, pausedUntil)
  }
  if (attemptNo > limit) throw new PaidAttemptsExhaustedError(input.operationKey, attemptNo - 1)
  throw new PaidStageFailedError(lastMessage, lastClass, lastClass !== 'CONFIG')
}

/** Local schema/citation validation can fail after a provider billed successfully. */
export async function recordInvalidOutput(attemptId: string, message: string) {
  await prisma.monitorLlmAttempt.updateMany({ where: { id: attemptId, status: 'SUCCEEDED' }, data: { status: 'FAILED_BILLABLE', error_class: 'INVALID_OUTPUT', error_message: message.slice(0, 1000) } })
}
