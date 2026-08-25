// Shared LLM plumbing for the reviewer's auxiliary calls (landscape distill,
// facet map, novelty, final panel report, revision comparison).
//
// Extracted from landscape.ts so the final-report generator can use the same
// resilience ladder without transitively importing the landscape's search
// machinery.

import type { TaskCode } from '@/lib/prisma-generated'
import { runFundingGatewayText } from '@/lib/funding/llmRouting'
import { generateFromGemini } from '@/lib/geminiService'
import { DEFAULT_OPENAI_FALLBACK_MODEL, generateFromOpenAI } from '@/lib/openaiService'

const AUX_TASK_CODE = 'GRANT_SECTION_GENERATE' as TaskCode
const DEFAULT_FALLBACK_GEMINI_MODEL = 'gemini-2.5-flash'

export type OwnerContext = { tenantId: string | null; userId: string | null }

/**
 * One LLM text call with the reviewer's resilience ladder: the metered gateway
 * stage first (admin-configurable), then the direct provider matching the
 * call's model family, then the other provider. Returns null when every rung
 * fails — callers fall back deterministically, never throw.
 */
export async function runReviewerAuxiliaryText(input: {
  stageCode: string
  prompt: string
  systemPrompt: string
  owner: OwnerContext
  modelType: 'O' | 'G'
  maxTokensOut: number
  temperature?: number
  /** Provider-side prompt cache key; honoured by the OpenAI provider. */
  promptCacheKey?: string
  promptCacheRetention?: 'in_memory' | '24h'
  /**
   * Model for the last-rung direct Gemini call. Defaults to flash; the final
   * panel report passes gemini-2.5-pro so a gateway outage never silently
   * downgrades the report's quality tier.
   */
  fallbackGeminiModel?: string
  metadataPurpose?: string
}): Promise<string | null> {
  const fallbackGeminiModel = input.fallbackGeminiModel || DEFAULT_FALLBACK_GEMINI_MODEL
  const metadataPurpose = input.metadataPurpose || 'reviewer_landscape'

  try {
    const gatewayResult = await runFundingGatewayText({
      taskCode: AUX_TASK_CODE,
      stageCode: input.stageCode,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      context: { tenantId: input.owner.tenantId, userId: input.owner.userId },
      responseMimeType: 'application/json',
      temperature: input.temperature ?? 0.1,
      maxTokensOut: input.maxTokensOut,
      ...(input.promptCacheKey ? { promptCacheKey: input.promptCacheKey } : {}),
      ...(input.promptCacheRetention ? { promptCacheRetention: input.promptCacheRetention } : {}),
      skipFeaturePolicy: true,
      metadata: { purpose: metadataPurpose, stage: input.stageCode },
    })
    if (gatewayResult?.rawText) return gatewayResult.rawText
  } catch (error) {
    console.warn(`[ReviewerAux:${input.stageCode}] gateway stage failed, using direct fallback:`, error instanceof Error ? error.message : error)
  }

  if (input.modelType === 'O') {
    try {
      return await generateFromOpenAI(input.prompt, DEFAULT_OPENAI_FALLBACK_MODEL, input.systemPrompt, {
        maxOutputTokens: input.maxTokensOut,
      })
    } catch (error) {
      console.warn(`[ReviewerAux:${input.stageCode}] OpenAI fallback failed, trying Gemini:`, error instanceof Error ? error.message : error)
    }
  }
  try {
    return await generateFromGemini(`${input.systemPrompt}\n\n${input.prompt}`, fallbackGeminiModel)
  } catch (error) {
    console.warn(`[ReviewerAux:${input.stageCode}] Gemini fallback failed:`, error instanceof Error ? error.message : error)
    return null
  }
}
