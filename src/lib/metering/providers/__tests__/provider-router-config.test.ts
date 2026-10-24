import { describe, expect, it } from 'vitest'
import { buildProviderConfigsFromEnv } from '../provider-router'
import Anthropic from '@anthropic-ai/sdk'

describe('LLMProviderRouter OpenAI config defaults', () => {
  it('does not force a 30s timeout when OPENAI_TIMEOUT_MS is unset', () => {
    const configs = buildProviderConfigsFromEnv({
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'test-key',
    } as NodeJS.ProcessEnv)

    expect(configs.openai.timeout).toBeUndefined()
    expect(configs.openai.maxRetries).toBeUndefined()
  })

  it('preserves explicit OpenAI timeout and retry overrides from env', () => {
    const configs = buildProviderConfigsFromEnv({
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'test-key',
      OPENAI_TIMEOUT_MS: '45000',
      OPENAI_MAX_RETRIES: '5',
    } as NodeJS.ProcessEnv)

    expect(configs.openai.timeout).toBe(45000)
    expect(configs.openai.maxRetries).toBe(5)
  })

  it('uses the current DeepSeek OpenAI-compatible base URL by default', () => {
    const configs = buildProviderConfigsFromEnv({
      NODE_ENV: 'test',
      DEEPSEEK_API_KEY: 'test-key',
    } as NodeJS.ProcessEnv)

    expect(configs.deepseek.baseURL).toBe('https://api.deepseek.com')
  })

  it('sends Anthropic SDK requests to a single /v1/messages path', async () => {
    const config = buildProviderConfigsFromEnv({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'test-key' }).anthropic
    const requests: string[] = []
    const client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
      fetch: async (input) => {
        requests.push(String(input))
        return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 16, messages: [{ role: 'user', content: 'Synthetic test' }] })
    expect(requests).toEqual(['https://api.anthropic.com/v1/messages'])
  })
})
