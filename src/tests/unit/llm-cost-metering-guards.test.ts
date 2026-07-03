import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

const ROOT = process.cwd()

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

async function createUsageTestRouter() {
  vi.stubEnv('GOOGLE_AI_API_KEY', '')
  vi.stubEnv('GOOGLE_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubEnv('GROQ_API_KEY', '')
  vi.stubEnv('ZHIPU_API_KEY', '')
  vi.stubEnv('QWEN_API_KEY', '')

  const { LLMProviderRouter } = await import('@/lib/metering/providers/provider-router')
  return new LLMProviderRouter() as any
}

describe('LLM cost metering guards', () => {
  it('falls back to request and response estimates when provider usage is missing', async () => {
    const router = await createUsageTestRouter()

    const usage = router.normalizeTokenUsage(
      {
        output: 'A concise generated answer with enough text to estimate output usage.',
        outputTokens: 0,
        modelClass: 'gpt-5',
        metadata: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      },
      {
        taskCode: 'GRANT_SECTION_GENERATE',
        inputTokens: 1234,
      }
    )

    expect(usage.inputTokens).toBe(1234)
    expect(usage.outputTokens).toBeGreaterThan(0)
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens)
  })

  it('does not double count reasoning tokens already included in completion tokens', async () => {
    const router = await createUsageTestRouter()

    const usage = router.normalizeTokenUsage(
      {
        output: 'Visible answer.',
        outputTokens: 300,
        modelClass: 'gpt-5.2-thinking',
        metadata: {
          inputTokens: 1000,
          outputTokens: 300,
          thoughtTokens: 80,
          totalTokens: 1300,
          usage: {
            completion_tokens: 300,
            total_tokens: 1300,
            completion_tokens_details: {
              reasoning_tokens: 80,
            },
          },
        },
      },
      {
        taskCode: 'GRANT_SECTION_GENERATE',
        inputTokens: 1000,
      }
    )

    expect(usage.inputTokens).toBe(1000)
    expect(usage.outputTokens).toBe(220)
    expect(usage.thoughtTokens).toBe(80)
    expect(usage.totalTokens).toBe(1300)
  })

  it('keeps separately reported thinking tokens when provider totals include them separately', async () => {
    const router = await createUsageTestRouter()

    const usage = router.normalizeTokenUsage(
      {
        output: 'Visible answer.',
        outputTokens: 300,
        modelClass: 'gemini-3-pro-preview-thinking',
        metadata: {
          inputTokens: 1000,
          outputTokens: 300,
          thoughtTokens: 80,
          totalTokens: 1380,
          usage: {
            promptTokenCount: 1000,
            candidatesTokenCount: 300,
            thoughtsTokenCount: 80,
            totalTokenCount: 1380,
          },
        },
      },
      {
        taskCode: 'GRANT_SECTION_GENERATE',
        inputTokens: 1000,
      }
    )

    expect(usage.inputTokens).toBe(1000)
    expect(usage.outputTokens).toBe(300)
    expect(usage.thoughtTokens).toBe(80)
    expect(usage.totalTokens).toBe(1380)
  })

  it('keeps funding and grant LLM paths off direct provider calls', () => {
    const files = [
      'src/lib/fundingTemplates/extractor.ts',
      'src/lib/fundingGuidelines/extractor.ts',
      'src/lib/services/recommendationConversationService.ts',
      'src/lib/services/recommendationSearchService.ts',
      'src/lib/services/fundingAdvisorService.ts',
      'src/lib/services/sqlToLLMConnector.ts',
      'src/lib/funding/llmRouting.ts',
      'src/lib/grants/blueprintLlmGeneration.ts',
      'src/lib/grants/drafting.ts',
      'src/lib/grantPrep/llm.ts',
    ]

    const joined = files.map((file) => readRepoFile(file)).join('\n')

    expect(joined).not.toMatch(/generateFromGemini|generateFromOpenAI|generateJsonFromDeepSeek/)
  })

  it('routes grant budget generation through the section drafting model policy', () => {
    const source = readRepoFile('src/lib/grants/drafting.ts')

    expect(source).toContain("taskCode: 'LLM2_DRAFT'")
    expect(source).toContain("stageCode: 'PAPER_SECTION_DRAFT'")
    expect(source).not.toContain("stageCode: 'GRANT_BUDGET_DRAFT'")
  })

  it('seeds Gemini embedding pricing from Google online request pricing', () => {
    const seed = readRepoFile('scripts/seed-llm-models.ts')
    const block = seed.slice(
      seed.indexOf("code: 'gemini-embedding-001'"),
      seed.indexOf('// Google - Image Generation Models')
    )

    expect(block).toContain("code: 'gemini-embedding-001'")
    expect(block).toContain('contextWindow: 2048')
    expect(block).toContain('inputCostPer1M: 15')
    expect(block).toContain('outputCostPer1M: 0')
  })

  it('seeds Voyage embedding models and assigns query and document stages', () => {
    const seed = readRepoFile('Seed/seed-llm-models.js')

    expect(seed).toContain("code: 'voyage-4-lite'")
    expect(seed).toContain('inputCostPer1M: 2')
    expect(seed).toContain("code: 'voyage-4-large'")
    expect(seed).toContain('inputCostPer1M: 12')
    expect(seed).toContain("code: 'FUNDING_DOCUMENT_RETRIEVAL'")
    expect(seed).toContain("code: 'FUNDING_DOCUMENT_CHUNK_EMBEDDING'")
    expect(seed).toContain("models: { FREE_PLAN: 'voyage-4-lite', PRO_PLAN: 'voyage-4-lite', ENTERPRISE_PLAN: 'voyage-4-lite' }")
    expect(seed).toContain("models: { FREE_PLAN: 'voyage-4-large', PRO_PLAN: 'voyage-4-large', ENTERPRISE_PLAN: 'voyage-4-large' }")
  })

  it('recognizes Voyage model codes for metering provider attribution', async () => {
    const { getModelPricingSync, getProviderFromModel } = await import('@/lib/metering/cost-calculator')

    expect(getProviderFromModel('voyage-4-lite')).toBe('Voyage')
    expect(getProviderFromModel('voyage-4-large')).toBe('Voyage')
    expect(getModelPricingSync('voyage-4-lite').input * 1_000_000).toBe(0.02)
    expect(getModelPricingSync('voyage-4-large').input * 1_000_000).toBe(0.12)
  })

  it('resolves Gemini 3 Flash preview pricing from the internal Gemini 3.1 Flash alias', async () => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        lLMModel: {
          findMany: vi.fn(async () => [
            { code: 'gemini-3.1-flash', inputCostPer1M: 50, outputCostPer1M: 300 },
          ]),
        },
        lLMModelPrice: {
          findMany: vi.fn(async () => []),
        },
      },
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const { getModelPricing } = await import('@/lib/metering/cost-calculator')
      const pricing = await getModelPricing('gemini-3-flash-preview')

      expect(pricing.input * 1_000_000).toBe(0.5)
      expect(pricing.output * 1_000_000).toBe(3)
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Model not found in database: gemini-3-flash-preview')
      )
    } finally {
      warnSpy.mockRestore()
      vi.doUnmock('@/lib/prisma')
      vi.resetModules()
    }
  })

  it('uses known Gemini 3 Flash pricing instead of the generic fallback when the DB row is missing', async () => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        lLMModel: {
          findMany: vi.fn(async () => []),
        },
        lLMModelPrice: {
          findMany: vi.fn(async () => []),
        },
      },
    }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const { getModelPricing } = await import('@/lib/metering/cost-calculator')
      const pricing = await getModelPricing('gemini-3-flash-preview')

      expect(pricing.input * 1_000_000).toBe(0.5)
      expect(pricing.output * 1_000_000).toBe(3)
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('using default pricing ($1/$4 per 1M)')
      )
    } finally {
      warnSpy.mockRestore()
      vi.doUnmock('@/lib/prisma')
      vi.resetModules()
    }
  })
})
