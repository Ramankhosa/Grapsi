// OpenAI Provider Implementation
// Supports GPT-3.5, GPT-4, GPT-5, and o1 series models with multimodal capabilities
// Note: GPT-5 and o1 models use max_completion_tokens instead of max_tokens

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

const DEFAULT_OPENAI_TIMEOUT_MS = 30000
// GPT-5 and o1 models use reasoning and produce longer outputs; they need a much
// larger timeout to avoid AbortError on complex prompts (e.g., paper section drafting).
const DEFAULT_GPT5_TIMEOUT_MS = 120000
const DEFAULT_O1_TIMEOUT_MS = 120000
const DEFAULT_OPENAI_MAX_RETRIES = 3
const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  supportedModels = [
    // GPT-4 Series
    'gpt-4o', 
    'gpt-4o-mini', 
    'gpt-4-turbo', 
    'gpt-4',
    // GPT-5 Series
    'gpt-5',
    'gpt-5.1',
    'gpt-5.2',
    'gpt-5-mini',
    'gpt-5-nano',
    // GPT-5 Thinking Variants (alias to base model + reasoning controls)
    'gpt-5.1-thinking',
    'gpt-5.2-thinking',
    // GPT-3.5 Series
    'gpt-3.5-turbo',
    // o1 Reasoning Models
    'o1',
    'o1-mini',
    'o1-preview'
  ]

  private config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  private getTimeoutMs(modelCode?: string): number {
    const configuredTimeout = this.config.timeout
    if (typeof configuredTimeout === 'number' && Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
      return configuredTimeout
    }
    // Use longer defaults for models that require more processing time
    if (modelCode) {
      if (modelCode.startsWith('gpt-5')) return DEFAULT_GPT5_TIMEOUT_MS
      if (modelCode.startsWith('o1')) return DEFAULT_O1_TIMEOUT_MS
    }
    return DEFAULT_OPENAI_TIMEOUT_MS
  }

  private getMaxRetries(): number {
    const configuredRetries = this.config.maxRetries
    if (typeof configuredRetries === 'number' && Number.isFinite(configuredRetries) && configuredRetries > 0) {
      return Math.floor(configuredRetries)
    }
    return DEFAULT_OPENAI_MAX_RETRIES
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false

    const message = error.message.toLowerCase()
    return (
      error.name === 'AbortError' ||
      message.includes('fetch failed') ||
      message.includes('und_err_connect_timeout') ||
      message.includes('timed out') ||
      message.includes('etimedout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('eai_again')
    )
  }

  private async waitBeforeRetry(attempt: number): Promise<void> {
    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  private normalizeModelCode(modelCode: string): {
    apiModel: string
    isThinkingVariant: boolean
  } {
    if (!modelCode) return { apiModel: modelCode, isThinkingVariant: false }

    // "thinking" is represented as a model-code variant in our system
    // and translated into OpenAI request fields (reasoning.effort).
    if (modelCode.endsWith('-thinking')) {
      return { apiModel: modelCode.replace(/-thinking$/, ''), isThinkingVariant: true }
    }

    return { apiModel: modelCode, isThinkingVariant: false }
  }

  private readTokenNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value)
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed)
      }
    }
    return 0
  }

  private extractThoughtTokens(usage: Record<string, unknown> | undefined): number {
    if (!usage) return 0

    const completionDetails =
      usage.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
        ? (usage.completion_tokens_details as Record<string, unknown>)
        : {}
    const outputDetails =
      usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
        ? (usage.output_tokens_details as Record<string, unknown>)
        : {}

    return this.readTokenNumber(
      usage.reasoning_tokens ??
      usage.reasoningTokens ??
      usage.thinking_tokens ??
      usage.thinkingTokens ??
      usage.thought_tokens ??
      usage.thoughtTokens ??
      completionDetails.reasoning_tokens ??
      completionDetails.thinking_tokens ??
      outputDetails.reasoning_tokens ??
      outputDetails.thinking_tokens
    )
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    // Use the model specified in the request (from model resolver) or fall back to config default
    const requestedModel = request.modelClass || this.config.model
    const { apiModel: modelToUse, isThinkingVariant } = this.normalizeModelCode(requestedModel)
    
    // Check if this model requires max_completion_tokens instead of max_tokens
    // OpenAI's newer models (o1, o1-mini, o1-preview, gpt-5, gpt-5.1, etc.) use max_completion_tokens
    const isO1Model = modelToUse.startsWith('o1')
    const isGPT5Model = modelToUse.startsWith('gpt-5')
    const usesMaxCompletionTokens = isO1Model || isGPT5Model
    const supportsTemperatureTuning = !(isO1Model || isGPT5Model)
    
    // Apply enforcement limits - some models use max_completion_tokens instead of max_tokens
    const maxTokens = limits.maxTokensOut || 4096
    const timeoutMs = this.getTimeoutMs(modelToUse)
    const maxAttempts = this.getMaxRetries()
    console.log(`[OpenAIProvider] Token limits: admin=${limits.maxTokensOut || 'not set'}, using=${maxTokens}`)
    console.log(`[OpenAIProvider] Request timeout=${timeoutMs}ms, maxAttempts=${maxAttempts}`)

    try {
      // Build message content for OpenAI
      let messageContent: any;

      if (request.content) {
        // Build multimodal content for GPT-4o
        messageContent = []
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            messageContent.push({ type: 'text', text: part.text })
          } else if (part.type === 'image') {
            messageContent.push({
              type: 'image_url',
              image_url: {
                url: `data:${part.image.mimeType};base64,${part.image.data}`,
                detail: 'high' // Use high detail for better analysis
              }
            })
          }
        }
      } else {
        // Fallback to text-only
        messageContent = request.prompt || ''
      }

      // Build request body with model-specific parameters
      const requestBody: any = {
        model: modelToUse,
        messages: [
          {
            role: 'user',
            content: messageContent
          }
        ]
      }

      // Reasoning / "thinking" controls:
      // - Thinking variants (e.g., gpt-5.2-thinking) default to higher reasoning effort.
      // - Non-thinking variants (gpt-5, gpt-5.1, gpt-5.2) default to 'low' for faster responses.
      // - Request can override via request.parameters.reasoning_effort (string) or request.parameters.reasoning?.effort.
      // IMPORTANT: This gateway calls OpenAI via /v1/chat/completions and that endpoint rejects an object parameter
      // named "reasoning" (400: Unknown parameter: 'reasoning'). Use reasoning_effort instead.
      // Note: We only apply this to GPT-5 family in this gateway to avoid surprising behavior on other models.
      if (isGPT5Model) {
        const configuredReasoning = request.parameters?.reasoning
        const configuredReasoningEffort = request.parameters?.reasoning_effort

        // Default effort: 'high' for thinking variants, 'low' for regular GPT-5 models (faster responses)
        // Set to 'medium' or 'high' explicitly if you need more thorough reasoning
        const defaultEffort = isThinkingVariant ? 'high' : 'low'
        const effort = configuredReasoning?.effort ?? configuredReasoningEffort ?? defaultEffort

        // Always set reasoning_effort for GPT-5 models to control response time
        requestBody.reasoning_effort = effort
        console.log(`[OpenAIProvider] Using reasoning_effort=${effort} for ${modelToUse}`)
      }
      
      if (usesMaxCompletionTokens) {
        // o1 models and GPT-5 models expect max_completion_tokens (NOT max_tokens)
        // See: https://help.openai.com/en/articles/5072518
        requestBody.max_completion_tokens = maxTokens
        
        // o1 models don't support temperature parameter
        // GPT-5 models expect default temperature (omit to avoid API error)
        if (supportsTemperatureTuning) {
          requestBody.temperature = request.parameters?.temperature ?? 0.7
        }
        console.log(`[OpenAIProvider] Using max_completion_tokens for ${modelToUse} (${maxTokens} tokens)`)
      } else {
        // Legacy chat models (GPT-3.5/4 families) use max_tokens
        requestBody.max_tokens = maxTokens
        if (supportsTemperatureTuning) {
          requestBody.temperature = request.parameters?.temperature ?? 0.7
        }
      }
      
      let lastError: Error | null = null

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        try {
          const response = await fetch(`${this.config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          })

          if (!response.ok) {
            const errorText = await response.text()
            const statusError = new Error(`OpenAI API error: ${response.status} ${errorText}`)
            const canRetry = attempt < maxAttempts && RETRYABLE_HTTP_STATUS_CODES.has(response.status)

            if (canRetry) {
              console.warn(
                `[OpenAIProvider] Attempt ${attempt}/${maxAttempts} returned status ${response.status}. Retrying...`
              )
              await this.waitBeforeRetry(attempt)
              continue
            }

            throw statusError
          }

          const data = await response.json()
          const choice = data.choices?.[0]
          const usage =
            data.usage && typeof data.usage === 'object'
              ? (data.usage as Record<string, unknown>)
              : undefined
          const inputTokens = this.readTokenNumber(usage?.prompt_tokens)
          const outputTokens = this.readTokenNumber(usage?.completion_tokens)
          const totalTokens = this.readTokenNumber(usage?.total_tokens)
          const thoughtTokens = this.extractThoughtTokens(usage)

          if (!choice?.message?.content) {
            throw new Error('OpenAI API returned an empty response')
          }

          return {
            output: choice.message.content,
            outputTokens,
            modelClass: requestedModel, // Preserve the configured model code (may be a thinking alias)
            metadata: {
              provider: 'openai',
              inputTokens,
              outputTokens,
              thoughtTokens,
              totalTokens,
              finishReason: choice.finish_reason,
              modelUsed: modelToUse,
              usage
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          const canRetry = attempt < maxAttempts && this.isRetryableNetworkError(lastError)
          if (canRetry) {
            console.warn(
              `[OpenAIProvider] Attempt ${attempt}/${maxAttempts} failed (${lastError.message}). Retrying...`
            )
            await this.waitBeforeRetry(attempt)
            continue
          }

          throw lastError
        } finally {
          clearTimeout(timeoutId)
        }
      }

      throw new Error(`OpenAI API call failed after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`)
    } catch (error) {
      console.error('OpenAI API error:', error)
      throw new Error(`OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getTokenLimits(modelName: string): { input: number, output: number } {
    const normalized = this.normalizeModelCode(modelName).apiModel
    // Token limits per model family
    const limits: Record<string, { input: number, output: number }> = {
      // GPT-4 Series
      'gpt-4o': { input: 128000, output: 16384 },
      'gpt-4o-mini': { input: 128000, output: 16384 },
      'gpt-4-turbo': { input: 128000, output: 4096 },
      'gpt-4': { input: 8192, output: 4096 },
      // GPT-5 Series (estimated based on typical patterns)
      'gpt-5': { input: 256000, output: 32768 },
      'gpt-5.1': { input: 256000, output: 32768 },
      'gpt-5.2': { input: 256000, output: 32768 },
      'gpt-5-mini': { input: 128000, output: 16384 },
      'gpt-5-nano': { input: 64000, output: 8192 },
      // GPT-3.5 Series
      'gpt-3.5-turbo': { input: 16384, output: 4096 },
      // o1 Reasoning Models
      'o1': { input: 200000, output: 100000 },
      'o1-mini': { input: 128000, output: 65536 },
      'o1-preview': { input: 128000, output: 32768 }
    }
    
    return limits[normalized] || { input: 128000, output: 16384 }
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    const normalized = this.normalizeModelCode(modelName).apiModel
    // Pricing per token (converted from per-million pricing)
    const costs: Record<string, { input: number, output: number }> = {
      // GPT-4 Series
      'gpt-4o': { input: 0.0000025, output: 0.000010 },           // $2.50/$10.00 per M
      'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },    // $0.15/$0.60 per M
      'gpt-4-turbo': { input: 0.00001, output: 0.00003 },         // $10/$30 per M
      'gpt-4': { input: 0.00003, output: 0.00006 },               // $30/$60 per M
      // GPT-5 Series (estimated pricing)
      'gpt-5': { input: 0.00001, output: 0.00003 },               // $10/$30 per M
      'gpt-5.1': { input: 0.000012, output: 0.000036 },           // $12/$36 per M
      'gpt-5.2': { input: 0.000012, output: 0.000036 },           // $12/$36 per M (placeholder - update if pricing differs)
      'gpt-5-mini': { input: 0.000003, output: 0.000012 },        // $3/$12 per M
      'gpt-5-nano': { input: 0.0000005, output: 0.000002 },       // $0.50/$2.00 per M
      // GPT-3.5 Series
      'gpt-3.5-turbo': { input: 0.0000005, output: 0.0000015 },   // $0.50/$1.50 per M
      // o1 Reasoning Models
      'o1': { input: 0.000015, output: 0.00006 },                 // $15/$60 per M
      'o1-mini': { input: 0.000003, output: 0.000012 },           // $3/$12 per M
      'o1-preview': { input: 0.000015, output: 0.00006 }          // $15/$60 per M
    }
    
    return costs[normalized] || { input: 0.000005, output: 0.000015 }
  }

  async isHealthy(): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.getTimeoutMs())
    try {
      const response = await fetch(`${this.config.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        signal: controller.signal
      })
      return response.ok
    } catch (error) {
      console.error('OpenAI health check failed:', error)
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
