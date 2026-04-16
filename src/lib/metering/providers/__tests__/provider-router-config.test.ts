import { describe, expect, it } from 'vitest'
import { buildProviderConfigsFromEnv } from '../provider-router'

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
})
