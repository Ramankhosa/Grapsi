/**
 * DeepSeek Provider Implementation
 * Supports DeepSeek Chat and DeepSeek Reasoner (R1)
 * Uses OpenAI-compatible API
 */

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek'
  supportedModels = ['deepseek-chat', 'deepseek-reasoner']

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      console.log(`Initializing DeepSeek provider with API key present: ${!!config.apiKey}`)
      
      if (!config.apiKey) {
        console.error('No API key provided for DeepSeek provider!')
        return
      }

      try {
        // DeepSeek uses OpenAI-compatible API
        const OpenAI = require('openai')
        this.client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://api.deepseek.com/v1'
        })
        console.log('DeepSeek client initialized successfully')
      } catch (error) {
        console.warn('DeepSeek client initialization failed:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('DeepSeek client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'deepseek-chat'
    
    // Map friendly names to API model names
    const modelMap: Record<string, string> = {
      'deepseek-chat': 'deepseek-chat',
      'deepseek-reasoner': 'deepseek-reasoner'
    }
    
    const actualModel = modelMap[modelToUse] || modelToUse

    try {
      // Build messages array
      const messages: any[] = []
      
      if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      } else if (request.content && request.content.parts) {
        // DeepSeek doesn't support vision yet, only use text
        const textParts = request.content.parts
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('\n')
        
        if (textParts) {
          messages.push({ role: 'user', content: textParts })
        }
      }

      if (messages.length === 0) {
        throw new Error('No valid content provided for DeepSeek request')
      }

      // Apply token limits - admin config takes priority
      // DeepSeek models support up to 64K output tokens
      const defaultMax = 8192
      const maxTokens = limits.maxTokensOut || defaultMax
      console.log(`[DeepSeekProvider] Token limits: admin=${limits.maxTokensOut || 'not set'}, using=${maxTokens}`)

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
      console.error('DeepSeek API error:', error)
      // IMPORTANT: Throw error instead of swallowing it, so fallback routing can work
      throw new Error(`DeepSeek API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    const limits: Record<string, { input: number; output: number }> = {
      'deepseek-chat': { input: 64000, output: 8192 },
      'deepseek-reasoner': { input: 64000, output: 8192 }
    }
    return limits[modelName] || { input: 64000, output: 8192 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    // Cost per token in USD
    const costs: Record<string, { input: number; output: number }> = {
      'deepseek-chat': { input: 0.00000014, output: 0.00000028 },
      'deepseek-reasoner': { input: 0.00000055, output: 0.00000219 }
    }
    return costs[modelName] || { input: 0.00000014, output: 0.00000028 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}

