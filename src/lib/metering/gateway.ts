// Central LLM Service Gateway
// Single point of control for all LLM operations with provider routing
//
// LLM MODEL ACCESS CONTROL:
// - Which plans can use which LLM models is controlled ONLY by Super Admin
// - Via PlanLLMAccess table (backward compatible) OR
// - Via PlanStageModelConfig/PlanTaskModelConfig (new flexible system)
// - Tenants have NO control over LLM model routing
//
// MODEL RESOLUTION PRIORITY:
// 1. Stage-specific config (if stage is provided)
// 2. Task-specific config
// 3. Plan defaults (PlanLLMAccess)
// 4. System default model
//
// ORGANIZATIONAL SERVICE ACCESS (teams/users):
// - Handled separately at API route level, NOT in LLM gateway
// - Team service toggles are for feature availability, not model access

import type {
  TenantContext,
  FeatureRequest,
  EnforcementDecision,
  UsageStats,
  TaskCode,
  FeatureCode,
  LLMRequest,
  LLMResponse
} from './types'
import { MeteringError } from './errors'
import { createMeteringSystem } from './system'
import { extractTenantContextFromRequest } from './auth-bridge'
import { llmProviderRouter } from './providers/provider-router'
import { resolveModel, type ModelResolutionResult } from './model-resolver'
import { recordStandaloneLLMUsage } from './llm-usage'

// === CENTRAL GATEWAY SERVICE ===

export class LLMGateway {
  private system = createMeteringSystem()

  /**
   * Execute LLM operation with automatic model resolution
   * 
   * @param request - Request with headers or tenant context
   * @param llmRequest - LLM request with taskCode and optional stageCode
   * @returns Response with success status and LLM output
   * 
   * Model Resolution Priority:
   * 1. If stageCode is provided: Look up PlanStageModelConfig
   * 2. If taskCode only: Look up PlanTaskModelConfig  
   * 3. Fall back to PlanLLMAccess (backward compatible)
   * 4. Fall back to system default model
   */
  async executeLLMOperation(
    request: { headers: Record<string, string> } | { tenantContext: TenantContext },
    llmRequest: LLMRequest & { stageCode?: string }
  ): Promise<{ success: boolean; response?: LLMResponse; error?: MeteringError }> {
    // Declare decision outside try block so we can release reservation in catch block
    let decision: any = null
    
    try {
      // 1. Extract tenant context from request (existing metering hierarchy)
      const tenantContext = await extractTenantContextFromRequest(request)
      if (!tenantContext) {
        return {
          success: false,
          error: new MeteringError('TENANT_UNRESOLVED', 'Unable to resolve tenant context')
        }
      }

      // 2. Ensure we have a reasonable input token estimate if caller did not supply one
      if (typeof llmRequest.inputTokens !== 'number' || llmRequest.inputTokens <= 0) {
        llmRequest.inputTokens = this.estimateInputTokens(llmRequest)
      }

      const skipFeaturePolicy = llmRequest.metadata?.skipFeaturePolicy === true

      if (skipFeaturePolicy) {
        decision = { allowed: true }
      } else {
        // 3. Create feature request for metering
        const featureRequest: FeatureRequest = {
          tenantId: tenantContext.tenantId,
          featureCode: this.getFeatureForTask(llmRequest.taskCode),
          taskCode: llmRequest.taskCode,
          userId: tenantContext.userId,
          metadata: {
            idempotencyKey: llmRequest.idempotencyKey || crypto.randomUUID(),
            stageCode: llmRequest.stageCode
          }
        }

        // 4. Enforce metering policies (Super Admin controlled via Plan Features)
        try {
          decision = await this.system.policy.evaluateAccess(featureRequest)
        } catch (policyError) {
          if (policyError instanceof MeteringError) {
            return {
              success: false,
              error: policyError
            }
          }
          // Re-throw unexpected errors
          throw policyError
        }

        if (!decision.allowed) {
          // This shouldn't happen anymore since policy now throws MeteringError
          return {
            success: false,
            error: new MeteringError('POLICY_VIOLATION', decision.reason || 'Access denied')
          }
        }
      }

      // 5. Resolve the model to use based on plan, task, and optional stage
      let modelResolution: ModelResolutionResult | null = null
      console.log(`[Gateway] Resolving model for tenant=${tenantContext.tenantId}, planId=${tenantContext.planId || 'NONE'}, taskCode=${llmRequest.taskCode}, stageCode=${llmRequest.stageCode || 'none'}`)
      
      if (tenantContext.planId) {
        try {
          modelResolution = await resolveModel(
            tenantContext.planId,
            llmRequest.taskCode,
            llmRequest.stageCode
          )
          
          // Apply stage-specific limits if configured (both input and output)
          // Stage limits should override plan defaults, not be capped by them
          if (modelResolution.maxTokensOut) {
            decision.maxTokensOut = modelResolution.maxTokensOut
          }

          // Apply maxTokensIn from stage config (NEW: enforce input limits)
          if (modelResolution.maxTokensIn) {
            decision.maxTokensIn = modelResolution.maxTokensIn
          }
          
          console.log(`[Gateway] ✓ Model resolved: ${modelResolution.modelCode} (source: ${modelResolution.source}, provider: ${modelResolution.provider})`)
          if (modelResolution.source === 'system-default') {
            console.warn(`[Gateway] ⚠️ Using SYSTEM DEFAULT model - no specific config found for plan=${tenantContext.planId}, task=${llmRequest.taskCode}`)
          }
          if (modelResolution.fallbacks.length > 0) {
            console.log(`[Gateway]   Fallbacks: ${modelResolution.fallbacks.map(f => f.modelCode).join(' → ')}`)
          } else {
            console.log(`[Gateway]   No fallback models configured`)
          }
        } catch (resolveError) {
          // Log error details for debugging but continue with fallback
          console.error('[Gateway] ✗ Model resolution FAILED:', {
            error: resolveError instanceof Error ? resolveError.message : resolveError,
            planId: tenantContext.planId,
            taskCode: llmRequest.taskCode,
            stageCode: llmRequest.stageCode
          })
          console.warn('[Gateway] ⚠️ Falling back to DEFAULT PROVIDER ROUTING (model resolution error)')
        }
      } else {
        console.warn('[Gateway] ⚠️ No planId in tenant context - using DEFAULT PROVIDER ROUTING')
        console.warn('[Gateway]   This will NOT honor plan-specific LLM configurations!')
      }

      const requestedPrimaryModel = typeof llmRequest.metadata?.primaryModelCode === 'string'
        ? llmRequest.metadata.primaryModelCode.trim()
        : ''

      // 6. Validate model capabilities (vision, streaming, etc.)
      const selectedModel = requestedPrimaryModel || modelResolution?.modelCode || 'gemini-2.5-pro' // Default model
      const capabilityCheck = this.validateModelCapabilities(selectedModel, llmRequest)
      if (!capabilityCheck.valid) {
        console.error(`✗ Model capability validation failed: ${capabilityCheck.error}`)
        // Release reservation on early failure
        if (decision.reservationId) {
          try {
            await this.system.reservation.releaseReservation(decision.reservationId)
            console.log(`[Gateway] Released reservation ${decision.reservationId} due to capability validation failure`)
          } catch (releaseError) {
            console.warn('[Gateway] Failed to release reservation on capability failure:', releaseError)
          }
        }
        return {
          success: false,
          error: new MeteringError('INVALID_MODEL', capabilityCheck.error || 'Model does not support required capabilities')
        }
      }

      // 7. Preflight check: enforce admin limits and emit provider-limit warnings
      const preflightResult = this.preflightCheck(
        selectedModel,
        llmRequest.inputTokens || 0,
        decision.maxTokensIn,
        decision.maxTokensOut
      )

      if (!preflightResult.valid) {
        console.error(`✗ Preflight check failed: ${preflightResult.error}`)
        // Release reservation on early failure
        if (decision.reservationId) {
          try {
            await this.system.reservation.releaseReservation(decision.reservationId)
            console.log(`[Gateway] Released reservation ${decision.reservationId} due to preflight failure`)
          } catch (releaseError) {
            console.warn('[Gateway] Failed to release reservation on preflight failure:', releaseError)
          }
        }
        return {
          success: false,
          error: new MeteringError('INPUT_TOO_LARGE', preflightResult.error || 'Input exceeds limits')
        }
      }
      
      if (preflightResult.warnings.length > 0) {
        console.warn(`⚠ Preflight warnings: ${preflightResult.warnings.join('; ')}`)
      }

      // 8. Route to LLM provider with resolved model or default routing
      const streamRequested = typeof llmRequest.stream?.onToken === 'function'
      const streamSupportedByResolvedModel = requestedPrimaryModel
        ? true
        : modelResolution
          ? modelResolution.supportsStreaming
          : true
      const executionRequest = streamRequested && !streamSupportedByResolvedModel
        ? {
            ...llmRequest,
            stream: undefined,
            metadata: {
              ...llmRequest.metadata,
              streamDisabledReason: 'model_does_not_support_streaming'
            }
          }
        : llmRequest

      if (streamRequested && !streamSupportedByResolvedModel) {
        console.log(`[Gateway] Streaming disabled for ${selectedModel}: model registry marks supportsStreaming=false`)
      }

      let response: LLMResponse
      
      if (modelResolution || requestedPrimaryModel) {
        const disableModelFallbacks = llmRequest.metadata?.disableModelFallbacks === true
        const requestFallbackModels = Array.isArray(llmRequest.metadata?.fallbackModelCodes)
          ? llmRequest.metadata.fallbackModelCodes
              .map((modelCode) => String(modelCode || '').trim())
              .filter(Boolean)
          : []
        const resolvedModelCode = modelResolution?.modelCode || selectedModel
        const fallbackModelCodes = disableModelFallbacks
          ? []
          : [
              ...(modelResolution?.fallbacks.map(f => f.modelCode) || []),
              ...requestFallbackModels.filter((modelCode) =>
                !(modelResolution?.fallbacks.some((fallback) => fallback.modelCode === modelCode))
                && modelCode !== resolvedModelCode
              ),
            ]

        // Use the resolved model with fallbacks
        response = await llmProviderRouter.routeWithModel(
          executionRequest,
          decision,
          selectedModel,
          fallbackModelCodes
        )
      } else {
        // Fall back to default priority-based routing
        response = await llmProviderRouter.routeAndExecute(executionRequest, decision)
      }

      const responseMetadata =
        response.metadata && typeof response.metadata === 'object'
          ? (response.metadata as Record<string, unknown>)
          : {}
      const normalizedUsage =
        responseMetadata.tokenUsage && typeof responseMetadata.tokenUsage === 'object'
          ? (responseMetadata.tokenUsage as Record<string, unknown>)
          : {}

      const meteredInputTokens =
        typeof normalizedUsage.inputTokens === 'number'
          ? normalizedUsage.inputTokens
          : typeof responseMetadata.inputTokens === 'number'
          ? responseMetadata.inputTokens
          : (llmRequest.inputTokens ?? 0)

      const meteredOutputTokens =
        typeof normalizedUsage.outputTokens === 'number'
          ? normalizedUsage.outputTokens
          : typeof responseMetadata.outputTokens === 'number'
          ? responseMetadata.outputTokens
          : response.outputTokens

      const meteredThoughtTokens =
        typeof normalizedUsage.thoughtTokens === 'number'
          ? normalizedUsage.thoughtTokens
          : typeof responseMetadata.thoughtTokens === 'number'
          ? responseMetadata.thoughtTokens
          : 0

      const meteredTotalTokens =
        typeof normalizedUsage.totalTokens === 'number'
          ? normalizedUsage.totalTokens
          : meteredInputTokens + meteredOutputTokens + meteredThoughtTokens
      const meteredModelClass =
        typeof responseMetadata.modelUsed === 'string' && responseMetadata.modelUsed.trim()
          ? responseMetadata.modelUsed
          : typeof responseMetadata.model === 'string' && responseMetadata.model.trim()
          ? responseMetadata.model
          : response.modelClass

      // 7. Record usage (metering for billing/quotas)
      if (decision.reservationId) {
        const usageStats: UsageStats = {
          inputTokens: meteredInputTokens,
          outputTokens: meteredOutputTokens,
          modelClass: meteredModelClass as any,
          apiCalls: 1,
          metadata: {
            ...llmRequest.metadata,
            stageCode: llmRequest.stageCode,
            modelSource: modelResolution?.source,
            thoughtTokens: meteredThoughtTokens,
            totalTokens: meteredTotalTokens
          }
        }

        await this.system.metering.recordUsage(decision.reservationId, usageStats, tenantContext.userId)
      } else if (skipFeaturePolicy) {
        await recordStandaloneLLMUsage({
          tenantId: tenantContext.tenantId,
          userId: tenantContext.userId,
          featureCode: this.getFeatureForTask(llmRequest.taskCode),
          taskCode: llmRequest.taskCode,
          operation: String(llmRequest.metadata?.action || llmRequest.metadata?.purpose || llmRequest.stageCode || llmRequest.taskCode),
          stageCode: llmRequest.stageCode,
          modelClass: meteredModelClass,
          inputTokens: meteredInputTokens,
          outputTokens: meteredOutputTokens,
          thoughtTokens: meteredThoughtTokens,
          idempotencyKey: llmRequest.idempotencyKey,
          metadata: {
            ...llmRequest.metadata,
            stageCode: llmRequest.stageCode,
            modelSource: modelResolution?.source,
            thoughtTokens: meteredThoughtTokens,
            totalTokens: meteredTotalTokens,
            gatewayPolicy: 'skipFeaturePolicy',
          },
          skipTerminalLog: true,
        })
      }

      return { success: true, response }

    } catch (error) {
      // Release reservation on any failure to prevent blocking subsequent operations
      if (decision?.reservationId) {
        try {
          await this.system.reservation.releaseReservation(decision.reservationId)
          console.log(`[Gateway] Released reservation ${decision.reservationId} due to LLM operation failure`)
        } catch (releaseError) {
          console.warn('[Gateway] Failed to release reservation on error:', releaseError)
        }
      }

      if (error instanceof MeteringError) {
        return { success: false, error }
      }

      console.error('LLM Gateway error:', error)
      const wrappedError = new MeteringError('SERVICE_UNAVAILABLE', 'LLM gateway error')
      return { success: false, error: wrappedError }
    }
  }

  /**
   * Execute LLM operation with explicit stage code
   * Convenience method for stage-aware calls
   */
  async executeLLMOperationForStage(
    request: { headers: Record<string, string> } | { tenantContext: TenantContext },
    taskCode: TaskCode,
    stageCode: string,
    prompt: string,
    options?: {
      parameters?: Record<string, any>
      idempotencyKey?: string
      content?: any
    }
  ): Promise<{ success: boolean; response?: LLMResponse; error?: MeteringError }> {
    const llmRequest: LLMRequest & { stageCode: string } = {
      taskCode,
      stageCode,
      prompt,
      parameters: options?.parameters,
      idempotencyKey: options?.idempotencyKey || crypto.randomUUID(),
      content: options?.content
    }

    return this.executeLLMOperation(request, llmRequest)
  }

  /**
   * Improved token estimation that accounts for text, images, and JSON payloads.
   * More accurate for quota management and billing.
   */
  private estimateInputTokens(llmRequest: LLMRequest): number {
    let textTokens = 0
    let imageTokens = 0
    let fileTokens = 0

    // Estimate text tokens
    if (llmRequest.prompt) {
      textTokens += this.estimateTextTokens(llmRequest.prompt)
    }

    if (llmRequest.content?.parts?.length) {
      for (const part of llmRequest.content.parts) {
        if (part.type === 'text') {
          textTokens += this.estimateTextTokens(part.text)
        } else if (part.type === 'image') {
          // Image token estimation based on provider conventions:
          // - OpenAI: ~85 tokens for low detail, 85 + 170*tiles for high detail
          // - Gemini: Similar approach
          // - We'll use a conservative estimate of ~1000 tokens per image for high detail
          const imageData = part.image?.data || ''
          const imageSizeKB = Math.ceil((imageData.length * 3) / 4 / 1024) // Base64 to bytes
          
          if (imageSizeKB > 512) {
            // Large image - high detail processing
            imageTokens += 1500
          } else if (imageSizeKB > 128) {
            // Medium image
            imageTokens += 800
          } else {
            // Small image - low detail
            imageTokens += 300
          }
        } else if (part.type === 'file') {
          // Approximate file processing tokens without over-penalizing base64 transport overhead.
          const fileData = part.file?.data || ''
          if (fileData) {
            const fileBytes = Math.ceil((fileData.length * 3) / 4)
            const estimated = Math.ceil(fileBytes / 450) // ~2.2KB/token equivalent processing budget
            fileTokens += Math.max(2000, Math.min(50000, estimated))
          } else if (part.file?.url) {
            // URL-based document ingestion still has substantial parse cost; keep conservative estimate.
            fileTokens += 8000
          } else {
            fileTokens += 2000
          }
        }
      }
    }

    return textTokens + imageTokens + fileTokens
  }

  /**
   * Estimate tokens for text content using improved heuristics
   */
  private estimateTextTokens(text: string): number {
    if (!text) return 0
    
    // More accurate tokenization heuristic:
    // - English text: ~4 chars/token
    // - Code: ~3 chars/token (more symbols)
    // - JSON: ~2.5 chars/token (lots of structure)
    
    const hasJson = text.includes('{') && text.includes('}')
    const hasCode = text.includes('function') || text.includes('const ') || text.includes('import ')
    
    let charsPerToken = 4
    if (hasJson) charsPerToken = 2.5
    else if (hasCode) charsPerToken = 3
    
    return Math.ceil(text.length / charsPerToken)
  }

  /**
   * Check if the request requires vision capabilities
   */
  private requiresVision(llmRequest: LLMRequest): boolean {
    return !!(llmRequest.content?.parts?.some(part => part.type === 'image'))
  }

  /**
   * Check if the request includes raw file inputs.
   */
  private requiresFileInput(llmRequest: LLMRequest): boolean {
    return !!(llmRequest.content?.parts?.some(part => part.type === 'file'))
  }

  /**
   * Models that support vision/multimodal input
   */
  private readonly VISION_CAPABLE_MODELS = new Set([
    // OpenAI
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-5.1-thinking', 'gpt-5.2-thinking',
    // Anthropic
    'claude-opus-4.5',
    'claude-opus-4-5',
    'claude-opus-4.6',
    'claude-3.5-sonnet', 'claude-3.5-haiku', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
    'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229',
    // Google Gemini
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash', 'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001',
    'gemini-1.5-pro', 'gemini-1.5-pro-002',
    'gemini-1.5-flash', 'gemini-1.5-flash-002',
    'gemini-3.0-nano-banana', 'gemini-3.1-flash', 'gemini-3.1-flash-preview', 'gemini-3-flash-preview',
    'gemini-3-pro-preview', 'gemini-3-pro-preview-thinking', 'gemini-3-pro-image-preview',
  ])

  /**
   * Models that support direct document/file input in this gateway.
   */
  private readonly FILE_CAPABLE_MODELS = new Set([
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ])

  /**
   * Validate that the model supports required capabilities
   */
  private validateModelCapabilities(modelCode: string, llmRequest: LLMRequest): { valid: boolean; error?: string } {
    // Check vision requirement
    if (this.requiresVision(llmRequest)) {
      if (!this.VISION_CAPABLE_MODELS.has(modelCode)) {
        return {
          valid: false,
          error: `Model ${modelCode} does not support vision/image inputs. Vision-capable models: GPT-4o, Claude 3.x, Gemini`
        }
      }
    }

    if (this.requiresFileInput(llmRequest)) {
      if (!this.FILE_CAPABLE_MODELS.has(modelCode)) {
        return {
          valid: false,
          error: `Model ${modelCode} does not support direct file inputs in this gateway`
        }
      }
    }
    
    return { valid: true }
  }

  /**
   * Get provider context limits for preflight checks
   * Includes both friendly names and canonical API model IDs
   */
  private getProviderContextLimits(modelCode: string): { maxInput: number; maxOutput: number } {
    // Context limits by model - includes both friendly names and canonical API IDs
    const limits: Record<string, { maxInput: number; maxOutput: number }> = {
      // OpenAI - GPT-4 Series
      'gpt-4o': { maxInput: 128000, maxOutput: 16384 },
      'gpt-4o-mini': { maxInput: 128000, maxOutput: 16384 },
      'gpt-4-turbo': { maxInput: 128000, maxOutput: 4096 },
      'gpt-4': { maxInput: 8192, maxOutput: 4096 },
      // OpenAI - GPT-5 Series
      'gpt-5': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.1': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.2': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5-mini': { maxInput: 200000, maxOutput: 64000 },
      'gpt-5-nano': { maxInput: 128000, maxOutput: 32000 },
      // OpenAI - GPT-5 Thinking Variants (alias to base)
      'gpt-5.1-thinking': { maxInput: 400000, maxOutput: 128000 },
      'gpt-5.2-thinking': { maxInput: 400000, maxOutput: 128000 },
      // OpenAI - GPT-3.5 Series
      'gpt-3.5-turbo': { maxInput: 16385, maxOutput: 4096 },
      // OpenAI - o1 Reasoning Models
      'o1': { maxInput: 200000, maxOutput: 100000 },
      'o1-mini': { maxInput: 128000, maxOutput: 65536 },
      'o1-preview': { maxInput: 128000, maxOutput: 32768 },
      
      // Anthropic - Claude 4 models
      'claude-sonnet-4': { maxInput: 200000, maxOutput: 16384 },
      'claude-sonnet-4-20250514': { maxInput: 200000, maxOutput: 16384 },
      'claude-opus-4': { maxInput: 200000, maxOutput: 16384 },
      'claude-opus-4-20250514': { maxInput: 200000, maxOutput: 16384 },
      'claude-opus-4.5': { maxInput: 1000000, maxOutput: 128000 },
      'claude-opus-4-5': { maxInput: 1000000, maxOutput: 128000 },
      'claude-opus-4.6': { maxInput: 1000000, maxOutput: 128000 },
      'claude-opus-4-6': { maxInput: 1000000, maxOutput: 128000 },
      // Anthropic - Claude 3.7 models
      'claude-3-7-sonnet': { maxInput: 200000, maxOutput: 16384 },
      'claude-3-7-sonnet-20250219': { maxInput: 200000, maxOutput: 16384 },
      // Anthropic - Claude 3.5 models
      'claude-3.5-sonnet': { maxInput: 200000, maxOutput: 8192 },
      'claude-3.5-haiku': { maxInput: 200000, maxOutput: 8192 },
      'claude-3-opus': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-sonnet': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-haiku': { maxInput: 200000, maxOutput: 4096 },
      // Anthropic - Canonical API model IDs (with dates)
      'claude-3-5-sonnet-20241022': { maxInput: 200000, maxOutput: 8192 },
      'claude-3-5-haiku-20241022': { maxInput: 200000, maxOutput: 8192 },
      'claude-3-opus-20240229': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-sonnet-20240229': { maxInput: 200000, maxOutput: 4096 },
      'claude-3-haiku-20240307': { maxInput: 200000, maxOutput: 4096 },
      
      // Gemini
      'gemini-2.5-pro': { maxInput: 2097152, maxOutput: 65536 },
      'gemini-2.5-flash': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash-001': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash-lite': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-2.0-flash-lite-001': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-1.5-pro': { maxInput: 2000000, maxOutput: 8192 },
      'gemini-1.5-pro-002': { maxInput: 2000000, maxOutput: 8192 },
      'gemini-1.5-flash': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-1.5-flash-002': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-3.0-nano-banana': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-3.1-flash': { maxInput: 1048576, maxOutput: 65536 },
      'gemini-3.1-flash-preview': { maxInput: 1048576, maxOutput: 65536 },
      'gemini-3-flash-preview': { maxInput: 1048576, maxOutput: 65536 },
      'gemini-3-pro-preview': { maxInput: 2000000, maxOutput: 16384 },
      'gemini-3-pro-preview-thinking': { maxInput: 2000000, maxOutput: 16384 },
      'gemini-3-pro-image-preview': { maxInput: 1000000, maxOutput: 8192 },
      'gemini-embedding-001': { maxInput: 2048, maxOutput: 0 },
      
      // DeepSeek
      'deepseek-v4-pro': { maxInput: 1000000, maxOutput: 384000 },
      'deepseek-v4-flash': { maxInput: 1000000, maxOutput: 384000 },
      'deepseek-chat': { maxInput: 128000, maxOutput: 8192 },
      'deepseek-reasoner': { maxInput: 128000, maxOutput: 8192 },

      // Zhipu
      'glm-5': { maxInput: 200000, maxOutput: 65536 },

      // Qwen
      'qwen2.5-72b-instruct': { maxInput: 131072, maxOutput: 8192 },
      
      // Groq - Friendly names (prefixed)
      'groq-llama-3.3-70b': { maxInput: 128000, maxOutput: 8192 },
      'groq-llama-3.1-70b': { maxInput: 128000, maxOutput: 8192 },
      'groq-llama-3.1-8b': { maxInput: 128000, maxOutput: 8192 },
      'groq-mixtral-8x7b': { maxInput: 32768, maxOutput: 8192 },
      'groq-gemma2-9b': { maxInput: 8192, maxOutput: 8192 },
      // Groq - Canonical API model IDs
      'llama-3.3-70b-versatile': { maxInput: 128000, maxOutput: 8192 },
      'llama-3.1-70b-versatile': { maxInput: 128000, maxOutput: 8192 },
      'llama-3.1-8b-instant': { maxInput: 128000, maxOutput: 8192 },
      'mixtral-8x7b-32768': { maxInput: 32768, maxOutput: 8192 },
      'gemma2-9b-it': { maxInput: 8192, maxOutput: 8192 }
    }
    
    // First try exact match
    if (limits[modelCode]) {
      return limits[modelCode]
    }
    
    // Fallback: try to match by prefix for unknown model variants
    const lowerCode = modelCode.toLowerCase()
    if (lowerCode.startsWith('gpt-4')) return { maxInput: 128000, maxOutput: 16384 }
    if (lowerCode.startsWith('gpt-5')) return { maxInput: 200000, maxOutput: 64000 }
    if (lowerCode.startsWith('gpt-3')) return { maxInput: 16385, maxOutput: 4096 }
    if (lowerCode.startsWith('o1')) return { maxInput: 128000, maxOutput: 65536 }
    if (lowerCode.startsWith('claude')) return { maxInput: 200000, maxOutput: 8192 }
    if (lowerCode.startsWith('gemini')) return { maxInput: 1000000, maxOutput: 65536 }
    if (lowerCode.startsWith('glm')) return { maxInput: 200000, maxOutput: 65536 }
    if (lowerCode.startsWith('qwen')) return { maxInput: 131072, maxOutput: 8192 }
    if (lowerCode.startsWith('llama') || lowerCode.startsWith('groq-llama')) return { maxInput: 128000, maxOutput: 8192 }
    if (lowerCode.startsWith('mixtral') || lowerCode.startsWith('groq-mixtral')) return { maxInput: 32768, maxOutput: 8192 }
    if (lowerCode.startsWith('deepseek')) return { maxInput: 128000, maxOutput: 8192 }
    
    // Safe defaults for truly unknown models
    console.warn(`[getProviderContextLimits] Unknown model: ${modelCode}, using safe defaults`)
    return { maxInput: 32768, maxOutput: 4096 }
  }

  /**
   * Preflight check:
   * - Enforces super-admin configured limits
   * - Emits warnings for known provider limits
   */
  private preflightCheck(
    modelCode: string,
    estimatedInputTokens: number,
    maxTokensIn?: number,
    maxTokensOut?: number
  ): { valid: boolean; error?: string; warnings: string[] } {
    const warnings: string[] = []
    const providerLimits = this.getProviderContextLimits(modelCode)
    
    // Provider context limits are advisory here.
    // Super-admin limits are the only hard enforcement in gateway preflight.
    if (estimatedInputTokens > providerLimits.maxInput) {
      warnings.push(
        `Estimated input (${estimatedInputTokens}) exceeds known ${modelCode} limit (${providerLimits.maxInput}); provider may reject request`
      )
    }
    
    // Check against admin-configured maxTokensIn
    if (maxTokensIn && estimatedInputTokens > maxTokensIn) {
      return {
        valid: false,
        error: `Input exceeds stage limit: ${estimatedInputTokens} tokens > configured limit of ${maxTokensIn}`,
        warnings
      }
    }
    
    // Warn if configured output tokens exceed known provider limits.
    if (maxTokensOut && maxTokensOut > providerLimits.maxOutput) {
      warnings.push(
        `Configured output tokens (${maxTokensOut}) exceed known ${modelCode} limit (${providerLimits.maxOutput}); provider may reject request`
      )
    }
    
    // Warn if approaching limits
    if (estimatedInputTokens > providerLimits.maxInput * 0.8) {
      warnings.push(`Input is ${Math.round(estimatedInputTokens / providerLimits.maxInput * 100)}% of ${modelCode} context limit`)
    }
    
    return { valid: true, warnings }
  }

  private getFeatureForTask(taskCode: TaskCode): FeatureCode {
    const taskToFeatureMap: Record<TaskCode, FeatureCode> = {
      LLM1_PRIOR_ART: 'PRIOR_ART_SEARCH',
      LLM2_DRAFT: 'PATENT_DRAFTING',
      LLM3_DIAGRAM: 'DIAGRAM_GENERATION',
      LLM4_NOVELTY_SCREEN: 'PRIOR_ART_SEARCH',
      LLM5_NOVELTY_ASSESS: 'PRIOR_ART_SEARCH',
      LLM6_REPORT_GENERATION: 'PRIOR_ART_SEARCH',
      LLM1_CLAIM_REFINEMENT: 'PATENT_DRAFTING',
      IDEA_BANK_ACCESS: 'IDEA_BANK',
      IDEA_BANK_RESERVE: 'IDEA_BANK',
      IDEA_BANK_EDIT: 'IDEA_BANK',
      PERSONA_SYNC_LEARN: 'PERSONA_SYNC',
      IDEATION_NORMALIZE: 'IDEATION',
      IDEATION_CLASSIFY: 'IDEATION',
      IDEATION_CONTRADICTION_MAPPING: 'IDEATION',
      IDEATION_EXPAND: 'IDEATION',
      IDEATION_OBVIOUSNESS_FILTER: 'IDEATION',
      IDEATION_GENERATE: 'IDEATION',
      IDEATION_NOVELTY: 'IDEATION',
      FUNDING_CALL_INGEST: 'FUNDING_DISCOVERY',
      FUNDING_CHAT: 'FUNDING_DISCOVERY',
      FUNDING_TEMPLATE_EXTRACT: 'FUNDING_DISCOVERY',
      FUNDING_GUIDELINE_EXTRACT: 'FUNDING_DISCOVERY',
      GRANT_PREP_CHAT: 'GRANT_PREP',
      GRANT_BLUEPRINT_GENERATE: 'GRANT_PREP',
      GRANT_SECTION_GENERATE: 'GRANT_DRAFTING',
      // Paper writing tasks
      LITERATURE_RELEVANCE: 'PAPER_DRAFTING',
      SEARCH_STRATEGY_GEN: 'SEARCH_STRATEGY'
    }
    return taskToFeatureMap[taskCode]
  }

  // Provider management methods
  getAvailableProviders(): string[] {
    return llmProviderRouter.getAvailableProviders()
  }

  getProviderHealth(): Record<string, { healthy: boolean; failureCount: number; lastError?: string }> {
    return llmProviderRouter.getProviderHealth()
  }

  async refreshProviders(): Promise<void> {
    await llmProviderRouter.refreshProviders()
  }

  /**
   * Check if a model supports vision (exposed for router fallback validation)
   */
  isModelVisionCapable(modelCode: string): boolean {
    return this.VISION_CAPABLE_MODELS.has(modelCode)
  }

  /**
   * Get context limits for a model (exposed for router fallback validation)
   */
  getModelContextLimits(modelCode: string): { maxInput: number; maxOutput: number } {
    return this.getProviderContextLimits(modelCode)
  }

  // Admin methods for monitoring and control
  async getTenantUsage(tenantId: string, period: 'daily' | 'monthly' = 'monthly') {
    return await this.system.metering.getUsage(tenantId, undefined, period)
  }

  async checkTenantQuota(tenantId: string, featureCode: FeatureCode) {
    return await this.system.metering.checkQuota({
      tenantId,
      featureCode
    })
  }
}

// === SINGLETON GATEWAY INSTANCE ===

export const llmGateway = new LLMGateway()

// === HELPER FUNCTIONS FOR INTEGRATION ===
// Note: These helper functions support optional stageCode for admin-configured model/limits

export async function executePriorArtSearch(
  request: { headers: Record<string, string> },
  query: string,
  options?: { maxResults?: number; sources?: string[]; stageCode?: string }
): Promise<{ success: boolean; results?: any[]; error?: MeteringError }> {
  const llmRequest: LLMRequest & { stageCode?: string } = {
    taskCode: 'LLM1_PRIOR_ART',
    stageCode: options?.stageCode || 'NOVELTY_QUERY_GENERATION', // Default stage for prior art search
    prompt: `Search for prior art related to: ${query}`,
    parameters: options,
    idempotencyKey: crypto.randomUUID()
  }

  const result = await llmGateway.executeLLMOperation(request, llmRequest)

  if (!result.success || !result.response) {
    return { success: false, error: result.error }
  }

  try {
    const results = JSON.parse(result.response.output)
    return { success: true, results }
  } catch {
    return { success: false, error: new MeteringError('SERVICE_UNAVAILABLE', 'Invalid response format') }
  }
}

export async function executePatentDrafting(
  request: { headers: Record<string, string> },
  specification: string,
  options?: { jurisdiction?: string; type?: string; stageCode?: string }
): Promise<{ success: boolean; draft?: string; error?: MeteringError }> {
  const llmRequest: LLMRequest & { stageCode?: string } = {
    taskCode: 'LLM2_DRAFT',
    stageCode: options?.stageCode || 'DRAFT_ANNEXURE_DESCRIPTION', // Default stage for patent drafting
    prompt: `Draft patent specification for: ${specification}`,
    parameters: options,
    idempotencyKey: crypto.randomUUID()
  }

  const result = await llmGateway.executeLLMOperation(request, llmRequest)

  if (!result.success || !result.response) {
    return { success: false, error: result.error }
  }

  return { success: true, draft: result.response.output }
}

export async function executeDiagramGeneration(
  request: { headers: Record<string, string> },
  description: string,
  format: 'plantuml' | 'mermaid' = 'plantuml',
  options?: { stageCode?: string }
): Promise<{ success: boolean; diagram?: string; error?: MeteringError }> {
  const llmRequest: LLMRequest & { stageCode?: string } = {
    taskCode: 'LLM3_DIAGRAM',
    stageCode: options?.stageCode || 'DRAFT_DIAGRAM_GENERATION', // Default stage for diagram generation
    prompt: `Generate ${format} diagram for: ${description}`,
    parameters: { format },
    idempotencyKey: crypto.randomUUID()
  }

  const result = await llmGateway.executeLLMOperation(request, llmRequest)

  if (!result.success || !result.response) {
    return { success: false, error: result.error }
  }

  return { success: true, diagram: result.response.output }
}

// Re-export types for convenience
export type { LLMRequest, LLMResponse } from './types'
