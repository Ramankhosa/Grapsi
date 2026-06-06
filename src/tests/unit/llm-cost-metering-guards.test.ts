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
})
