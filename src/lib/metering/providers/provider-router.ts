// LLM Provider Router
// Routes requests to appropriate providers with failover and metering integration
// Now supports flexible model configuration via super admin

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider } from './llm-provider'
import { createLLMProvider, getProviderFromModelCode, type ProviderConfig, type ProviderType } from './llm-provider'
import { logLLMCost, ensurePricingLoaded, isPricingLoaded } from '../cost-calculator'

const SHOULD_LOG_PROVIDER_INIT = process.env.LLM_PROVIDER_INIT_LOGS === 'true'
const parseOptionalPositiveIntEnv = (value: string | undefined): number | undefined => {
  if (!value || !value.trim()) return undefined
  const parsed = Number.parseInt(value, 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return undefined
}

export interface ProviderPriority {
  provider: string
  priority: number // Lower number = higher priority
  fallback: boolean // Whether to use as fallback
}

export interface RoutingDecision {
  provider: LLMProvider
  reason: string
  costEstimate?: number
  modelCode?: string
}

interface NormalizedTokenUsage {
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  totalTokens: number
}

/**
 * Models that support vision/multimodal input
 * Used for validating fallback models when request contains images
 */
const VISION_CAPABLE_MODELS = new Set([
  // OpenAI
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5-mini', 'gpt-5-nano',
  'gpt-5.1-thinking', 'gpt-5.2-thinking',
  // Anthropic
  'claude-opus-4.5',
  'claude-opus-4-5',
  'claude-opus-4.6',
  'claude-3.5-sonnet', 'claude-3.5-haiku', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
  'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229',
  'claude-3-sonnet-20240229', 'claude-3-haiku-20240307',
  // Google Gemini
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash', 'gemini-2.0-flash-001',
  'gemini-1.5-pro', 'gemini-1.5-pro-002',
  'gemini-1.5-flash', 'gemini-1.5-flash-002',
  'gemini-3.0-nano-banana', 'gemini-3-pro-preview', 'gemini-3-pro-preview-thinking', 'gemini-3-pro-image-preview'
])

/**
 * Models that support direct file/document inputs in this router.
 */
const FILE_CAPABLE_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro'
])

/**
 * Context limits for preflight validation of fallback models
 */
const MODEL_CONTEXT_LIMITS: Record<string, { maxInput: number; maxOutput: number }> = {
  // OpenAI
  'gpt-4o': { maxInput: 128000, maxOutput: 16384 },
  'gpt-4o-mini': { maxInput: 128000, maxOutput: 16384 },
  'gpt-4-turbo': { maxInput: 128000, maxOutput: 4096 },
  'gpt-3.5-turbo': { maxInput: 16385, maxOutput: 4096 },
  'o1': { maxInput: 200000, maxOutput: 100000 },
  'o1-mini': { maxInput: 128000, maxOutput: 65536 },
  // GPT-5 additions (for fallback validation)
  'gpt-5.2': { maxInput: 400000, maxOutput: 128000 },
  'gpt-5.1-thinking': { maxInput: 400000, maxOutput: 128000 },
  'gpt-5.2-thinking': { maxInput: 400000, maxOutput: 128000 },
  // Anthropic
  'claude-3.5-sonnet': { maxInput: 200000, maxOutput: 8192 },
  'claude-3-5-sonnet-20241022': { maxInput: 200000, maxOutput: 8192 },
  'claude-3.5-haiku': { maxInput: 200000, maxOutput: 8192 },
  'claude-3-5-haiku-20241022': { maxInput: 200000, maxOutput: 8192 },
  'claude-3-opus': { maxInput: 200000, maxOutput: 4096 },
  'claude-opus-4.5': { maxInput: 1000000, maxOutput: 128000 },
  'claude-opus-4-5': { maxInput: 1000000, maxOutput: 128000 },
  'claude-opus-4.6': { maxInput: 1000000, maxOutput: 128000 },
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
  'gemini-3-pro-preview': { maxInput: 2000000, maxOutput: 16384 },
  'gemini-3-pro-preview-thinking': { maxInput: 2000000, maxOutput: 16384 },
  // Groq
  'llama-3.3-70b-versatile': { maxInput: 128000, maxOutput: 8192 },
  'groq-llama-3.3-70b': { maxInput: 128000, maxOutput: 8192 },
  'mixtral-8x7b-32768': { maxInput: 32768, maxOutput: 8192 },
  // DeepSeek
  'deepseek-chat': { maxInput: 128000, maxOutput: 8192 },
  // Zhipu
  'glm-5': { maxInput: 200000, maxOutput: 65536 },
  // Qwen
  'qwen2.5-72b-instruct': { maxInput: 131072, maxOutput: 8192 }
}

// All supported provider configurations
interface ProviderConfigs {
  [key: string]: {
    apiKey: string | undefined
    model: string
    baseURL: string
    timeout?: number
    maxRetries?: number
  }
}

export function buildProviderConfigsFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderConfigs {
  return {
    // Google Gemini providers
    gemini: {
      apiKey: env.GOOGLE_AI_API_KEY,
      model: 'gemini-2.5-pro',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta'
    },
    'gemini-flash-lite': {
      apiKey: env.GOOGLE_AI_API_KEY,
      model: 'gemini-2.0-flash-lite',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta'
    },
    
    // OpenAI provider
    openai: {
      apiKey: env.OPENAI_API_KEY,
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      // Leave timeout undefined unless explicitly configured so GPT-5 requests can
      // use the provider's longer model-specific defaults instead of a hard 30s cap.
      timeout: parseOptionalPositiveIntEnv(env.OPENAI_TIMEOUT_MS),
      maxRetries: parseOptionalPositiveIntEnv(env.OPENAI_MAX_RETRIES)
    },
    
    // Anthropic Claude provider
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
      baseURL: 'https://api.anthropic.com/v1',
      timeout: parseOptionalPositiveIntEnv(env.ANTHROPIC_TIMEOUT_MS),
      maxRetries: parseOptionalPositiveIntEnv(env.ANTHROPIC_MAX_RETRIES)
    },
    
    // DeepSeek provider (cost-effective)
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY,
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1'
    },
    
    // Groq provider (ultra-fast)
    groq: {
      apiKey: env.GROQ_API_KEY,
      model: 'llama-3.3-70b-versatile',
      baseURL: 'https://api.groq.com/openai/v1'
    },

    // Zhipu GLM provider
    zhipu: {
      apiKey: env.ZHIPU_API_KEY,
      model: 'glm-5',
      baseURL: env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
    },

    // Qwen provider (DashScope-compatible)
    qwen: {
      apiKey: env.QWEN_API_KEY,
      model: 'qwen2.5-72b-instruct',
      baseURL: env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
    }
  }
}

export class LLMProviderRouter {
  private providers = new Map<string, LLMProvider>()
  private providerConfigs: Record<string, ProviderConfig> = {}

  constructor() {
    this.initializeProviders()
  }

  private initializeProviders() {
    // Initialize all providers from environment variables
    if (SHOULD_LOG_PROVIDER_INIT) {
      console.log('Initializing LLM providers...')
    }

    const configs = buildProviderConfigsFromEnv(process.env)

    // Only initialize providers that have API keys
    Object.entries(configs).forEach(([type, config]) => {
      if (config.apiKey) {
        try {
          const provider = createLLMProvider(type as ProviderType, config as ProviderConfig)
          this.providers.set(type, provider)
          this.providerConfigs[type] = config as ProviderConfig
          if (SHOULD_LOG_PROVIDER_INIT) {
            console.log(`Initialized ${type} provider`)
          }
        } catch (error) {
          console.warn(`Failed to initialize ${type} provider:`, error)
        }
      } else {
        if (SHOULD_LOG_PROVIDER_INIT) {
          console.log(`Skipping ${type} provider (no API key)`)
        }
      }
    })
    
    if (SHOULD_LOG_PROVIDER_INIT) {
      console.log(`Total providers initialized: ${this.providers.size}`)
    }
  }

  /**
   * Get provider for a specific model code
   * Used when model is specified by the model resolver
   * Returns null if model code is unknown or provider is not available
   */
  getProviderForModel(modelCode: string): LLMProvider | null {
    try {
      const providerType = getProviderFromModelCode(modelCode)
      return this.providers.get(providerType) || null
    } catch (error) {
      // getProviderFromModelCode now throws for unknown models (fail-fast)
      console.error(`[getProviderForModel] ${error instanceof Error ? error.message : error}`)
      return null
    }
  }

  private readTokenNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value)
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed)
      }
    }

    return undefined
  }

  private getNestedValue(source: unknown, path: string[]): unknown {
    let current: unknown = source
    for (const key of path) {
      if (!current || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[key]
    }
    return current
  }

  private firstTokenNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
      const parsed = this.readTokenNumber(value)
      if (parsed !== undefined) return parsed
    }
    return undefined
  }

  private normalizeTokenUsage(response: LLMResponse, request: LLMRequest): NormalizedTokenUsage {
    const metadata =
      response.metadata && typeof response.metadata === 'object'
        ? (response.metadata as Record<string, unknown>)
        : {}

    const usageCandidate = metadata.usage ?? metadata.usageMetadata
    const usage =
      usageCandidate && typeof usageCandidate === 'object'
        ? (usageCandidate as Record<string, unknown>)
        : {}

    const inputTokens = this.firstTokenNumber(
      metadata.inputTokens,
      metadata.promptTokens,
      metadata.promptTokenCount,
      metadata.prompt_tokens,
      usage.prompt_tokens,
      usage.input_tokens,
      usage.promptTokenCount,
      usage.inputTokenCount,
      request.inputTokens
    ) ?? 0

    const outputTokens = this.firstTokenNumber(
      response.outputTokens,
      metadata.outputTokens,
      metadata.completionTokens,
      metadata.completion_tokens,
      metadata.candidatesTokenCount,
      usage.completion_tokens,
      usage.output_tokens,
      usage.candidatesTokenCount,
      usage.outputTokenCount
    ) ?? 0

    const thoughtTokens = this.firstTokenNumber(
      metadata.thoughtTokens,
      metadata.reasoningTokens,
      metadata.reasoning_tokens,
      metadata.thinkingTokens,
      metadata.thoughtTokenCount,
      metadata.thoughtsTokenCount,
      usage.reasoning_tokens,
      usage.thinking_tokens,
      usage.reasoningTokenCount,
      usage.thinkingTokenCount,
      usage.thoughtTokenCount,
      usage.thoughtsTokenCount,
      this.getNestedValue(usage, ['completion_tokens_details', 'reasoning_tokens']),
      this.getNestedValue(usage, ['completion_tokens_details', 'thinking_tokens']),
      this.getNestedValue(usage, ['output_tokens_details', 'reasoning_tokens']),
      this.getNestedValue(usage, ['output_tokens_details', 'thinking_tokens'])
    ) ?? 0

    const totalTokens = this.firstTokenNumber(
      metadata.totalTokens,
      metadata.total_tokens,
      usage.total_tokens,
      usage.totalTokenCount
    ) ?? (inputTokens + outputTokens + thoughtTokens)

    return {
      inputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens
    }
  }

  async routeAndExecute(
    request: LLMRequest,
    limits: EnforcementDecision,
    priorities?: ProviderPriority[]
  ): Promise<LLMResponse> {
    const routingDecision = await this.selectProvider(request, limits, priorities)

    if (!routingDecision) {
      throw new Error('No suitable provider found for the request')
    }

    const { provider, reason, modelCode } = routingDecision

    console.log(`Routing to ${provider.name}: ${reason}${modelCode ? ` (model: ${modelCode})` : ''}`)

    // If a specific model was resolved, set it in the request
    if (modelCode) {
      request.modelClass = modelCode
    }

    const startTime = Date.now()
    const actualModelCode = modelCode || request.modelClass || provider.supportedModels[0]

    // Ensure pricing is loaded from database for accurate cost calculation
    if (!isPricingLoaded()) {
      await ensurePricingLoaded()
    }

    // Execute with the selected provider
    try {
      const response = await provider.execute(request, limits)

      // Mark provider as successful for health tracking
      this.markProviderSuccess(provider.name)

      const duration = Date.now() - startTime
      
      // Normalize token fields so cost logs are consistent across providers/models.
      const tokenUsage = this.normalizeTokenUsage(response, request)
      const responseMetadata =
        response.metadata && typeof response.metadata === 'object'
          ? (response.metadata as Record<string, unknown>)
          : {}
      const providerReportedModel =
        typeof responseMetadata.modelUsed === 'string'
          ? responseMetadata.modelUsed
          : typeof responseMetadata.model === 'string'
          ? responseMetadata.model
          : undefined
      const loggedModelCode = providerReportedModel || actualModelCode
      
      const costBreakdown = logLLMCost(
        request.taskCode || 'LLM_CALL',
        loggedModelCode,
        tokenUsage.inputTokens,
        tokenUsage.outputTokens,
        tokenUsage.thoughtTokens,
        {
          taskCode: request.taskCode,
          stageCode: (request as any).stageCode,
          patentId: request.metadata?.patentId,
          paperId: request.metadata?.paperId,
          userId: request.metadata?.userId,
          tenantId: request.metadata?.tenantId,
          module: request.metadata?.module,
          action: request.metadata?.action,
          duration,
          resolvedModelCode: actualModelCode,
          providerModel: providerReportedModel
        }
      )

      // Add provider metadata to response
      return {
        ...response,
        metadata: {
          ...response.metadata,
          routingReason: reason,
          selectedProvider: provider.name,
          modelUsed: loggedModelCode,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          thoughtTokens: tokenUsage.thoughtTokens,
          totalTokens: tokenUsage.totalTokens,
          tokenUsage,
          // Add cost information to metadata
          costBreakdown: {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            thoughtTokens: tokenUsage.thoughtTokens,
            totalTokens: costBreakdown.totalTokens,
            actualCost: costBreakdown.actualCost,
            contingencyCost: costBreakdown.contingencyCost,
            inputCost: costBreakdown.inputCost,
            outputCost: costBreakdown.outputCost,
            thoughtCost: costBreakdown.thoughtCost
          },
          durationMs: duration
        }
      }
    } catch (error) {
      console.error(`Provider ${provider.name} failed:`, error)

      // Mark provider failure for health tracking (FIX: was missing)
      this.markProviderFailure(provider.name, error instanceof Error ? error : new Error(String(error)))

      // Try fallback if enabled
      const fallbackResponse = await this.tryFallback(request, limits, provider.name)
      if (fallbackResponse) {
        return fallbackResponse
      }

      throw error
    }
  }

  /**
   * Route with a specific model code (from model resolver)
   * This is the preferred method when using the flexible model configuration
   */
  async routeWithModel(
    request: LLMRequest,
    limits: EnforcementDecision,
    modelCode: string,
    fallbackModelCodes?: string[]
  ): Promise<LLMResponse> {
    console.log(`[ProviderRouter] routeWithModel called with modelCode=${modelCode}, fallbacks=${fallbackModelCodes?.join(', ') || 'none'}`)
    
    // Ensure pricing is loaded from database for accurate cost calculation
    if (!isPricingLoaded()) {
      await ensurePricingLoaded()
    }
    
    // Get the provider for this model
    const provider = this.getProviderForModel(modelCode)
    
    if (!provider) {
      console.warn(`[ProviderRouter] No provider available for model ${modelCode}, trying fallbacks...`)
      return this.tryFallbackModels(request, limits, fallbackModelCodes)
    }
    
    console.log(`[ProviderRouter] Using provider ${provider.name} for model ${modelCode}`)
    
    // Try primary model first
    request.modelClass = modelCode
    try {
      return await this.executeWithProvider(request, limits, provider, modelCode, false)
    } catch (error) {
      // Primary model failed - try fallbacks
      console.error(`[ProviderRouter] Primary model ${modelCode} failed:`, error)
      
      if (fallbackModelCodes && fallbackModelCodes.length > 0) {
        console.log(`[ProviderRouter] Attempting fallback models: ${fallbackModelCodes.join(' → ')}`)
        return this.tryFallbackModels(request, limits, fallbackModelCodes)
      }
      
      // No fallbacks configured - rethrow
      throw error
    }
  }

  /**
   * Try fallback models in order until one succeeds
   * Validates vision capability and context limits for each fallback before attempting
   */
  private async tryFallbackModels(
    request: LLMRequest,
    limits: EnforcementDecision,
    fallbackModelCodes?: string[]
  ): Promise<LLMResponse> {
    if (fallbackModelCodes && fallbackModelCodes.length > 0) {
      const errors: Error[] = []
      const requiresVision = this.requestRequiresVision(request)
      const requiresFile = this.requestRequiresFile(request)
      const estimatedInputTokens = request.inputTokens || 0
      
      for (const fallbackModel of fallbackModelCodes) {
        // Validate fallback model capabilities BEFORE attempting
        const validationResult = this.validateFallbackModel(
          fallbackModel, 
          requiresVision,
          requiresFile,
          estimatedInputTokens
        )
        
        if (!validationResult.valid) {
          console.warn(`⚠ Skipping fallback ${fallbackModel}: ${validationResult.reason}`)
          errors.push(new Error(`${fallbackModel}: ${validationResult.reason}`))
          continue
        }
        
        const fallbackProvider = this.getProviderForModel(fallbackModel)
        if (fallbackProvider && this.isProviderHealthy(fallbackProvider)) {
          try {
            request.modelClass = fallbackModel
            console.log(`Trying fallback model: ${fallbackModel}`)
            return await this.executeWithProvider(request, limits, fallbackProvider, fallbackModel, true)
          } catch (fallbackError) {
            console.error(`Fallback model ${fallbackModel} failed:`, fallbackError)
            errors.push(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)))
          }
        } else {
          console.warn(`⚠ Skipping fallback ${fallbackModel}: provider unavailable or unhealthy`)
        }
      }
      
      // All fallbacks failed
      throw new Error(`All fallback models failed: ${errors.map(e => e.message).join('; ')}`)
    }
    
    // No fallbacks - use default routing as last resort
    console.warn('[ProviderRouter] ⚠️ No fallback models configured, falling back to DEFAULT PROVIDER ROUTING (hardcoded priorities)')
    console.warn('[ProviderRouter] This may not honor your plan-specific LLM configuration!')
    return this.routeAndExecute(request, limits)
  }

  /**
   * Check if request contains images requiring vision capability
   */
  private requestRequiresVision(request: LLMRequest): boolean {
    return !!(request.content?.parts?.some(part => part.type === 'image'))
  }

  /**
   * Check if request contains file inputs.
   */
  private requestRequiresFile(request: LLMRequest): boolean {
    return !!(request.content?.parts?.some(part => part.type === 'file'))
  }

  /**
   * Validate that a fallback model supports the request requirements
   */
  private validateFallbackModel(
    modelCode: string,
    requiresVision: boolean,
    requiresFile: boolean,
    estimatedInputTokens: number
  ): { valid: boolean; reason?: string } {
    // Check vision capability
    if (requiresVision && !VISION_CAPABLE_MODELS.has(modelCode)) {
      return { 
        valid: false, 
        reason: `Model does not support vision/image inputs` 
      }
    }

    if (requiresFile && !FILE_CAPABLE_MODELS.has(modelCode)) {
      return {
        valid: false,
        reason: `Model does not support file/document inputs`
      }
    }
    
    // Check context limits
    const limits = MODEL_CONTEXT_LIMITS[modelCode]
    if (limits && estimatedInputTokens > limits.maxInput) {
      return {
        valid: false,
        reason: `Input (${estimatedInputTokens} tokens) exceeds model limit (${limits.maxInput})`
      }
    }
    
    return { valid: true }
  }

  private async executeWithProvider(
    request: LLMRequest,
    limits: EnforcementDecision,
    provider: LLMProvider,
    modelCode: string,
    isFallback: boolean
  ): Promise<LLMResponse> {
    console.log(`Executing with ${provider.name} (model: ${modelCode})${isFallback ? ' [FALLBACK]' : ''}`)
    
    const startTime = Date.now()
    
    try {
      const response = await provider.execute(request, limits)
      
      // Mark provider as successful
      this.markProviderSuccess(provider.name)
      
      const duration = Date.now() - startTime
      
      // Normalize token fields so cost logs are consistent across providers/models.
      const tokenUsage = this.normalizeTokenUsage(response, request)
      const responseMetadata =
        response.metadata && typeof response.metadata === 'object'
          ? (response.metadata as Record<string, unknown>)
          : {}
      const providerReportedModel =
        typeof responseMetadata.modelUsed === 'string'
          ? responseMetadata.modelUsed
          : typeof responseMetadata.model === 'string'
          ? responseMetadata.model
          : undefined
      const loggedModelCode = providerReportedModel || modelCode
      
      const costBreakdown = logLLMCost(
        `${request.taskCode || 'LLM_CALL'}${isFallback ? ' [FALLBACK]' : ''}`,
        loggedModelCode,
        tokenUsage.inputTokens,
        tokenUsage.outputTokens,
        tokenUsage.thoughtTokens,
        {
          taskCode: request.taskCode,
          stageCode: (request as any).stageCode,
          patentId: request.metadata?.patentId,
          paperId: request.metadata?.paperId,
          userId: request.metadata?.userId,
          tenantId: request.metadata?.tenantId,
          duration,
          module: request.metadata?.module,
          action: request.metadata?.action,
          resolvedModelCode: modelCode,
          providerModel: providerReportedModel
        }
      )
      
      return {
        ...response,
        metadata: {
          ...response.metadata,
          selectedProvider: provider.name,
          modelUsed: loggedModelCode,
          wasFallback: isFallback,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          thoughtTokens: tokenUsage.thoughtTokens,
          totalTokens: tokenUsage.totalTokens,
          tokenUsage,
          // Add cost information to metadata
          costBreakdown: {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            thoughtTokens: tokenUsage.thoughtTokens,
            totalTokens: costBreakdown.totalTokens,
            actualCost: costBreakdown.actualCost,
            contingencyCost: costBreakdown.contingencyCost,
            inputCost: costBreakdown.inputCost,
            outputCost: costBreakdown.outputCost,
            thoughtCost: costBreakdown.thoughtCost
          },
          durationMs: duration
        }
      }
    } catch (error) {
      console.error(`Provider ${provider.name} failed with model ${modelCode}:`, error)
      
      // Track provider failure for health monitoring
      this.markProviderFailure(provider.name, error instanceof Error ? error : new Error(String(error)))
      
      throw error
    }
  }

  private async selectProvider(
    request: LLMRequest,
    limits: EnforcementDecision,
    priorities?: ProviderPriority[]
  ): Promise<RoutingDecision | null> {
    const availableProviders = Array.from(this.providers.values())
      .filter(provider => this.isProviderHealthy(provider))

    if (availableProviders.length === 0) {
      throw new Error('No healthy providers available')
    }

    // If request specifies a model, try to use it directly
    if (request.modelClass) {
      const specifiedProvider = this.getProviderForModel(request.modelClass)
      if (specifiedProvider && this.isProviderHealthy(specifiedProvider)) {
        return {
          provider: specifiedProvider,
          reason: `Using specified model: ${request.modelClass}`,
          modelCode: request.modelClass,
          costEstimate: this.estimateCost(specifiedProvider, request, limits)
        }
      }
    }

    // Special handling for multimodal requests (images or files)
    const hasFileInput = Boolean(request.content && request.content.parts.some(part => part.type === 'file'))
    const isMultimodal = Boolean(
      request.content && request.content.parts.some(part => part.type === 'image' || part.type === 'file')
    )

    // Special handling for relevance analysis (PRIOR_ART_SEARCH) - use Flash-Lite
    const isRelevanceAnalysis = request.taskCode === 'LLM5_NOVELTY_ASSESS' && !isMultimodal

    // Special handling for diagram generation - use GPT-4o for PlantUML code generation
    const isDiagramGeneration = request.taskCode === 'LLM3_DIAGRAM'

    let activePriorities: ProviderPriority[]

    if (hasFileInput) {
      // Raw document inputs: prioritize Gemini native document-capable models.
      activePriorities = [
        { provider: 'gemini', priority: 1, fallback: true },
        { provider: 'openai', priority: 2, fallback: true },
        { provider: 'anthropic', priority: 3, fallback: true },
      ]
    } else if (isMultimodal) {
      // For multimodal: prioritize vision-capable models
      activePriorities = [
        { provider: 'gemini', priority: 1, fallback: true },
        { provider: 'openai', priority: 2, fallback: true },
        { provider: 'anthropic', priority: 3, fallback: true },
        { provider: 'zhipu', priority: 4, fallback: true }
      ]
    } else if (isDiagramGeneration) {
      // For diagram generation: GPT-4o primary (better PlantUML code)
      activePriorities = [
        { provider: 'openai', priority: 1, fallback: true },
        { provider: 'gemini', priority: 2, fallback: true },
        { provider: 'anthropic', priority: 3, fallback: true }
      ]
    } else if (isRelevanceAnalysis) {
      // For relevance analysis: fast, cost-effective models
      activePriorities = [
        { provider: 'gemini-flash-lite', priority: 1, fallback: true },
        { provider: 'groq', priority: 2, fallback: true },
        { provider: 'deepseek', priority: 3, fallback: true },
        { provider: 'openai', priority: 4, fallback: true },
        { provider: 'qwen', priority: 5, fallback: true },
        { provider: 'zhipu', priority: 6, fallback: true }
      ]
    } else {
      // Default priority order
      activePriorities = priorities || [
        { provider: 'gemini', priority: 1, fallback: true },
        { provider: 'openai', priority: 2, fallback: true },
        { provider: 'anthropic', priority: 3, fallback: true },
        { provider: 'deepseek', priority: 4, fallback: true },
        { provider: 'groq', priority: 5, fallback: true },
        { provider: 'qwen', priority: 6, fallback: true },
        { provider: 'zhipu', priority: 7, fallback: true }
      ]
    }

    // Sort providers by priority
    const sortedProviders = availableProviders
      .map(provider => ({
        provider,
        priority: activePriorities.find(p => p.provider === provider.name)?.priority || 999
      }))
      .sort((a, b) => a.priority - b.priority)

    // Return the highest priority provider
    const selected = sortedProviders[0]
    if (!selected) return null

    return {
      provider: selected.provider,
      reason: `Selected by priority (${selected.priority})`,
      costEstimate: this.estimateCost(selected.provider, request, limits)
    }
  }

  private async tryFallback(
    request: LLMRequest,
    limits: EnforcementDecision,
    failedProvider: string
  ): Promise<LLMResponse | null> {
    const fallbackProviders = Array.from(this.providers.values())
      .filter(provider => provider.name !== failedProvider && this.isProviderHealthy(provider))

    for (const provider of fallbackProviders) {
      try {
        console.log(`Trying fallback provider: ${provider.name}`)
        const fallbackModel = request.modelClass || provider.supportedModels[0]
        const response = await this.executeWithProvider(request, limits, provider, fallbackModel, true)

        return {
          ...response,
          metadata: {
            ...response.metadata,
            originalProvider: failedProvider,
            fallbackProvider: provider.name
          }
        }
      } catch (error) {
        console.error(`Fallback provider ${provider.name} also failed:`, error)
        continue
      }
    }

    return null
  }

  // Track provider health status and recent failures
  private providerHealth: Map<string, { 
    healthy: boolean
    lastCheck: number
    failureCount: number
    lastError?: string
  }> = new Map()
  
  private readonly HEALTH_CHECK_INTERVAL = 60000 // 1 minute
  private readonly FAILURE_THRESHOLD = 3 // Mark unhealthy after 3 consecutive failures
  private readonly RECOVERY_INTERVAL = 300000 // 5 minutes to retry unhealthy provider

  private isProviderHealthy(provider: LLMProvider): boolean {
    const health = this.providerHealth.get(provider.name)
    
    // No health data yet - assume healthy but check API key
    if (!health) {
      const hasKey = this.hasValidApiKey(provider.name)
      this.providerHealth.set(provider.name, {
        healthy: hasKey,
        lastCheck: Date.now(),
        failureCount: 0,
        lastError: hasKey ? undefined : 'Missing API key'
      })
      return hasKey
    }
    
    // If marked unhealthy, check if recovery interval has passed
    if (!health.healthy) {
      const timeSinceLastCheck = Date.now() - health.lastCheck
      if (timeSinceLastCheck >= this.RECOVERY_INTERVAL) {
        // Allow retry - reset health status
        console.log(`[ProviderRouter] Retrying unhealthy provider ${provider.name} after recovery interval`)
        health.healthy = true
        health.failureCount = 0
        health.lastCheck = Date.now()
        return true
      }
      return false
    }
    
    return health.healthy
  }

  /**
   * Check if provider has a valid API key configured
   */
  private hasValidApiKey(providerName: string): boolean {
    const keyMap: Record<string, string | undefined> = {
      'openai': process.env.OPENAI_API_KEY,
      'anthropic': process.env.ANTHROPIC_API_KEY,
      'gemini': process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY,
      'gemini-flash-lite': process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY,
      'deepseek': process.env.DEEPSEEK_API_KEY,
      'groq': process.env.GROQ_API_KEY,
      'zhipu': process.env.ZHIPU_API_KEY,
      'qwen': process.env.QWEN_API_KEY
    }
    
    const key = keyMap[providerName]
    return !!key && key.length > 10 // Basic validation - key exists and has reasonable length
  }

  /**
   * Mark a provider as failed (called after provider throws)
   */
  markProviderFailure(providerName: string, error: Error): void {
    const health = this.providerHealth.get(providerName) || {
      healthy: true,
      lastCheck: Date.now(),
      failureCount: 0
    }
    
    health.failureCount++
    health.lastError = error.message
    health.lastCheck = Date.now()
    
    if (health.failureCount >= this.FAILURE_THRESHOLD) {
      health.healthy = false
      console.error(`[ProviderRouter] Provider ${providerName} marked unhealthy after ${health.failureCount} failures: ${error.message}`)
    }
    
    this.providerHealth.set(providerName, health)
  }

  /**
   * Mark a provider as successful (reset failure count)
   */
  markProviderSuccess(providerName: string): void {
    const health = this.providerHealth.get(providerName) || {
      healthy: true,
      lastCheck: Date.now(),
      failureCount: 0
    }
    
    health.healthy = true
    health.failureCount = 0
    health.lastCheck = Date.now()
    delete health.lastError
    
    this.providerHealth.set(providerName, health)
  }

  private estimateCost(
    provider: LLMProvider,
    request: LLMRequest,
    limits: EnforcementDecision
  ): number {
    const costs = provider.getCostPerToken(provider.supportedModels[0])
    const estimatedInputTokens = (request.inputTokens || 100)
    const estimatedOutputTokens = (limits.maxTokensOut || 1000)

    return (estimatedInputTokens * costs.input) + (estimatedOutputTokens * costs.output)
  }

  // Public methods for monitoring and management
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  getProviderHealth(): Record<string, { healthy: boolean; failureCount: number; lastError?: string }> {
    const health: Record<string, { healthy: boolean; failureCount: number; lastError?: string }> = {}
    this.providers.forEach((provider, name) => {
      const providerHealth = this.providerHealth.get(name)
      health[name] = {
        healthy: this.isProviderHealthy(provider),
        failureCount: providerHealth?.failureCount || 0,
        lastError: providerHealth?.lastError
      }
    })
    return health
  }

  async refreshProviders(): Promise<void> {
    // Reinitialize providers (useful for key rotation)
    this.providers.clear()
    this.initializeProviders()
  }
}

// Singleton instance
export const llmProviderRouter = new LLMProviderRouter()
