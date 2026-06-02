import { afterEach, describe, expect, it, vi } from 'vitest'

import { OpenAIProvider } from '../openai-provider'

describe('OpenAIProvider cache hints', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes prompt cache key and supported 24h retention to GPT-5 family models', async () => {
    let requestBody: any = null
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 30,
          total_tokens: 1230,
          prompt_tokens_details: { cached_tokens: 1024 },
        },
      }), { status: 200 })
    })

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
    })

    const result = await provider.execute({
      taskCode: 'FUNDING_CALL_INGEST' as any,
      prompt: 'extract funding call fields',
      modelClass: 'gpt-5.2',
      parameters: {
        prompt_cache_key: 'funding-intake:core:v1',
        prompt_cache_retention: '24h',
      },
    }, { allowed: true, maxTokensOut: 2000 })

    expect(requestBody.prompt_cache_key).toBe('funding-intake:core:v1')
    expect(requestBody.prompt_cache_retention).toBe('24h')
    expect(result.metadata?.cachedInputTokens).toBe(1024)
  })

  it('omits 24h retention for models that do not support extended prompt cache retention', async () => {
    let requestBody: any = null
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200 })
    })

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    })

    await provider.execute({
      taskCode: 'FUNDING_CALL_INGEST' as any,
      prompt: 'extract funding call fields',
      modelClass: 'gpt-4o',
      parameters: {
        prompt_cache_key: 'funding-intake:core:v1',
        prompt_cache_retention: '24h',
      },
    }, { allowed: true, maxTokensOut: 2000 })

    expect(requestBody.prompt_cache_key).toBe('funding-intake:core:v1')
    expect(requestBody.prompt_cache_retention).toBeUndefined()
  })
})
