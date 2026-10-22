import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '@/lib/metering/providers/openai-provider'

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI fallback model output limits', () => {
  it.each([
    ['gpt-4o', 24000, 'max_tokens', 16384],
    ['gpt-4o', 7000, 'max_tokens', 7000],
    ['gpt-5.4-mini', 24000, 'max_completion_tokens', 24000],
  ])('sends a valid output allowance for %s (%i)', async (model, requested, field, expected) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenAIProvider({ apiKey: 'test', model, baseURL: 'https://example.invalid/v1' } as any)
    await provider.execute({ modelClass: model, prompt: 'Return JSON' } as any, { maxTokensOut: requested } as any)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)[field]).toBe(expected)
  })
})
