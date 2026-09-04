/**
 * Zhipu Provider Implementation
 * Supports GLM-5 and GLM-4.5V via OpenAI-compatible API
 */

import type { LLMRequest, LLMResponse, EnforcementDecision } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'
import { collectOpenAICompatibleChatCompletionStream } from './streaming-utils'

export class ZhipuProvider implements LLMProvider {
  name = 'zhipu'
  supportedModels = [
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.2',
    'glm-5.1',
    'glm-5',
    'glm-5-turbo',
    'glm-5v-turbo',
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4.7-flashx',
    'glm-4.6',
    'glm-4.6v',
    'glm-4.6v-flash',
    'glm-4.5-air',
    'glm-4.5-airx',
    'glm-4.5-flash',
  ]

  private config: ProviderConfig
  private client: any

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    if (typeof window === 'undefined') {
      if (!config.apiKey) {
        console.error('No API key provided for Zhipu provider!')
        return
      }

      try {
        const OpenAI = require('openai')
        this.client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL || 'https://open.bigmodel.cn/api/paas/v4'
        })
      } catch (error) {
        console.warn('Zhipu client initialization failed:', error)
      }
    }
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Zhipu client not initialized')
    }

    const startTime = Date.now()
    const modelToUse = request.modelClass || this.config.model || 'glm-5'
    const modelMap: Record<string, string> = {
      'glm-5.3': 'glm-5.3',
      'glm-5.3-flash': 'glm-5.3-flash',
      'glm-5.2': 'glm-5.2',
      'glm-5.1': 'glm-5.1',
      'glm-5': 'glm-5',
      'glm-5-turbo': 'glm-5-turbo',
      'glm-5v-turbo': 'glm-5v-turbo',
      'glm-4.7': 'glm-4.7',
      'glm-4.7-flash': 'glm-4.7-flash',
      'glm-4.7-flashx': 'glm-4.7-flashx',
      'glm-4.6': 'glm-4.6',
      'glm-4.6v': 'glm-4.6v',
      'glm-4.6v-flash': 'glm-4.6v-flash',
      'glm-4.5-air': 'glm-4.5-air',
      'glm-4.5-airx': 'glm-4.5-airx',
      'glm-4.5-flash': 'glm-4.5-flash',
      // Legacy aliases — route retired codes to valid replacements
      'glm-4.5': 'glm-4.5-air',
      'glm-4.5-x': 'glm-4.5-airx',
      'glm-4.5v': 'glm-4.6v',
      'glm-4-5v': 'glm-4.6v',
      'glm-4-32b-0414-128k': 'glm-4.7-flash',
    }
    const actualModel = modelMap[modelToUse] || modelToUse

    try {
      const messages: any[] = []

      if (request.content?.parts?.length) {
        const hasMultimodalBinary = request.content.parts.some(
          p => p.type === 'image' || p.type === 'file'
        )

        const visionModels = new Set(['glm-5v-turbo', 'glm-4.6v', 'glm-4.6v-flash'])
        if (hasMultimodalBinary && visionModels.has(actualModel)) {
          const multimodalParts: any[] = []
          for (const part of request.content.parts) {
            if (part.type === 'text') {
              multimodalParts.push({ type: 'text', text: part.text })
            } else if (part.type === 'image') {
              multimodalParts.push({
                type: 'image_url',
                image_url: {
                  url: `data:${part.image.mimeType || 'image/jpeg'};base64,${part.image.data}`
                }
              })
            } else if (part.type === 'file') {
              const fileUrl = String(part.file?.url || '').trim()
              if (!fileUrl) {
                throw new Error('Zhipu file input requires file.url (publicly reachable HTTP/HTTPS URL)')
              }
              multimodalParts.push({
                type: 'file_url',
                file_url: {
                  url: fileUrl
                }
              })
            }
          }
          messages.push({ role: 'user', content: multimodalParts })
        } else {
          const textParts = request.content.parts
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('\n')
          if (textParts) {
            messages.push({ role: 'user', content: textParts })
          }
        }
      } else if (request.prompt) {
        messages.push({ role: 'user', content: request.prompt })
      }

      if (messages.length === 0) {
        throw new Error('No valid content provided for Zhipu request')
      }

      const modelLimits = this.getTokenLimits(actualModel)
      const requestedMaxTokens = limits.maxTokensOut || modelLimits.output
      const maxTokens = Math.max(1, Math.min(requestedMaxTokens, modelLimits.output))
      if (requestedMaxTokens > modelLimits.output) {
        console.warn(
          `[ZhipuProvider] Clamping max_tokens from ${requestedMaxTokens} to ${maxTokens} for model ${actualModel}`
        )
      }

      const createParams = {
        model: actualModel,
        messages,
        max_tokens: maxTokens,
        temperature: request.parameters?.temperature ?? 0.7
      }

      if (request.stream?.onToken) {
        return await collectOpenAICompatibleChatCompletionStream({
          client: this.client,
          createParams,
          request,
          providerName: this.name,
          modelClass: modelToUse,
          actualModel,
          startedAt: startTime
        })
      }

      const response = await this.client.chat.completions.create(createParams)

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
      console.error('Zhipu API error:', error)
      throw new Error(`Zhipu API error: ${error.message || 'Unknown error'}`)
    }
  }

  getTokenLimits(modelName: string): { input: number; output: number } {
    const limits: Record<string, { input: number; output: number }> = {
      'glm-5.2': { input: 200000, output: 65536 },
      'glm-5.1': { input: 200000, output: 65536 },
      'glm-5': { input: 200000, output: 65536 },
      'glm-5-turbo': { input: 200000, output: 65536 },
      'glm-5v-turbo': { input: 200000, output: 65536 },
      'glm-4.7': { input: 128000, output: 32768 },
      'glm-4.7-flash': { input: 128000, output: 32768 },
      'glm-4.7-flashx': { input: 128000, output: 32768 },
      'glm-4.6': { input: 128000, output: 32768 },
      'glm-4.6v': { input: 128000, output: 16384 },
      'glm-4.6v-flash': { input: 128000, output: 16384 },
      'glm-4.5-air': { input: 128000, output: 32768 },
      'glm-4.5-airx': { input: 128000, output: 32768 },
      'glm-4.5-flash': { input: 128000, output: 32768 },
    }
    return limits[modelName] || { input: 128000, output: 8192 }
  }

  getCostPerToken(modelName: string): { input: number; output: number } {
    const costs: Record<string, { input: number; output: number }> = {
      // USD per token (from per-1M pricing)
      'glm-5.2': { input: 0.0000016, output: 0.0000048 },
      'glm-5.1': { input: 0.0000014, output: 0.0000044 },
      'glm-5': { input: 0.000001, output: 0.0000032 },
      'glm-5-turbo': { input: 0.0000012, output: 0.000004 },
      'glm-5v-turbo': { input: 0.0000012, output: 0.000004 },
      'glm-4.7': { input: 0.000001, output: 0.0000032 },
      'glm-4.7-flash': { input: 0.0000002, output: 0.0000011 },
      'glm-4.7-flashx': { input: 0.0000002, output: 0.0000011 },
      'glm-4.6': { input: 0.000001, output: 0.0000032 },
      'glm-4.6v': { input: 0.000001, output: 0.0000032 },
      'glm-4.6v-flash': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5-air': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5-airx': { input: 0.0000002, output: 0.0000011 },
      'glm-4.5-flash': { input: 0.0000002, output: 0.0000011 },
    }
    return costs[modelName] || { input: 0.000001, output: 0.0000032 }
  }

  async isHealthy(): Promise<boolean> {
    return !!this.client
  }
}
