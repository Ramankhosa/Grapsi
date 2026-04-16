/**
 * Qwen Provider Implementation
 * Supports Qwen 2.5 models via DashScope-compatible API
 */

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class QwenProvider implements LLMProvider {
  name = 'qwen'
  supportedModels = ['qwen2.5-72b-instruct']

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      if (!config.apiKey) {
        console.error('No API key provided for Qwen provider!')
        return
      }

      try {
        const OpenAI = require('openai')
        this.client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
        })
      } catch (error) {
        console.warn('Qwen client initialization failed:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Qwen client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'qwen2.5-72b-instruct'
    const modelMap: Record<string, string> = {
      'qwen2.5-72b-instruct': 'qwen2.5-72b-instruct',
      'qwen-2.5-72b-instruct': 'qwen2.5-72b-instruct'
    }
    const actualModel = modelMap[modelToUse] || modelToUse

    try {
      const messages: any[] = []

      if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      } else if (request.content?.parts?.length) {
        const textParts = request.content.parts
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('\n')

        if (textParts) {
          messages.push({ role: 'user', content: textParts })
        }
      }

      if (messages.length === 0) {
        throw new Error('No valid content provided for Qwen request')
      }

      const modelLimits = this.getTokenLimits(actualModel)
      const maxTokens = limits.maxTokensOut || modelLimits.output

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
      console.error('Qwen API error:', error)
      throw new Error(`Qwen API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    const limits: Record<string, { input: number; output: number }> = {
      'qwen2.5-72b-instruct': { input: 131072, output: 8192 }
    }
    return limits[modelName] || { input: 131072, output: 8192 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    const costs: Record<string, { input: number; output: number }> = {
      // USD per token (from per-1M pricing)
      'qwen2.5-72b-instruct': { input: 0.0000014, output: 0.0000056 }
    }
    return costs[modelName] || { input: 0.0000014, output: 0.0000056 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}
