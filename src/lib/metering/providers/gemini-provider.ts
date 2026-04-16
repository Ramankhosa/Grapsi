// Google Gemini Provider Implementation
// Supports Gemini 2.5 Pro model

import type { LLMRequest, LLMResponse, EnforcementDecision, MultimodalContent } from '../types'
import type { LLMProvider, ProviderConfig } from './llm-provider'

export class GeminiProvider implements LLMProvider {
  name = 'gemini'
  supportedModels = [
    // Gemini 2.x Series (Text + Image Output)
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-exp',           // Experimental - best image output quality
    'gemini-2.0-flash-thinking-exp',  // Thinking model - higher quality but slower
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-exp-1206',                // Experimental model with good image capability
    // Gemini 1.5 Series
    'gemini-1.5-pro',
    'gemini-1.5-pro-002',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
    // Legacy Image Generation Models (for backwards compatibility)
    'gemini-3.0-nano-banana',
    'gemini-3-pro-preview',
    'gemini-3-pro-preview-thinking',
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image-preview'
  ]

  // Map legacy model codes (as saved in plan config) to current Google model IDs
  // This keeps old config working after Google renames/versions.
  private modelAliasMap: Record<string, string> = {
    // Gemini 1.5 stable variants
    'gemini-1.5-pro': 'gemini-1.5-pro-002',
    'gemini-1.5-flash': 'gemini-1.5-flash-002',
    // Gemini 2.x variants (align to current GA/preview IDs)
    'gemini-2.0-flash': 'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite-001',
    // Experimental models (pass through as-is)
    'gemini-2.0-flash-exp': 'gemini-2.0-flash-exp',
    'gemini-2.0-flash-thinking-exp': 'gemini-2.0-flash-thinking-exp',
    'gemini-exp-1206': 'gemini-exp-1206',
    // Legacy image models (pass through as-is)
    'gemini-3.0-nano-banana': 'gemini-3.0-nano-banana',
    'gemini-3-pro-preview': 'gemini-3-pro-preview',
    'gemini-3-pro-preview-thinking': 'gemini-3-pro-preview',
    'gemini-3-pro-image-preview': 'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image': 'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image-preview'
  }

  private config: ProviderConfig
  private client: any // Google Generative AI client

  constructor(config: ProviderConfig, name?: string) {
    this.config = config
    if (name) this.name = name

    // Initialize Google Generative AI client
    if (typeof window === 'undefined') {
      // Only initialize on server side
      console.log(`Initializing Gemini provider (${name || 'gemini'}) with API key present: ${!!config.apiKey}`)
      if (config.apiKey) {
        console.log(`API key length: ${config.apiKey.length}`)
      } else {
        console.error('No API key provided for Gemini provider!')
      }

      try {
        // Dynamic import to avoid client-side issues
        const { GoogleGenerativeAI } = require('@google/generative-ai')
        this.client = new GoogleGenerativeAI(config.apiKey)
        console.log('Gemini client initialized successfully')
      } catch (error) {
        console.warn('Google Generative AI not available:', error)
      }
    }
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

    const usageObject = usage as Record<string, unknown>
    return this.readTokenNumber(
      usageObject.thoughtsTokenCount ??
      usageObject.thoughtTokenCount ??
      usageObject.thinkingTokenCount ??
      usageObject.reasoningTokenCount ??
      usageObject.reasoning_tokens ??
      usageObject.thinking_tokens
    )
  }

  async execute(request: LLMRequest, limits: EnforcementDecision): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Gemini client not initialized')
    }

    // Use modelClass from request, or fallback to configured model, or first supported model
    const requestedModel = request.modelClass || this.config.model || this.supportedModels[0]
    const modelClass = this.modelAliasMap[requestedModel] || requestedModel

    // Thinking level support for Gemini 3 (documented as thinking_level; default is high).
    // We support two ways to request it:
    // 1) Model alias variant: gemini-3-pro-preview-thinking (defaults to "high")
    // 2) Explicit parameter: request.parameters.thinking_level
    const isGemini3 = modelClass.startsWith('gemini-3')
    const isThinkingVariant = requestedModel.endsWith('-thinking')
    const thinkingLevel = request.parameters?.thinking_level ?? (isThinkingVariant ? 'high' : undefined)

    // Note: Model validation is now handled by the model resolver
    // We allow any model code to be passed through since new models can be added via admin UI
    if (modelClass !== requestedModel) {
      console.log(`[GeminiProvider] Using model alias: requested=${requestedModel} -> api=${modelClass}`)
    } else {
      console.log(`[GeminiProvider] Using model: ${modelClass}`)
    }

    // Use enforcement limits from admin config, with provider limits as fallback
    // Admin-configured limits take priority to allow flexibility for high-output tasks
    const providerLimits = this.getTokenLimits(modelClass)
    const requested = limits.maxTokensOut || providerLimits.output
    // Allow admin to configure higher limits than provider defaults (up to model's actual max)
    const maxTokens = limits.maxTokensOut ? requested : Math.min(requested, providerLimits.output)
    const temperature = request.parameters?.temperature ?? 0.7 // Default temperature 0.7 if not specified
    const topP = request.parameters?.topP ?? 0.95 // Default topP 0.95
    
    console.log(`[GeminiProvider] Token limits: admin=${limits.maxTokensOut || 'not set'}, provider=${providerLimits.output}, using=${maxTokens}`)

    try {
      // Gemini 3 "thinking_level" is expressed in the REST request schema.
      // The @google/generative-ai SDK may not expose it directly for all versions, so for
      // gemini-3 models we call REST directly to ensure thinking_level is honored.
      if (isGemini3) {
        return await this.executeGemini3ViaRest({
          requestedModel,
          modelClass,
          request,
          maxTokens,
          temperature,
          topP,
          thinkingLevel
        })
      }

      const model = this.client.getGenerativeModel({
        model: modelClass,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
          topP: topP
        }
      })

      // Handle multimodal content (text + images + files)
      let contentToGenerate: any;
      if (request.content) {
        // Build multimodal content for Gemini
        const parts = []
        for (const part of request.content.parts) {
          if (part.type === 'text') {
            parts.push({ text: part.text })
          } else if (part.type === 'image') {
            parts.push({
              inlineData: {
                mimeType: part.image.mimeType,
                data: part.image.data
              }
            })
          } else if (part.type === 'file') {
            const mimeType = part.file?.mimeType || 'application/pdf'
            if (part.file?.data) {
              parts.push({
                inlineData: {
                  mimeType,
                  data: part.file.data
                }
              })
            } else if (part.file?.url) {
              parts.push({
                fileData: {
                  mimeType,
                  fileUri: part.file.url
                }
              })
            }
          }
        }
        contentToGenerate = parts
      } else {
        // Fallback to text-only prompt
        contentToGenerate = request.prompt || ''
      }

      // Add retry logic for network issues
      const maxRetries = 3
      let lastError: Error | null = null

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Attempting Gemini API call (attempt ${attempt}/${maxRetries})`)
          const result = await model.generateContent(contentToGenerate)
          const response = result.response

          // If we get here, the call was successful
          console.log(`Gemini API call successful on attempt ${attempt}`)

          const output = response.text()
          const usage =
            response.usageMetadata && typeof response.usageMetadata === 'object'
              ? (response.usageMetadata as Record<string, unknown>)
              : undefined
          const inputTokens = this.readTokenNumber(usage?.promptTokenCount)
          const outputTokens = this.readTokenNumber(usage?.candidatesTokenCount)
          const totalTokens = this.readTokenNumber(usage?.totalTokenCount)
          const thoughtTokens = this.extractThoughtTokens(usage)

          // Log response details for debugging
          console.log('🔍 Gemini API response details:', {
            hasCandidates: !!response.candidates,
            candidatesCount: response.candidates?.length || 0,
            finishReason: response.candidates?.[0]?.finishReason,
            outputLength: output?.length || 0,
            usage: usage
          });

          // Check if response is empty
          if (!output || output.trim().length === 0) {
            const finishReason = response.candidates?.[0]?.finishReason;
            console.error(`❌ Gemini API returned empty response - finishReason: ${finishReason}`);
            if (finishReason === 'MAX_TOKENS') {
              console.warn('💡 MAX_TOKENS reached - consider increasing token limit or reducing prompt size');
            }
            throw new Error(`Gemini API returned empty response (finishReason: ${finishReason})`);
          }

          return {
            output,
            outputTokens,
            modelClass: requestedModel,
            metadata: {
              provider: 'gemini',
              inputTokens,
              outputTokens,
              thoughtTokens,
              totalTokens,
              finishReason: response.candidates?.[0]?.finishReason,
              usage
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          console.error(`Attempt ${attempt} failed:`, lastError.message)

          // If this is not the last attempt, wait before retrying
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Exponential backoff, max 5s
            console.log(`Waiting ${delay}ms before retry...`)
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      }

      // All retries failed
      throw new Error(`Gemini API call failed after ${maxRetries} attempts. Last error: ${lastError?.message}`)
    } catch (error) {
      console.error('Gemini API error:', error)

      // Provide more detailed error information
      if (error instanceof Error) {
        if (error.message.includes('fetch failed')) {
          console.error('Network connectivity issue detected. Check internet connection and API endpoint availability.')
        } else if (error.message.includes('API_KEY')) {
          console.error('API key issue detected. Verify GOOGLE_AI_API_KEY is properly configured.')
        }
      }

      throw new Error(`Gemini API call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  getTokenLimits(modelName: string): { input: number, output: number } {
    const normalized = this.modelAliasMap[modelName] || modelName
    // Updated limits based on Google's official documentation (Jan 2025)
    // Note: Thinking models need extra headroom as thinking tokens count toward output limit
    const limits: Record<string, { input: number, output: number }> = {
      // Flash Lite models
      'gemini-2.0-flash-lite': { input: 1048576, output: 8192 },
      'gemini-2.0-flash-lite-001': { input: 1048576, output: 8192 },
      'gemini-2.5-flash-lite': { input: 1048576, output: 8192 },
      'gemini-2.5-flash': { input: 1048576, output: 8192 },
      // Flash models (including experimental with image output)
      'gemini-2.0-flash': { input: 1048576, output: 8192 },
      'gemini-2.0-flash-001': { input: 1048576, output: 8192 },
      'gemini-2.0-flash-exp': { input: 1048576, output: 8192 },            // Experimental - best image output
      'gemini-2.0-flash-thinking-exp': { input: 1048576, output: 65536 },  // Thinking model - needs more output for thinking tokens
      'gemini-exp-1206': { input: 2097152, output: 8192 },                 // Experimental model
      // Pro models - Gemini 2.5 Pro supports up to 65K output tokens
      'gemini-2.5-pro': { input: 2097152, output: 65536 },                 // Updated: supports 65K output (includes thinking tokens)
      'gemini-2.5-pro-preview': { input: 2097152, output: 65536 },         // Preview variant
      'gemini-1.5-pro': { input: 2097152, output: 8192 },                  // 1.5 Pro has lower output limit
      'gemini-1.5-pro-002': { input: 2097152, output: 8192 },
      'gemini-1.5-flash': { input: 1048576, output: 8192 },
      'gemini-1.5-flash-002': { input: 1048576, output: 8192 },
      // Legacy image generation models (backwards compatibility)
      'gemini-3.0-nano-banana': { input: 128000, output: 8192 },
      'gemini-3-pro-preview': { input: 2097152, output: 65536 },
      'gemini-3-pro-image-preview': { input: 128000, output: 8192 },
      'gemini-3.1-flash-image': { input: 128000, output: 8192 },
      'gemini-3.1-flash-image-preview': { input: 128000, output: 8192 }
    }
    
    return limits[normalized] || { input: 2097152, output: 65536 }  // Default to 65K output for newer models
  }

  getCostPerToken(modelName: string): { input: number, output: number } {
    const normalized = this.modelAliasMap[modelName] || modelName
    // Pricing per token (converted from per-million pricing)
    const costs: Record<string, { input: number, output: number }> = {
      // Flash Lite models
      'gemini-2.0-flash-lite': { input: 0.00000008, output: 0.0000003 },    // $0.08/$0.30 per M
      'gemini-2.0-flash-lite-001': { input: 0.00000008, output: 0.0000003 },
      'gemini-2.5-flash-lite': { input: 0.00000035, output: 0.0000007 },    // $0.35/$0.70 per M
      'gemini-2.5-flash': { input: 0.00000015, output: 0.0000006 },         // $0.15/$0.60 per M
      // Flash models (including experimental with image output)
      'gemini-2.0-flash': { input: 0.0000001, output: 0.0000004 },          // $0.10/$0.40 per M
      'gemini-2.0-flash-001': { input: 0.0000001, output: 0.0000004 },
      'gemini-2.0-flash-exp': { input: 0.0000001, output: 0.0000004 },      // Experimental - same pricing
      'gemini-2.0-flash-thinking-exp': { input: 0.0000003, output: 0.0000012 }, // Thinking model - higher cost
      'gemini-exp-1206': { input: 0.0000001, output: 0.0000004 },           // Experimental model
      // Pro models
      'gemini-2.5-pro': { input: 0.00000125, output: 0.000005 },            // $1.25/$5.00 per M
      'gemini-1.5-pro': { input: 0.00000125, output: 0.000005 },            // $1.25/$5.00 per M (legacy)
      'gemini-1.5-pro-002': { input: 0.00000125, output: 0.000005 },
      'gemini-1.5-flash': { input: 0.0000001, output: 0.0000004 },          // $0.10/$0.40 per M (legacy)
      'gemini-1.5-flash-002': { input: 0.0000001, output: 0.0000004 },
      // Legacy image generation models (backwards compatibility)
      'gemini-3.0-nano-banana': { input: 0.000001, output: 0.000004 },      // $1.00/$4.00 per M
      'gemini-3-pro-preview': { input: 0.00000125, output: 0.000005 },      // Placeholder - update if pricing differs
      'gemini-3-pro-image-preview': { input: 0.000001, output: 0.000004 },  // $1.00/$4.00 per M
      'gemini-3.1-flash-image': { input: 0.000001, output: 0.000004 },      // Placeholder - verify with official pricing
      'gemini-3.1-flash-image-preview': { input: 0.000001, output: 0.000004 }
    }
    
    return costs[normalized] || { input: 0.00000125, output: 0.000005 }
  }

  private async executeGemini3ViaRest(args: {
    requestedModel: string
    modelClass: string
    request: LLMRequest
    maxTokens: number
    temperature: number
    topP: number
    thinkingLevel?: string
  }): Promise<LLMResponse> {
    const { requestedModel, modelClass, request, maxTokens, temperature, topP, thinkingLevel } = args

    // Build multimodal content payload for Gemini REST API
    let parts: any[] = []
    if (request.content) {
      for (const part of request.content.parts) {
        if (part.type === 'text') {
          parts.push({ text: part.text })
        } else if (part.type === 'image') {
          parts.push({
            inlineData: {
              mimeType: part.image.mimeType,
              data: part.image.data
            }
          })
        } else if (part.type === 'file') {
          const mimeType = part.file?.mimeType || 'application/pdf'
          if (part.file?.data) {
            parts.push({
              inlineData: {
                mimeType,
                data: part.file.data
              }
            })
          } else if (part.file?.url) {
            parts.push({
              fileData: {
                mimeType,
                fileUri: part.file.url
              }
            })
          }
        }
      }
    } else {
      parts = [{ text: request.prompt || '' }]
    }

    const body: any = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        topP
      }
    }

    if (thinkingLevel) {
      body.thinking_level = thinkingLevel
    }

    // Use the configured baseURL (defaults to https://generativelanguage.googleapis.com/v1beta)
    const url = `${this.config.baseURL}/models/${encodeURIComponent(modelClass)}:generateContent`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const candidate = data?.candidates?.[0]
    const candidateParts = candidate?.content?.parts || []
    const output = candidateParts.map((p: any) => p?.text).filter(Boolean).join('\n')

    if (!output || output.trim().length === 0) {
      throw new Error(`Gemini API returned empty response (finishReason: ${candidate?.finishReason || 'unknown'})`)
    }

    const usage =
      data?.usageMetadata && typeof data.usageMetadata === 'object'
        ? (data.usageMetadata as Record<string, unknown>)
        : undefined
    const inputTokens = this.readTokenNumber(usage?.promptTokenCount)
    const outputTokens = this.readTokenNumber(usage?.candidatesTokenCount)
    const totalTokens = this.readTokenNumber(usage?.totalTokenCount)
    const thoughtTokens = this.extractThoughtTokens(usage)
    return {
      output,
      outputTokens,
      modelClass: requestedModel,
      metadata: {
        provider: 'gemini',
        inputTokens,
        outputTokens,
        thoughtTokens,
        totalTokens,
        finishReason: candidate?.finishReason,
        modelUsed: modelClass,
        thinkingLevel: thinkingLevel || undefined,
        usage
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      if (!this.client) return false

      // Simple health check - try to list models
      const model = this.client.getGenerativeModel({ model: this.config.model })
      // If we can create a model instance, consider it healthy
      return true
    } catch (error) {
      console.error('Gemini health check failed:', error)
      return false
    }
  }
}
