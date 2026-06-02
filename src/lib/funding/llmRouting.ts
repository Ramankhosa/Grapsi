import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

import prisma from '@/lib/prisma'
import { llmGateway, type ContentPart, type TenantContext } from '@/lib/metering'
import type { TaskCode } from '@/lib/prisma-generated'

export const FUNDING_CALL_INGEST_TASK_CODE = 'FUNDING_CALL_INGEST' as TaskCode
export const FUNDING_CALL_INGEST_PDF_STAGE_CODE = 'FUNDING_CALL_INGEST_PDF'
export const FUNDING_CALL_INGEST_TEXT_STAGE_CODE = 'FUNDING_CALL_INGEST_TEXT'
export const FUNDING_CHAT_TASK_CODE = 'FUNDING_CHAT' as TaskCode
export const FUNDING_CHAT_ORCHESTRATOR_STAGE_CODE = 'FUNDING_CHAT_ORCHESTRATOR'
export const FUNDING_CHAT_NARRATIVE_STAGE_CODE = 'FUNDING_CHAT_NARRATIVE'
export const FUNDING_CHAT_QUERY_ENRICHMENT_STAGE_CODE = 'FUNDING_CHAT_QUERY_ENRICHMENT'
export const FUNDING_TEMPLATE_EXTRACT_TASK_CODE = 'FUNDING_TEMPLATE_EXTRACT' as TaskCode
export const FUNDING_TEMPLATE_TEXT_STAGE_CODE = 'FUNDING_TEMPLATE_EXTRACT_TEXT'
export const FUNDING_TEMPLATE_MULTIMODAL_STAGE_CODE = 'FUNDING_TEMPLATE_EXTRACT_MULTIMODAL'
export const FUNDING_GUIDELINE_EXTRACT_TASK_CODE = 'FUNDING_GUIDELINE_EXTRACT' as TaskCode
export const FUNDING_GUIDELINE_TEXT_STAGE_CODE = 'FUNDING_GUIDELINE_EXTRACT_TEXT'

export interface FundingLlmRoutingContext {
  tenantId?: string | null
  userId?: string | null
  planId?: string | null
}

export interface FundingGatewayExtractionResult {
  model: string
  rawText: string
  metadata?: Record<string, unknown>
}

export interface FundingGatewayStructuredSchema {
  name: string
  schema: unknown
  strict?: boolean
}

async function getActivePlanIdForTenant(tenantId?: string | null): Promise<string | null> {
  if (!tenantId) {
    return null
  }

  const now = new Date()
  const tenantPlan = await prisma.tenantPlan.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      effectiveFrom: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { planId: true },
  })

  return tenantPlan?.planId || null
}

async function getPlatformFundingControlPlanId(): Promise<string | null> {
  const configuredPlan = (
    process.env.FUNDING_LLM_CONTROL_PLAN_ID ||
    process.env.FUNDING_LLM_CONTROL_PLAN_CODE ||
    ''
  ).trim()

  if (configuredPlan) {
    const plan = await prisma.plan.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [{ id: configuredPlan }, { code: configuredPlan }],
      },
      select: { id: true },
    })

    if (plan?.id) {
      return plan.id
    }

    console.warn(`[Funding LLM] Configured control plan was not found or inactive: ${configuredPlan}`)
  }

  for (const code of ['PRO_PLAN', 'ENTERPRISE_PLAN', 'FREE_PLAN']) {
    const preferredPlan = await prisma.plan.findFirst({
      where: {
        status: 'ACTIVE',
        code,
      },
      select: { id: true },
    })

    if (preferredPlan?.id) {
      return preferredPlan.id
    }
  }

  const planWithFundingConfig = await prisma.planStageModelConfig.findFirst({
    where: {
      isActive: true,
      plan: { status: 'ACTIVE' },
      stage: {
        code: { in: [FUNDING_CALL_INGEST_PDF_STAGE_CODE, FUNDING_CALL_INGEST_TEXT_STAGE_CODE] },
      },
    },
    orderBy: { createdAt: 'asc' },
    select: { planId: true },
  })

  if (planWithFundingConfig?.planId) {
    return planWithFundingConfig.planId
  }

  const firstActivePlan = await prisma.plan.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { code: 'asc' },
    select: { id: true },
  })

  return firstActivePlan?.id || null
}

export async function resolveFundingLlmTenantContext(
  context?: FundingLlmRoutingContext | null
): Promise<TenantContext | null> {
  const explicitPlanId = context?.planId?.trim() || null
  const activeTenantPlanId = explicitPlanId || (await getActivePlanIdForTenant(context?.tenantId))
  const planId = activeTenantPlanId || await getPlatformFundingControlPlanId()

  if (!planId) {
    return null
  }

  return {
    tenantId: context?.tenantId || 'platform-funding-ingestion',
    planId,
    userId: context?.userId || 'system',
  }
}

function buildGatewayPrompt(prompt: string, systemPrompt?: string): string {
  const trimmedPrompt = prompt.trim()
  const trimmedSystemPrompt = (systemPrompt || '').trim()

  if (!trimmedSystemPrompt) {
    return trimmedPrompt
  }

  return `${trimmedSystemPrompt}\n\n${trimmedPrompt}`
}

export async function runFundingGatewayExtraction(options: {
  stageCode: string
  prompt: string
  systemPrompt?: string
  context?: FundingLlmRoutingContext | null
  contentParts?: ContentPart[]
  maxTokensOut?: number
  temperature?: number
  responseMimeType?: string
  promptCacheKey?: string
  promptCacheRetention?: 'in_memory' | '24h'
  structuredSchema?: FundingGatewayStructuredSchema
  metadata?: Record<string, unknown>
}): Promise<FundingGatewayExtractionResult | null> {
  const tenantContext = await resolveFundingLlmTenantContext(options.context)
  if (!tenantContext) {
    return null
  }

  const fullPrompt = buildGatewayPrompt(options.prompt, options.systemPrompt)
  const content = options.contentParts
    ? {
        parts: [
          { type: 'text' as const, text: fullPrompt },
          ...options.contentParts,
        ],
      }
    : undefined

  const result = await llmGateway.executeLLMOperation(
    { tenantContext },
    {
      taskCode: FUNDING_CALL_INGEST_TASK_CODE,
      stageCode: options.stageCode,
      prompt: content ? undefined : fullPrompt,
      content,
      parameters: {
        temperature: options.temperature ?? 0,
        response_format: options.structuredSchema
          ? {
              type: 'json_schema',
              json_schema: {
                name: options.structuredSchema.name,
                schema: options.structuredSchema.schema,
                strict: options.structuredSchema.strict ?? true,
              },
            }
          : { type: 'json_object' },
        responseMimeType: options.responseMimeType || 'application/json',
        ...(options.structuredSchema
          ? {
              responseJsonSchema: options.structuredSchema.schema,
              responseSchema: options.structuredSchema.schema,
            }
          : {}),
        ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
        ...(options.promptCacheRetention ? { prompt_cache_retention: options.promptCacheRetention } : {}),
        ...(options.maxTokensOut ? { maxTokensOut: options.maxTokensOut } : {}),
      },
      metadata: {
        skipFeaturePolicy: true,
        module: 'funding',
        action: options.stageCode,
        ...options.metadata,
      },
      idempotencyKey: crypto.randomUUID(),
    }
  )

  if (!result.success || !result.response?.output) {
    throw new Error(result.error?.message || `Funding LLM gateway request failed for ${options.stageCode}`)
  }

  return {
    model: result.response.modelClass,
    rawText: result.response.output,
    metadata: result.response.metadata,
  }
}

export async function runFundingGatewayText(options: {
  taskCode: TaskCode
  stageCode: string
  prompt: string
  systemPrompt?: string
  context?: FundingLlmRoutingContext | null
  contentParts?: ContentPart[]
  maxTokensOut?: number
  temperature?: number
  responseMimeType?: string
  promptCacheKey?: string
  promptCacheRetention?: 'in_memory' | '24h'
  structuredSchema?: FundingGatewayStructuredSchema
  metadata?: Record<string, unknown>
  skipFeaturePolicy?: boolean
}): Promise<FundingGatewayExtractionResult | null> {
  const tenantContext = await resolveFundingLlmTenantContext(options.context)
  if (!tenantContext) {
    return null
  }

  const fullPrompt = buildGatewayPrompt(options.prompt, options.systemPrompt)
  const content = options.contentParts
    ? {
        parts: [
          { type: 'text' as const, text: fullPrompt },
          ...options.contentParts,
        ],
      }
    : undefined
  const result = await llmGateway.executeLLMOperation(
    { tenantContext },
    {
      taskCode: options.taskCode,
      stageCode: options.stageCode,
      prompt: content ? undefined : fullPrompt,
      content,
      parameters: {
        temperature: options.temperature ?? 0,
        ...(options.structuredSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: options.structuredSchema.name,
                  schema: options.structuredSchema.schema,
                  strict: options.structuredSchema.strict ?? true,
                },
              },
              responseJsonSchema: options.structuredSchema.schema,
              responseSchema: options.structuredSchema.schema,
            }
          : {}),
        ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
        ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
        ...(options.promptCacheRetention ? { prompt_cache_retention: options.promptCacheRetention } : {}),
        ...(options.maxTokensOut ? { maxTokensOut: options.maxTokensOut } : {}),
      },
      metadata: {
        module: 'funding',
        action: options.stageCode,
        ...(options.skipFeaturePolicy ? { skipFeaturePolicy: true } : {}),
        ...options.metadata,
      },
      idempotencyKey: crypto.randomUUID(),
    }
  )

  if (!result.success || !result.response?.output) {
    throw new Error(result.error?.message || `Funding LLM gateway request failed for ${options.stageCode}`)
  }

  return {
    model: result.response.modelClass,
    rawText: result.response.output,
    metadata: result.response.metadata,
  }
}

export async function buildPdfFileContentPart(storagePath: string): Promise<ContentPart> {
  const absolutePath = path.isAbsolute(storagePath)
    ? storagePath
    : path.join(process.cwd(), storagePath)
  const fileBuffer = await fs.readFile(absolutePath)

  return {
    type: 'file',
    file: {
      mimeType: 'application/pdf',
      data: fileBuffer.toString('base64'),
      filename: path.basename(absolutePath),
    },
  }
}
