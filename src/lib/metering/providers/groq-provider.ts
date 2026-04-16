/**
 * Groq Provider Implementation
 * Ultra-fast inference for open-source models
 * Supports Llama 3.3, Mixtral, and other models
 */

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

const SHOULD_LOG_PROVIDER_INIT = process.env.LLM_PROVIDER_INIT_LOGS === 'true'

export class GroqProvider implements LLMProvider {
  name = 'groq'
  supportedModels = [
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it'
  ]

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      if (SHOULD_LOG_PROVIDER_INIT) {
        console.log(`Initializing Groq provider with API key present: ${!!config.apiKey}`)
      }
      
      if (!config.apiKey) {
        console.error('No API key provided for Groq provider!')
        return
      }

      try {
        // Groq uses OpenAI-compatible API
        const OpenAI = require('openai')
        this.client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://api.groq.com/openai/v1'
        })
        if (SHOULD_LOG_PROVIDER_INIT) {
          console.log('Groq client initialized successfully')
        }
      } catch (error) {
        console.warn('Groq client initialization failed:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Groq client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'llama-3.3-70b-versatile'
    
    // Map friendly names to API model names
    const modelMap: Record<string, string> = {
      'groq-llama-3.3-70b': 'llama-3.3-70b-versatile',
      'groq-llama-3.1-70b': 'llama-3.1-70b-versatile',
      'groq-llama-3.1-8b': 'llama-3.1-8b-instant',
      'groq-mixtral-8x7b': 'mixtral-8x7b-32768',
      'groq-gemma2-9b': 'gemma2-9b-it'
    }
    
    const actualModel = modelMap[modelToUse] || modelToUse

    try {
      // Build messages array
      const messages: any[] = []
      
      if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      } else if (request.content && request.content.parts) {
        // Groq doesn't support vision, only use text
        const textParts = request.content.parts
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('\n')
        
        if (textParts) {
          messages.push({ role: 'user', content: textParts })
        }
      }

      if (messages.length === 0) {
        throw new Error('No valid content provided for Groq request')
      }

      // Apply token limits - admin config takes priority over model defaults
      const modelLimits = this.getTokenLimits(actualModel)
      const maxTokens = limits.maxTokensOut || modelLimits.output
      console.log(`[GroqProvider] Token limits: admin=${limits.maxTokensOut || 'not set'}, model=${modelLimits.output}, using=${maxTokens}`)

      const response = await this.client.chat.completions.create({
        model: actualModel,
        messages,
        max_tokens: maxTokens,
        temperature: request.parameters?.temperature ?? 0.7
      })

      const outputText = response.choices?.[0]?.message?.content || ''
      const usage = (response.usage || {}) as Record<string, any>
      const inputTokens = Number(usage.prompt_tokens) || 0
      const outputTokens = Number(usage.completion_tokens) || 0
      const thoughtTokens = Number(
        usage.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens ??
        0
      ) || 0
      const totalTokens = Number(usage.total_tokens) || (inputTokens + outputTokens + thoughtTokens)
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
          finishReason: response.choices?.[0]?.finish_reason,
          usage
        }
      }
    } catch (error: any) {
      console.error('Groq API error:', error)
      // IMPORTANT: Throw error instead of swallowing it, so fallback routing can work
      throw new Error(`Groq API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    const limits: Record<string, { input: number; output: number }> = {
      'llama-3.3-70b-versatile': { input: 128000, output: 8192 },
      'llama-3.1-70b-versatile': { input: 128000, output: 8192 },
      'llama-3.1-8b-instant': { input: 128000, output: 8192 },
      'mixtral-8x7b-32768': { input: 32768, output: 8192 },
      'gemma2-9b-it': { input: 8192, output: 4096 }
    }
    return limits[modelName] || { input: 128000, output: 8192 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    // Cost per token in USD (Groq is very affordable)
    const costs: Record<string, { input: number; output: number }> = {
      'llama-3.3-70b-versatile': { input: 0.00000059, output: 0.00000079 },
      'llama-3.1-70b-versatile': { input: 0.00000059, output: 0.00000079 },
      'llama-3.1-8b-instant': { input: 0.00000005, output: 0.00000008 },
      'mixtral-8x7b-32768': { input: 0.00000024, output: 0.00000024 },
      'gemma2-9b-it': { input: 0.00000020, output: 0.00000020 }
    }
    return costs[modelName] || { input: 0.00000059, output: 0.00000079 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}

