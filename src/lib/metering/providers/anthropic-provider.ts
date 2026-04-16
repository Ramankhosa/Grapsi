/**
 * Anthropic Claude Provider Implementation
 * Supports Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus
 */

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  supportedModels = [
    // Claude 4 models (latest)
    'claude-sonnet-4',
    'claude-opus-4',
    'claude-opus-4.5',
    'claude-opus-4.6',
    // Claude 3.7 models
    'claude-3-7-sonnet',
    // Claude 3.5 models
    'claude-3-5-sonnet',
    'claude-3-5-haiku', 
    // Legacy Claude 3 models
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
  ]

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      console.log(`Initializing Anthropic provider with API key present: ${!!config.apiKey}`)
      
      if (!config.apiKey) {
        console.error('No API key provided for Anthropic provider!')
        return
      }

      try {
        const Anthropic = require('@anthropic-ai/sdk')
        this.client = new Anthropic({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
          timeout: this.getTimeoutMs(),
          maxRetries: this.getMaxRetries()
        })
        console.log('Anthropic client initialized successfully')
      } catch (error) {
        console.warn('Anthropic SDK not available:', error)
      }
    }
  }

  private getTimeoutMs(): number {
    const configuredTimeout = this.config.timeout
    if (typeof configuredTimeout === 'number' && Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
      return configuredTimeout
    }
    return 30 * 60 * 1000
  }

  private getMaxRetries(): number {
    const configuredRetries = this.config.maxRetries
    if (typeof configuredRetries === 'number' && Number.isFinite(configuredRetries) && configuredRetries >= 0) {
      return Math.floor(configuredRetries)
    }
    return 2
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

    return this.readTokenNumber(
      usage.thinking_tokens ??
      usage.reasoning_tokens ??
      usage.thought_tokens ??
      usage.thinkingTokens ??
      usage.reasoningTokens ??
      usage.thoughtTokens
    )
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'claude-sonnet-4'
    
    // Map friendly model names to Anthropic's required exact model IDs
    // Anthropic API requires dated versions - aliases don't work
    // Updated Jan 2026 with latest available models
    const modelMap: Record<string, string> = {
      // Claude 4 models (latest - Jan 2026)
      'claude-sonnet-4': 'claude-sonnet-4-20250514',
      'claude-4-sonnet': 'claude-sonnet-4-20250514',
      'claude-opus-4': 'claude-opus-4-20250514',
      'claude-4-opus': 'claude-opus-4-20250514',
      'claude-opus-4.5': 'claude-opus-4-6', // Alias to latest supported Opus variant
      'claude-opus-4-5': 'claude-opus-4-6',
      'claude-opus-4.6': 'claude-opus-4-6',
      'claude-opus-4-6': 'claude-opus-4-6',
      // Claude 3.7 Sonnet
      'claude-3-7-sonnet': 'claude-3-7-sonnet-20250219',
      'claude-3.7-sonnet': 'claude-3-7-sonnet-20250219',
      // Claude 3.5 Sonnet variations -> use Claude 3.7 as replacement
      'claude-3.5-sonnet': 'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet': 'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-latest': 'claude-3-7-sonnet-20250219',
      'claude-sonnet-3.5': 'claude-3-7-sonnet-20250219',
      // Claude 3.5 Haiku variations -> use latest haiku
      'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
      // Claude 3 Opus variations -> use Claude Opus 4
      'claude-3-opus': 'claude-opus-4-20250514',
      'claude-3-opus-latest': 'claude-opus-4-20250514',
      // Legacy Claude 3 models (fallback to newer versions)
      'claude-3-sonnet': 'claude-3-7-sonnet-20250219',
      'claude-3-haiku': 'claude-3-5-haiku-20241022',
    }
    
    const actualModel = modelMap[modelToUse] || modelToUse
    console.log(`Anthropic: mapping model "${modelToUse}" -> "${actualModel}"`)

    try {
      // Build messages array
      const messages: any[] = []
      
      if (request.content && request.content.parts) {
        // Multimodal content
        const contentParts: any[] = []
        
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            contentParts.push({ type: 'text', text: part.text })
          } else if (part.type === 'image') {
            // Claude expects base64 images
            contentParts.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: part.image.mimeType || 'image/jpeg',
                data: part.image.data
              }
            })
          }
        }
        
        messages.push({ role: 'user', content: contentParts })
      } else if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      }

      // Apply token limits - admin config takes priority
      // Claude 3.5 Sonnet supports 8192, Claude 3 Opus supports 4096
      // Allow admin to override with higher limits for newer models
      const defaultMax = 8192
      const maxTokens = limits.maxTokensOut || defaultMax
      const timeoutMs = this.getTimeoutMs()
      console.log(`[AnthropicProvider] Token limits: admin=${limits.maxTokensOut || 'not set'}, using=${maxTokens}`)
      console.log(`[AnthropicProvider] Request timeout=${timeoutMs}ms, maxRetries=${this.getMaxRetries()}`)

      const response = await this.client.messages.create({
        model: actualModel,
        max_tokens: maxTokens,
        messages,
        temperature: request.parameters?.temperature ?? 0.7
      })

      const outputText = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('')

      const usage =
        response.usage && typeof response.usage === 'object'
          ? (response.usage as Record<string, unknown>)
          : undefined
      const inputTokens = this.readTokenNumber(usage?.input_tokens)
      const outputTokens = this.readTokenNumber(usage?.output_tokens)
      const thoughtTokens = this.extractThoughtTokens(usage)
      const totalTokens = this.readTokenNumber(usage?.total_tokens) || (inputTokens + outputTokens + thoughtTokens)
      const latency = Date.now() - startTime

      return {
        output: outputText,
        outputTokens,
        modelClass: modelToUse,
        metadata: {
          provider: this.name,
          model: actualModel,
          inputTokens,
          outputTokens,
          thoughtTokens,
          totalTokens,
          latencyMs: latency,
          stopReason: response.stop_reason,
          usage
        }
      }
    } catch (error: any) {
      console.error('Anthropic API error:', error)
      // IMPORTANT: Throw error instead of swallowing it, so fallback routing can work
      throw new Error(`Anthropic API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    // Claude models context windows (updated Jan 2026)
    const limits: Record<string, { input: number; output: number }> = {
      // Claude 4 models
      'claude-sonnet-4': { input: 200000, output: 16384 },
      'claude-opus-4': { input: 200000, output: 16384 },
      'claude-opus-4.5': { input: 1000000, output: 128000 },
      'claude-opus-4-5': { input: 1000000, output: 128000 },
      'claude-opus-4.6': { input: 1000000, output: 128000 },
      'claude-opus-4-6': { input: 1000000, output: 128000 },
      // Claude 3.7 models
      'claude-3-7-sonnet': { input: 200000, output: 16384 },
      // Claude 3.5 models
      'claude-3-5-sonnet': { input: 200000, output: 8192 },
      'claude-3-5-haiku': { input: 200000, output: 8192 },
      // Legacy Claude 3 models
      'claude-3-opus': { input: 200000, output: 4096 },
      'claude-3-sonnet': { input: 200000, output: 4096 },
      'claude-3-haiku': { input: 200000, output: 4096 }
    }
    return limits[modelName] || { input: 200000, output: 8192 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    // Cost per token in USD (approximate as of Jan 2026)
    const costs: Record<string, { input: number; output: number }> = {
      // Claude 4 models
      'claude-sonnet-4': { input: 0.000003, output: 0.000015 },
      'claude-opus-4': { input: 0.000015, output: 0.000075 },
      'claude-opus-4.5': { input: 0.000005, output: 0.000025 },
      'claude-opus-4-5': { input: 0.000005, output: 0.000025 },
      'claude-opus-4.6': { input: 0.000005, output: 0.000025 },
      'claude-opus-4-6': { input: 0.000005, output: 0.000025 },
      // Claude 3.7 models
      'claude-3-7-sonnet': { input: 0.000003, output: 0.000015 },
      // Claude 3.5 models
      'claude-3-5-sonnet': { input: 0.000003, output: 0.000015 },
      'claude-3-5-haiku': { input: 0.0000008, output: 0.000004 },
      // Legacy Claude 3 models
      'claude-3-opus': { input: 0.000015, output: 0.000075 },
      'claude-3-sonnet': { input: 0.000003, output: 0.000015 },
      'claude-3-haiku': { input: 0.00000025, output: 0.00000125 }
    }
    return costs[modelName] || { input: 0.000003, output: 0.000015 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}

